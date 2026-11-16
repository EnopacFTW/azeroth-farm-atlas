use crate::db::{game, maps};
use crate::wowclient;
use crate::error::{AppError, AppResult};
use crate::i18n::tr;
use crate::state::AppState;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn zone_density(state: State<'_, AppState>, zone_id: u32) -> AppResult<Value> {
    game::zone_density(&*state.game()?, zone_id, 75, 50)
}

/// The maps folder is in the asset scope (lib.rs). Windows may resolve a file to another real location
/// (e.g. virtualised AppData), so the resolved file path is allowed as well.
fn expose(app: &AppHandle, a: &maps::MapAsset) {
    if let Ok(real) = std::fs::canonicalize(&a.path) {
        let _ = app.asset_protocol_scope().allow_file(real);
    }
}

#[tauri::command]
pub async fn get_map_asset(app: AppHandle, state: State<'_, AppState>, zone_id: u32) -> AppResult<Option<maps::MapAsset>> {
    let a = maps::get(&*state.user()?, &state.paths.maps_dir, zone_id)?;
    if let Some(a) = &a {
        expose(&app, a);
    }
    Ok(a)
}

#[tauri::command]
pub async fn list_map_assets(app: AppHandle, state: State<'_, AppState>) -> AppResult<Vec<maps::MapAsset>> {
    let all = maps::list(&*state.user()?, &state.paths.maps_dir)?;
    all.iter().for_each(|a| expose(&app, a));
    Ok(all)
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

// ---- zone maps from the user's own local WoW installation (crate::wowclient) ----

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientMapImport {
    pub imported: u32,
    pub kept_own: u32,
    pub missing: Vec<u32>,
    pub source: String,
}

/// WoW installations (Forever / Classic Era) in the usual folders.
#[tauri::command]
pub async fn detect_wow_clients() -> AppResult<Vec<wowclient::ClientInstall>> {
    tauri::async_runtime::spawn_blocking(wowclient::detect_installs).await.map_err(|e| AppError::new("task", e.to_string()))
}

/// Lets the user pick the WoW folder (or its `_forever_` subfolder) when it was not found automatically.
#[tauri::command]
pub async fn pick_wow_client(app: AppHandle) -> AppResult<Option<Vec<wowclient::ClientInstall>>> {
    let Some(path) = app.dialog().file().set_title(tr("World-of-Warcraft-Ordner wählen", "Choose the World of Warcraft folder")).blocking_pick_folder() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::invalid(tr("Ungültiger Pfad", "Invalid path")))?;
    let found = wowclient::installs_in(&path);
    if found.is_empty() {
        return Err(AppError::not_found(tr(
            "In diesem Ordner wurde keine WoW-Forever- oder Classic-Era-Installation gefunden. Wähle den Ordner „World of Warcraft“ (enthält „.build.info“ und „Data“).",
            "No WoW Forever or Classic Era installation found in this folder. Choose the “World of Warcraft” folder (contains “.build.info” and “Data”).",
        )));
    }
    Ok(Some(found))
}

/// Reads the world maps of all zones from a local client and stores them like imported images.
/// Own (user-imported) images are kept unless `replace_own` is set.
#[tauri::command]
pub async fn import_client_maps(state: State<'_, AppState>, root: String, product: String, replace_own: bool) -> AppResult<ClientMapImport> {
    let install = wowclient::installs_in(std::path::Path::new(&root))
        .into_iter()
        .find(|i| i.product == product)
        .ok_or_else(|| AppError::not_found(tr("WoW-Installation nicht gefunden", "WoW installation not found")))?;
    let zones: Vec<(u32, Option<u32>)> = {
        let game = state.game()?;
        let mut st = game.prepare("SELECT id, ui_map_id FROM zones WHERE ui_map_id IS NOT NULL")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, u32>(0)?, r.get::<_, Option<u32>>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let existing = maps::list(&*state.user()?, &state.paths.maps_dir)?;
    let keep: Vec<u32> = if replace_own { vec![] } else { existing.iter().filter(|a| !maps::is_client_map(a.original_name.as_deref())).map(|a| a.zone_id).collect() };
    let wanted: Vec<(u32, Option<u32>)> = zones.iter().copied().filter(|(z, _)| !keep.contains(z)).collect();
    let inst = install.clone();
    let (extracted, missing) = tauri::async_runtime::spawn_blocking(move || wowclient::extract_zone_maps(&inst, &wanted))
        .await
        .map_err(|e| AppError::new("task", e.to_string()))??;
    // "explored" marks maps with all explored-area overlays (since 0.3.1); the frontend offers a refresh otherwise
    let source = format!("{} · {} {} · explored", maps::CLIENT_PREFIX, install.label, install.version);
    let user = state.user()?;
    let mut imported = 0;
    for m in extracted {
        maps::store(&user, &state.paths.maps_dir, m.zone_id, &m.png, maps::ImageKind::Png, wowclient::MAP_W, wowclient::MAP_H, Some(source.clone()))?;
        imported += 1;
    }
    Ok(ClientMapImport { imported, kept_own: keep.len() as u32, missing, source })
}
