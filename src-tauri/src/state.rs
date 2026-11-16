use crate::db::{self, DataPaths};
use crate::error::{AppError, AppResult};
use crate::market::{http::HttpClient, MarketEngine};
use crate::security::network_policy::NetworkPolicy;
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

pub struct AppState {
    pub paths: DataPaths,
    pub game: Mutex<Connection>,
    pub user: Mutex<Connection>,
    pub market: MarketEngine,
    pub manifest: serde_json::Value,
    pub seed_installed_now: bool,
}

impl AppState {
    pub fn init(data_dir: std::path::PathBuf, seed: &Path, manifest: &Path) -> AppResult<Self> {
        let paths = DataPaths::new(data_dir);
        let seed_installed_now = db::install_seed(seed, manifest, &paths)?;
        let game = db::open_game(&paths.game_db)?;
        let user = db::user::open(&paths.user_db, &paths.backups_dir)?;
        let cache = crate::market::cache::open(&paths.cache_db)?;
        crate::market::cache::purge_expired(&cache)?;
        let manifest_json = std::fs::read_to_string(manifest).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(serde_json::Value::Null);
        Ok(Self {
            paths,
            game: Mutex::new(game),
            user: Mutex::new(user),
            market: MarketEngine::new(HttpClient::new(NetworkPolicy::production()), cache),
            manifest: manifest_json,
            seed_installed_now,
        })
    }

    pub fn game(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.game.lock().map_err(|_| AppError::new("lock", "Spieldatenbank gesperrt"))
    }
    pub fn user(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.user.lock().map_err(|_| AppError::new("lock", "Benutzerdatenbank gesperrt"))
    }
    pub fn market_settings(&self) -> AppResult<crate::market::MarketSettings> {
        Ok(db::user::get_settings(&*self.user()?)?.market)
    }
}
