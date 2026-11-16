//! UI language for backend texts (errors, notes, dialogs). Set from the saved settings at startup and on every save.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn set_language(lang: &str) {
    ENGLISH.store(lang == "en", Ordering::Relaxed);
}

pub fn is_english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// German/English pair; returns the text for the current UI language.
pub fn tr(de: impl Into<String>, en: impl Into<String>) -> String {
    if is_english() { en.into() } else { de.into() }
}
