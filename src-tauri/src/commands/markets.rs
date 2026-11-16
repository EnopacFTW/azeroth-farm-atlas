use crate::db::user::{self, ManualPrice};
use crate::error::{AppError, AppResult};
use crate::market::model::*;
use crate::market::QuoteDetail;
use crate::security::credentials;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn list_markets(state: State<'_, AppState>, provider: String, refresh: Option<bool>) -> AppResult<Vec<Market>> {
    let s = state.market_settings()?;
    state.market.list_markets(&provider, &s, refresh.unwrap_or(false)).await
}

fn manual_quotes(state: &AppState, market_id: &str, items: &[u32]) -> AppResult<Vec<MarketQuote>> {
    let prices = user::manual_prices(&*state.user()?, Some(market_id))?;
    let (ruleset, faction, region) = crate::market::ahledger::split_market(market_id);
    Ok(prices
        .into_iter()
        .filter(|p| items.contains(&p.item_id))
        .map(|p| MarketQuote {
            provider: ProviderId::Manual,
            market_id: p.market_id,
            region: region.clone(),
            ruleset: ruleset.clone(),
            faction: faction.clone(),
            house_id: None,
            item_id: p.item_id,
            variant_key: None,
            min_buyout_copper: None,
            median_copper: None,
            reference_price_copper: Some(p.unit_copper),
            median7d_copper: None,
            median30d_copper: None,
            quantity_listed: None,
            auctions: None,
            estimated_units_sold_per_day: None,
            observed_at: p.updated_at.clone(),
            fetched_at: p.updated_at.unwrap_or_else(now_iso),
            cache_expires_at: None,
            is_live_snapshot: false,
            source_url: None,
            attribution_text: "Manueller Preis (eigene Notiz)".into(),
            attribution_url: None,
            data_source_note: p.note,
            from_cache: true,
        })
        .collect())
}

#[tauri::command]
pub async fn fetch_quotes(state: State<'_, AppState>, provider: String, market_id: String, item_ids: Vec<u32>) -> AppResult<Vec<MarketQuote>> {
    if item_ids.len() > 400 {
        return Err(AppError::invalid("Zu viele Items auf einmal (max. 400)"));
    }
    if provider == "manual" {
        return manual_quotes(&state, &market_id, &item_ids);
    }
    let s = state.market_settings()?;
    state.market.quotes(&provider, &market_id, &item_ids, &s).await
}

#[tauri::command]
pub async fn fetch_quote_detail(state: State<'_, AppState>, provider: String, market_id: String, item_id: u32, range: Option<String>, variant_key: Option<String>) -> AppResult<QuoteDetail> {
    if provider == "manual" {
        let q = manual_quotes(&state, &market_id, &[item_id])?;
        return Ok(QuoteDetail { quote: q.into_iter().next(), series: None });
    }
    let s = state.market_settings()?;
    state.market.quote_detail(&provider, &market_id, item_id, range.as_deref().unwrap_or("7d"), variant_key, &s).await
}

#[tauri::command]
pub async fn fetch_crafting(state: State<'_, AppState>, market_id: String, profession: String) -> AppResult<serde_json::Value> {
    let s = state.market_settings()?;
    if !s.ahledger_enabled {
        return Err(AppError::new("provider_disabled", "AHledger ist deaktiviert – Rezeptdaten kommen von AHledger."));
    }
    crate::market::ahledger::Ahledger::new(credentials::get("ahledger_api_key")).crafting(&state.market.http, &market_id, &profession).await
}

#[tauri::command]
pub async fn sync_market_prices(state: State<'_, AppState>, provider: String, market_id: String) -> AppResult<SyncStatus> {
    let s = state.market_settings()?;
    state.market.sync(&provider, &market_id, &s).await
}

#[tauri::command]
pub async fn cancel_market_sync(state: State<'_, AppState>) -> AppResult<()> {
    state.market.cancel_sync();
    Ok(())
}

#[tauri::command]
pub async fn get_market_sync_status(state: State<'_, AppState>) -> AppResult<Vec<SyncStatus>> {
    state.market.sync_statuses()
}

#[tauri::command]
pub async fn provider_health(state: State<'_, AppState>, provider: String) -> AppResult<ProviderHealth> {
    let s = state.market_settings()?;
    state.market.health(&provider, &s).await
}

#[tauri::command]
pub async fn cached_provider_health(state: State<'_, AppState>) -> AppResult<Vec<ProviderHealth>> {
    let mut out = Vec::new();
    for p in ["ahledger", "auctionhouse_fyi", "blizzard_forever"] {
        if let Some(h) = state.market.cached_health(p)? {
            out.push(h);
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn set_credential(state: State<'_, AppState>, name: String, value: String) -> AppResult<()> {
    credentials::set(&name, &value)?;
    if name.starts_with("blizzard") {
        state.market.forget_blizzard_token();
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_credential(state: State<'_, AppState>, name: String) -> AppResult<()> {
    credentials::delete(&name)?;
    state.market.forget_blizzard_token();
    Ok(())
}

/// Only reports whether a credential exists – the value never leaves Rust.
#[tauri::command]
pub async fn credential_status() -> AppResult<serde_json::Value> {
    let mut m = serde_json::Map::new();
    for n in credentials::ALLOWED {
        m.insert(n.to_string(), serde_json::Value::Bool(credentials::is_set(n)));
    }
    Ok(serde_json::Value::Object(m))
}

#[tauri::command]
pub async fn clear_price_cache(state: State<'_, AppState>) -> AppResult<()> {
    state.market.clear_cache()
}

#[tauri::command]
pub async fn set_manual_price(state: State<'_, AppState>, price: ManualPrice) -> AppResult<()> {
    user::set_manual_price(&*state.user()?, &price)
}

#[tauri::command]
pub async fn delete_manual_price(state: State<'_, AppState>, item_id: u32, market_id: String) -> AppResult<()> {
    user::delete_manual_price(&*state.user()?, item_id, &market_id)
}

#[tauri::command]
pub async fn list_manual_prices(state: State<'_, AppState>, market_id: Option<String>) -> AppResult<Vec<ManualPrice>> {
    user::manual_prices(&*state.user()?, market_id.as_deref())
}
