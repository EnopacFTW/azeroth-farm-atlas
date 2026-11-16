//! Zone maps from the user's *own local* WoW client installation.
//! Reads the world map tiles (`Interface/WorldMap/<Zone>/<Zone>1..12.blp`) from the local CASC storage,
//! stitches them and keeps the result only in the app data folder. Nothing is downloaded or redistributed,
//! the game files are opened read-only and the game process is never touched.

pub mod blp;
pub mod casc;

use crate::error::{AppError, AppResult};
use crate::i18n::tr;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Zone ID (AreaTable) → world map art folder of the Classic client.
pub const ZONE_MAP_DIRS: &[(u32, &str)] = &[
    (1, "DunMorogh"), (3, "Badlands"), (4, "BlastedLands"), (8, "SwampOfSorrows"), (10, "Duskwood"), (11, "Wetlands"),
    (12, "Elwynn"), (14, "Durotar"), (15, "Dustwallow"), (16, "Aszhara"), (17, "Barrens"), (28, "WesternPlaguelands"),
    (33, "Stranglethorn"), (36, "Alterac"), (38, "LochModan"), (40, "Westfall"), (41, "DeadwindPass"), (44, "Redridge"),
    (45, "Arathi"), (46, "BurningSteppes"), (47, "Hinterlands"), (51, "SearingGorge"), (85, "Tirisfal"), (130, "Silverpine"),
    (139, "EasternPlaguelands"), (141, "Teldrassil"), (148, "Darkshore"), (215, "Mulgore"), (267, "Hilsbrad"),
    (331, "Ashenvale"), (357, "Feralas"), (361, "Felwood"), (400, "ThousandNeedles"), (405, "Desolace"),
    (406, "StonetalonMountains"), (440, "Tanaris"), (490, "UngoroCrater"), (493, "Moonglade"), (618, "Winterspring"),
    (1377, "Silithus"), (1497, "Undercity"), (1519, "Stormwind"), (1537, "Ironforge"), (1637, "Ogrimmar"),
    (1638, "ThunderBluff"), (1657, "Darnassis"), (2597, "AlteracValley"), (3277, "WarsongGulch"), (3358, "ArathiBasin"),
];

/// Client products whose world maps match the 1–60 zones (newest first). Retail/Cataclysm maps differ and are excluded.
pub const PRODUCTS: &[(&str, &str)] = &[
    ("wowf", "WoW: Forever"),
    ("wow_classic_era", "WoW Classic Era"),
    ("wow_anniversary", "WoW Classic Anniversary"),
    ("wow_classic_era_ptr", "WoW Classic Era PTR"),
];

/// The 12 tiles (4 × 3, 256 px) form 1024 × 768; the zone itself (0–100 %) is the top-left 1002 × 668.
pub const MAP_W: u32 = 1002;
pub const MAP_H: u32 = 668;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInstall {
    pub root: String,
    pub product: String,
    pub label: String,
    pub version: String,
}

/// Normalises a picked folder: the WoW root (has `.build.info`) or one of its `_forever_`-style subfolders.
pub fn wow_root_of(p: &Path) -> Option<PathBuf> {
    [Some(p), p.parent()].into_iter().flatten().find(|d| d.join(".build.info").is_file() && d.join("Data").join("data").is_dir()).map(Path::to_path_buf)
}

pub fn installs_in(root: &Path) -> Vec<ClientInstall> {
    let Some(root) = wow_root_of(root) else { return vec![] };
    let rows = casc::read_build_info(&root).unwrap_or_default();
    PRODUCTS
        .iter()
        .filter_map(|(p, label)| {
            let r = rows.iter().find(|r| r.product == *p && r.active)?;
            let k = r.build_key.to_lowercase();
            root.join("Data").join("config").join(&k[0..2]).join(&k[2..4]).join(&k).is_file().then(|| ClientInstall {
                root: root.to_string_lossy().replace('/', "\\"),
                product: p.to_string(),
                label: label.to_string(),
                version: r.version.clone(),
            })
        })
        .collect()
}

/// Looks in the usual install locations and the Battle.net default install path.
pub fn detect_installs() -> Vec<ClientInstall> {
    let mut roots: Vec<PathBuf> = vec![];
    if let Ok(appdata) = std::env::var("APPDATA") {
        if let Ok(t) = std::fs::read_to_string(Path::new(&appdata).join("Battle.net").join("Battle.net.config")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                if let Some(p) = v.pointer("/Client/Install/DefaultInstallPath").and_then(|v| v.as_str()) {
                    roots.push(Path::new(p).join("World of Warcraft"));
                }
            }
        }
    }
    for drive in b'C'..=b'H' {
        let d = format!("{}:\\", drive as char);
        if !Path::new(&d).is_dir() {
            continue;
        }
        for sub in ["Program Files (x86)\\World of Warcraft", "Program Files\\World of Warcraft", "World of Warcraft", "Games\\World of Warcraft", "Blizzard\\World of Warcraft", "Battle.net\\World of Warcraft"] {
            roots.push(Path::new(&d).join(sub));
        }
    }
    let mut out: Vec<ClientInstall> = vec![];
    for r in roots {
        for i in installs_in(&r) {
            if !out.iter().any(|o| o.root.eq_ignore_ascii_case(&i.root) && o.product == i.product) {
                out.push(i);
            }
        }
    }
    out
}

