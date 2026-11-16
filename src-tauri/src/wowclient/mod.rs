//! Zone maps from the user's *own local* WoW client installation.
//! Reads the world map tiles (`Interface/WorldMap/<Zone>/<Zone>1..12.blp`) from the local CASC storage,
//! stitches them and keeps the result only in the app data folder. Nothing is downloaded or redistributed,
//! the game files are opened read-only and the game process is never touched.

pub mod blp;
pub mod casc;
pub mod db2;

use crate::error::{AppError, AppResult};
use crate::i18n::tr;
use serde::Serialize;
use std::collections::HashMap;
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
    /// Number of "explored area" overlays (towns, roads) drawn onto the base map.
    pub overlays: u32,
}

/// Client database files (file data IDs, stable across Classic builds).
const DB_WORLD_MAP_OVERLAY: i64 = 1_134_579;
const DB_WORLD_MAP_OVERLAY_TILE: i64 = 1_957_212;
const DB_UI_MAP_ART_TILE: i64 = 1_957_210;
const DB_UI_MAP_X_MAP_ART: i64 = 1_957_217;

/// (row, col, file data ID) of a 256 px texture tile.
type Tile = (usize, usize, i64);

/// Overlay texture placed on the 1002 × 668 map, split into 256 px tiles.
struct Overlay {
    x: i64,
    y: i64,
    w: usize,
    h: usize,
    tiles: Vec<Tile>,
}

/// What the client shows for each UiMap: map art (phase 0), its base tiles and its explored-area overlays.
#[derive(Default)]
struct ArtIndex {
    art_of_map: HashMap<u32, u32>,
    base: HashMap<u32, Vec<Tile>>,
    overlays: HashMap<u32, Vec<Overlay>>,
}

/// Reads UiMapXMapArt, UiMapArtTile, WorldMapOverlay and WorldMapOverlayTile.
/// None if a table is missing or has an unexpected layout (then the legacy file names are used, without overlays).
fn load_art_index(idx: &casc::Index) -> Option<ArtIndex> {
    let dbs = idx.read_fdids(&[DB_UI_MAP_X_MAP_ART, DB_UI_MAP_ART_TILE, DB_WORLD_MAP_OVERLAY, DB_WORLD_MAP_OVERLAY_TILE]).ok()?;
    let xart = db2::parse(dbs.get(&DB_UI_MAP_X_MAP_ART)?).ok()?;
    let art = db2::parse(dbs.get(&DB_UI_MAP_ART_TILE)?).ok()?;
    let ov = db2::parse(dbs.get(&DB_WORLD_MAP_OVERLAY)?).ok()?;
    let ovt = db2::parse(dbs.get(&DB_WORLD_MAP_OVERLAY_TILE)?).ok()?;
    // UiMapXMapArt = PhaseID, UiMapArtID + relation UiMapID; *Tile = RowIndex, ColIndex, LayerIndex, FileDataID + relation;
    // WorldMapOverlay = ID, UiMapArtID, TextureWidth, TextureHeight, OffsetX, OffsetY, … (13 fields)
    let has = |t: &db2::Table, n: usize| t.rows.first().is_some_and(|r| r.fields.len() == n && r.relation.is_some());
    if !(has(&xart, 2) && has(&art, 4) && has(&ovt, 4) && ov.rows.first()?.fields.len() == 13) {
        return None;
    }
    let f = |r: &db2::Row, i: usize| r.fields.get(i).and_then(|v| v.first()).copied().unwrap_or(0);
    let mut out = ArtIndex::default();
    let mut phase: HashMap<u32, u32> = HashMap::new();
    for r in &xart.rows {
        let (map, p, a) = (r.relation.unwrap_or(0), f(r, 0), f(r, 1));
        if phase.get(&map).map_or(true, |old| p < *old) {
            phase.insert(map, p);
            out.art_of_map.insert(map, a);
        }
    }
    let tiles_of = |t: &db2::Table| {
        let mut m: HashMap<u32, Vec<Tile>> = HashMap::new();
        for r in &t.rows {
            if f(r, 2) == 0 {
                m.entry(r.relation.unwrap_or(0)).or_default().push((f(r, 0) as usize, f(r, 1) as usize, f(r, 3) as i64));
            }
        }
        m
    };
    out.base = tiles_of(&art);
    let mut ov_tiles = tiles_of(&ovt);
    for r in &ov.rows {
        let (w, h) = (f(r, 2) as usize, f(r, 3) as usize);
        let Some(t) = ov_tiles.remove(&r.id) else { continue };
        if w == 0 || h == 0 || w > 2048 || h > 2048 {
            continue;
        }
        out.overlays.entry(f(r, 1)).or_default().push(Overlay { x: f(r, 4) as i32 as i64, y: f(r, 5) as i32 as i64, w, h, tiles: t });
    }
    Some(out)
}

