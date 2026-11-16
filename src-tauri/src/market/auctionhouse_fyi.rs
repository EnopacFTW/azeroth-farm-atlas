//! auctionhouse.fyi adapter (https://auctionhouse.fyi/docs/api, checked 2026-11-15). Read-only, public snapshot routes only.
//! `row = [price, quantity, at]` (at = Unix ms), `row` may be null, `live` is a real field.
//! The documented public markets are six US markets; anything else must be confirmed by a request first.

use super::http::{HttpClient, HttpResponse, RequestOptions};
use super::model::*;
use crate::error::AppError;
use serde::Deserialize;

pub const BASE: &str = "https://auctionhouse.fyi/api/v1";
pub const ATTRIBUTION: &str = "Prices from auctionhouse.fyi";
pub const HOME: &str = "https://auctionhouse.fyi";

pub const DOCUMENTED_MARKETS: &[&str] = &[
    "forever.normal.alliance.us",
    "forever.normal.horde.us",
    "forever.pvp.alliance.us",
    "forever.pvp.horde.us",
    "forever.rp.alliance.us",
    "forever.rp.horde.us",
];

#[derive(Clone)]
pub struct Fyi {
    pub base: String,
    pub api_key: Option<String>,
}

#[derive(Deserialize)]
struct ItemResp {
    market: String,
    item: u64,
    row: Option<Vec<Option<serde_json::Value>>>,
    #[serde(default)]
    live: bool,
}

#[derive(Deserialize)]
struct ErrBody {
    error: Option<String>,
}

pub fn documented_markets() -> Vec<Market> {
    DOCUMENTED_MARKETS
        .iter()
        .map(|id| {
            let (ruleset, faction, region) = super::ahledger::split_market(id);
            Market {
                provider: ProviderId::AuctionhouseFyi,
                id: id.to_string(),
                label: format!("{} {} {}", ruleset, faction, region.to_uppercase()),
                region,
                ruleset,
                faction,
                house_id: None,
                house_name: None,
                confirmed: false,
            }
        })
        .collect()
}

/// Item keys: plain items use the item id; variants are distinct 53-bit keys (key = itemID + 2^31 * v). Never flattened.
pub fn item_key(item_id: u32, variant_key: Option<&str>) -> Result<u64, AppError> {
    match variant_key {
        None => Ok(item_id as u64),
        Some(v) => {
            let k: u64 = v.parse().map_err(|_| AppError::invalid(crate::i18n::tr("Ungültiger Varianten-Schlüssel", "Invalid variant key")))?;
            if k == 0 || k > (1u64 << 53) - 1 {
                return Err(AppError::invalid(crate::i18n::tr("Varianten-Schlüssel außerhalb des gültigen Bereichs", "Variant key outside the valid range")));
            }
            Ok(k)
        }
    }
}

pub fn parse_item(r: &HttpResponse, item_id: u32, variant_key: Option<&str>) -> Result<MarketQuote, AppError> {
    let p: ItemResp = r.json()?;
    let (ruleset, faction, region) = super::ahledger::split_market(&p.market);
    let num = |v: Option<&Option<serde_json::Value>>| v.and_then(|x| x.as_ref()).and_then(|x| x.as_i64());
    let (price, qty, at) = match &p.row {
        Some(row) => (num(row.first()), num(row.get(1)), num(row.get(2))),
        None => (None, None, None),
    };
    let observed_at = at.and_then(chrono::DateTime::from_timestamp_millis).map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    Ok(MarketQuote {
        provider: ProviderId::AuctionhouseFyi,
        market_id: p.market.clone(),
        region,
        ruleset,
        faction,
        house_id: None,
        item_id,
        variant_key: variant_key.map(|s| s.to_string()).or_else(|| (p.item != item_id as u64).then(|| p.item.to_string())),
        min_buyout_copper: None,
        median_copper: None,
        reference_price_copper: price,
        median7d_copper: None,
        median30d_copper: None,
        quantity_listed: qty,
        auctions: None,
        estimated_units_sold_per_day: None,
        observed_at,
        fetched_at: now_iso(),
        cache_expires_at: r.max_age_secs.map(iso_in),
        is_live_snapshot: p.live,
        source_url: Some(format!("{HOME}/")),
        attribution_text: ATTRIBUTION.into(),
        attribution_url: Some(HOME.into()),
        data_source_note: Some(if p.row.is_none() {
            crate::i18n::tr("Keine Lesung (row = null)", "No reading (row = null)")
        } else if p.live {
            "Live-Tabelle".into()
        } else {
            crate::i18n::tr("Stündlicher Snapshot (live = false); Statistik der Lesung laut Doku nicht als Min/Median spezifiziert", "Hourly snapshot (live = false); the docs do not specify the reading as min/median")
        }),
        from_cache: false,
    })
}

