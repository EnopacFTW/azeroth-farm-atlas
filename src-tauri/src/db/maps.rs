//! User-supplied zone map images (e.g. own screenshots of the in-game world map).
//! Files are copied into `<app data>/maps/`; the calibration says where WoW 0–100 % sits inside the image.
//! No map image is shipped, downloaded or hotlinked by the app; maps can also be read from the user's own
//! local WoW installation (crate::wowclient), which stay on this PC as well.

use crate::error::{AppError, AppResult};
use crate::i18n::tr;
use crate::market::model::now_iso;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const MAX_IMAGE_BYTES: u64 = 30 * 1024 * 1024;
pub const MAX_IMAGE_SIDE: u32 = 16_384;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapCalibration {
    /// Image-percent position of WoW x = 0 / y = 0 (left / top) and x = 100 / y = 100 (right / bottom).
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl MapCalibration {
    pub const FULL: MapCalibration = MapCalibration { x0: 0.0, y0: 0.0, x1: 100.0, y1: 100.0 };

    pub fn validate(&self) -> AppResult<()> {
        let ok = [self.x0, self.y0, self.x1, self.y1].iter().all(|v| v.is_finite() && (-100.0..=200.0).contains(v))
            && self.x1 - self.x0 >= 5.0
            && self.y1 - self.y0 >= 5.0;
        if ok { Ok(()) } else { Err(AppError::invalid(tr("Ungültige Kartenausrichtung", "Invalid map calibration"))) }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapAsset {
    pub zone_id: u32,
    pub file_name: String,
    /// Absolute path, for the asset protocol (scope: $APPDATA/maps/*).
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub calibration: MapCalibration,
    pub original_name: Option<String>,
    pub imported_at: String,
}

pub const MIGRATION_SQL: &str = r#"
CREATE TABLE map_assets (
  zone_id INTEGER PRIMARY KEY, file_name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  x0 REAL NOT NULL, y0 REAL NOT NULL, x1 REAL NOT NULL, y1 REAL NOT NULL, original_name TEXT, imported_at TEXT NOT NULL
);
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageKind {
    Png,
    Jpeg,
    Webp,
}

impl ImageKind {
    pub fn ext(self) -> &'static str {
        match self {
            ImageKind::Png => "png",
            ImageKind::Jpeg => "jpg",
            ImageKind::Webp => "webp",
        }
    }
}

/// Detects PNG/JPEG/WebP by magic bytes and reads the pixel size from the header (no decoding).
pub fn sniff_image(b: &[u8]) -> Option<(ImageKind, u32, u32)> {
    let be16 = |i: usize| -> Option<u32> { Some(u16::from_be_bytes([*b.get(i)?, *b.get(i + 1)?]) as u32) };
    let le16 = |i: usize| -> Option<u32> { Some(u16::from_le_bytes([*b.get(i)?, *b.get(i + 1)?]) as u32) };
    let le24 = |i: usize| -> Option<u32> { Some(u32::from_le_bytes([*b.get(i)?, *b.get(i + 1)?, *b.get(i + 2)?, 0])) };
    let (kind, w, h) = if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) && b.get(12..16) == Some(b"IHDR") {
        let w = u32::from_be_bytes(b.get(16..20)?.try_into().ok()?);
        let h = u32::from_be_bytes(b.get(20..24)?.try_into().ok()?);
        (ImageKind::Png, w, h)
    } else if b.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2;
        loop {
            while *b.get(i)? != 0xFF {
                i += 1;
            }
            while *b.get(i)? == 0xFF {
                i += 1;
            }
            let m = *b.get(i)?;
            i += 1;
            if matches!(m, 0xD8 | 0x01 | 0xD0..=0xD7) {
                continue;
            }
            let len = be16(i)? as usize;
            if matches!(m, 0xC0..=0xCF) && !matches!(m, 0xC4 | 0xC8 | 0xCC) {
                break (ImageKind::Jpeg, be16(i + 5)?, be16(i + 3)?);
            }
            if len < 2 {
                return None;
            }
            i += len;
        }
    } else if b.get(0..4) == Some(b"RIFF") && b.get(8..12) == Some(b"WEBP") {
        match b.get(12..16)? {
            b"VP8 " => (ImageKind::Webp, le16(26)? & 0x3FFF, le16(28)? & 0x3FFF),
            b"VP8L" => {
                let (b0, b1, b2, b3) = (*b.get(21)? as u32, *b.get(22)? as u32, *b.get(23)? as u32, *b.get(24)? as u32);
                (ImageKind::Webp, 1 + (((b1 & 0x3F) << 8) | b0), 1 + (((b3 & 0xF) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6)))
            }
            b"VP8X" => (ImageKind::Webp, 1 + le24(24)?, 1 + le24(27)?),
            _ => return None,
        }
    } else {
        return None;
    };
    (w > 0 && h > 0 && w <= MAX_IMAGE_SIDE && h <= MAX_IMAGE_SIDE).then_some((kind, w, h))
}

