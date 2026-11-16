//! Provider-independent market domain. The UI only ever sees these types, never provider JSON.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    Ahledger,
    BlizzardForever,
    AuctionhouseFyi,
    Manual,
}

impl ProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderId::Ahledger => "ahledger",
            ProviderId::BlizzardForever => "blizzard_forever",
            ProviderId::AuctionhouseFyi => "auctionhouse_fyi",
            ProviderId::Manual => "manual",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "ahledger" => Some(Self::Ahledger),
            "blizzard_forever" => Some(Self::BlizzardForever),
            "auctionhouse_fyi" => Some(Self::AuctionhouseFyi),
            "manual" => Some(Self::Manual),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Market {
    pub provider: ProviderId,
    /// Provider-specific market id (never forced into a global schema).
    pub id: String,
    pub region: String,
    pub ruleset: String,
    pub faction: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub house_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub house_name: Option<String>,
    /// true = listed by the provider API in this session; false = only from documentation.
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarketQuote {
    pub provider: ProviderId,
    pub market_id: String,
    pub region: String,
    pub ruleset: String,
    pub faction: String,
    pub house_id: Option<u32>,
    pub item_id: u32,
    pub variant_key: Option<String>,
    /// Integer copper per unit. None = unknown / not available (never 0 for "missing").
    pub min_buyout_copper: Option<i64>,
    pub median_copper: Option<i64>,
    /// A provider price whose statistic is not documented as min or median (auctionhouse.fyi "latest reading").
    pub reference_price_copper: Option<i64>,
    pub median7d_copper: Option<i64>,
    pub median30d_copper: Option<i64>,
    pub quantity_listed: Option<i64>,
    pub auctions: Option<i64>,
    pub estimated_units_sold_per_day: Option<f64>,
    /// Original scan time of the provider data (ISO 8601). None = provider did not say.
    pub observed_at: Option<String>,
    pub fetched_at: String,
    pub cache_expires_at: Option<String>,
    pub is_live_snapshot: bool,
    pub source_url: Option<String>,
    pub attribution_text: String,
    pub attribution_url: Option<String>,
    pub data_source_note: Option<String>,
    pub from_cache: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PricePoint {
    pub t: String,
    pub min: Option<i64>,
    pub median: Option<i64>,
    pub quantity: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PriceSeries {
    pub provider: ProviderId,
    pub market_id: String,
    pub item_id: u32,
    pub range: String,
    pub points: Vec<PricePoint>,
    pub attribution_text: String,
    pub attribution_url: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub provider: String,
    pub enabled: bool,
    pub reachable: Option<bool>,
    pub checked_at: Option<String>,
    pub last_success_at: Option<String>,
    pub last_response_ms: Option<u64>,
    pub last_data_at: Option<String>,
    pub credentials_required: bool,
    pub credentials_configured: bool,
    pub markets_found: usize,
    pub last_error: Option<String>,
    pub tested_endpoint: Option<String>,
    pub experimental: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub provider: String,
    pub market_id: String,
    pub last_attempt_at: Option<String>,
    pub last_success_at: Option<String>,
    pub last_error: Option<String>,
    pub items: i64,
    pub observed_at: Option<String>,
    pub not_modified: bool,
    pub note: Option<String>,
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn iso_in(secs: u64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(secs as i64)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn validate_market_id(id: &str) -> Result<(), crate::error::AppError> {
    let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-' || c == '_');
    if ok { Ok(()) } else { Err(crate::error::AppError::invalid("Ungültige Markt-ID")) }
}