impl Fyi {
    pub fn new(api_key: Option<String>) -> Self {
        Self { base: BASE.into(), api_key }
    }

    pub async fn quote(&self, http: &HttpClient, market: &str, item_id: u32, variant_key: Option<&str>) -> Result<MarketQuote, AppError> {
        validate_market_id(market)?;
        let key = item_key(item_id, variant_key)?;
        let opts = RequestOptions { bearer: self.api_key.clone(), timeout: Some(std::time::Duration::from_secs(20)), ..Default::default() };
        match http.get(&format!("{}/ah/{market}/{key}", self.base), opts).await {
            Ok(r) => parse_item(&r, item_id, variant_key),
            Err(e) => Err(map_error(e)),
        }
    }
}

/// `{"error":"bad_market"}` -> clear "market not offered" message, so the UI can switch provider.
fn map_error(e: AppError) -> AppError {
    if matches!(e.http_status, Some(400) | Some(404)) {
        return AppError::new("market_unavailable", crate::i18n::tr("Dieser Markt wird von auctionhouse.fyi nicht angeboten (bad_market/404). Für EU bitte AHledger verwenden.", "auctionhouse.fyi does not offer this market (bad_market/404). Use AHledger for EU."))
            .with_status(e.http_status.unwrap_or(404));
    }
    e
}

pub fn parse_error_body(body: &[u8]) -> Option<String> {
    serde_json::from_slice::<ErrBody>(body).ok().and_then(|b| b.error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::network_policy::NetworkPolicy;

    const ITEM: &str = include_str!("../../../tests/fixtures/fyi/item_2589_horde_us.json");
    const NULL_ROW: &str = include_str!("../../../tests/fixtures/fyi/item_row_null.json");

    fn resp(body: &str) -> HttpResponse {
        HttpResponse::for_tests(body, Some(600))
    }

    #[test]
    fn parses_row_and_ms_timestamps() {
        let q = parse_item(&resp(ITEM), 2589, None).unwrap();
        assert_eq!(q.reference_price_copper, Some(20));
        assert_eq!(q.quantity_listed, Some(27673));
        assert_eq!(q.observed_at.as_deref(), Some("2026-11-15T16:29:39Z"));
        assert!(!q.is_live_snapshot, "live=false must be kept");
        assert_eq!(q.min_buyout_copper, None, "undocumented statistic is not relabelled as min buyout");
    }

    #[test]
    fn null_row_is_unknown() {
        let q = parse_item(&resp(NULL_ROW), 999999, None).unwrap();
        assert_eq!(q.reference_price_copper, None);
        assert_eq!(q.quantity_listed, None);
        assert_eq!(q.observed_at, None);
    }

    #[test]
    fn variant_keys_are_not_flattened() {
        assert_eq!(item_key(2589, None).unwrap(), 2589);
        let k = 15211u64 + 2147483648u64 * 2 * 1046;
        assert_eq!(item_key(15211, Some(&k.to_string())).unwrap(), k);
        assert!(item_key(1, Some("0")).is_err());
    }

    #[test]
    fn documented_markets_are_us_only_and_unconfirmed() {
        let m = documented_markets();
        assert_eq!(m.len(), 6);
        assert!(m.iter().all(|m| m.region == "us" && !m.confirmed));
    }

    #[tokio::test]
    async fn eu_market_maps_to_unavailable() {
        let mut server = mockito::Server::new_async().await;
        // live API answers 400 {"error":"bad_market"} (checked 2026-11-15)
        let _m = server.mock("GET", "/ah/forever.normal.alliance.eu/2589").with_status(400).with_body(r#"{"error":"bad_market"}"#).create_async().await;
        let http = HttpClient::new(NetworkPolicy::loopback_for_tests());
        let f = Fyi { base: server.url(), api_key: None };
        let e = f.quote(&http, "forever.normal.alliance.eu", 2589, None).await.unwrap_err();
        assert_eq!(e.code, "market_unavailable");
    }
}
