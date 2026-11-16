//! Minimal read-only reader for the *local* CASC storage of an installed WoW client
//! (`<WoW>/Data/{config,data}`). It only resolves files by their path name hash and never talks to a CDN.
//! Formats: .build.info, build config, local `.idx` (v7), `data.###` + BLTE, encoding, root (TSFM v1/v2).

use crate::error::{AppError, AppResult};
use crate::i18n::tr;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Upper bound for a single stored file (encoding is ~140 MB on current clients).
const MAX_FILE_BYTES: usize = 512 * 1024 * 1024;

fn bad(what: &str) -> AppError {
    AppError::new("wow_client", tr(format!("WoW-Spieldaten nicht lesbar ({what})"), format!("Cannot read WoW game data ({what})")))
}

fn hex16(s: &str) -> Option<[u8; 16]> {
    let s = s.trim();
    if s.len() != 32 {
        return None;
    }
    let mut out = [0u8; 16];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(s.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

#[derive(Debug, Clone)]
pub struct BuildInfoRow {
    pub product: String,
    pub build_key: String,
    pub version: String,
    pub active: bool,
}

/// Parses `<WoW>/.build.info` (pipe-separated table, header `Name!TYPE:len`).
pub fn read_build_info(root: &Path) -> AppResult<Vec<BuildInfoRow>> {
    let text = std::fs::read_to_string(root.join(".build.info")).map_err(|_| bad(".build.info"))?;
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let header: Vec<String> = lines.next().ok_or_else(|| bad(".build.info"))?.split('|').map(|h| h.split('!').next().unwrap_or("").to_string()).collect();
    let col = |n: &str| header.iter().position(|h| h == n);
    let (Some(p), Some(b)) = (col("Product"), col("Build Key")) else { return Err(bad(".build.info")) };
    let (v, a) = (col("Version"), col("Active"));
    Ok(lines
        .map(|l| l.split('|').collect::<Vec<_>>())
        .filter_map(|f| {
            Some(BuildInfoRow {
                product: f.get(p)?.to_string(),
                build_key: f.get(b)?.to_string(),
                version: v.and_then(|i| f.get(i)).unwrap_or(&"").to_string(),
                active: a.and_then(|i| f.get(i)).map(|s| *s == "1").unwrap_or(true),
            })
        })
        .filter(|r| hex16(&r.build_key).is_some())
        .collect())
}

#[derive(Debug, Clone, Copy)]
struct IdxEntry {
    archive: u32,
    offset: u64,
    size: u32,
}

pub struct Storage {
    data_dir: PathBuf,
    build: HashMap<String, String>,
}

impl Storage {
    pub fn open(root: &Path, product: &str) -> AppResult<Storage> {
        let row = read_build_info(root)?.into_iter().find(|r| r.product == product).ok_or_else(|| bad(product))?;
        let k = row.build_key.to_lowercase();
        let data_dir = root.join("Data");
        let cfg = std::fs::read_to_string(data_dir.join("config").join(&k[0..2]).join(&k[2..4]).join(&k)).map_err(|_| bad("build config"))?;
        let build = cfg
            .lines()
            .filter_map(|l| l.split_once(" = "))
            .map(|(a, b)| (a.trim().to_string(), b.trim().to_string()))
            .collect();
        Ok(Storage { data_dir, build })
    }

    fn cfg_key(&self, name: &str, index: usize) -> AppResult<[u8; 16]> {
        self.build.get(name).and_then(|v| v.split_whitespace().nth(index)).and_then(hex16).ok_or_else(|| bad(name))
    }

    /// Scans the newest `.idx` file of every bucket for the wanted encoding keys (first 9 bytes).
    fn idx_lookup(&self, wanted: &HashSet<[u8; 9]>) -> AppResult<HashMap<[u8; 9], IdxEntry>> {
        let dir = self.data_dir.join("data");
        let mut newest: HashMap<String, String> = HashMap::new();
        for e in std::fs::read_dir(&dir).map_err(|_| bad("Data/data"))?.flatten() {
            let n = e.file_name().to_string_lossy().to_lowercase();
            if n.len() == 14 && n.ends_with(".idx") && n[..10].chars().all(|c| c.is_ascii_hexdigit()) {
                let bucket = n[..2].to_string();
                if newest.get(&bucket).map_or(true, |o| n > *o) {
                    newest.insert(bucket, n);
                }
            }
        }
        let mut out = HashMap::new();
        for name in newest.values() {
            let b = std::fs::read(dir.join(name))?;
            let rd32 = |i: usize| b.get(i..i + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap()));
            let hsz = rd32(0).ok_or_else(|| bad("idx"))? as usize;
            let mut p = (8 + hsz + 15) & !15;
            let esz = rd32(p).ok_or_else(|| bad("idx"))? as usize;
            p += 8;
            let end = (p + esz).min(b.len());
            while p + 18 <= end {
                let key: [u8; 9] = b[p..p + 9].try_into().unwrap();
                if wanted.contains(&key) && !out.contains_key(&key) {
                    let hi = b[p + 9] as u64;
                    let lo = u32::from_be_bytes(b[p + 10..p + 14].try_into().unwrap()) as u64;
                    let packed = (hi << 32) | lo;
                    let size = u32::from_le_bytes(b[p + 14..p + 18].try_into().unwrap());
                    out.insert(key, IdxEntry { archive: (packed >> 30) as u32, offset: packed & 0x3FFF_FFFF, size });
                }
                p += 18;
            }
        }
        Ok(out)
    }

    fn read_entry(&self, e: IdxEntry) -> AppResult<Vec<u8>> {
        if e.size < 30 || e.size as usize > MAX_FILE_BYTES {
            return Err(bad("data size"));
        }
        let mut f = File::open(self.data_dir.join("data").join(format!("data.{:03}", e.archive))).map_err(|_| bad("data archive"))?;
        f.seek(SeekFrom::Start(e.offset + 30))?;
        let mut raw = vec![0u8; e.size as usize - 30];
        f.read_exact(&mut raw).map_err(|_| bad("data archive"))?;
        blte_decode(&raw)
    }

    /// Reads files by encoding key; missing (not installed locally) keys are left out.
    fn read_ekeys(&self, ekeys: &[[u8; 16]]) -> AppResult<HashMap<[u8; 16], Vec<u8>>> {
        let short = |k: &[u8; 16]| -> [u8; 9] { k[..9].try_into().unwrap() };
        let wanted: HashSet<[u8; 9]> = ekeys.iter().map(short).collect();
        let idx = self.idx_lookup(&wanted)?;
        let mut out = HashMap::new();
        for k in ekeys {
            if let Some(e) = idx.get(&short(k)) {
                if let Ok(data) = self.read_entry(*e) {
                    out.insert(*k, data);
                }
            }
        }
        Ok(out)
    }

    /// Loads encoding and root once; files are then resolved by path or file data ID.
    pub fn index(&self) -> AppResult<Index<'_>> {
        let enc_ekey = self.cfg_key("encoding", 1)?;
        let root_ckey = self.cfg_key("root", 0)?;
        let enc = self.read_ekeys(&[enc_ekey])?.remove(&enc_ekey).ok_or_else(|| bad("encoding"))?;
        let root_ekey = *encoding_lookup(&enc, &HashSet::from([root_ckey]))?.get(&root_ckey).ok_or_else(|| bad("root"))?;
        let root = self.read_ekeys(&[root_ekey])?.remove(&root_ekey).ok_or_else(|| bad("root"))?;
        Ok(Index { storage: self, enc, root })
    }

    /// Resolves file paths (e.g. `Interface/WorldMap/Elwynn/Elwynn1.blp`) and returns the decoded contents
    /// of those that exist in the local storage, keyed by the given path.
    pub fn read_files_by_name(&self, paths: &[String]) -> AppResult<HashMap<String, Vec<u8>>> {
        let idx = self.index()?;
        let ids = idx.fdids_by_name(paths)?;
        let data = idx.read_fdids(&ids.values().copied().collect::<Vec<_>>())?;
        Ok(ids.into_iter().filter_map(|(p, id)| data.get(&id).map(|d| (p, d.clone()))).collect())
    }
}