fn row_to_asset(maps_dir: &Path, r: &rusqlite::Row) -> rusqlite::Result<MapAsset> {
    let file_name: String = r.get(1)?;
    Ok(MapAsset {
        zone_id: r.get(0)?,
        path: maps_dir.join(&file_name).to_string_lossy().to_string(),
        file_name,
        width: r.get(2)?,
        height: r.get(3)?,
        calibration: MapCalibration { x0: r.get(4)?, y0: r.get(5)?, x1: r.get(6)?, y1: r.get(7)? },
        original_name: r.get(8)?,
        imported_at: r.get(9)?,
    })
}

const COLS: &str = "zone_id, file_name, width, height, x0, y0, x1, y1, original_name, imported_at";

pub fn get(c: &Connection, maps_dir: &Path, zone_id: u32) -> AppResult<Option<MapAsset>> {
    let a = c
        .query_row(&format!("SELECT {COLS} FROM map_assets WHERE zone_id = ?1"), [zone_id], |r| row_to_asset(maps_dir, r))
        .optional()?;
    // a deleted/missing file means "no map" rather than a broken image
    Ok(a.filter(|a| Path::new(&a.path).is_file()))
}

pub fn list(c: &Connection, maps_dir: &Path) -> AppResult<Vec<MapAsset>> {
    let mut st = c.prepare(&format!("SELECT {COLS} FROM map_assets ORDER BY zone_id"))?;
    let rows = st.query_map([], |r| row_to_asset(maps_dir, r))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().filter(|a| Path::new(&a.path).is_file()).collect())
}

/// Validates and copies an image into the maps folder, replacing a previous image of the zone.
pub fn import(c: &Connection, maps_dir: &Path, zone_id: u32, source: &Path) -> AppResult<MapAsset> {
    let meta = std::fs::metadata(source)?;
    if !meta.is_file() || meta.len() > MAX_IMAGE_BYTES {
        return Err(AppError::new("too_large", tr("Bild fehlt oder ist größer als 30 MB", "Image missing or larger than 30 MB")));
    }
    let bytes = std::fs::read(source)?;
    let (kind, width, height) = sniff_image(&bytes)
        .ok_or_else(|| AppError::invalid(tr("Kein gültiges PNG-, JPEG- oder WebP-Bild", "Not a valid PNG, JPEG or WebP image")))?;
    let original = source.file_name().map(|n| n.to_string_lossy().chars().take(200).collect::<String>());
    store(c, maps_dir, zone_id, &bytes, kind, width, height, original)
}

/// Name prefix of maps read from the local WoW client (see crate::wowclient).
pub const CLIENT_PREFIX: &str = "WoW-Client";

pub fn is_client_map(original_name: Option<&str>) -> bool {
    original_name.is_some_and(|n| n.starts_with(CLIENT_PREFIX))
}

/// Writes an already validated image atomically and replaces the previous image of the zone.
#[allow(clippy::too_many_arguments)]
pub fn store(c: &Connection, maps_dir: &Path, zone_id: u32, bytes: &[u8], kind: ImageKind, width: u32, height: u32, original: Option<String>) -> AppResult<MapAsset> {
    std::fs::create_dir_all(maps_dir)?;
    let file_name = format!("zone-{zone_id}-{}.{}", chrono::Utc::now().timestamp_millis(), kind.ext());
    let tmp = maps_dir.join(format!("{file_name}.tmp"));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, maps_dir.join(&file_name))?;
    let old: Option<String> = c.query_row("SELECT file_name FROM map_assets WHERE zone_id = ?1", [zone_id], |r| r.get(0)).optional()?;
    let cal = MapCalibration::FULL;
    c.execute(
        "INSERT OR REPLACE INTO map_assets (zone_id, file_name, width, height, x0, y0, x1, y1, original_name, imported_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![zone_id, file_name, width, height, cal.x0, cal.y0, cal.x1, cal.y1, original, now_iso()],
    )?;
    if let Some(old) = old.filter(|o| *o != file_name) {
        let _ = std::fs::remove_file(maps_dir.join(old));
    }
    get(c, maps_dir, zone_id)?.ok_or_else(|| AppError::not_found(tr("Kartenbild nicht gefunden", "Map image not found")))
}

