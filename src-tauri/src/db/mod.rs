//! Three SQLite files in the Tauri AppData dir (%APPDATA%\de.azerothfarmatlas.desktop):
//!   game.db         – copy of the bundled read-only seed (replaced atomically when the seed changes)
//!   user.db         – profiles, sessions, favorites, settings, manual prices (never touched by seed updates)
//!   market_cache.db – third-party price cache with expiry (see market::cache)

pub mod game;
pub mod maps;
pub mod user;

use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPaths {
    pub data_dir: PathBuf,
    pub game_db: PathBuf,
    pub user_db: PathBuf,
    pub cache_db: PathBuf,
    pub backups_dir: PathBuf,
    pub maps_dir: PathBuf,
}

impl DataPaths {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            game_db: data_dir.join("game.db"),
            user_db: data_dir.join("user.db"),
            cache_db: data_dir.join("market_cache.db"),
            backups_dir: data_dir.join("backups"),
            maps_dir: data_dir.join("maps"),
            data_dir,
        }
    }
}

fn seed_sha(manifest: &Path) -> Option<String> {
    let text = std::fs::read_to_string(manifest).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v.get("seedSha256")?.as_str().map(|s| s.to_string())
}

/// Copies the bundled seed into AppData if missing or outdated. Atomic: write temp file, then rename.
pub fn install_seed(seed: &Path, manifest: &Path, paths: &DataPaths) -> AppResult<bool> {
    std::fs::create_dir_all(&paths.data_dir)?;
    let installed_manifest = paths.data_dir.join("game-manifest.json");
    let bundled = seed_sha(manifest);
    let current = seed_sha(&installed_manifest);
    if paths.game_db.exists() && bundled.is_some() && bundled == current {
        return Ok(false);
    }
    if !seed.exists() {
        return Err(AppError::new("seed_missing", crate::i18n::tr(format!("Seed-Datenbank fehlt: {}", seed.display()), format!("Seed database missing: {}", seed.display()))));
    }
    let tmp = paths.data_dir.join("game.db.tmp");
    std::fs::copy(seed, &tmp)?;
    // verify before swapping in
    {
        let c = Connection::open_with_flags(&tmp, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let n: i64 = c.query_row("SELECT COUNT(*) FROM spots", [], |r| r.get(0))?;
        if n == 0 {
            return Err(AppError::new("seed_invalid", crate::i18n::tr("Seed-Datenbank enthält keine Spots", "Seed database contains no spots")));
        }
    }
    let old = paths.data_dir.join("game.db.old");
    if paths.game_db.exists() {
        let _ = std::fs::remove_file(&old);
        std::fs::rename(&paths.game_db, &old)?;
    }
    if let Err(e) = std::fs::rename(&tmp, &paths.game_db) {
        // rollback
        if old.exists() {
            let _ = std::fs::rename(&old, &paths.game_db);
        }
        return Err(e.into());
    }
    let _ = std::fs::remove_file(&old);
    std::fs::copy(manifest, &installed_manifest)?;
    Ok(true)
}

pub fn open_game(path: &Path) -> AppResult<Connection> {
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    c.execute_batch("PRAGMA query_only = ON;")?;
    Ok(c)
}

#[cfg(test)]
pub fn test_seed_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("seed.db")
}
