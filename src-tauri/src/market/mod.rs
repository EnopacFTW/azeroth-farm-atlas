//! Rust market engine: providers -> validation -> normalization -> licensed cache -> UI.

pub mod ahledger;
pub mod auctionhouse_fyi;
pub mod blizzard_forever;
pub mod cache;
pub mod http;
pub mod model;

use crate::error::{AppError, AppResult};
use crate::security::credentials;
use http::HttpClient;
use model::*;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketSettings {
    pub ahledger_enabled: bool,
    pub fyi_enabled: bool,
    pub blizzard_enabled: bool,
    pub blizzard_region: String,
    pub blizzard_cache_minutes: u64,
}

impl Default for MarketSettings {
    fn default() -> Self {
        Self { ahledger_enabled: true, fyi_enabled: true, blizzard_enabled: false, blizzard_region: "eu".into(), blizzard_cache_minutes: 60 }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteDetail {
    pub quote: Option<MarketQuote>,
    pub series: Option<PriceSeries>,
}

pub struct MarketEngine {
    pub http: HttpClient,
    pub cache: Mutex<Connection>,
    /// AHledger price tables kept in memory only (for ETag revalidation); never persisted past Cache-Control.
    tables: tokio::sync::Mutex<HashMap<String, (Option<String>, Vec<MarketQuote>)>>,
    blizzard_token: tokio::sync::Mutex<Option<(String, String, chrono::DateTime<chrono::Utc>)>>,
    cancel: AtomicBool,
}

fn provider(p: &str) -> AppResult<ProviderId> {
    ProviderId::parse(p).ok_or_else(|| AppError::invalid(crate::i18n::tr("Unbekannter Preisanbieter", "Unknown price provider")))
}

fn disabled(name: &str) -> AppError {
    AppError::new("provider_disabled", crate::i18n::tr(format!("{name} ist in den Einstellungen deaktiviert."), format!("{name} is disabled in the settings.")))
}

impl MarketEngine {
    pub fn new(http: HttpClient, cache: Connection) -> Self {
        Self { http, cache: Mutex::new(cache), tables: Default::default(), blizzard_token: Default::default(), cancel: AtomicBool::new(false) }
    }

    fn ahledger(&self) -> ahledger::Ahledger {
        ahledger::Ahledger::new(credentials::get("ahledger_api_key"))
    }
    fn fyi(&self) -> auctionhouse_fyi::Fyi {
        auctionhouse_fyi::Fyi::new(credentials::get("fyi_api_key"))
    }

    fn with_cache<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut c = self.cache.lock().map_err(|_| AppError::new("lock", crate::i18n::tr("Cache gesperrt", "Cache locked")))?;
        cache::purge_expired(&c)?;
        f(&mut c)
    }

    async fn blizzard_token(&self, s: &MarketSettings) -> AppResult<String> {
        let mut guard = self.blizzard_token.lock().await;
        if let Some((tok, region, exp)) = guard.as_ref() {
            if region == &s.blizzard_region && *exp > chrono::Utc::now() + chrono::Duration::seconds(60) {
                return Ok(tok.clone());
            }
        }
        let (Some(id), Some(secret)) = (credentials::get("blizzard_client_id"), credentials::get("blizzard_client_secret")) else {
            return Err(AppError::new("not_configured", crate::i18n::tr("Keine Blizzard-Developer-Zugangsdaten hinterlegt (Einstellungen → Preisquellen).", "No Blizzard developer credentials stored (Settings → price sources).")));
        };
        let b = blizzard_forever::Blizzard::new(&s.blizzard_region)?;
        let t = b.token(&self.http, &id, &secret).await?;
        // token kept in memory only, with its own expiry
        let exp = chrono::Utc::now() + chrono::Duration::seconds(t.expires_in.unwrap_or(3600) as i64);
        *guard = Some((t.access_token.clone(), s.blizzard_region.clone(), exp));
        Ok(t.access_token)
    }

    pub fn forget_blizzard_token(&self) {
        if let Ok(mut g) = self.blizzard_token.try_lock() {
            *g = None;
        }
    }

    pub async fn list_markets(&self, p: &str, s: &MarketSettings, refresh: bool) -> AppResult<Vec<Market>> {
        let pid = provider(p)?;
        if !refresh {
            if let Some(m) = self.with_cache(|c| cache::get_market_list(c, pid))? {
                return Ok(m);
            }
        }
        match pid {
            ProviderId::Ahledger => {
                if !s.ahledger_enabled {
                    return Err(disabled("AHledger"));
                }
                let (m, r) = self.ahledger().markets(&self.http).await?;
                self.with_cache(|c| cache::put_market_list(c, pid, &m, r.max_age_secs.unwrap_or(300)))?;
                Ok(m)
            }
            ProviderId::AuctionhouseFyi => {
                if !s.fyi_enabled {
                    return Err(disabled("auctionhouse.fyi"));
                }
                // No public market-list route; documented markets until a health check confirms them.
                Ok(auctionhouse_fyi::documented_markets())
            }
            ProviderId::BlizzardForever => {
                if !s.blizzard_enabled {
                    return Err(disabled("Blizzard Forever (experimentell)"));
                }
                let tok = self.blizzard_token(s).await?;
                let m = blizzard_forever::Blizzard::new(&s.blizzard_region)?.markets(&self.http, &tok).await?;
                self.with_cache(|c| cache::put_market_list(c, pid, &m, 3600))?;
                Ok(m)
            }
            ProviderId::Manual => Ok(vec![]),
        }
    }

    /// Cached-or-fetched quotes for many items on ONE market. Missing items stay missing (unknown), never 0.
    pub async fn quotes(&self, p: &str, market_id: &str, items: &[u32], s: &MarketSettings) -> AppResult<Vec<MarketQuote>> {
        let pid = provider(p)?;
        validate_market_id(market_id)?;
        let items: Vec<u32> = items.iter().copied().take(400).collect();
        let mut have = self.with_cache(|c| cache::get_quotes(c, pid, market_id, &items))?;
        let missing: Vec<u32> = items.iter().copied().filter(|i| !have.iter().any(|q| q.item_id == *i)).collect();
        if missing.is_empty() {
            return Ok(have);
        }
        let fetched = match pid {
            ProviderId::Ahledger => {
                if !s.ahledger_enabled {
                    return Err(disabled("AHledger"));
                }
                self.ahledger().tooltip(&self.http, market_id, &missing).await?
            }
            ProviderId::AuctionhouseFyi => {
                if !s.fyi_enabled {
                    return Err(disabled("auctionhouse.fyi"));
                }
                let f = self.fyi();
                let mut out = Vec::new();
                for i in missing.iter().take(30) {
                    out.push(f.quote(&self.http, market_id, *i, None).await?);
                }
                out
            }
            ProviderId::BlizzardForever => {
                if !s.blizzard_enabled {
                    return Err(disabled("Blizzard Forever (experimentell)"));
                }
                vec![] // only from a completed house sync
            }
            ProviderId::Manual => vec![],
        };
        self.with_cache(|c| cache::put_quotes(c, &fetched, 300))?;
        have.extend(fetched);
        Ok(have)
    }

    pub async fn quote_detail(&self, p: &str, market_id: &str, item: u32, range: &str, variant: Option<String>, s: &MarketSettings) -> AppResult<QuoteDetail> {
        let pid = provider(p)?;
        validate_market_id(market_id)?;
        match pid {
            ProviderId::Ahledger => {
                if !s.ahledger_enabled {
                    return Err(disabled("AHledger"));
                }
                match self.ahledger().prices(&self.http, market_id, item, range).await? {
                    Some((q, series)) => {
                        self.with_cache(|c| cache::put_quotes(c, std::slice::from_ref(&q), 60))?;
                        Ok(QuoteDetail { quote: Some(q), series: Some(series) })
                    }
                    None => Ok(QuoteDetail { quote: None, series: None }),
                }
            }
            ProviderId::AuctionhouseFyi => {
                if !s.fyi_enabled {
                    return Err(disabled("auctionhouse.fyi"));
                }
                let q = self.fyi().quote(&self.http, market_id, item, variant.as_deref()).await?;
                self.with_cache(|c| cache::put_quotes(c, std::slice::from_ref(&q), 300))?;
                Ok(QuoteDetail { quote: Some(q), series: None })
            }
            ProviderId::BlizzardForever | ProviderId::Manual => {
                let q = self.with_cache(|c| cache::get_quotes(c, pid, market_id, &[item]))?;
                Ok(QuoteDetail { quote: q.into_iter().find(|q| q.variant_key == variant), series: None })
            }
        }
    }

    pub fn cancel_sync(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub async fn sync(&self, p: &str, market_id: &str, s: &MarketSettings) -> AppResult<SyncStatus> {
        let pid = provider(p)?;
        validate_market_id(market_id)?;
        self.cancel.store(false, Ordering::SeqCst);
        let started = now_iso();
        let mut status = self
            .with_cache(|c| cache::get_sync_status(c, pid.as_str(), market_id))?
            .unwrap_or(SyncStatus { provider: pid.as_str().into(), market_id: market_id.into(), last_attempt_at: None, last_success_at: None,
                last_error: None, items: 0, observed_at: None, not_modified: false, note: None });
        status.last_attempt_at = Some(started.clone());
        let result = self.sync_inner(pid, market_id, s, &mut status).await;
        match &result {
            Ok(()) => {
                status.last_success_at = Some(now_iso());
                status.last_error = None;
            }
            Err(e) => status.last_error = Some(e.message.clone()),
        }
        self.with_cache(|c| cache::put_sync_status(c, &status))?;
        result.map(|_| status)
    }

    async fn sync_inner(&self, pid: ProviderId, market_id: &str, s: &MarketSettings, status: &mut SyncStatus) -> AppResult<()> {
        match pid {
            ProviderId::Ahledger => {
                if !s.ahledger_enabled {
                    return Err(disabled("AHledger"));
                }
                let etag = self.tables.lock().await.get(market_id).and_then(|t| t.0.clone());
                match self.ahledger().pricetable(&self.http, market_id, etag).await? {
                    ahledger::PriceTable::NotModified { max_age } => {
                        let mut quotes = self.tables.lock().await.get(market_id).map(|t| t.1.clone()).unwrap_or_default();
                        let exp = iso_in(max_age.unwrap_or(60));
                        let now = now_iso();
                        for q in quotes.iter_mut() {
                            q.cache_expires_at = Some(exp.clone());
                            q.fetched_at = now.clone();
                        }
                        self.with_cache(|c| cache::put_quotes(c, &quotes, 60))?;
                        status.items = quotes.len() as i64;
                        status.not_modified = true;
                        status.note = Some(crate::i18n::tr("304 Not Modified – Tabelle unverändert, Cache-Frist erneuert", "304 Not Modified – table unchanged, cache lifetime renewed"));
                    }
                    ahledger::PriceTable::Fresh { quotes, observed, etag, .. } => {
                        if self.cancel.load(Ordering::SeqCst) {
                            return Err(AppError::new("cancelled", crate::i18n::tr("Synchronisierung abgebrochen", "Sync cancelled")));
                        }
                        self.with_cache(|c| cache::put_quotes(c, &quotes, 60))?;
                        status.items = quotes.len() as i64;
                        status.observed_at = observed;
                        status.not_modified = false;
                        status.note = Some("Bulk-Preistabelle geladen".into());
                        self.tables.lock().await.insert(market_id.into(), (etag, quotes));
                    }
                }
                Ok(())
            }
            ProviderId::BlizzardForever => {
                if !s.blizzard_enabled {
                    return Err(disabled("Blizzard Forever (experimentell)"));
                }
                let markets = self.list_markets("blizzard_forever", s, false).await?;
                let market = markets.into_iter().find(|m| m.id == market_id).ok_or_else(|| AppError::not_found(crate::i18n::tr("House nicht in der Marktliste", "House not in the market list")))?;
                let tok = self.blizzard_token(s).await?;
                let b = blizzard_forever::Blizzard::new(&s.blizzard_region)?;
                let (mut agg, observed) = b.fetch_house(&self.http, &tok, &market).await?;
                if self.cancel.load(Ordering::SeqCst) {
                    return Err(AppError::new("cancelled", crate::i18n::tr("Synchronisierung abgebrochen", "Sync cancelled")));
                }
                let ttl = s.blizzard_cache_minutes.clamp(5, 24 * 60) * 60;
                let exp = iso_in(ttl);
                for q in agg.quotes.iter_mut() {
                    q.cache_expires_at = Some(exp.clone());
                }
                let duplicates: Vec<String> = self
                    .with_cache(|c| cache::all_sync_status(c))?
                    .into_iter()
                    .filter(|o| o.market_id != market_id && o.note.as_deref().map(|n| n.contains(&agg.signature)).unwrap_or(false))
                    .map(|o| o.market_id)
                    .collect();
                self.with_cache(|c| cache::put_quotes(c, &agg.quotes, ttl))?;
                status.items = agg.quotes.len() as i64;
                status.observed_at = observed;
                status.note = Some(format!(
                    "{} Listings, {} Gebote ohne Sofortkauf ausgelassen, Signatur {}{}",
                    agg.listings,
                    agg.bid_only_skipped,
                    agg.signature,
                    if duplicates.is_empty() { String::new() } else { format!(" – identisch mit {}", duplicates.join(", ")) }
                ));
                Ok(())
            }
            ProviderId::AuctionhouseFyi => Err(AppError::new("unsupported", crate::i18n::tr("auctionhouse.fyi: Bulk-Sync ist in V1 nicht implementiert; Preise werden pro Item abgefragt.", "auctionhouse.fyi: bulk sync is not implemented in V1; prices are fetched per item."))),
            ProviderId::Manual => Err(AppError::new("unsupported", crate::i18n::tr("Manuelle Preise werden nicht synchronisiert.", "Manual prices are not synced."))),
        }
    }

    pub fn sync_statuses(&self) -> AppResult<Vec<SyncStatus>> {
        self.with_cache(|c| cache::all_sync_status(c))
    }

    pub fn clear_cache(&self) -> AppResult<()> {
        self.with_cache(|c| cache::clear_all(c))?;
        if let Ok(mut t) = self.tables.try_lock() {
            t.clear();
        }
        Ok(())
    }

    pub fn cached_health(&self, p: &str) -> AppResult<Option<ProviderHealth>> {
        self.with_cache(|c| cache::get_health(c, p))
    }

    /// Test button: performs a real request and records the outcome. Never claims success without a request.
    pub async fn health(&self, p: &str, s: &MarketSettings) -> AppResult<ProviderHealth> {
        let pid = provider(p)?;
        let prev = self.cached_health(p)?.unwrap_or_default();
        let mut h = ProviderHealth {
            provider: p.into(),
            checked_at: Some(now_iso()),
            last_success_at: prev.last_success_at,
            experimental: pid == ProviderId::BlizzardForever,
            ..Default::default()
        };
        let started = std::time::Instant::now();
        let outcome: AppResult<(usize, Option<String>, String)> = match pid {
            ProviderId::Ahledger => {
                h.enabled = s.ahledger_enabled;
                h.credentials_configured = credentials::is_set("ahledger_api_key");
                if !s.ahledger_enabled {
                    Err(disabled("AHledger"))
                } else {
                    match self.list_markets(p, s, true).await {
                        Ok(m) => {
                            let eu = m.iter().find(|m| m.region == "eu").or(m.first()).map(|m| m.id.clone()).unwrap_or_default();
                            let d = self.quote_detail(p, &eu, 2589, "24h", None, s).await?;
                            let obs = d.quote.and_then(|q| q.observed_at);
                            Ok((m.len(), obs, format!("GET /v1/markets + /v1/prices/{eu}/2589?range=24h")))
                        }
                        Err(e) => Err(e),
                    }
                }
            }
            ProviderId::AuctionhouseFyi => {
                h.enabled = s.fyi_enabled;
                h.credentials_configured = credentials::is_set("fyi_api_key");
                if !s.fyi_enabled {
                    Err(disabled("auctionhouse.fyi"))
                } else {
                    let f = self.fyi();
                    let mut confirmed = Vec::new();
                    let mut last_obs = None;
                    let mut err = None;
                    for mut m in auctionhouse_fyi::documented_markets() {
                        match f.quote(&self.http, &m.id, 2589, None).await {
                            Ok(q) => {
                                last_obs = last_obs.or(q.observed_at);
                                m.confirmed = true;
                                confirmed.push(m);
                            }
                            Err(e) => err = Some(e),
                        }
                    }
                    if confirmed.is_empty() {
                        Err(err.unwrap_or_else(|| AppError::new("unknown", crate::i18n::tr("Keine Antwort", "No response"))))
                    } else {
                        self.with_cache(|c| cache::put_market_list(c, pid, &confirmed, 86400))?;
                        Ok((confirmed.len(), last_obs, "GET /api/v1/ah/{6 US-Märkte}/2589".into()))
                    }
                }
            }
            ProviderId::BlizzardForever => {
                h.enabled = s.blizzard_enabled;
                h.credentials_required = true;
                h.credentials_configured = credentials::is_set("blizzard_client_id") && credentials::is_set("blizzard_client_secret");
                if !s.blizzard_enabled {
                    Err(disabled("Blizzard Forever (experimentell)"))
                } else {
                    self.forget_blizzard_token();
                    self.list_markets(p, s, true)
                        .await
                        .map(|m| (m.len(), None, format!("OAuth + /data/wow/ruleset/index + /auctions/index ({})", s.blizzard_region)))
                }
            }
            ProviderId::Manual => Ok((0, None, "lokal".into())),
        };
        h.last_response_ms = Some(started.elapsed().as_millis() as u64);
        match outcome {
            Ok((n, obs, endpoint)) => {
                h.reachable = Some(true);
                h.markets_found = n;
                h.last_data_at = obs;
                h.tested_endpoint = Some(endpoint);
                h.last_success_at = h.checked_at.clone();
            }
            Err(e) => {
                // disabled / not configured = not tested; anything else = request made and failed
                h.reachable = if ["provider_disabled", "not_configured"].contains(&e.code.as_str()) { None } else { Some(false) };
                h.last_error = Some(e.message);
            }
        }
        self.with_cache(|c| cache::put_health(c, &h))?;
        Ok(h)
    }
}
