//! Minimal reader for WDC3/WDC4/WDC5 client database files (non-sparse tables only).
//! Returns every record as raw unsigned field values; column meaning comes from the caller (WoWDBDefs layout).

use crate::error::{AppError, AppResult};
use std::collections::HashMap;

fn bad(what: &str) -> AppError {
    AppError::new("wow_client", crate::i18n::tr(format!("Spieltabelle nicht lesbar ({what})"), format!("Cannot read game table ({what})")))
}

#[derive(Debug, Clone)]
pub struct Row {
    pub id: u32,
    /// Foreign key from the relationship map (`$noninline,relation$` columns), if the table has one.
    pub relation: Option<u32>,
    /// Inline fields in file order; arrays have several values.
    pub fields: Vec<Vec<u32>>,
}

pub struct Table {
    pub layout_hash: u32,
    pub rows: Vec<Row>,
}

#[derive(Clone, Copy)]
struct Storage {
    offset_bits: u32,
    size_bits: u32,
    additional: u32,
    kind: u32,
    v1: u32,
    v3: u32,
}

struct R<'a>(&'a [u8]);
impl R<'_> {
    fn u16(&self, i: usize) -> AppResult<u16> {
        self.0.get(i..i + 2).map(|s| u16::from_le_bytes([s[0], s[1]])).ok_or_else(|| bad("eof"))
    }
    fn u32(&self, i: usize) -> AppResult<u32> {
        self.0.get(i..i + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap())).ok_or_else(|| bad("eof"))
    }
}

/// Reads `bits` bits (≤ 32) starting at bit `off` of `rec` (little endian bit order).
fn bits(rec: &[u8], off: u32, bits: u32) -> u32 {
    let mut v: u64 = 0;
    let first = (off / 8) as usize;
    for (k, b) in rec.iter().skip(first).take(5).enumerate() {
        v |= (*b as u64) << (8 * k);
    }
    v >>= off % 8;
    if bits >= 32 { v as u32 } else { (v & ((1u64 << bits) - 1)) as u32 }
}