pub struct ZoneMap {
    pub zone_id: u32,
    pub png: Vec<u8>,
}

/// Extracts and stitches the world maps of the given zones. Returns the maps and the zones without tiles.
pub fn extract_zone_maps(install: &ClientInstall, zone_ids: &[u32]) -> AppResult<(Vec<ZoneMap>, Vec<u32>)> {
    let root = wow_root_of(Path::new(&install.root)).ok_or_else(|| AppError::not_found(tr("Keine WoW-Installation in diesem Ordner", "No WoW installation in this folder")))?;
    if !PRODUCTS.iter().any(|(p, _)| *p == install.product) {
        return Err(AppError::invalid(tr("Nicht unterstützte WoW-Version", "Unsupported WoW version")));
    }
    let storage = casc::Storage::open(&root, &install.product)?;
    let zones: Vec<(u32, &str)> = ZONE_MAP_DIRS.iter().copied().filter(|(z, _)| zone_ids.contains(z)).collect();
    let tile = |dir: &str, i: u32| format!("Interface/WorldMap/{dir}/{dir}{i}.blp");
    let names: Vec<String> = zones.iter().flat_map(|(_, d)| (1..=12).map(move |i| tile(d, i))).collect();
    let files = storage.read_files_by_name(&names)?;
    let (mut maps, mut missing) = (vec![], vec![]);
    for (zone_id, dir) in zones {
        match stitch(&files, &(1..=12).map(|i| tile(dir, i)).collect::<Vec<_>>()) {
            Some(png) => maps.push(ZoneMap { zone_id, png }),
            None => missing.push(zone_id),
        }
    }
    missing.extend(zone_ids.iter().filter(|z| !ZONE_MAP_DIRS.iter().any(|(id, _)| id == *z)));
    Ok((maps, missing))
}

fn stitch(files: &std::collections::HashMap<String, Vec<u8>>, tiles: &[String]) -> Option<Vec<u8>> {
    let (w, h) = (MAP_W as usize, MAP_H as usize);
    let mut rgb = vec![0u8; w * h * 3];
    for (i, name) in tiles.iter().enumerate() {
        let img = blp::decode(files.get(name)?).ok()?;
        let (tw, th) = (img.width as usize, img.height as usize);
        let (ox, oy) = ((i % 4) * 256, (i / 4) * 256);
        for y in 0..th.min(256) {
            for x in 0..tw.min(256) {
                let (dx, dy) = (ox + x, oy + y);
                if dx < w && dy < h {
                    let s = &img.pixels[(y * tw + x) * 4..][..3];
                    rgb[(dy * w + dx) * 3..][..3].copy_from_slice(s);
                }
            }
        }
    }
    let mut out = vec![];
    {
        let mut e = png::Encoder::new(&mut out, MAP_W, MAP_H);
        e.set_color(png::ColorType::Rgb);
        e.set_depth(png::BitDepth::Eight);
        let mut wr = e.write_header().ok()?;
        wr.write_image_data(&rgb).ok()?;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zone_table_has_no_duplicates() {
        let mut ids: Vec<u32> = ZONE_MAP_DIRS.iter().map(|z| z.0).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), ZONE_MAP_DIRS.len());
    }

    #[test]
    fn rejects_folders_without_client() {
        let d = tempfile::tempdir().unwrap();
        assert!(wow_root_of(d.path()).is_none());
        assert!(installs_in(d.path()).is_empty());
    }

    /// Runs against a real local install when present (skipped otherwise):
    /// `cargo test real_client -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_client_extracts_all_zone_maps() {
        let installs = detect_installs();
        println!("{installs:?}");
        let Some(i) = installs.first() else { return };
        let ids: Vec<u32> = ZONE_MAP_DIRS.iter().map(|z| z.0).collect();
        let t = std::time::Instant::now();
        let (maps, missing) = extract_zone_maps(i, &ids).unwrap();
        println!("{} maps in {:?}, missing {missing:?}", maps.len(), t.elapsed());
        if let Ok(dir) = std::env::var("MAP_DUMP_DIR") {
            for m in &maps {
                std::fs::write(Path::new(&dir).join(format!("{}.png", m.zone_id)), &m.png).unwrap();
            }
        }
        assert!(missing.is_empty());
    }
}
