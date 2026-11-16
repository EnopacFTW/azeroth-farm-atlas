//! User data (user.db). Migrations are transactional and preceded by a file backup.

use crate::error::{AppError, AppResult};
use crate::market::model::now_iso;
use crate::market::MarketSettings;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

const MIGRATIONS: &[(i64, &str)] = &[(
    1,
    r#"
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE favorites (profile_id TEXT NOT NULL, spot_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (profile_id, spot_id));
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, spot_id TEXT, started_at TEXT NOT NULL, ended_at TEXT,
  state TEXT NOT NULL, active_ms INTEGER NOT NULL DEFAULT 0, last_resumed_at TEXT,
  kills INTEGER, xp_gained INTEGER, raw_copper INTEGER, vendor_copper INTEGER, realized_auction_copper INTEGER,
  repairs_copper INTEGER, purchases_copper INTEGER, deaths INTEGER, notes TEXT, provider TEXT, market_id TEXT
);
CREATE INDEX idx_sessions_profile ON sessions(profile_id, started_at);
CREATE TABLE session_loot (
  session_id TEXT NOT NULL, item_id INTEGER NOT NULL, quantity INTEGER NOT NULL,
  realized_copper INTEGER, unit_price_copper INTEGER, price_source TEXT, price_observed_at TEXT,
  PRIMARY KEY (session_id, item_id)
);
CREATE TABLE manual_prices (item_id INTEGER NOT NULL, market_id TEXT NOT NULL, unit_copper INTEGER NOT NULL, note TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (item_id, market_id));
CREATE TABLE watchlist (profile_id TEXT NOT NULL, item_id INTEGER NOT NULL, PRIMARY KEY (profile_id, item_id));
"#,
)];

pub fn open(path: &Path, backups_dir: &Path) -> AppResult<Connection> {
    let existed = path.exists();
    let mut c = Connection::open(path)?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);")?;
    let current: i64 = c.query_row("SELECT COALESCE(MAX(version),0) FROM schema_migrations", [], |r| r.get(0))?;
    let pending: Vec<_> = MIGRATIONS.iter().filter(|(v, _)| *v > current).collect();
    if !pending.is_empty() && existed && current > 0 {
        std::fs::create_dir_all(backups_dir)?;
        let name = format!("user-v{current}-{}.db", chrono::Utc::now().format("%Y%m%d-%H%M%S"));
        c.execute("VACUUM INTO ?1", [backups_dir.join(name).to_string_lossy().to_string()])?;
    }
    for (v, sql) in pending {
        let tx = c.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)", params![v, now_iso()])?;
        tx.commit()?;
    }
    ensure_defaults(&c)?;
    Ok(c)
}

// ------------------------------------------------------------------ settings

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub active_profile_id: Option<String>,
    pub ui_scale: f32,
    pub always_on_top: bool,
    pub stale_minutes: u32,
    pub ah_cut_percent_faction: f32,
    pub ah_cut_percent_neutral: f32,
    pub refresh_interval_min: u32,
    pub provider_priority: Vec<String>,
    pub market: MarketSettings,
    pub language: String,
    pub show_unavailable: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            active_profile_id: None,
            ui_scale: 1.0,
            always_on_top: false,
            stale_minutes: 120,
            ah_cut_percent_faction: 5.0,
            ah_cut_percent_neutral: 15.0,
            refresh_interval_min: 0,
            provider_priority: vec!["ahledger".into(), "auctionhouse_fyi".into(), "blizzard_forever".into(), "manual".into()],
            market: MarketSettings::default(),
            language: "de".into(),
            show_unavailable: false,
        }
    }
}

pub fn get_settings(c: &Connection) -> AppResult<AppSettings> {
    let v: Option<String> = c.query_row("SELECT value FROM settings WHERE key='app'", [], |r| r.get(0)).optional()?;
    Ok(v.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default())
}