pub fn parse(b: &[u8]) -> AppResult<Table> {
    let r = R(b);
    let magic = b.get(0..4).ok_or_else(|| bad("header"))?;
    let base = match magic {
        b"WDC3" => 4,
        b"WDC4" | b"WDC5" => 4 + 4 + 128,
        _ => return Err(bad("format")),
    };
    let record_count = r.u32(base)? as usize;
    let field_count = r.u32(base + 4)? as usize;
    let record_size = r.u32(base + 8)? as usize;
    let layout_hash = r.u32(base + 20)?;
    let flags = r.u16(base + 36)?;
    let id_index = r.u16(base + 38)? as usize;
    let storage_size = r.u32(base + 52)? as usize;
    let common_size = r.u32(base + 56)? as usize;
    let pallet_size = r.u32(base + 60)? as usize;
    let section_count = r.u32(base + 64)? as usize;
    if flags & 1 != 0 {
        return Err(bad("sparse table"));
    }
    if field_count > 256 || section_count > 64 {
        return Err(bad("header"));
    }
    let mut p = base + 68;
    let sections: Vec<[u32; 9]> = (0..section_count)
        .map(|s| {
            let at = p + s * 40 + 8; // skip tact key hash
            let mut v = [0u32; 9];
            for (k, o) in v.iter_mut().enumerate().take(8) {
                *o = r.u32(at + k * 4)?;
            }
            v[8] = (r.u32(p + s * 40)? != 0 || r.u32(p + s * 40 + 4)? != 0) as u32; // encrypted?
            Ok(v)
        })
        .collect::<AppResult<_>>()?;
    p += section_count * 40;
    // field structures: element width of uncompressed fields = 32 - size
    let elem_bits: Vec<u32> = (0..field_count).map(|i| r.u16(p + i * 4).map(|v| (32 - (v as i16 as i32)).clamp(8, 32) as u32)).collect::<AppResult<_>>()?;
    p += field_count * 4;
    let storage: Vec<Storage> = (0..storage_size / 24)
        .map(|i| {
            let at = p + i * 24;
            Ok(Storage {
                offset_bits: r.u16(at)? as u32,
                size_bits: r.u16(at + 2)? as u32,
                additional: r.u32(at + 4)?,
                kind: r.u32(at + 8)?,
                v1: r.u32(at + 12)?,
                v3: r.u32(at + 20)?,
            })
        })
        .collect::<AppResult<_>>()?;
    p += storage_size;
    let pallet = b.get(p..p + pallet_size).ok_or_else(|| bad("pallet"))?;
    p += pallet_size;
    let common = b.get(p..p + common_size).ok_or_else(|| bad("common"))?;

    // per-field offsets into pallet / common data
    let (mut pal_off, mut com_off) = (vec![0usize; storage.len()], vec![0usize; storage.len()]);
    let (mut pa, mut co) = (0usize, 0usize);
    let mut common_maps: Vec<HashMap<u32, u32>> = vec![HashMap::new(); storage.len()];
    for (i, s) in storage.iter().enumerate() {
        pal_off[i] = pa;
        com_off[i] = co;
        match s.kind {
            3 | 4 => pa += s.additional as usize,
            2 => {
                let chunk = common.get(co..co + s.additional as usize).ok_or_else(|| bad("common"))?;
                for e in chunk.chunks_exact(8) {
                    common_maps[i].insert(u32::from_le_bytes(e[0..4].try_into().unwrap()), u32::from_le_bytes(e[4..8].try_into().unwrap()));
                }
                co += s.additional as usize;
            }
            _ => {}
        }
    }
    let pal = |i: usize, idx: usize| -> u32 {
        let at = pal_off[i] + idx * 4;
        pallet.get(at..at + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap())).unwrap_or(0)
    };

    let mut rows = Vec::with_capacity(record_count);
    for sec in &sections {
        let [file_offset, count, string_size, _records_end, id_list_size, rel_size, offset_map_count, copy_count, encrypted] = *sec;
        let (count, file_offset) = (count as usize, file_offset as usize);
        if count == 0 {
            continue;
        }
        let records = b.get(file_offset..file_offset + count * record_size).ok_or_else(|| bad("records"))?;
        if encrypted == 1 && records.iter().all(|v| *v == 0) {
            continue; // encrypted section without key
        }
        let mut q = file_offset + count * record_size + string_size as usize;
        let ids: Vec<u32> = (0..id_list_size as usize / 4).map(|k| r.u32(q + k * 4)).collect::<AppResult<_>>()?;
        q += id_list_size as usize;
        q += copy_count as usize * 8;
        q += offset_map_count as usize * 6;
        let mut rel: HashMap<u32, u32> = HashMap::new();
        if rel_size > 0 {
            let n = r.u32(q)? as usize;
            for k in 0..n {
                let at = q + 12 + k * 8;
                rel.insert(r.u32(at + 4)?, r.u32(at)?);
            }
        }
        for i in 0..count {
            let rec = &records[i * record_size..(i + 1) * record_size];
            let mut fields = Vec::with_capacity(storage.len());
            for (f, s) in storage.iter().enumerate() {
                let vals = match s.kind {
                    0 => {
                        // uncompressed: one or more elements of the declared width
                        let elem = elem_bits.get(f).copied().unwrap_or(32);
                        (0..(s.size_bits / elem).max(1)).map(|k| bits(rec, s.offset_bits + k * elem, elem)).collect()
                    }
                    1 => vec![bits(rec, s.offset_bits, s.size_bits)],
                    5 => {
                        let v = bits(rec, s.offset_bits, s.size_bits);
                        let sh = 32 - s.size_bits.min(32);
                        vec![(((v << sh) as i32) >> sh) as u32]
                    }
                    2 => vec![0], // filled below once the id is known
                    3 => vec![pal(f, bits(rec, s.offset_bits, s.size_bits) as usize)],
                    4 => {
                        let n = s.v3.max(1) as usize;
                        let idx = bits(rec, s.offset_bits, s.size_bits) as usize;
                        (0..n).map(|k| pal(f, idx * n + k)).collect()
                    }
                    _ => return Err(bad("field type")),
                };
                fields.push(vals);
            }
            let id = if !ids.is_empty() { *ids.get(i).ok_or_else(|| bad("id list"))? } else { fields.get(id_index).and_then(|v| v.first()).copied().unwrap_or(0) };
            for (f, s) in storage.iter().enumerate() {
                if s.kind == 2 {
                    fields[f] = vec![*common_maps[f].get(&id).unwrap_or(&s.v1)];
                }
            }
            rows.push(Row { id, relation: rel.get(&(i as u32)).copied(), fields });
        }
    }
    Ok(Table { layout_hash, rows })
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_bit_fields() {
        let rec = [0b1010_1100u8, 0xFF, 0x01, 0, 0];
        assert_eq!(bits(&rec, 0, 8), 0b1010_1100);
        assert_eq!(bits(&rec, 2, 3), 0b011);
        assert_eq!(bits(&rec, 8, 9), 0x1FF);
        assert_eq!(bits(&rec, 0, 32), 0x0001_FFAC);
    }

    #[test]
    fn rejects_non_db2() {
        assert!(parse(b"WDBC....").is_err());
        assert!(parse(b"WDC3").is_err());
    }
}