pub struct Index<'a> {
    storage: &'a Storage,
    enc: Vec<u8>,
    root: Vec<u8>,
}

impl Index<'_> {
    /// Path → file data ID (only paths the root file knows by name hash).
    pub fn fdids_by_name(&self, paths: &[String]) -> AppResult<HashMap<String, i64>> {
        let by_hash: HashMap<u64, &String> = paths.iter().map(|p| (name_hash(p), p)).collect();
        let (names, _) = root_scan(&self.root, &by_hash.keys().copied().collect(), &HashSet::new())?;
        Ok(names.into_iter().filter_map(|(h, id)| by_hash.get(&h).map(|p| ((*p).clone(), id))).collect())
    }

    /// Decoded contents of the given file data IDs that are present in the local storage.
    pub fn read_fdids(&self, fdids: &[i64]) -> AppResult<HashMap<i64, Vec<u8>>> {
        let (_, ckeys) = root_scan(&self.root, &HashSet::new(), &fdids.iter().copied().collect())?;
        let c2e = encoding_lookup(&self.enc, &ckeys.values().copied().collect())?;
        let ekeys: Vec<[u8; 16]> = c2e.values().copied().collect();
        let data = self.storage.read_ekeys(&ekeys)?;
        Ok(ckeys.into_iter().filter_map(|(id, c)| c2e.get(&c).and_then(|e| data.get(e)).map(|d| (id, d.clone()))).collect())
    }
}

