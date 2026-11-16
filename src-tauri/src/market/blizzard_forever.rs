//! EXPERIMENTAL Blizzard Forever adapter. Undocumented by Blizzard; routes from community tests
//! (us.forums.blizzard.com/…/60334 and mhuijskens.com/WoWForever/Api, state 2026-11-05/06).
//! Off by default. Needs the user's own Blizzard developer client credentials (stored in Windows Credential Manager).

use super::http::{HttpClient, HttpResponse, RequestOptions};
use super::model::*;
use crate::error::AppError;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::time::Duration;

pub fn attribution() -> String {
    crate::i18n::tr("Daten: Blizzard Battle.net API (experimentell, inoffiziell für Forever)", "Data: Blizzard Battle.net API (experimental, unofficial for Forever)")
}
pub const OAUTH_URL: &str = "https://oauth.battle.net/token";
pub const REGIONS: &[&str] = &["eu", "us", "kr", "tw"];

#[derive(Clone)]
pub struct Blizzard {
    pub region: String,
    pub api_base: String,
    pub oauth_url: String,
}

#[derive(Deserialize)]
pub struct TokenResp {
    pub access_token: String,
    pub expires_in: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NamedId {
    pub id: u32,
    pub name: String,
}

#[derive(Deserialize)]
struct AuctionItem {
    id: u32,
    #[serde(default)]
    bonus_lists: Option<Vec<i64>>,
}
#[derive(Deserialize)]
struct Auction {
    id: u64,
    item: AuctionItem,
    quantity: Option<i64>,
    buyout: Option<i64>,
    unit_price: Option<i64>,
}
#[derive(Deserialize)]
struct AuctionsResp {
    #[serde(default)]
    auctions: Vec<Auction>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Aggregated {
    pub quotes: Vec<MarketQuote>,
    pub listings: usize,
    pub bid_only_skipped: usize,
    pub signature: String,
}

impl Blizzard {
    pub fn new(region: &str) -> Result<Self, AppError> {
        if !REGIONS.contains(&region) {
            return Err(AppError::invalid(crate::i18n::tr("Region für Blizzard-API nicht unterstützt", "Region not supported by the Blizzard API")));
        }
        Ok(Self { region: region.into(), api_base: format!("https://{region}.api.blizzard.com"), oauth_url: OAUTH_URL.into() })
    }
    fn ns(&self) -> String {
        format!("dynamic-forever-{}", self.region)
    }

