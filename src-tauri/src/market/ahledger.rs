//! AHledger adapter (https://ahledger.com/developers, checked 2026-11-15).
//! Routes: /v1/markets, /v1/prices/{market}/{item}?range=, /v1/tooltip/{market}?items=, /v1/pricetable/{market} (ETag).

use super::http::{HttpClient, HttpResponse, RequestOptions};
use super::model::*;
use crate::error::AppError;
use serde::Deserialize;

pub const BASE: &str = "https://api.ahledger.com";
pub const ATTRIBUTION: &str = "Prices from AHledger";
pub const HOME: &str = "https://ahledger.com";

#[derive(Clone)]
pub struct Ahledger {
    pub base: String,
    pub api_key: Option<String>,
}

#[derive(Deserialize)]
struct MarketsResp {
    markets: Vec<MarketRow>,
}
#[derive(Deserialize)]
struct MarketRow {
    id: String,
    game: String,
    ruleset: String,
    faction: String,
    region: String,
    label: Option<String>,
}

#[derive(Deserialize)]
struct Attribution {
    text: Option<String>,
    url: Option<String>,
}
#[derive(Deserialize)]
struct PriceItem {
    url: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Latest {
    observed_at: Option<String>,
    source: Option<String>,
    min_buyout: Option<i64>,
    median: Option<i64>,
    quantity: Option<i64>,
    auctions: Option<i64>,
    median7d: Option<i64>,
    median30d: Option<i64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sales {
    estimated_per_day: Option<f64>,
}
#[derive(Deserialize)]
struct SeriesRow {
    t: String,
    min: Option<i64>,
    median: Option<i64>,
    quantity: Option<i64>,
}
#[derive(Deserialize)]
struct PricesResp {
    market: String,
    item: Option<PriceItem>,
    attribution: Option<Attribution>,
    latest: Option<Latest>,
    sales: Option<Sales>,
    range: Option<String>,
    #[serde(default)]
    series: Vec<SeriesRow>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TooltipItem {
    id: u32,
    median: Option<i64>,
    min_buyout: Option<i64>,
    quantity: Option<i64>,
    observed_at: Option<String>,
    sales_per_day: Option<f64>,
}
#[derive(Deserialize)]
struct TooltipResp {
    #[serde(default)]
    items: Vec<TooltipItem>,
}

/// "forever.normal.alliance.eu" -> (ruleset, faction, region)
pub fn split_market(id: &str) -> (String, String, String) {
    let p: Vec<&str> = id.split('.').collect();
    if p.len() == 4 {
        (p[1].into(), p[2].into(), p[3].into())
    } else {
        ("unknown".into(), "unknown".into(), "unknown".into())
    }
}

pub fn parse_markets(r: &HttpResponse) -> Result<Vec<Market>, AppError> {
    let m: MarketsResp = r.json()?;
    Ok(m.markets
        .into_iter()
        .filter(|m| m.game == "forever")
        .map(|m| Market {
            provider: ProviderId::Ahledger,
            label: m.label.unwrap_or_else(|| m.id.clone()),
            id: m.id,
            region: m.region,
            ruleset: m.ruleset,
            faction: m.faction,
            house_id: None,
            house_name: None,
            confirmed: true,
        })
        .collect())
}

fn base_quote(market_id: &str, item_id: u32, fetched_at: &str, expires: Option<String>) -> MarketQuote {
    let (ruleset, faction, region) = split_market(market_id);
    MarketQuote {
        provider: ProviderId::Ahledger,
        market_id: market_id.into(),
        region,
        ruleset,
        faction,
        house_id: None,
        item_id,
        variant_key: None,
        min_buyout_copper: None,
        median_copper: None,
        reference_price_copper: None,
        median7d_copper: None,
        median30d_copper: None,
        quantity_listed: None,
        auctions: None,
        estimated_units_sold_per_day: None,
        observed_at: None,
        fetched_at: fetched_at.into(),
        cache_expires_at: expires,
        is_live_snapshot: false,
        source_url: None,
        attribution_text: ATTRIBUTION.into(),
        attribution_url: Some(HOME.into()),
        data_source_note: None,
        from_cache: false,
    }
}

pub fn parse_prices(r: &HttpResponse, item_id: u32) -> Result<(MarketQuote, PriceSeries), AppError> {
    let p: PricesResp = r.json()?;
    let fetched = now_iso();
    let mut q = base_quote(&p.market, item_id, &fetched, r.max_age_secs.map(iso_in));
    let attr_url = p.attribution.as_ref().and_then(|a| a.url.clone()).or_else(|| p.item.as_ref().and_then(|i| i.url.clone()));
    if let Some(a) = &p.attribution {
        if let Some(t) = &a.text {
            q.attribution_text = t.clone();
        }
    }
    q.attribution_url = attr_url.clone().or(Some(HOME.into()));
    q.source_url = p.item.as_ref().and_then(|i| i.url.clone());
    if let Some(l) = p.latest {
        q.min_buyout_copper = l.min_buyout;
        q.median_copper = l.median;
        q.quantity_listed = l.quantity;
        q.auctions = l.auctions;
        q.median7d_copper = l.median7d;
        q.median30d_copper = l.median30d;
        q.observed_at = l.observed_at;
        q.data_source_note = l.source;
    } else {
        q.data_source_note = Some(crate::i18n::tr("Kein Scan für diesen Markt (latest = null)", "No scan for this market (latest = null)"));
    }
    q.estimated_units_sold_per_day = p.sales.and_then(|s| s.estimated_per_day);
    let series = PriceSeries {
        provider: ProviderId::Ahledger,
        market_id: p.market,
        item_id,
        range: p.range.unwrap_or_default(),
        points: p.series.into_iter().map(|s| PricePoint { t: s.t, min: s.min, median: s.median, quantity: s.quantity }).collect(),
        attribution_text: q.attribution_text.clone(),
        attribution_url: q.attribution_url.clone(),
        fetched_at: fetched,
    };
    Ok((q, series))
}

pub fn parse_tooltip(r: &HttpResponse, market_id: &str) -> Result<Vec<MarketQuote>, AppError> {
    let t: TooltipResp = r.json()?;
    let fetched = now_iso();
    Ok(t.items
        .into_iter()
        .map(|i| {
            let mut q = base_quote(market_id, i.id, &fetched, r.max_age_secs.map(iso_in));
            q.median_copper = i.median;
            q.min_buyout_copper = i.min_buyout;
            q.quantity_listed = i.quantity;
            q.observed_at = i.observed_at;
            q.estimated_units_sold_per_day = i.sales_per_day;
            q
        })
        .collect())
}

/// Price table format (documented): header `AHL1|forever/pvp/horde/us|<unix>|<rows>`, rows
/// `item:median:minBuyout:quantity:median7d:median30d:low30d:high30d:soldPerDay*10`, empty field = unknown.
pub fn parse_pricetable(text: &str, market_id: &str, max_age: Option<u64>) -> Result<(Vec<MarketQuote>, Option<String>), AppError> {
    let mut lines = text.lines();
    let header = lines.next().ok_or_else(|| AppError::new("schema", crate::i18n::tr("Leere Preistabelle", "Empty price table")))?;
    let h: Vec<&str> = header.split('|').collect();
    if h.len() < 4 || h[0] != "AHL1" {
        return Err(AppError::new("schema", crate::i18n::tr("Unbekanntes Preistabellen-Format (erwartet AHL1)", "Unknown price table format (expected AHL1)")));
    }
    if h[1].replace('/', ".") != market_id {
        return Err(AppError::new("schema", crate::i18n::tr(format!("Preistabelle gehört zu {} statt {market_id}", h[1]), format!("Price table belongs to {} instead of {market_id}", h[1]))));
    }
    let observed = h[2]
        .parse::<i64>()
        .ok()
        .and_then(|s| chrono::DateTime::from_timestamp(s, 0))
        .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    let fetched = now_iso();
    let expires = max_age.map(iso_in);
    let num = |s: &str| if s.is_empty() { None } else { s.parse::<i64>().ok() };
    let mut out = Vec::new();
    for line in lines {
        let f: Vec<&str> = line.trim().split(':').collect();
        if f.len() < 9 {
            continue;
        }
        let Ok(item) = f[0].parse::<u32>() else { continue };
        let mut q = base_quote(market_id, item, &fetched, expires.clone());
        q.median_copper = num(f[1]);
        q.min_buyout_copper = num(f[2]);
        q.quantity_listed = num(f[3]);
        q.median7d_copper = num(f[4]);
        q.median30d_copper = num(f[5]);
        q.estimated_units_sold_per_day = num(f[8]).map(|v| v as f64 / 10.0);
        q.observed_at = observed.clone();
        q.data_source_note = Some("AHledger-Preistabelle (Bulk)".into());
        out.push(q);
    }
    let declared: usize = h[3].parse().unwrap_or(0);
    if declared > 0 && out.len() * 10 < declared * 9 {
        return Err(AppError::new("schema", crate::i18n::tr(format!("Preistabelle unvollständig ({} von {declared} Zeilen)", out.len()), format!("Price table incomplete ({} of {declared} rows)", out.len()))));
    }
    Ok((out, observed))
}

impl Ahledger {
    pub fn new(api_key: Option<String>) -> Self {
        Self { base: BASE.into(), api_key }
    }

    fn opts(&self) -> RequestOptions {
        RequestOptions { bearer: self.api_key.clone(), timeout: Some(std::time::Duration::from_secs(20)), ..Default::default() }
    }

    pub async fn markets(&self, http: &HttpClient) -> Result<(Vec<Market>, HttpResponse), AppError> {
        let r = http.get(&format!("{}/v1/markets", self.base), self.opts()).await?;
        Ok((parse_markets(&r)?, r))
    }

    pub async fn prices(&self, http: &HttpClient, market: &str, item: u32, range: &str) -> Result<Option<(MarketQuote, PriceSeries)>, AppError> {
        validate_market_id(market)?;
        if !["24h", "7d", "30d", "90d"].contains(&range) {
            return Err(AppError::invalid(crate::i18n::tr("Ungültiger Zeitraum", "Invalid range")));
        }
        match http.get(&format!("{}/v1/prices/{market}/{item}?range={range}", self.base), self.opts()).await {
            Ok(r) => Ok(Some(parse_prices(&r, item)?)),
            Err(e) if e.code == "not_found" => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub async fn tooltip(&self, http: &HttpClient, market: &str, items: &[u32]) -> Result<Vec<MarketQuote>, AppError> {
        validate_market_id(market)?;
        let mut out = Vec::new();
        for chunk in items.chunks(100) {
            let ids = chunk.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
            let r = http.get(&format!("{}/v1/tooltip/{market}?items={ids}", self.base), self.opts()).await?;
            out.extend(parse_tooltip(&r, market)?);
        }
        Ok(out)
    }

    /// Market tool: every priced recipe of a profession (Forever recipes, reagents, skillRequired). 60 req/min limit.
    pub async fn crafting(&self, http: &HttpClient, market: &str, profession: &str) -> Result<serde_json::Value, AppError> {
        validate_market_id(market)?;
        const PROFESSIONS: &[&str] = &["Alchemy", "Blacksmithing", "Cooking", "Enchanting", "Engineering", "First Aid", "Leatherworking", "Tailoring"];
        if !PROFESSIONS.contains(&profession) {
            return Err(AppError::invalid(crate::i18n::tr("Beruf ohne Rezepte bei AHledger", "Profession has no recipes at AHledger")));
        }
        let mut o = self.opts();
        o.max_bytes = Some(4 * 1024 * 1024);
        let url = format!("{}/v1/crafting/{market}?profession={}&all=1", self.base, profession.replace(' ', "%20"));
        let r = http.get(&url, o).await?;
        let mut v: serde_json::Value = r.json()?;
        v["fetchedAt"] = serde_json::Value::String(now_iso());
        Ok(v)
    }

    pub async fn pricetable(&self, http: &HttpClient, market: &str, etag: Option<String>) -> Result<PriceTable, AppError> {
        validate_market_id(market)?;
        let mut o = self.opts();
        o.if_none_match = etag;
        o.max_bytes = Some(16 * 1024 * 1024);
        let r = http.get(&format!("{}/v1/pricetable/{market}", self.base), o).await?;
        if r.status == 304 {
            return Ok(PriceTable::NotModified { max_age: r.max_age_secs });
        }
        let (quotes, observed) = parse_pricetable(&r.text()?, market, r.max_age_secs)?;
        Ok(PriceTable::Fresh { quotes, observed, etag: r.etag.clone(), max_age: r.max_age_secs })
    }
}

pub enum PriceTable {
    NotModified { max_age: Option<u64> },
    Fresh { quotes: Vec<MarketQuote>, observed: Option<String>, etag: Option<String>, max_age: Option<u64> },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::network_policy::NetworkPolicy;

    const MARKETS: &str = include_str!("../../../tests/fixtures/ahledger/markets.json");
    const PRICES: &str = include_str!("../../../tests/fixtures/ahledger/prices_2589_eu.json");
    const PRICES_NULL: &str = include_str!("../../../tests/fixtures/ahledger/prices_latest_null.json");
    const TABLE: &str = include_str!("../../../tests/fixtures/ahledger/pricetable_sample.txt");
    const TOOLTIP: &str = include_str!("../../../tests/fixtures/ahledger/tooltip.json");

    fn resp(body: &str) -> HttpResponse {
        HttpResponse::for_tests(body, Some(60))
    }

    #[test]
    fn markets_are_filtered_to_forever_and_keep_eu_rppvp() {
        let m = parse_markets(&resp(MARKETS)).unwrap();
        assert!(m.iter().all(|m| m.id.starts_with("forever.")));
        assert!(m.iter().any(|m| m.id == "forever.normal.alliance.eu"));
        assert!(m.iter().any(|m| m.id == "forever.rppvp.horde.eu"));
        assert!(!m.iter().any(|m| m.id.starts_with("retail")));
    }

    #[test]
    fn prices_parse_integer_copper_and_attribution() {
        let (q, s) = parse_prices(&resp(PRICES), 2589).unwrap();
        assert_eq!(q.market_id, "forever.normal.alliance.eu");
        assert_eq!((q.region.as_str(), q.ruleset.as_str(), q.faction.as_str()), ("eu", "normal", "alliance"));
        assert_eq!(q.min_buyout_copper, Some(26));
        assert_eq!(q.median_copper, Some(27));
        assert_eq!(q.observed_at.as_deref(), Some("2026-11-15T17:56:28.000Z"));
        assert_eq!(q.attribution_text, "Prices from AHledger");
        assert!(q.attribution_url.as_deref().unwrap().contains("ahledger.com/items/2589"));
        assert!(!s.points.is_empty());
        assert!(q.cache_expires_at.is_some());
    }

    #[test]
    fn latest_null_is_unknown_not_zero() {
        let (q, _) = parse_prices(&resp(PRICES_NULL), 2589).unwrap();
        assert_eq!(q.min_buyout_copper, None);
        assert_eq!(q.median_copper, None);
        assert_eq!(q.observed_at, None);
    }

    #[test]
    fn pricetable_parses_rows_and_empty_fields() {
        let (q, observed) = parse_pricetable(TABLE, "forever.normal.alliance.eu", Some(60)).unwrap();
        assert!(observed.is_some());
        let linen = q.iter().find(|q| q.item_id == 2589).unwrap();
        assert_eq!(linen.median_copper, Some(27));
        assert_eq!(linen.min_buyout_copper, Some(23));
        assert_eq!(linen.estimated_units_sold_per_day, Some(1783.3));
        let empty = q.iter().find(|q| q.item_id == 4306).unwrap();
        assert_eq!(empty.min_buyout_copper, None, "empty field must stay unknown");
    }

    #[test]
    fn pricetable_rejects_wrong_market() {
        assert!(parse_pricetable(TABLE, "forever.pvp.horde.us", None).is_err());
    }

    #[test]
    fn tooltip_omits_unknown_items() {
        let q = parse_tooltip(&resp(TOOLTIP), "forever.normal.alliance.eu").unwrap();
        assert_eq!(q.len(), 2);
        assert!(q.iter().all(|q| q.item_id != 999999));
    }

    #[tokio::test]
    async fn http_paths_against_mock() {
        let mut server = mockito::Server::new_async().await;
        let _a = server.mock("GET", "/v1/markets").with_header("cache-control", "public, max-age=300").with_body(MARKETS).create_async().await;
        let _b = server.mock("GET", "/v1/prices/forever.normal.alliance.eu/2589?range=7d").with_body(PRICES).create_async().await;
        let _c = server.mock("GET", "/v1/prices/forever.normal.alliance.eu/999999?range=7d").with_status(404).with_body(r#"{"error":"item not found"}"#).create_async().await;
        let _d = server.mock("GET", "/v1/pricetable/forever.normal.alliance.eu").match_header("if-none-match", "\"e1\"").with_status(304).create_async().await;
        let http = HttpClient::new(NetworkPolicy::loopback_for_tests());
        let a = Ahledger { base: server.url(), api_key: None };
        let (m, r) = a.markets(&http).await.unwrap();
        assert_eq!(r.max_age_secs, Some(300));
        assert!(m.len() > 10);
        assert!(a.prices(&http, "forever.normal.alliance.eu", 2589, "7d").await.unwrap().is_some());
        assert!(a.prices(&http, "forever.normal.alliance.eu", 999999, "7d").await.unwrap().is_none());
        assert!(matches!(a.pricetable(&http, "forever.normal.alliance.eu", Some("\"e1\"".into())).await.unwrap(), PriceTable::NotModified { .. }));
        assert!(a.prices(&http, "../etc", 1, "7d").await.is_err(), "market id is validated");
    }

    /// Real network test. Run with: cargo test -- --ignored live_ahledger
    #[tokio::test]
    #[ignore]
    async fn live_ahledger() {
        let http = HttpClient::new(NetworkPolicy::production());
        let a = Ahledger::new(None);
        let (m, _) = a.markets(&http).await.unwrap();
        let eu = m.iter().find(|m| m.region == "eu").expect("an EU market");
        let (q, _) = a.prices(&http, &eu.id, 2589, "24h").await.unwrap().expect("linen exists");
        println!("LIVE {} 2589 min={:?} median={:?} observed={:?}", eu.id, q.min_buyout_copper, q.median_copper, q.observed_at);
        assert_eq!(q.item_id, 2589);
    }
}