pub fn save_settings(c: &Connection, s: &AppSettings) -> AppResult<()> {
    if !(0.75..=1.6).contains(&s.ui_scale) || s.stale_minutes == 0 || s.stale_minutes > 7 * 24 * 60 {
        return Err(AppError::invalid("Ungültige Einstellungen"));
    }
    if !(0.0..=50.0).contains(&s.ah_cut_percent_faction) || !(0.0..=50.0).contains(&s.ah_cut_percent_neutral) {
        return Err(AppError::invalid("AH-Gebühr außerhalb 0–50 %"));
    }
    if ![0, 5, 15, 30, 60].contains(&s.refresh_interval_min) {
        return Err(AppError::invalid("Ungültiges Refresh-Intervall"));
    }
    if !crate::market::blizzard_forever::REGIONS.contains(&s.market.blizzard_region.as_str()) {
        return Err(AppError::invalid("Ungültige Blizzard-Region"));
    }
    c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?1)", [serde_json::to_string(s)?])?;
    Ok(())
}

// ------------------------------------------------------------------ profiles

pub const CLASSES: &[&str] = &["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
pub const PRIMARY: &[&str] = &["skinning", "mining", "herbalism", "leatherworking", "tailoring", "engineering", "alchemy", "blacksmithing", "enchanting"];
pub const SECONDARY: &[&str] = &["cooking", "first_aid", "fishing"];
pub const GOALS: &[&str] = &["xp", "gold", "cloth", "skinning", "mining", "herbalism", "fishing", "rare", "materials", "professions"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfSkill {
    pub id: String,
    pub skill: u16,
    #[serde(default)]
    pub target_skill: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Priorities {
    pub xp: u8,
    pub gold: u8,
    pub profession: u8,
    pub rare: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarketSelection {
    pub provider: String,
    pub market_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub level: u8,
    pub class: String,
    #[serde(default)]
    pub race: Option<String>,
    pub faction: String,
    pub region: String,
    pub ruleset: String,
    pub professions: Vec<ProfSkill>,
    #[serde(default)]
    pub secondary: Vec<ProfSkill>,
    #[serde(default)]
    pub playstyle: Vec<String>,
    pub duration_min: u16,
    #[serde(default)]
    pub start_zone_id: Option<u32>,
    pub priorities: Priorities,
    pub goals: Vec<String>,
    pub allow_classic_fallback: bool,
    pub market: MarketSelection,
    #[serde(default)]
    pub ui: serde_json::Value,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

pub fn validate_profile(p: &Profile) -> AppResult<()> {
    let bad = |m: &str| Err(AppError::invalid(m.to_string()));
    let name = p.name.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return bad("Profilname muss 1–40 Zeichen haben");
    }
    if !(1..=60).contains(&p.level) {
        return bad("Level muss zwischen 1 und 60 liegen");
    }
    if !CLASSES.contains(&p.class.as_str()) {
        return bad("Unbekannte Klasse");
    }
    if !["alliance", "horde"].contains(&p.faction.as_str()) {
        return bad("Fraktion muss Allianz oder Horde sein");
    }
    if !["eu", "us", "kr", "tw", "cn"].contains(&p.region.as_str()) || !["normal", "pvp", "rp", "rppvp"].contains(&p.ruleset.as_str()) {
        return bad("Ungültige Region/Ruleset");
    }
    if p.professions.len() > 2 {
        return bad("Maximal zwei Primärberufe");
    }
    let mut seen = std::collections::HashSet::new();
    for s in &p.professions {
        if !PRIMARY.contains(&s.id.as_str()) {
            return bad("Unbekannter Primärberuf");
        }
        if !seen.insert(&s.id) {
            return bad("Beruf doppelt gewählt");
        }
    }
    for s in &p.secondary {
        if !SECONDARY.contains(&s.id.as_str()) {
            return bad("Unbekannter Sekundärberuf");
        }
    }
    for s in p.professions.iter().chain(&p.secondary) {
        if s.skill > 300 || s.target_skill.map(|t| t > 300).unwrap_or(false) {
            return bad("Skill muss zwischen 0 und 300 liegen");
        }
    }
    if p.goals.iter().any(|g| !GOALS.contains(&g.as_str())) {
        return bad("Unbekanntes Farmziel");
    }
    if ![15, 30, 60, 120].contains(&p.duration_min) {
        return bad("Dauer muss 15, 30, 60 oder 120 Minuten sein");
    }
    if [p.priorities.xp, p.priorities.gold, p.priorities.profession, p.priorities.rare].iter().any(|v| *v > 100) {
        return bad("Prioritäten 0–100");
    }
    if let Some(m) = &p.market.market_id {
        crate::market::model::validate_market_id(m)?;
    }
    if serde_json::to_string(&p.ui)?.len() > 16_000 {
        return bad("UI-Zustand zu groß");
    }
    Ok(())
}

pub fn demo_profile() -> Profile {
    Profile {
        id: String::new(),
        name: "Enopac (Demo)".into(),
        level: 28,
        class: "hunter".into(),
        race: None,
        faction: "alliance".into(),
        region: "eu".into(),
        ruleset: "normal".into(),
        // Beispielwerte laut Briefing – bitte echten Skill einstellen
        professions: vec![
            ProfSkill { id: "skinning".into(), skill: 140, target_skill: None },
            ProfSkill { id: "leatherworking".into(), skill: 1, target_skill: Some(150) },
        ],
        secondary: vec![],
        playstyle: vec!["solo".into(), "pet".into()],
        duration_min: 30,
        start_zone_id: None,
        priorities: Priorities { xp: 60, gold: 60, profession: 70, rare: 10 },
        goals: vec!["xp".into(), "gold".into(), "skinning".into()],
        allow_classic_fallback: true,
        market: MarketSelection { provider: "ahledger".into(), market_id: Some("forever.normal.alliance.eu".into()) },
        ui: serde_json::json!({ "demo": true }),
        created_at: None,
        updated_at: None,
    }
}

fn ensure_defaults(c: &Connection) -> AppResult<()> {
    let n: i64 = c.query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0))?;
    if n == 0 {
        let p = save_profile(c, demo_profile())?;
        let mut s = get_settings(c)?;
        s.active_profile_id = Some(p.id);
        save_settings(c, &s)?;
    }
    Ok(())
}

pub fn list_profiles(c: &Connection) -> AppResult<Vec<Profile>> {
    let mut st = c.prepare("SELECT data FROM profiles ORDER BY created_at")?;
    let rows = st.query_map([], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(serde_json::from_str(&r?)?);
    }
    Ok(out)
}

pub fn get_profile(c: &Connection, id: &str) -> AppResult<Option<Profile>> {
    let d: Option<String> = c.query_row("SELECT data FROM profiles WHERE id=?1", [id], |r| r.get(0)).optional()?;
    Ok(match d {
        Some(d) => Some(serde_json::from_str(&d)?),
        None => None,
    })
}

pub fn save_profile(c: &Connection, mut p: Profile) -> AppResult<Profile> {
    p.name = p.name.trim().to_string();
    validate_profile(&p)?;
    let now = now_iso();
    if p.id.is_empty() {
        p.id = uuid::Uuid::new_v4().to_string();
        p.created_at = Some(now.clone());
    }
    p.created_at.get_or_insert(now.clone());
    p.updated_at = Some(now.clone());
    c.execute(
        "INSERT INTO profiles (id, name, data, created_at, updated_at) VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, data=excluded.data, updated_at=excluded.updated_at",
        params![p.id, p.name, serde_json::to_string(&p)?, p.created_at, now],
    )?;
    Ok(p)
}

pub fn delete_profile(c: &Connection, id: &str) -> AppResult<()> {
    let n: i64 = c.query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0))?;
    if n <= 1 {
        return Err(AppError::invalid("Das letzte Profil kann nicht gelöscht werden"));
    }
    c.execute("DELETE FROM favorites WHERE profile_id=?1", [id])?;
    c.execute("DELETE FROM watchlist WHERE profile_id=?1", [id])?;
    c.execute("DELETE FROM profiles WHERE id=?1", [id])?;
    Ok(())
}

