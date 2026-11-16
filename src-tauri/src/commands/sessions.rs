use crate::db::user::{self, Session, SessionPatch};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn start_session(state: State<'_, AppState>, profile_id: String, spot_id: Option<String>, provider: Option<String>, market_id: Option<String>) -> AppResult<Session> {
    user::start_session(&*state.user()?, &profile_id, spot_id, provider, market_id)
}

#[tauri::command]
pub async fn session_action(state: State<'_, AppState>, id: String, action: String) -> AppResult<Session> {
    if !["pause", "resume", "end"].contains(&action.as_str()) {
        return Err(AppError::invalid(crate::i18n::tr("Unbekannte Aktion", "Unknown action")));
    }
    user::transition(&*state.user()?, &id, &action)
}

#[tauri::command]
pub async fn patch_session(state: State<'_, AppState>, id: String, patch: SessionPatch) -> AppResult<Session> {
    user::patch_session(&mut *state.user()?, &id, patch)
}

#[tauri::command]
pub async fn list_sessions(state: State<'_, AppState>, profile_id: String) -> AppResult<Vec<Session>> {
    user::list_sessions(&*state.user()?, &profile_id)
}

#[tauri::command]
pub async fn delete_session(state: State<'_, AppState>, id: String) -> AppResult<()> {
    user::delete_session(&*state.user()?, &id)
}

fn csv_escape(s: &str) -> String {
    if s.contains([',', '"', '\n', ';']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

pub fn sessions_csv(sessions: &[Session]) -> String {
    let mut out = String::from("id,spot_id,started_at,ended_at,active_minutes,kills,xp_gained,raw_copper,vendor_copper,realized_auction_copper,repairs_copper,purchases_copper,deaths,loot,notes\n");
    let n = |v: Option<i64>| v.map(|x| x.to_string()).unwrap_or_default();
    for s in sessions {
        let loot = s.loot.iter().map(|l| format!("{}x{}", l.item_id, l.quantity)).collect::<Vec<_>>().join(" ");
        out.push_str(&format!(
            "{},{},{},{},{:.2},{},{},{},{},{},{},{},{},{},{}\n",
            s.id,
            csv_escape(s.spot_id.as_deref().unwrap_or("")),
            s.started_at,
            s.ended_at.clone().unwrap_or_default(),
            s.active_ms as f64 / 60000.0,
            n(s.kills),
            n(s.xp_gained),
            n(s.raw_copper),
            n(s.vendor_copper),
            n(s.realized_auction_copper),
            n(s.repairs_copper),
            n(s.purchases_copper),
            n(s.deaths),
            csv_escape(&loot),
            csv_escape(s.notes.as_deref().unwrap_or(""))
        ));
    }
    out
}

#[tauri::command]
pub async fn export_sessions(app: AppHandle, state: State<'_, AppState>, profile_id: String, format: String) -> AppResult<Option<String>> {
    let sessions = user::list_sessions(&*state.user()?, &profile_id)?;
    let (ext, body) = match format.as_str() {
        "csv" => ("csv", sessions_csv(&sessions).into_bytes()),
        "json" => ("json", serde_json::to_vec_pretty(&serde_json::json!({ "format": "azeroth-farm-atlas.sessions", "version": 1, "sessions": sessions }))?),
        _ => return Err(AppError::invalid(crate::i18n::tr("Format muss csv oder json sein", "Format must be csv or json"))),
    };
    let Some(path) = app.dialog().file().add_filter(ext, &[ext]).set_file_name(&format!("farm-sessions.{ext}")).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::invalid(crate::i18n::tr("Ungültiger Pfad", "Invalid path")))?;
    std::fs::write(&path, body)?;
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_escapes_notes() {
        let s = Session { id: "a".into(), notes: Some("Mobs, \"viele\"".into()), active_ms: 90_000, ..Default::default() };
        let csv = sessions_csv(&[s]);
        assert!(csv.contains("\"Mobs, \"\"viele\"\"\""));
        assert!(csv.contains(",1.50,"));
    }
}
