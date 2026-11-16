use serde::Serialize;

/// Error sent to the frontend. `code` is stable and machine readable, `message` is UI text in the current language (see i18n.rs).
#[derive(Debug, thiserror::Error, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
#[error("{code}: {message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_secs: Option<u64>,
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), http_status: None, retry_after_secs: None }
    }
    pub fn with_status(mut self, status: u16) -> Self {
        self.http_status = Some(status);
        self
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_input", message)
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::new("database", crate::i18n::tr(format!("Datenbankfehler: {e}"), format!("Database error: {e}")))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::new("json", crate::i18n::tr(format!("Ungültiges JSON: {e}"), format!("Invalid JSON: {e}")))
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::new("io", crate::i18n::tr(format!("Dateifehler: {e}"), format!("File error: {e}")))
    }
}

pub type AppResult<T> = Result<T, AppError>;