pub fn set_calibration(c: &Connection, maps_dir: &Path, zone_id: u32, cal: &MapCalibration) -> AppResult<MapAsset> {
    cal.validate()?;
    let n = c.execute("UPDATE map_assets SET x0 = ?2, y0 = ?3, x1 = ?4, y1 = ?5 WHERE zone_id = ?1", params![zone_id, cal.x0, cal.y0, cal.x1, cal.y1])?;
    if n == 0 {
        return Err(AppError::not_found(tr("Für diese Zone ist kein Kartenbild importiert", "No map image imported for this zone")));
    }
    get(c, maps_dir, zone_id)?.ok_or_else(|| AppError::not_found(tr("Kartenbild nicht gefunden", "Map image not found")))
}

pub fn delete(c: &Connection, maps_dir: &Path, zone_id: u32) -> AppResult<()> {
    let old: Option<String> = c.query_row("SELECT file_name FROM map_assets WHERE zone_id = ?1", [zone_id], |r| r.get(0)).optional()?;
    c.execute("DELETE FROM map_assets WHERE zone_id = ?1", [zone_id])?;
    if let Some(old) = old {
        let _ = std::fs::remove_file(maps_dir.join(old));
    }
    Ok(())
}

pub fn delete_all(c: &Connection, maps_dir: &Path) -> AppResult<()> {
    c.execute("DELETE FROM map_assets", [])?;
    if maps_dir.is_dir() {
        std::fs::remove_dir_all(maps_dir)?;
    }
    Ok(())
}

/// Lowercase ASCII key for file-name matching: "Sümpfe des Elends" -> "sumpfedeselends".
pub fn name_key(s: &str) -> String {
    let mut out = String::new();
    for ch in s.to_lowercase().chars() {
        match ch {
            'ä' | 'á' | 'à' | 'â' => out.push('a'),
            'ö' | 'ó' | 'ò' | 'ô' => out.push('o'),
            'ü' | 'ú' | 'ù' | 'û' => out.push('u'),
            'é' | 'è' | 'ê' => out.push('e'),
            'ß' => out.push_str("ss"),
            c if c.is_ascii_alphanumeric() => out.push(c),
            _ => {}
        }
    }
    out
}

pub struct ZoneKey {
    pub id: u32,
    pub ui_map_id: Option<u32>,
    pub keys: Vec<String>,
}

/// Matches a file stem to a zone: UiMap ID, then zone ID, then English/German zone name.
pub fn match_zone(stem: &str, zones: &[ZoneKey]) -> Option<u32> {
    if let Ok(n) = stem.trim().parse::<u32>() {
        if let Some(z) = zones.iter().find(|z| z.ui_map_id == Some(n)) {
            return Some(z.id);
        }
        return zones.iter().find(|z| z.id == n).map(|z| z.id);
    }
    let k = name_key(stem);
    if k.is_empty() {
        return None;
    }
    zones.iter().find(|z| z.keys.iter().any(|zk| *zk == k)).map(|z| z.id)
}

