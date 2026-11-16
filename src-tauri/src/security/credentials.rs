//! Secrets live only in the Windows Credential Manager (keyring crate, windows-native backend).
//! Never in SQLite, logs, profile exports or the JS bundle. The frontend can set/delete and ask "configured?", never read.

use crate::error::AppError;

const SERVICE: &str = "AzerothFarmAtlas";

pub const ALLOWED: &[&str] = &["blizzard_client_id", "blizzard_client_secret", "ahledger_api_key", "fyi_api_key"];

fn entry(name: &str) -> Result<keyring::Entry, AppError> {
    if !ALLOWED.contains(&name) {
        return Err(AppError::invalid(crate::i18n::tr("Unbekannter Schlüsselname", "Unknown key name")));
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| AppError::new("credential_store", crate::i18n::tr(format!("Windows-Anmeldeinformationsverwaltung nicht verfügbar: {e}"), format!("Windows Credential Manager unavailable: {e}"))))
}

pub fn set(name: &str, value: &str) -> Result<(), AppError> {
    let v = value.trim();
    if v.is_empty() || v.len() > 512 {
        return Err(AppError::invalid(crate::i18n::tr("Wert leer oder zu lang", "Value empty or too long")));
    }
    entry(name)?.set_password(v).map_err(|e| AppError::new("credential_store", crate::i18n::tr(format!("Speichern fehlgeschlagen: {e}"), format!("Saving failed: {e}"))))
}

pub fn get(name: &str) -> Option<String> {
    entry(name).ok()?.get_password().ok()
}

pub fn delete(name: &str) -> Result<(), AppError> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::new("credential_store", crate::i18n::tr(format!("Löschen fehlgeschlagen: {e}"), format!("Deleting failed: {e}")))),
    }
}

pub fn is_set(name: &str) -> bool {
    get(name).is_some()
}
