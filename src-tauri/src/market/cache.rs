//! Third-party price cache (market_cache.db), separate from game data and user data.
//! Entries are deleted once `expires_at` (from the provider's Cache-Control) has passed – AHledger terms from 10.12.2026.

use super::model::*;
use crate::error::AppResult;
use rusqlite::{params, Connection, OptionalExtension};

pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS quotes (
  provider TEXT NOT NULL, market_id TEXT NOT NULL, item_id INTEGER NOT NULL, variant_key TEXT NOT NULL DEFAULT '',
  quote_json TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  PRIMARY KEY (provider, market_id, item_id, variant_key)
);
CREATE INDEX IF NOT EXISTS idx_quotes_expiry ON quotes(expires_at);
CREATE TABLE IF NOT EXISTS market_lists (provider TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_status (provider TEXT NOT NULL, market_id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (provider, market_id));
CREATE TABLE IF NOT EXISTS provider_health (provider TEXT PRIMARY KEY, json TEXT NOT NULL);
"#;

pub fn open(path: &std::path::Path) -> AppResult<Connection> {
    let c = Connection::open(path)?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    c.execute_batch(SCHEMA)?;
    Ok(c)
}

pub fn purge_expired(c: &Connection) -> AppResult<usize> {
    let now = now_iso();
    let a = c.execute("DELETE FROM quotes WHERE expires_at <= ?1", [&now])?;
    let b = c.execute("DELETE FROM market_lists WHERE expires_at <= ?1", [&now])?;
    Ok(a + b)
}

pub fn put_quotes(c: &mut Connection, quotes: &[MarketQuote], default_ttl_secs: u64) -> AppResult<()> {
    let tx = c.transaction()?;
    {
        let mut st = tx.prepare(
            "INSERT OR REPLACE INTO quotes (provider, market_id, item_id, variant_key, quote_json, fetched_at, expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        )?;
        for q in quotes {
            let expires = q.cache_expires_at.clone().unwrap_or_else(|| iso_in(default_ttl_secs));
            let mut stored = q.clone();
            stored.cache_expires_at = Some(expires.clone());
            st.execute(params![
                q.provider.as_str(),
                q.market_id,
                q.item_id,
                q.variant_key.clone().unwrap_or_default(),
                serde_json::to_string(&stored)?,
                q.fetched_at,
                expires
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Only non-expired quotes are returned; an expired entry is never presented as current.
pub fn get_quotes(c: &Connection, provider: ProviderId, market_id: &str, items: &[u32]) -> AppResult<Vec<MarketQuote>> {
    let now = now_iso();
    let mut st = c.prepare("SELECT quote_json FROM quotes WHERE provider=?1 AND market_id=?2 AND item_id=?3 AND expires_at > ?4")?;
    let mut out = Vec::new();
    for i in items {
        let rows = st.query_map(params![provider.as_str(), market_id, i, now], |r| r.get::<_, String>(0))?;
        for r in rows {
            let mut q: MarketQuote = serde_json::from_str(&r?)?;
            q.from_cache = true;
            out.push(q);
        }
    }
    Ok(out)
}

pub fn count_quotes(c: &Connection, provider: ProviderId, market_id: &str) -> AppResult<i64> {
    let now = now_iso();
    Ok(c.query_row("SELECT COUNT(*) FROM quotes WHERE provider=?1 AND market_id=?2 AND expires_at > ?3", params![provider.as_str(), market_id, now], |r| r.get(0))?)
}

pub fn put_market_list(c: &Connection, provider: ProviderId, markets: &[Market], ttl: u64) -> AppResult<()> {
    c.execute(
        "INSERT OR REPLACE INTO market_lists (provider, json, fetched_at, expires_at) VALUES (?1,?2,?3,?4)",
        params![provider.as_str(), serde_json::to_string(markets)?, now_iso(), iso_in(ttl)],
    )?;
    Ok(())
}

pub fn get_market_list(c: &Connection, provider: ProviderId) -> AppResult<Option<Vec<Market>>> {
    let now = now_iso();
    let j: Option<String> = c
        .query_row("SELECT json FROM market_lists WHERE provider=?1 AND expires_at > ?2", params![provider.as_str(), now], |r| r.get(0))
        .optional()?;
    Ok(match j {
        Some(j) => Some(serde_json::from_str(&j)?),
        None => None,
    })
}

pub fn put_sync_status(c: &Connection, s: &SyncStatus) -> AppResult<()> {
    c.execute(
        "INSERT OR REPLACE INTO sync_status (provider, market_id, json) VALUES (?1,?2,?3)",
        params![s.provider, s.market_id, serde_json::to_string(s)?],
    )?;
    Ok(())
}

pub fn get_sync_status(c: &Connection, provider: &str, market_id: &str) -> AppResult<Option<SyncStatus>> {
    let j: Option<String> =
        c.query_row("SELECT json FROM sync_status WHERE provider=?1 AND market_id=?2", params![provider, market_id], |r| r.get(0)).optional()?;
    Ok(match j {
        Some(j) => Some(serde_json::from_str(&j)?),
        None => None,
    })
}

pub fn all_sync_status(c: &Connection) -> AppResult<Vec<SyncStatus>> {
    let mut st = c.prepare("SELECT json FROM sync_status")?;
    let rows = st.query_map([], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(serde_json::from_str(&r?)?);
    }
    Ok(out)
}

pub fn put_health(c: &Connection, h: &ProviderHealth) -> AppResult<()> {
    c.execute("INSERT OR REPLACE INTO provider_health (provider, json) VALUES (?1,?2)", params![h.provider, serde_json::to_string(h)?])?;
    Ok(())
}

pub fn get_health(c: &Connection, provider: &str) -> AppResult<Option<ProviderHealth>> {
    let j: Option<String> = c.query_row("SELECT json FROM provider_health WHERE provider=?1", [provider], |r| r.get(0)).optional()?;
    Ok(match j {
        Some(j) => Some(serde_json::from_str(&j)?),
        None => None,
    })
}

pub fn clear_all(c: &Connection) -> AppResult<()> {
    c.execute_batch("DELETE FROM quotes; DELETE FROM market_lists; DELETE FROM sync_status;")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quote(expires: &str) -> MarketQuote {
        MarketQuote {
            provider: ProviderId::Ahledger, market_id: "forever.normal.alliance.eu".into(), region: "eu".into(), ruleset: "normal".into(),
            faction: "alliance".into(), house_id: None, item_id: 2589, variant_key: None, min_buyout_copper: Some(26), median_copper: Some(27),
            reference_price_copper: None, median7d_copper: None, median30d_copper: None, quantity_listed: Some(1), auctions: None,
            estimated_units_sold_per_day: None, observed_at: Some("2026-11-15T17:56:28Z".into()), fetched_at: now_iso(),
            cache_expires_at: Some(expires.into()), is_live_snapshot: false, source_url: None, attribution_text: "Prices from AHledger".into(),
            attribution_url: None, data_source_note: None, from_cache: false,
        }
    }

    #[test]
    fn expired_entries_are_not_served_and_get_purged() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = open(&dir.path().join("c.db")).unwrap();
        put_quotes(&mut c, &[quote("2000-01-01T00:00:00Z")], 60).unwrap();
        assert!(get_quotes(&c, ProviderId::Ahledger, "forever.normal.alliance.eu", &[2589]).unwrap().is_empty());
        assert_eq!(purge_expired(&c).unwrap(), 1);
        let row: i64 = c.query_row("SELECT COUNT(*) FROM quotes", [], |r| r.get(0)).unwrap();
        assert_eq!(row, 0, "expired third-party prices must be physically deleted");
    }

    #[test]
    fn fresh_entries_are_served_only_for_their_market() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = open(&dir.path().join("c.db")).unwrap();
        put_quotes(&mut c, &[quote(&iso_in(300))], 60).unwrap();
        let got = get_quotes(&c, ProviderId::Ahledger, "forever.normal.alliance.eu", &[2589]).unwrap();
        assert_eq!(got.len(), 1);
        assert!(got[0].from_cache);
        assert!(get_quotes(&c, ProviderId::Ahledger, "forever.pvp.horde.eu", &[2589]).unwrap().is_empty(), "no cross-market leakage");
    }
}