/// Extracts the world maps of the given zones (zone ID, UiMap ID) exactly as the client shows them fully explored:
/// the map art assigned to the UiMap plus all explored-area overlays. Zones without UiMap art fall back to the
/// legacy `Interface/WorldMap/<Zone>` tiles. Returns the maps and the zones without a map.
pub fn extract_zone_maps(install: &ClientInstall, zones: &[(u32, Option<u32>)]) -> AppResult<(Vec<ZoneMap>, Vec<u32>)> {
    let root = wow_root_of(Path::new(&install.root)).ok_or_else(|| AppError::not_found(tr("Keine WoW-Installation in diesem Ordner", "No WoW installation in this folder")))?;
    if !PRODUCTS.iter().any(|(p, _)| *p == install.product) {
        return Err(AppError::invalid(tr("Nicht unterstützte WoW-Version", "Unsupported WoW version")));
    }
    let storage = casc::Storage::open(&root, &install.product)?;
    let idx = storage.index()?;
    let arts = load_art_index(&idx).unwrap_or_default();
    let art_of = |ui: Option<u32>| ui.and_then(|u| arts.art_of_map.get(&u)).filter(|a| arts.base.get(a).is_some_and(|t| !t.is_empty())).copied();

    // legacy fallback: file names of the 4 × 3 tiles
    let legacy_dir = |z: u32| ZONE_MAP_DIRS.iter().find(|(id, _)| *id == z).map(|(_, d)| *d);
    let tile_name = |dir: &str, i: usize| format!("Interface/WorldMap/{dir}/{dir}{i}.blp");
    let legacy_names: Vec<String> = zones.iter().filter(|(_, ui)| art_of(*ui).is_none()).filter_map(|(z, _)| legacy_dir(*z)).flat_map(|d| (1..=12).map(move |i| tile_name(d, i))).collect();
    let legacy_ids = idx.fdids_by_name(&legacy_names)?;

    let plan: Vec<(u32, Vec<Tile>, &[Overlay])> = zones
        .iter()
        .map(|(z, ui)| match art_of(*ui) {
            Some(a) => (*z, arts.base[&a].clone(), arts.overlays.get(&a).map(|v| v.as_slice()).unwrap_or(&[])),
            None => {
                let tiles = legacy_dir(*z)
                    .map(|d| (0..12).filter_map(|i| legacy_ids.get(&tile_name(d, i + 1)).map(|id| (i / 4, i % 4, *id))).collect())
                    .unwrap_or_default();
                (*z, tiles, &[][..])
            }
        })
        .collect();
    let want: Vec<i64> = plan.iter().flat_map(|(_, base, ov)| base.iter().map(|t| t.2).chain(ov.iter().flat_map(|o| o.tiles.iter().map(|t| t.2)))).collect();
    let files = idx.read_fdids(&want)?;
    drop(idx);

    let (mut maps, mut missing) = (vec![], vec![]);
    for (zone_id, base, ov) in plan {
        match compose(&base, ov, &files) {
            Some((png, n)) => maps.push(ZoneMap { zone_id, png, overlays: n }),
            None => missing.push(zone_id),
        }
    }
    Ok((maps, missing))
}

/// Stitches the base tiles (all 12 must be present), alpha-blends the overlays on top and encodes a 1002 × 668 PNG.
fn compose(base: &[Tile], overlays: &[Overlay], files: &HashMap<i64, Vec<u8>>) -> Option<(Vec<u8>, u32)> {
    let (w, h) = (MAP_W as usize, MAP_H as usize);
    if base.len() < 12 {
        return None;
    }
    let mut rgb = vec![0u8; w * h * 3];
    for &(row, col, fdid) in base {
        let img = blp::decode(files.get(&fdid)?).ok()?;
        let (tw, th) = (img.width as usize, img.height as usize);
        let (ox, oy) = (col * 256, row * 256);
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
    let mut drawn = 0;
    for o in overlays {
        let mut any = false;
        for &(row, col, fdid) in &o.tiles {
            let Some(img) = files.get(&fdid).and_then(|d| blp::decode(d).ok()) else { continue };
            any = true;
            let (tw, th) = (img.width as usize, img.height as usize);
            for y in 0..th.min(256) {
                for x in 0..tw.min(256) {
                    let (lx, ly) = (col * 256 + x, row * 256 + y);
                    if lx >= o.w || ly >= o.h {
                        continue;
                    }
                    let (dx, dy) = (o.x + lx as i64, o.y + ly as i64);
                    if dx < 0 || dy < 0 || dx >= w as i64 || dy >= h as i64 {
                        continue;
                    }
                    let s = &img.pixels[(y * tw + x) * 4..][..4];
                    let a = s[3] as u32;
                    if a == 0 {
                        continue;
                    }
                    let d = &mut rgb[(dy as usize * w + dx as usize) * 3..][..3];
                    for k in 0..3 {
                        d[k] = ((s[k] as u32 * a + d[k] as u32 * (255 - a)) / 255) as u8;
                    }
                }
            }
        }
        drawn += any as u32;
    }
    let mut out = vec![];
    {
        let mut e = png::Encoder::new(&mut out, MAP_W, MAP_H);
        e.set_color(png::ColorType::Rgb);
        e.set_depth(png::BitDepth::Eight);
        let mut wr = e.write_header().ok()?;
        wr.write_image_data(&rgb).ok()?;
    }
    Some((out, drawn))
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
        let seed = rusqlite::Connection::open(Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/seed.db")).unwrap();
        let mut st = seed.prepare("SELECT id, ui_map_id FROM zones WHERE ui_map_id IS NOT NULL").unwrap();
        let zones: Vec<(u32, Option<u32>)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|r| r.unwrap()).collect();
        let t = std::time::Instant::now();
        let (maps, missing) = extract_zone_maps(i, &zones).unwrap();
        println!("{} maps in {:?}, missing {missing:?}, overlays {:?}", maps.len(), t.elapsed(), maps.iter().map(|m| (m.zone_id, m.overlays)).collect::<Vec<_>>());
        if let Ok(dir) = std::env::var("MAP_DUMP_DIR") {
            for m in &maps {
                std::fs::write(Path::new(&dir).join(format!("{}.png", m.zone_id)), &m.png).unwrap();
            }
        }
        assert!(missing.is_empty());
    }
}