/// Decodes a BLTE container. Encrypted chunks are rejected (no keys are used).
pub fn blte_decode(b: &[u8]) -> AppResult<Vec<u8>> {
    if b.get(0..4) != Some(b"BLTE") {
        return Err(bad("BLTE"));
    }
    let hs = u32::from_be_bytes(b.get(4..8).ok_or_else(|| bad("BLTE"))?.try_into().unwrap()) as usize;
    let mut chunks: Vec<(usize, usize)> = vec![];
    let mut p;
    if hs == 0 {
        chunks.push((b.len() - 8, 0));
        p = 8;
    } else {
        let n = b.get(9..12).map(|s| u32::from_be_bytes([0, s[0], s[1], s[2]])).ok_or_else(|| bad("BLTE"))? as usize;
        for i in 0..n {
            let at = 12 + i * 24;
            let c = b.get(at..at + 8).ok_or_else(|| bad("BLTE"))?;
            chunks.push((u32::from_be_bytes(c[0..4].try_into().unwrap()) as usize, u32::from_be_bytes(c[4..8].try_into().unwrap()) as usize));
        }
        p = hs;
    }
    let total: usize = chunks.iter().map(|c| c.1).sum();
    if total > MAX_FILE_BYTES {
        return Err(bad("BLTE size"));
    }
    let mut out = Vec::with_capacity(total);
    for (csize, _) in chunks {
        let d = b.get(p..p + csize).ok_or_else(|| bad("BLTE"))?;
        p += csize;
        match d.first() {
            Some(b'N') => out.extend_from_slice(&d[1..]),
            Some(b'Z') => {
                flate2::read::ZlibDecoder::new(&d[1..]).take((MAX_FILE_BYTES - out.len()) as u64).read_to_end(&mut out).map_err(|_| bad("zlib"))?;
            }
            Some(b'F') => out.extend(blte_decode(&d[1..])?),
            Some(b'E') => return Err(AppError::new("wow_client_encrypted", tr("Datei ist verschlüsselt", "File is encrypted"))),
            _ => return Err(bad("BLTE mode")),
        }
    }
    Ok(out)
}

/// Content key → encoding key for the wanted content keys (linear scan of the CEKey pages).
pub fn encoding_lookup(enc: &[u8], wanted: &HashSet<[u8; 16]>) -> AppResult<HashMap<[u8; 16], [u8; 16]>> {
    if enc.get(0..2) != Some(b"EN") || enc.len() < 22 || enc[2] != 1 || enc[3] != 16 || enc[4] != 16 {
        return Err(bad("encoding"));
    }
    let page = u16::from_be_bytes([enc[5], enc[6]]) as usize * 1024;
    let pages = u32::from_be_bytes(enc[9..13].try_into().unwrap()) as usize;
    let espec = u32::from_be_bytes(enc[18..22].try_into().unwrap()) as usize;
    let start = 22 + espec + pages * 32;
    let mut out = HashMap::new();
    for i in 0..pages {
        let mut q = start + i * page;
        let end = (q + page).min(enc.len());
        while q + 22 <= end {
            let n = enc[q] as usize;
            if n == 0 {
                break;
            }
            let ck: [u8; 16] = enc[q + 6..q + 22].try_into().unwrap();
            if wanted.contains(&ck) {
                if let Some(ek) = enc.get(q + 22..q + 38) {
                    out.insert(ck, ek.try_into().unwrap());
                }
            }
            q += 22 + 16 * n;
        }
        if out.len() == wanted.len() {
            break;
        }
    }
    Ok(out)
}

