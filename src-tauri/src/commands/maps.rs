use crate::db::{game, maps};
use crate::error::{AppError, AppResult};
use crate::i18n::tr;
use crate::state::AppState;
use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn zone_density(state: State<'_, AppState>, zone_id: u32) -> AppResult<Value> {
    game::zone_density(&*state.game()?, zone_id, 75, 50)
}

#[tauri::command]
pub async fn get_map_asset(state: State<'_, AppState>, zone_id: u32) -> AppResult<Option<maps::MapAsset>> {
    maps::get(&*state.user()?, &state.paths.maps_dir, zone_id)
}

#[tauri::command]
pub async fn list_map_assets(state: State<'_, AppState>) -> AppResult<Vec<maps::MapAsset>> {
    maps::list(&*state.user()?, &state.paths.maps_dir)
}

/// Lets the user pick a PNG/JPEG/WebP file (e.g. a screenshot of the in-game world map) for one zone.
#[tauri::command]
pub async fn import_map_image(app: AppHandle, state: State<'_, AppState>, zone_id: u32) -> AppResult<Option<maps::MapAsset>> {
    game_zone_exists(&state, zone_id)?;
    let Some(path) = app
        .dialog()
        .file()
        .set_title(tr("Kartenbild für die Zone wählen", "Choose a map image for the zone"))
        .add_filter(tr("Bilder", "Images"), &["png", "jpg", "jpeg", "webp"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::invalid(tr("Ungültiger Pfad", "Invalid path")))?;
    maps::import(&*state.user()?, &state.paths.maps_dir, zone_id, &path).map(Some)
}

/// Imports every image of a folder whose file name is a UiMap ID, zone ID or zone name (EN/DE).
#[tauri::command]
pub async fn import_map_folder(app: AppHandle, state: State<'_, AppState>) -> AppResult<Option<maps::FolderImport>> {
    let Some(path) = app.dialog().file().set_title(tr("Ordner mit Kartenbildern wählen", "Choose a folder with map images")).blocking_pick_folder() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::invalid(tr("Ungültiger Pfad", "Invalid path")))?;
    let game = state.game()?;
    maps::import_folder(&*state.user()?, &game, &state.paths.maps_dir, &path).map(Some)
}

#[tauri::command]
pub async fn set_map_calibration(state: State<'_, AppState>, zone_id: u32, calibration: maps::MapCalibration) -> AppResult<maps::MapAsset> {
    maps::set_calibration(&*state.user()?, &state.paths.maps_dir, zone_id, &calibration)
}

#[tauri::command]
pub async fn delete_map_asset(state: State<'_, AppState>, zone_id: u32) -> AppResult<()> {
    maps::delete(&*state.user()?, &state.paths.maps_dir, zone_id)
}

fn game_zone_exists(state: &AppState, zone_id: u32) -> AppResult<()> {
    let n: i64 = state.game()?.query_row("SELECT COUNT(*) FROM zones WHERE id = ?1", [zone_id], |r| r.get(0))?;
    if n == 0 {
        return Err(AppError::not_found(tr("Zone nicht gefunden", "Zone not found")));
    }
    Ok(())
}