pub fn zone_keys(game: &Connection) -> AppResult<Vec<ZoneKey>> {
    let mut st = game.prepare("SELECT id, ui_map_id, name_en, name_de FROM zones")?;
    let rows = st
        .query_map([], |r| {
            let en: String = r.get(2)?;
            let de: Option<String> = r.get(3)?;
            let mut keys = vec![name_key(&en)];
            if let Some(de) = de {
                keys.push(name_key(&de));
            }
            Ok(ZoneKey { id: r.get(0)?, ui_map_id: r.get(1)?, keys })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderImport {
    pub imported: Vec<MapAsset>,
    pub skipped: Vec<String>,
}

pub fn import_folder(c: &Connection, game: &Connection, maps_dir: &Path, folder: &Path) -> AppResult<FolderImport> {
    let zones = zone_keys(game)?;
    let mut out = FolderImport { imported: vec![], skipped: vec![] };
    let mut files: Vec<PathBuf> = std::fs::read_dir(folder)?.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.is_file()).collect();
    files.sort();
    for p in files.into_iter().take(500) {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
            continue;
        }
        let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        match match_zone(&stem, &zones) {
            Some(zone_id) => match import(c, maps_dir, zone_id, &p) {
                Ok(a) => out.imported.push(a),
                Err(e) => out.skipped.push(format!("{name}: {}", e.message)),
            },
            None => out.skipped.push(tr(format!("{name}: keine Zone erkannt"), format!("{name}: no zone recognised"))),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut b = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
        b.extend_from_slice(b"IHDR");
        b.extend_from_slice(&w.to_be_bytes());
        b.extend_from_slice(&h.to_be_bytes());
        b.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        b
    }

    fn jpeg(w: u16, h: u16) -> Vec<u8> {
        let mut b = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        b.extend_from_slice(&[0; 14]);
        b.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 0x08]);
        b.extend_from_slice(&h.to_be_bytes());
        b.extend_from_slice(&w.to_be_bytes());
        b.extend_from_slice(&[3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
        b
    }

    #[test]
    fn sniffs_png_jpeg_webp_sizes() {
        assert_eq!(sniff_image(&png(1002, 668)), Some((ImageKind::Png, 1002, 668)));
        assert_eq!(sniff_image(&jpeg(1920, 1080)), Some((ImageKind::Jpeg, 1920, 1080)));
        let mut vp8x = b"RIFF\0\0\0\0WEBPVP8X".to_vec();
        vp8x.extend_from_slice(&[10, 0, 0, 0, 0, 0, 0, 0]);
        vp8x.extend_from_slice(&[0xE9, 0x03, 0x00, 0x9B, 0x02, 0x00]); // 1001+1 x 667+1
        assert_eq!(sniff_image(&vp8x), Some((ImageKind::Webp, 1002, 668)));
    }

    #[test]
    fn rejects_non_images_and_absurd_sizes() {
        assert_eq!(sniff_image(b"<svg xmlns=...>"), None);
        assert_eq!(sniff_image(b"GIF89a...."), None);
        assert_eq!(sniff_image(&png(0, 10)), None);
        assert_eq!(sniff_image(&png(40_000, 10)), None);
        assert_eq!(sniff_image(&[0xFF, 0xD8, 0xFF]), None);
    }

    #[test]
    fn calibration_bounds() {
        assert!(MapCalibration::FULL.validate().is_ok());
        assert!(MapCalibration { x0: 10.0, y0: 10.0, x1: 12.0, y1: 90.0 }.validate().is_err());
        assert!(MapCalibration { x0: f64::NAN, ..MapCalibration::FULL }.validate().is_err());
    }

    #[test]
    fn matches_file_names_to_zones() {
        let zones = vec![
            ZoneKey { id: 11, ui_map_id: Some(1437), keys: vec![name_key("Wetlands"), name_key("Sumpfland")] },
            ZoneKey { id: 8, ui_map_id: Some(1435), keys: vec![name_key("Swamp of Sorrows"), name_key("Sümpfe des Elends")] },
        ];
        assert_eq!(match_zone("1437", &zones), Some(11));
        assert_eq!(match_zone("8", &zones), Some(8));
        assert_eq!(match_zone("Sümpfe des Elends", &zones), Some(8));
        assert_eq!(match_zone("swamp_of_sorrows", &zones), Some(8));
        assert_eq!(match_zone("SUMPFLAND", &zones), Some(11));
        assert_eq!(match_zone("Durotar", &zones), None);
    }

    #[test]
    fn import_replace_calibrate_delete() {
        let dir = tempfile::tempdir().unwrap();
        let maps = dir.path().join("maps");
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(MIGRATION_SQL).unwrap();
        let src = dir.path().join("Wetlands.png");
        std::fs::write(&src, png(1002, 668)).unwrap();
        let a = import(&c, &maps, 11, &src).unwrap();
        assert_eq!((a.width, a.height, a.calibration.clone()), (1002, 668, MapCalibration::FULL));
        assert!(Path::new(&a.path).is_file());
        std::thread::sleep(std::time::Duration::from_millis(5));
        let b = import(&c, &maps, 11, &src).unwrap();
        assert!(!Path::new(&a.path).exists(), "old image is removed on re-import");
        let cal = MapCalibration { x0: 2.0, y0: 8.5, x1: 98.0, y1: 92.0 };
        assert_eq!(set_calibration(&c, &maps, 11, &cal).unwrap().calibration, cal);
        assert_eq!(list(&c, &maps).unwrap().len(), 1);
        delete(&c, &maps, 11).unwrap();
        assert!(!Path::new(&b.path).exists());
        assert!(get(&c, &maps, 11).unwrap().is_none());
        std::fs::write(&src, b"not an image").unwrap();
        assert_eq!(import(&c, &maps, 11, &src).unwrap_err().code, "invalid_input");
    }
}
