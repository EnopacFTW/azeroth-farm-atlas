use crate::db::user::{self, AppSettings};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    user::get_settings(&*state.user()?)
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: AppSettings) -> AppResult<AppSettings> {
    user::save_settings(&*state.user()?, &settings)?;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(settings.always_on_top);
    }
    Ok(settings)
}

#[tauri::command]
pub async fn toggle_favorite(state: State<'_, AppState>, profile_id: String, spot_id: String) -> AppResult<bool> {
    user::toggle_favorite(&*state.user()?, &profile_id, &spot_id)
}

#[tauri::command]
pub async fn list_favorites(state: State<'_, AppState>, profile_id: String) -> AppResult<Vec<String>> {
    user::favorites(&*state.user()?, &profile_id)
}

#[tauri::command]
pub async fn toggle_watch(state: State<'_, AppState>, profile_id: String, item_id: u32) -> AppResult<bool> {
    user::toggle_watch(&*state.user()?, &profile_id, item_id)
}

#[tauri::command]
pub async fn list_watchlist(state: State<'_, AppState>, profile_id: String) -> AppResult<Vec<u32>> {
    user::watchlist(&*state.user()?, &profile_id)
}

/// Consistent SQLite backup of user.db via VACUUM INTO to a user-chosen file.
#[tauri::command]
pub async fn backup_user_data(app: AppHandle, state: State<'_, AppState>) -> AppResult<Option<String>> {
    let name = format!("azeroth-farm-atlas-backup-{}.db", chrono::Utc::now().format("%Y%m%d-%H%M"));
    let Some(path) = app.dialog().file().add_filter("SQLite", &["db"]).set_file_name(&name).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::invalid("Ungültiger Pfad"))?;
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    state.user()?.execute("VACUUM INTO ?1", [path.to_string_lossy().to_string()])?;
    Ok(Some(path.display().to_string()))
}

/// Deletes all local user data, the price cache and stored credentials. Requires the confirmation word.
#[tauri::command]
pub async fn reset_local_data(state: State<'_, AppState>, confirm: String) -> AppResult<()> {
    if confirm != "LÖSCHEN" {
        return Err(AppError::invalid("Bestätigungswort fehlt"));
    }
    {
        let c = state.user()?;
        c.execute_batch("DELETE FROM session_loot; DELETE FROM sessions; DELETE FROM favorites; DELETE FROM watchlist; DELETE FROM manual_prices; DELETE FROM profiles; DELETE FROM settings;")?;
        let p = user::save_profile(&c, user::demo_profile())?;
        let s = AppSettings { active_profile_id: Some(p.id), ..Default::default() };
        user::save_settings(&c, &s)?;
    }
    state.market.clear_cache()?;
    for n in crate::security::credentials::ALLOWED {
        crate::security::credentials::delete(n)?;
    }
    state.market.forget_blizzard_token();
    Ok(())
}