const LOCALE_ENUS: u32 = 0x2;
const NO_NAME_HASH: u32 = 0x1000_0000;

/// Root (TSFM) scan: name hash → file data ID for the wanted hashes, and file data ID → content key for the wanted IDs
/// plus the IDs found by name (prefers enUS / all-locale records).
pub type RootScan = (HashMap<u64, i64>, HashMap<i64, [u8; 16]>);

pub fn root_scan(root: &[u8], hashes: &HashSet<u64>, fdids: &HashSet<i64>) -> AppResult<RootScan> {
    let u32at = |i: usize| root.get(i..i + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap()));
    if u32at(0) != Some(0x4D46_5354) {
        return Err(bad("root (TSFM)"));
    }
    let (a, b) = (u32at(4).ok_or_else(|| bad("root"))?, u32at(8).ok_or_else(|| bad("root"))?);
    let (version, named, r) = if a == 0x18 && b < 10 { (b, u32at(16).ok_or_else(|| bad("root"))?, a as usize) } else { (1, b, 12) };
    // pass 1: name hash -> file data id; pass 2: file data id -> content key
    let mut fdid_of: HashMap<u64, i64> = HashMap::new();
    let mut best: HashMap<i64, ([u8; 16], bool)> = HashMap::new();
    let mut wanted_ids: HashSet<i64> = HashSet::new();
    for pass in 0..2 {
        let mut p = r;
        while p < root.len() {
            let n = u32at(p).ok_or_else(|| bad("root"))? as usize;
            let (cf, lf, hdr) = if version >= 2 {
                let lf = u32at(p + 4).ok_or_else(|| bad("root"))?;
                let cf = u32at(p + 8).ok_or_else(|| bad("root"))? | u32at(p + 12).ok_or_else(|| bad("root"))? | ((*root.get(p + 16).ok_or_else(|| bad("root"))? as u32) << 17);
                (cf, lf, 17)
            } else {
                (u32at(p + 4).ok_or_else(|| bad("root"))?, u32at(p + 8).ok_or_else(|| bad("root"))?, 12)
            };
            p += hdr;
            let ids_at = p;
            let ck_at = ids_at + n * 4;
            let has_names = cf & NO_NAME_HASH == 0 && named > 0;
            let nh_at = ck_at + n * 16;
            let next = nh_at + if has_names { n * 8 } else { 0 };
            if next > root.len() {
                return Err(bad("root"));
            }
            let mut fdid: i64 = -1;
            for i in 0..n {
                fdid += 1 + i32::from_le_bytes(root[ids_at + i * 4..ids_at + i * 4 + 4].try_into().unwrap()) as i64;
                if pass == 0 {
                    if has_names {
                        let h = u64::from_le_bytes(root[nh_at + i * 8..nh_at + i * 8 + 8].try_into().unwrap());
                        if hashes.contains(&h) {
                            fdid_of.insert(h, fdid);
                        }
                    }
                } else if wanted_ids.contains(&fdid) {
                    let ck: [u8; 16] = root[ck_at + i * 16..ck_at + i * 16 + 16].try_into().unwrap();
                    let en = lf & LOCALE_ENUS != 0;
                    if best.get(&fdid).map_or(true, |(_, had_en)| en && !had_en) {
                        best.insert(fdid, (ck, en));
                    }
                }
            }
            p = next;
        }
        wanted_ids = fdid_of.values().copied().chain(fdids.iter().copied()).collect();
        if pass == 0 && wanted_ids.is_empty() {
            break;
        }
    }
    Ok((fdid_of, best.into_iter().map(|(f, (c, _))| (f, c)).collect()))
}