    pub async fn token(&self, http: &HttpClient, client_id: &str, secret: &str) -> Result<TokenResp, AppError> {
        let r = http
            .post_form(
                &self.oauth_url,
                RequestOptions {
                    basic_auth: Some((client_id.into(), secret.into())),
                    form: Some(vec![("grant_type".into(), "client_credentials".into())]),
                    max_retries: Some(1),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| if e.code == "unauthorized" || e.http_status == Some(400) { AppError::new("unauthorized", crate::i18n::tr("Blizzard-Client-ID oder -Secret ungültig.", "Blizzard client ID or secret invalid.")) } else { e })?;
        r.json()
    }

    fn opts(token: &str) -> RequestOptions {
        RequestOptions { bearer: Some(token.into()), timeout: Some(Duration::from_secs(30)), ..Default::default() }
    }

    pub async fn rulesets(&self, http: &HttpClient, token: &str) -> Result<Vec<NamedId>, AppError> {
        let r = http.get(&format!("{}/data/wow/ruleset/index?namespace={}", self.api_base, self.ns()), Self::opts(token)).await?;
        parse_named_list(&r, &["rulesets", "ruleset"])
    }

    /// Community reports differ: `/auctions/index` (mhuijskens) vs `/auctions/` with trailing slash (forum). Try both.
    pub async fn houses(&self, http: &HttpClient, token: &str, ruleset: u32) -> Result<(Vec<NamedId>, String), AppError> {
        let mut last = None;
        for suffix in ["auctions/index", "auctions/"] {
            let url = format!("{}/data/wow/ruleset/{ruleset}/{suffix}?namespace={}", self.api_base, self.ns());
            match http.get(&url, Self::opts(token)).await {
                Ok(r) => return Ok((parse_named_list(&r, &["auctions", "auction_houses"])?, suffix.to_string())),
                Err(e) if e.code == "not_found" => last = Some(e),
                Err(e) => return Err(e),
            }
        }
        Err(last.unwrap_or_else(|| AppError::not_found(crate::i18n::tr("Kein Auktionshaus-Index gefunden", "No auction house index found"))))
    }

    pub async fn markets(&self, http: &HttpClient, token: &str) -> Result<Vec<Market>, AppError> {
        let mut out = Vec::new();
        for rs in self.rulesets(http, token).await? {
            let (houses, _) = self.houses(http, token, rs.id).await?;
            for h in houses {
                out.push(Market {
                    provider: ProviderId::BlizzardForever,
                    id: format!("blizzard.{}.{}.{}", self.region, rs.id, h.id),
                    region: self.region.clone(),
                    ruleset: ruleset_slug(&rs.name, rs.id),
                    faction: faction_from_house_name(&h.name),
                    label: format!("{} · {} (House {})", rs.name, h.name, h.id),
                    house_id: Some(h.id),
                    house_name: Some(h.name),
                    confirmed: true,
                });
            }
        }
        Ok(out)
    }

    /// Downloads listings + commodities of one house and aggregates per item (can be ~10 MB each).
    pub async fn fetch_house(&self, http: &HttpClient, token: &str, market: &Market) -> Result<(Aggregated, Option<String>), AppError> {
        let house = market.house_id.ok_or_else(|| AppError::invalid(crate::i18n::tr("Markt ohne House-ID", "Market without house ID")))?;
        let ruleset: u32 = market.id.split('.').nth(2).and_then(|s| s.parse().ok()).ok_or_else(|| AppError::invalid(crate::i18n::tr("Markt-ID ohne Ruleset", "Market ID without ruleset")))?;
        let big = RequestOptions { bearer: Some(token.into()), timeout: Some(Duration::from_secs(180)), max_bytes: Some(96 * 1024 * 1024), ..Default::default() };
        let base = format!("{}/data/wow/ruleset/{ruleset}/auctions/{house}", self.api_base);
        let listings = http.get(&format!("{base}?namespace={}", self.ns()), big.clone()).await?;
        let commodities = http.get(&format!("{base}/commodities?namespace={}", self.ns()), big).await?;
        let observed = commodities.last_modified.clone().or(listings.last_modified.clone());
        let agg = aggregate(market, &listings, &commodities, observed.clone())?;
        Ok((agg, observed))
    }
}

pub fn ruleset_slug(name: &str, id: u32) -> String {
    match id {
        1 => "pvp".into(),
        2 => "normal".into(),
        3 => "rp".into(),
        15 => "rppvp".into(),
        _ => name.to_lowercase().replace(' ', ""),
    }
}

/// Faction label from the house *name the API returned* (shown next to the raw house id; never guessed from ids).
pub fn faction_from_house_name(name: &str) -> String {
    let n = name.to_lowercase();
    if n.contains("alliance") {
        "alliance".into()
    } else if n.contains("horde") {
        "horde".into()
    } else if n.contains("blackwater") || n.contains("neutral") {
        "neutral".into()
    } else {
        "unknown".into()
    }
}

/// Lenient parse of `{ "<key>": [ { "id": .., "name": .. } ] }`; name may be a string or a localized object.
pub fn parse_named_list(r: &HttpResponse, keys: &[&str]) -> Result<Vec<NamedId>, AppError> {
    let v: serde_json::Value = r.json()?;
    let arr = keys
        .iter()
        .find_map(|k| v.get(*k).and_then(|a| a.as_array()))
        .ok_or_else(|| AppError::new("schema", crate::i18n::tr("Blizzard-Antwort ohne erwartete Liste (Schema geändert?)", "Blizzard response without the expected list (schema changed?)")))?;
    Ok(arr
        .iter()
        .filter_map(|e| {
            let id = e.get("id")?.as_u64()? as u32;
            let name = match e.get("name") {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(serde_json::Value::Object(o)) => o.get("en_US").or_else(|| o.values().next()).and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                _ => format!("#{id}"),
            };
            Some(NamedId { id, name })
        })
        .collect())
}

pub fn aggregate(market: &Market, listings: &HttpResponse, commodities: &HttpResponse, observed: Option<String>) -> Result<Aggregated, AppError> {
    let l: AuctionsResp = listings.json()?;
    let c: AuctionsResp = commodities.json()?;
    // (item, variant) -> Vec<(unit_price, qty)>
    let mut per: BTreeMap<(u32, Option<String>), Vec<(i64, i64)>> = BTreeMap::new();
    let mut ids: Vec<u64> = Vec::new();
    let mut bid_only = 0usize;
    for a in &c.auctions {
        ids.push(a.id);
        let (Some(unit), Some(q)) = (a.unit_price, a.quantity) else { continue };
        if q <= 0 {
            continue;
        }
        per.entry((a.item.id, None)).or_default().push((unit, q));
    }
    for a in &l.auctions {
        ids.push(a.id);
        let q = a.quantity.unwrap_or(1).max(1);
        let Some(buyout) = a.buyout else {
            bid_only += 1; // bid-only auctions are never turned into a buyout price
            continue;
        };
        let variant = a.item.bonus_lists.as_ref().filter(|b| !b.is_empty()).map(|b| {
            let mut b = b.clone();
            b.sort();
            format!("bonus:{}", b.iter().map(|x| x.to_string()).collect::<Vec<_>>().join("-"))
        });
        per.entry((a.item.id, variant)).or_default().push((buyout / q, q));
    }
    ids.sort_unstable();
    let mut h = Sha256::new();
    for id in &ids {
        h.update(id.to_le_bytes());
    }
    let signature = format!("{:x}", h.finalize())[..16].to_string();
    let fetched = now_iso();
    let quotes = per
        .into_iter()
        .map(|((item, variant), mut rows)| {
            rows.sort_by_key(|r| r.0);
            let total: i64 = rows.iter().map(|r| r.1).sum();
            let mut acc = 0;
            let mut median = None;
            for (p, q) in &rows {
                acc += q;
                if acc * 2 >= total {
                    median = Some(*p);
                    break;
                }
            }
            MarketQuote {
                provider: ProviderId::BlizzardForever,
                market_id: market.id.clone(),
                region: market.region.clone(),
                ruleset: market.ruleset.clone(),
                faction: market.faction.clone(),
                house_id: market.house_id,
                item_id: item,
                variant_key: variant,
                min_buyout_copper: rows.first().map(|r| r.0),
                median_copper: median,
                reference_price_copper: None,
                median7d_copper: None,
                median30d_copper: None,
                quantity_listed: Some(total),
                auctions: Some(rows.len() as i64),
                estimated_units_sold_per_day: None,
                observed_at: observed.clone(),
                fetched_at: fetched.clone(),
                cache_expires_at: None,
                is_live_snapshot: false,
                source_url: None,
                attribution_text: attribution(),
                attribution_url: Some("https://develop.battle.net/".into()),
                data_source_note: Some(crate::i18n::tr(format!("House {} · Einheitspreis = Sofortkauf / Menge; Gebote ohne Sofortkauf ausgeschlossen", market.house_id.unwrap_or(0)), format!("House {} · unit price = buyout / quantity; bids without buyout excluded", market.house_id.unwrap_or(0)))),
                from_cache: false,
            }
        })
        .collect();
    Ok(Aggregated { quotes, listings: ids.len(), bid_only_skipped: bid_only, signature })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::network_policy::NetworkPolicy;

    const RULESETS: &str = include_str!("../../../tests/fixtures/blizzard/ruleset_index.json");
    const HOUSES: &str = include_str!("../../../tests/fixtures/blizzard/auctions_index.json");
    const LISTINGS: &str = include_str!("../../../tests/fixtures/blizzard/house_auctions.json");
    const COMMODITIES: &str = include_str!("../../../tests/fixtures/blizzard/house_commodities.json");

    fn resp(b: &str) -> HttpResponse {
        HttpResponse::for_tests(b, None)
    }

    fn market(id: &str, house: u32) -> Market {
        Market { provider: ProviderId::BlizzardForever, id: id.into(), region: "eu".into(), ruleset: "normal".into(), faction: "alliance".into(),
            label: String::new(), house_id: Some(house), house_name: None, confirmed: true }
    }

    #[test]
    fn named_lists_parse() {
        let rs = parse_named_list(&resp(RULESETS), &["rulesets"]).unwrap();
        assert_eq!(rs.iter().map(|r| r.id).collect::<Vec<_>>(), vec![1, 2, 3, 15]);
        let houses = parse_named_list(&resp(HOUSES), &["auctions"]).unwrap();
        assert_eq!(houses.len(), 15);
        assert_eq!(faction_from_house_name(&houses[0].name), "alliance");
        assert_eq!(faction_from_house_name("Blackwater Auction House"), "neutral");
    }

    #[test]
    fn aggregation_unit_prices_bid_only_and_variants() {
        let a = aggregate(&market("blizzard.eu.2.110", 110), &resp(LISTINGS), &resp(COMMODITIES), None).unwrap();
        let linen = a.quotes.iter().find(|q| q.item_id == 2589).unwrap();
        assert_eq!(linen.min_buyout_copper, Some(23), "commodity unit_price is per unit");
        assert_eq!(linen.quantity_listed, Some(60));
        assert_eq!(linen.median_copper, Some(25));
        // non-commodity: buyout 50000 for quantity 2 -> 25000 per unit
        let sword = a.quotes.iter().find(|q| q.item_id == 15211 && q.variant_key.is_none()).unwrap();
        assert_eq!(sword.min_buyout_copper, Some(25000));
        assert!(a.quotes.iter().any(|q| q.item_id == 15211 && q.variant_key.as_deref() == Some("bonus:1046")), "variants stay separate");
        assert_eq!(a.bid_only_skipped, 1);
        assert!(!a.quotes.iter().any(|q| q.item_id == 4306), "bid-only item must not get a price");
    }

    #[test]
    fn duplicate_houses_share_signature() {
        let a = aggregate(&market("blizzard.eu.2.110", 110), &resp(LISTINGS), &resp(COMMODITIES), None).unwrap();
        let b = aggregate(&market("blizzard.eu.1.110", 110), &resp(LISTINGS), &resp(COMMODITIES), None).unwrap();
        assert_eq!(a.signature, b.signature);
    }

    #[test]
    fn empty_auctions_are_fine() {
        let a = aggregate(&market("blizzard.eu.2.111", 111), &resp(r#"{"auctions":[]}"#), &resp(r#"{}"#), None).unwrap();
        assert!(a.quotes.is_empty());
    }

    #[tokio::test]
    async fn oauth_and_index_fallback_against_mock() {
        let mut server = mockito::Server::new_async().await;
        let _t = server.mock("POST", "/token").match_header("authorization", mockito::Matcher::Regex("^Basic ".into()))
            .with_body(r#"{"access_token":"tok","token_type":"bearer","expires_in":86399}"#).create_async().await;
        let _r = server.mock("GET", "/data/wow/ruleset/index?namespace=dynamic-forever-eu").match_header("authorization", "Bearer tok").with_body(RULESETS).create_async().await;
        let _i = server.mock("GET", mockito::Matcher::Regex(r"^/data/wow/ruleset/\d+/auctions/index".into())).with_status(404).create_async().await;
        let _s = server.mock("GET", mockito::Matcher::Regex(r"^/data/wow/ruleset/\d+/auctions/\?".into())).with_body(HOUSES).create_async().await;
        let http = HttpClient::new(NetworkPolicy::loopback_for_tests());
        let b = Blizzard { region: "eu".into(), api_base: server.url(), oauth_url: format!("{}/token", server.url()) };
        let t = b.token(&http, "id", "secret").await.unwrap();
        assert_eq!(t.access_token, "tok");
        let (houses, route) = b.houses(&http, "tok", 2).await.unwrap();
        assert_eq!(route, "auctions/");
        assert_eq!(houses.len(), 15);
        let m = b.markets(&http, "tok").await.unwrap();
        assert_eq!(m.len(), 60);
        assert!(m.iter().all(|m| m.house_id.is_some()));
    }

    #[tokio::test]
    async fn bad_credentials_are_explained() {
        let mut server = mockito::Server::new_async().await;
        let _t = server.mock("POST", "/token").with_status(401).create_async().await;
        let http = HttpClient::new(NetworkPolicy::loopback_for_tests());
        let b = Blizzard { region: "eu".into(), api_base: server.url(), oauth_url: format!("{}/token", server.url()) };
        let e = b.token(&http, "id", "wrong").await.err().unwrap();
        assert_eq!(e.code, "unauthorized");
    }
}
