use crate::db::game::{self, CandidateQuery};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn app_info(state: State<'_, AppState>) -> AppResult<Value> {
    Ok(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "dataDir": state.paths.data_dir,
        "manifest": state.manifest,
        "seedInstalledNow": state.seed_installed_now,
        "httpUserAgent": crate::market::http::USER_AGENT,
    }))
}

#[tauri::command]
pub async fn search_spots(state: State<'_, AppState>, query: CandidateQuery) -> AppResult<Vec<Value>> {
    game::spot_candidates(&*state.game()?, &query)
}

#[tauri::command]
pub async fn get_spot(state: State<'_, AppState>, id: String) -> AppResult<Value> {
    if id.len() > 200 {
        return Err(AppError::invalid(crate::i18n::tr("Spot-ID zu lang", "Spot ID too long")));
    }
    game::spot_detail(&*state.game()?, &id)?.ok_or_else(|| AppError::not_found(crate::i18n::tr("Spot nicht gefunden", "Spot not found")))
}

#[tauri::command]
pub async fn get_item(state: State<'_, AppState>, id: u32) -> AppResult<Value> {
    game::item_detail(&*state.game()?, id)?.ok_or_else(|| AppError::not_found(crate::i18n::tr("Item nicht in der lokalen Datenbank", "Item not in the local database")))
}

#[tauri::command]
pub async fn get_npc(state: State<'_, AppState>, id: u32) -> AppResult<Value> {
    game::npc_detail(&*state.game()?, id)?.ok_or_else(|| AppError::not_found(crate::i18n::tr("NPC nicht in der lokalen Datenbank", "NPC not in the local database")))
}

#[tauri::command]
pub async fn search(state: State<'_, AppState>, q: String, kinds: Option<Vec<String>>, limit: Option<u32>) -> AppResult<Vec<Value>> {
    if q.len() > 100 {
        return Err(AppError::invalid(crate::i18n::tr("Suchbegriff zu lang", "Search term too long")));
    }
    game::search(&*state.game()?, &q, kinds, limit.unwrap_or(30))
}

#[tauri::command]
pub async fn list_zones(state: State<'_, AppState>) -> AppResult<Vec<Value>> {
    game::zones(&*state.game()?)
}

#[tauri::command]
pub async fn zone_layer(state: State<'_, AppState>, zone_id: u32) -> AppResult<Value> {
    game::zone_layer(&*state.game()?, zone_id)
}

#[tauri::command]
pub async fn list_sources(state: State<'_, AppState>) -> AppResult<Vec<Value>> {
    game::sources(&*state.game()?)
}

#[tauri::command]
pub async fn get_coverage(state: State<'_, AppState>) -> AppResult<Value> {
    game::coverage(&*state.game()?)
}
