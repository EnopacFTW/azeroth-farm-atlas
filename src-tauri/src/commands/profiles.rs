use crate::db::user::{self, Profile};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn list_profiles(state: State<'_, AppState>) -> AppResult<Vec<Profile>> {
    user::list_profiles(&*state.user()?)
}

#[tauri::command]
pub async fn save_profile(state: State<'_, AppState>, profile: Profile) -> AppResult<Profile> {
    user::save_profile(&*state.user()?, profile)
}

#[tauri::command]
pub async fn delete_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let c = state.user()?;
    user::delete_profile(&c, &id)?;
    let mut s = user::get_settings(&c)?;
    if s.active_profile_id.as_deref() == Some(id.as_str()) {
        s.active_profile_id = user::list_profiles(&c)?.first().map(|p| p.id.clone());
        user::save_settings(&c, &s)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn duplicate_profile(state: State<'_, AppState>, id: String) -> AppResult<Profile> {
    let c = state.user()?;
    let mut p = user::get_profile(&c, &id)?.ok_or_else(|| AppError::not_found("Profil nicht gefunden"))?;
    p.id = String::new();
    p.created_at = None;
    p.name = format!("{} (Kopie)", p.name).chars().take(40).collect();
    user::save_profile(&c, p)
}

#[tauri::command]
pub async fn set_active_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let c = state.user()?;
    user::get_profile(&c, &id)?.ok_or_else(|| AppError::not_found("Profil nicht gefunden"))?;
    let mut s = user::get_settings(&c)?;
    s.active_profile_id = Some(id);
    user::save_settings(&c, &s)
}

/// Export contains only profile data – never credentials (those live in the Windows Credential Manager).
#[tauri::command]
pub async fn export_profile(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<Option<String>> {
    let p = user::get_profile(&*state.user()?, &id)?.ok_or_else(|| AppError::not_found("Profil nicht gefunden"))?;
    let file_name = format!("{}.profile.json", p.name.replace(|c: char| !c.is_alphanumeric(), "_"));
    let Some(path) = app.dialog().file().add_filter("JSON", &["json"]).set_file_name(&file_name).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::invalid("Ungültiger Pfad"))?;
    let doc = serde_json::json!({ "format": "azeroth-farm-atlas.profile", "version": 1, "profile": p });
    std::fs::write(&path, serde_json::to_vec_pretty(&doc)?)?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
pub async fn import_profile(app: AppHandle, state: State<'_, AppState>) -> AppResult<Option<Profile>> {
    let Some(path) = app.dialog().file().add_filter("JSON", &["json"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::invalid("Ungültiger Pfad"))?;
    if std::fs::metadata(&path)?.len() > 256 * 1024 {
        return Err(AppError::invalid("Datei zu groß für ein Profil"));
    }
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&path)?)?;
    if v.get("format").and_then(|f| f.as_str()) != Some("azeroth-farm-atlas.profile") {
        return Err(AppError::invalid("Keine Azeroth-Farm-Atlas-Profildatei"));
    }
    let mut p: Profile = serde_json::from_value(v.get("profile").cloned().unwrap_or_default())
        .map_err(|e| AppError::invalid(format!("Profil ungültig: {e}")))?;
    p.id = String::new();
    p.created_at = None;
    Ok(Some(user::save_profile(&*state.user()?, p)?))
}