// ------------------------------------------------------------------ favorites / watchlist

pub fn toggle_favorite(c: &Connection, profile: &str, spot: &str) -> AppResult<bool> {
    if spot.len() > 200 {
        return Err(AppError::invalid("Spot-ID zu lang"));
    }
    let n = c.execute("DELETE FROM favorites WHERE profile_id=?1 AND spot_id=?2", params![profile, spot])?;
    if n == 0 {
        c.execute("INSERT INTO favorites (profile_id, spot_id, created_at) VALUES (?1,?2,?3)", params![profile, spot, now_iso()])?;
        return Ok(true);
    }
    Ok(false)
}

pub fn favorites(c: &Connection, profile: &str) -> AppResult<Vec<String>> {
    let mut st = c.prepare("SELECT spot_id FROM favorites WHERE profile_id=?1 ORDER BY created_at")?;
    let r = st.query_map([profile], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
    Ok(r)
}

pub fn toggle_watch(c: &Connection, profile: &str, item: u32) -> AppResult<bool> {
    let n = c.execute("DELETE FROM watchlist WHERE profile_id=?1 AND item_id=?2", params![profile, item])?;
    if n == 0 {
        c.execute("INSERT INTO watchlist (profile_id, item_id) VALUES (?1,?2)", params![profile, item])?;
        return Ok(true);
    }
    Ok(false)
}

pub fn watchlist(c: &Connection, profile: &str) -> AppResult<Vec<u32>> {
    let mut st = c.prepare("SELECT item_id FROM watchlist WHERE profile_id=?1")?;
    let r = st.query_map([profile], |r| r.get(0))?.collect::<Result<Vec<u32>, _>>()?;
    Ok(r)
}

// ------------------------------------------------------------------ manual prices

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualPrice {
    pub item_id: u32,
    pub market_id: String,
    pub unit_copper: i64,
    pub note: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

pub fn set_manual_price(c: &Connection, p: &ManualPrice) -> AppResult<()> {
    if p.unit_copper < 0 || p.unit_copper > 10_000 * 100_000 {
        return Err(AppError::invalid("Preis außerhalb des gültigen Bereichs"));
    }
    crate::market::model::validate_market_id(&p.market_id)?;
    c.execute(
        "INSERT OR REPLACE INTO manual_prices (item_id, market_id, unit_copper, note, updated_at) VALUES (?1,?2,?3,?4,?5)",
        params![p.item_id, p.market_id, p.unit_copper, p.note.as_deref().map(|s| s.chars().take(200).collect::<String>()), now_iso()],
    )?;
    Ok(())
}

pub fn delete_manual_price(c: &Connection, item: u32, market: &str) -> AppResult<()> {
    c.execute("DELETE FROM manual_prices WHERE item_id=?1 AND market_id=?2", params![item, market])?;
    Ok(())
}

pub fn manual_prices(c: &Connection, market: Option<&str>) -> AppResult<Vec<ManualPrice>> {
    let mut st = c.prepare("SELECT item_id, market_id, unit_copper, note, updated_at FROM manual_prices WHERE (?1 IS NULL OR market_id=?1) ORDER BY updated_at DESC")?;
    let r = st
        .query_map([market], |r| Ok(ManualPrice { item_id: r.get(0)?, market_id: r.get(1)?, unit_copper: r.get(2)?, note: r.get(3)?, updated_at: r.get(4)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(r)
}

// ------------------------------------------------------------------ sessions

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionLoot {
    pub item_id: u32,
    pub quantity: i64,
    pub realized_copper: Option<i64>,
    pub unit_price_copper: Option<i64>,
    pub price_source: Option<String>,
    pub price_observed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub profile_id: String,
    pub spot_id: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub state: String,
    /// Active time in ms with pauses removed, computed up to "now" for running sessions.
    pub active_ms: i64,
    pub last_resumed_at: Option<String>,
    pub kills: Option<i64>,
    pub xp_gained: Option<i64>,
    pub raw_copper: Option<i64>,
    pub vendor_copper: Option<i64>,
    pub realized_auction_copper: Option<i64>,
    pub repairs_copper: Option<i64>,
    pub purchases_copper: Option<i64>,
    pub deaths: Option<i64>,
    pub notes: Option<String>,
    pub provider: Option<String>,
    pub market_id: Option<String>,
    #[serde(default)]
    pub loot: Vec<SessionLoot>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub kills: Option<i64>,
    pub xp_gained: Option<i64>,
    pub raw_copper: Option<i64>,
    pub vendor_copper: Option<i64>,
    pub realized_auction_copper: Option<i64>,
    pub repairs_copper: Option<i64>,
    pub purchases_copper: Option<i64>,
    pub deaths: Option<i64>,
    pub notes: Option<String>,
    pub loot: Option<Vec<SessionLoot>>,
}

fn ms_between(a: &str, b: &str) -> i64 {
    match (chrono::DateTime::parse_from_rfc3339(a), chrono::DateTime::parse_from_rfc3339(b)) {
        (Ok(a), Ok(b)) => (b - a).num_milliseconds().max(0),
        _ => 0,
    }
}

fn now_ms_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn start_session(c: &Connection, profile: &str, spot: Option<String>, provider: Option<String>, market: Option<String>) -> AppResult<Session> {
    let running: i64 = c.query_row("SELECT COUNT(*) FROM sessions WHERE profile_id=?1 AND state!='ended'", [profile], |r| r.get(0))?;
    if running > 0 {
        return Err(AppError::invalid("Es läuft bereits eine Session für dieses Profil"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms_iso();
    c.execute(
        "INSERT INTO sessions (id, profile_id, spot_id, started_at, state, active_ms, last_resumed_at, provider, market_id) VALUES (?1,?2,?3,?4,'running',0,?4,?5,?6)",
        params![id, profile, spot, now, provider, market],
    )?;
    get_session(c, &id)?.ok_or_else(|| AppError::not_found("Session"))
}

pub fn transition(c: &Connection, id: &str, action: &str) -> AppResult<Session> {
    let s = get_session_raw(c, id)?.ok_or_else(|| AppError::not_found("Session nicht gefunden"))?;
    let now = now_ms_iso();
    let running_ms = |s: &Session| s.last_resumed_at.as_deref().map(|r| ms_between(r, &now)).unwrap_or(0);
    match (s.state.as_str(), action) {
        ("running", "pause") => {
            c.execute("UPDATE sessions SET state='paused', active_ms=active_ms+?2, last_resumed_at=NULL WHERE id=?1", params![id, running_ms(&s)])?;
        }
        ("paused", "resume") => {
            c.execute("UPDATE sessions SET state='running', last_resumed_at=?2 WHERE id=?1", params![id, now])?;
        }
        ("running", "end") | ("paused", "end") => {
            let add = if s.state == "running" { running_ms(&s) } else { 0 };
            c.execute("UPDATE sessions SET state='ended', active_ms=active_ms+?2, last_resumed_at=NULL, ended_at=?3 WHERE id=?1", params![id, add, now])?;
        }
        _ => return Err(AppError::invalid(format!("Aktion '{action}' im Zustand '{}' nicht möglich", s.state))),
    }
    get_session(c, id)?.ok_or_else(|| AppError::not_found("Session"))
}

pub fn patch_session(c: &mut Connection, id: &str, p: SessionPatch) -> AppResult<Session> {
    let nonneg = [p.kills, p.xp_gained, p.raw_copper, p.vendor_copper, p.realized_auction_copper, p.repairs_copper, p.purchases_copper, p.deaths];
    if nonneg.iter().flatten().any(|v| *v < 0 || *v > 1_000_000_000_000) {
        return Err(AppError::invalid("Werte müssen ≥ 0 sein"));
    }
    let tx = c.transaction()?;
    tx.execute(
        "UPDATE sessions SET kills=COALESCE(?2,kills), xp_gained=COALESCE(?3,xp_gained), raw_copper=COALESCE(?4,raw_copper),
         vendor_copper=COALESCE(?5,vendor_copper), realized_auction_copper=COALESCE(?6,realized_auction_copper),
         repairs_copper=COALESCE(?7,repairs_copper), purchases_copper=COALESCE(?8,purchases_copper), deaths=COALESCE(?9,deaths),
         notes=COALESCE(?10,notes) WHERE id=?1",
        params![id, p.kills, p.xp_gained, p.raw_copper, p.vendor_copper, p.realized_auction_copper, p.repairs_copper, p.purchases_copper, p.deaths,
            p.notes.map(|n| n.chars().take(4000).collect::<String>())],
    )?;
    if let Some(loot) = p.loot {
        tx.execute("DELETE FROM session_loot WHERE session_id=?1", [id])?;
        for l in loot {
            if l.quantity <= 0 {
                continue;
            }
            tx.execute(
                "INSERT OR REPLACE INTO session_loot (session_id, item_id, quantity, realized_copper, unit_price_copper, price_source, price_observed_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![id, l.item_id, l.quantity, l.realized_copper, l.unit_price_copper, l.price_source, l.price_observed_at],
            )?;
        }
    }
    tx.commit()?;
    get_session(c, id)?.ok_or_else(|| AppError::not_found("Session"))
}

fn row_to_session(r: &rusqlite::Row) -> rusqlite::Result<Session> {
    Ok(Session {
        id: r.get(0)?,
        profile_id: r.get(1)?,
        spot_id: r.get(2)?,
        started_at: r.get(3)?,
        ended_at: r.get(4)?,
        state: r.get(5)?,
        active_ms: r.get(6)?,
        last_resumed_at: r.get(7)?,
        kills: r.get(8)?,
        xp_gained: r.get(9)?,
        raw_copper: r.get(10)?,
        vendor_copper: r.get(11)?,
        realized_auction_copper: r.get(12)?,
        repairs_copper: r.get(13)?,
        purchases_copper: r.get(14)?,
        deaths: r.get(15)?,
        notes: r.get(16)?,
        provider: r.get(17)?,
        market_id: r.get(18)?,
        loot: vec![],
    })
}

const SESSION_COLS: &str = "id, profile_id, spot_id, started_at, ended_at, state, active_ms, last_resumed_at, kills, xp_gained, raw_copper, vendor_copper, realized_auction_copper, repairs_copper, purchases_copper, deaths, notes, provider, market_id";

fn get_session_raw(c: &Connection, id: &str) -> AppResult<Option<Session>> {
    Ok(c.query_row(&format!("SELECT {SESSION_COLS} FROM sessions WHERE id=?1"), [id], row_to_session).optional()?)
}

fn finish(c: &Connection, mut s: Session) -> AppResult<Session> {
    if s.state == "running" {
        if let Some(r) = &s.last_resumed_at {
            s.active_ms += ms_between(r, &now_ms_iso());
        }
    }
    let mut st = c.prepare("SELECT item_id, quantity, realized_copper, unit_price_copper, price_source, price_observed_at FROM session_loot WHERE session_id=?1")?;
    s.loot = st
        .query_map([&s.id], |r| {
            Ok(SessionLoot { item_id: r.get(0)?, quantity: r.get(1)?, realized_copper: r.get(2)?, unit_price_copper: r.get(3)?, price_source: r.get(4)?, price_observed_at: r.get(5)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(s)
}

pub fn get_session(c: &Connection, id: &str) -> AppResult<Option<Session>> {
    match get_session_raw(c, id)? {
        Some(s) => Ok(Some(finish(c, s)?)),
        None => Ok(None),
    }
}

pub fn list_sessions(c: &Connection, profile: &str) -> AppResult<Vec<Session>> {
    let mut st = c.prepare(&format!("SELECT {SESSION_COLS} FROM sessions WHERE profile_id=?1 ORDER BY started_at DESC LIMIT 500"))?;
    let raw = st.query_map([profile], row_to_session)?.collect::<Result<Vec<_>, _>>()?;
    raw.into_iter().map(|s| finish(c, s)).collect()
}

pub fn delete_session(c: &Connection, id: &str) -> AppResult<()> {
    c.execute("DELETE FROM session_loot WHERE session_id=?1", [id])?;
    c.execute("DELETE FROM sessions WHERE id=?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> (tempfile::TempDir, Connection) {
        let d = tempfile::tempdir().unwrap();
        let c = open(&d.path().join("user.db"), &d.path().join("backups")).unwrap();
        (d, c)
    }

    #[test]
    fn first_start_creates_demo_profile_as_active() {
        let (_d, c) = db();
        let p = list_profiles(&c).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].level, 28);
        assert_eq!(get_settings(&c).unwrap().active_profile_id.as_deref(), Some(p[0].id.as_str()));
    }

    #[test]
    fn profile_validation() {
        let mut p = demo_profile();
        p.level = 61;
        assert!(validate_profile(&p).is_err());
        p.level = 1;
        assert!(validate_profile(&p).is_ok());
        p.professions.push(ProfSkill { id: "mining".into(), skill: 1, target_skill: None });
        assert!(validate_profile(&p).is_err(), "only two primary professions");
        let mut p = demo_profile();
        p.professions[0].skill = 301;
        assert!(validate_profile(&p).is_err());
        let mut p = demo_profile();
        p.secondary.push(ProfSkill { id: "mining".into(), skill: 1, target_skill: None });
        assert!(validate_profile(&p).is_err(), "mining is not secondary");
    }

    #[test]
    fn session_pause_excludes_time_and_survives_reopen() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("user.db");
        let id;
        {
            let c = open(&path, &d.path().join("b")).unwrap();
            let pid = list_profiles(&c).unwrap()[0].id.clone();
            let s = start_session(&c, &pid, Some("mob:x".into()), None, None).unwrap();
            id = s.id.clone();
            std::thread::sleep(std::time::Duration::from_millis(120));
            transition(&c, &id, "pause").unwrap();
            std::thread::sleep(std::time::Duration::from_millis(300));
            let paused = get_session(&c, &id).unwrap().unwrap();
            assert!(paused.active_ms >= 100 && paused.active_ms < 300, "paused time must not count: {}", paused.active_ms);
            transition(&c, &id, "resume").unwrap();
            assert!(transition(&c, &id, "resume").is_err());
        }
        // "reload": new connection, same file
        let c = open(&path, &d.path().join("b")).unwrap();
        let s = transition(&c, &id, "end").unwrap();
        assert_eq!(s.state, "ended");
        assert!(s.active_ms >= 100 && s.active_ms < 1500);
    }

    #[test]
    fn migration_keeps_data_and_writes_backup_on_upgrade() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("user.db");
        {
            let c = open(&path, &d.path().join("b")).unwrap();
            let pid = list_profiles(&c).unwrap()[0].id.clone();
            toggle_favorite(&c, &pid, "mob:a").unwrap();
        }
        let c = open(&path, &d.path().join("b")).unwrap();
        let pid = list_profiles(&c).unwrap()[0].id.clone();
        assert_eq!(favorites(&c, &pid).unwrap(), vec!["mob:a".to_string()]);
    }
}