/// Jenkins `hashlittle2` over the normalised path (upper case, backslashes) as used by WoW root files.
pub fn name_hash(path: &str) -> u64 {
    let norm: Vec<u8> = path.bytes().map(|c| if c == b'/' { b'\\' } else { c.to_ascii_uppercase() }).collect();
    let mut len = norm.len();
    let mut a = 0xdead_beefu32.wrapping_add(len as u32);
    let (mut b, mut c) = (a, a);
    let w = |s: &[u8]| u32::from_le_bytes(s.try_into().unwrap());
    let mut o = 0;
    while len > 12 {
        a = a.wrapping_add(w(&norm[o..o + 4]));
        b = b.wrapping_add(w(&norm[o + 4..o + 8]));
        c = c.wrapping_add(w(&norm[o + 8..o + 12]));
        a = a.wrapping_sub(c); a ^= c.rotate_left(4); c = c.wrapping_add(b);
        b = b.wrapping_sub(a); b ^= a.rotate_left(6); a = a.wrapping_add(c);
        c = c.wrapping_sub(b); c ^= b.rotate_left(8); b = b.wrapping_add(a);
        a = a.wrapping_sub(c); a ^= c.rotate_left(16); c = c.wrapping_add(b);
        b = b.wrapping_sub(a); b ^= a.rotate_left(19); a = a.wrapping_add(c);
        c = c.wrapping_sub(b); c ^= b.rotate_left(4); b = b.wrapping_add(a);
        len -= 12;
        o += 12;
    }
    if len == 0 {
        return ((c as u64) << 32) | b as u64;
    }
    let mut t = [0u8; 12];
    t[..len].copy_from_slice(&norm[o..o + len]);
    a = a.wrapping_add(w(&t[0..4]));
    b = b.wrapping_add(w(&t[4..8]));
    c = c.wrapping_add(w(&t[8..12]));
    c ^= b; c = c.wrapping_sub(b.rotate_left(14));
    a ^= c; a = a.wrapping_sub(c.rotate_left(11));
    b ^= a; b = b.wrapping_sub(a.rotate_left(25));
    c ^= b; c = c.wrapping_sub(b.rotate_left(16));
    a ^= c; a = a.wrapping_sub(c.rotate_left(4));
    b ^= a; b = b.wrapping_sub(a.rotate_left(14));
    c ^= b; c = c.wrapping_sub(b.rotate_left(24));
    ((c as u64) << 32) | b as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_hash_matches_client_root() {
        // values observed in a live root file (also equal to CascLib's hashlittle2 output)
        assert_eq!(name_hash("Interface/WorldMap/Elwynn/Elwynn1.blp"), 0xf36a9c9dc822890e);
        assert_eq!(name_hash("interface\\worldmap\\wetlands\\wetlands1.blp"), 0x67ce33c426b32825);
        assert_eq!(name_hash("Interface/WorldMap/Duskwood/Duskwood12.blp"), 0x4637a9c71127e9a8);
    }

    #[test]
    fn blte_plain_zlib_and_rejects() {
        let mut single = b"BLTE\0\0\0\0N".to_vec();
        single.extend_from_slice(b"hello");
        assert_eq!(blte_decode(&single).unwrap(), b"hello");

        let z = {
            use std::io::Write;
            let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            e.write_all(b"world!").unwrap();
            e.finish().unwrap()
        };
        let chunks: [(Vec<u8>, usize); 2] = [([b"N".to_vec(), b"ab".to_vec()].concat(), 2), ([b"Z".to_vec(), z].concat(), 6)];
        let hs = 12 + 24 * chunks.len();
        let mut m = b"BLTE".to_vec();
        m.extend_from_slice(&(hs as u32).to_be_bytes());
        m.extend_from_slice(&[0x0F, 0, 0, chunks.len() as u8]);
        for (c, d) in &chunks {
            m.extend_from_slice(&(c.len() as u32).to_be_bytes());
            m.extend_from_slice(&(*d as u32).to_be_bytes());
            m.extend_from_slice(&[0; 16]);
        }
        for (c, _) in &chunks {
            m.extend_from_slice(c);
        }
        assert_eq!(blte_decode(&m).unwrap(), b"abworld!");

        assert!(blte_decode(b"BLTE\0\0\0\0Exxxx").is_err());
        assert!(blte_decode(b"NOPE").is_err());
        assert!(blte_decode(b"BLTE\0\0\0\x30\x0f\0\0\x09").is_err());
    }
}
