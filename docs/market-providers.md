# Marktdaten-Anbieter

Alle Anfragen laufen im nativen Rust-Prozess (`src-tauri/src/market/`), über eine Domain-Allowlist
(`security/network_policy.rs`): `api.ahledger.com`, `auctionhouse.fyi`, `oauth.battle.net`, `{eu,us,kr,tw}.api.blizzard.com`.
Nur HTTPS, keine Redirects, Timeouts (10 s connect, 20–180 s gesamt), Größenlimits (8 MB Standard, 16 MB Preistabelle,
96 MB Blizzard-House), max. 2 Retries bei 5xx/429/Timeout mit exponentiellem Backoff + Jitter, `Retry-After` > 30 s wird
nicht abgewartet, sondern als Fehler gemeldet. Fehlermeldungen werden von Tokens bereinigt.

Normalform: `MarketQuote` (`market/model.rs`, TS: `src/domain/types.ts`). Preise sind **Integer-Copper pro Stück**;
`null` = unbekannt, nie 0. `observedAt` = ursprünglicher Scan, `fetchedAt` = Abruf, `cacheExpiresAt` aus `Cache-Control`.
Märkte werden nie gemischt oder gemittelt; Quotes sind an `provider + marketId` gebunden.

Geprüft am **15.11.2026**.

## AHledger (Standard)

| | |
|---|---|
| Doku | https://ahledger.com/developers · Terms https://ahledger.com/terms |
| Basis | `https://api.ahledger.com` |
| Auth | keine; optional `Authorization: Bearer ahlk_…` (Windows-Anmeldeinformationsverwaltung) |
| Regionen | Forever: us, eu, cn, kr × normal/pvp/rp/rppvp × alliance/horde (32 Märkte, dynamisch über `/v1/markets`) |
| Genutzt | `GET /v1/markets`, `GET /v1/prices/{market}/{item}?range=24h|7d|30d`, `GET /v1/tooltip/{market}?items=…` (≤100), `GET /v1/pricetable/{market}` (ETag/304), `GET /v1/crafting/{market}?profession=…&all=1` |
| Limits | 300/min/IP (ab 10.12.2026: 30/min ohne Key, Preistabelle 60/h je Markt, 304 kostenlos); Markt-Tools 60/min |
| Cache-Control | markets 300 s, prices 60 s, tooltip 300 s, pricetable 60 s, crafting 300 s |
| Attribution | „Prices from AHledger“ mit Link (bei Einzelitems `attribution.url`); in jeder Preisanzeige vorhanden |

**Live-Nachweis (15.11.2026):**
- `GET /v1/markets` → 200, 32 Forever-Märkte inkl. `forever.rppvp.alliance.eu`.
- `GET /v1/prices/forever.normal.alliance.eu/2589?range=7d` → 200, `latest.minBuyout=26`, `median=27`, `observedAt=2026-11-15T17:56:28Z`, `quantity=35766`.
- Rust-Livetest (`cargo test live_ahledger -- --ignored --nocapture`):
  `LIVE forever.normal.alliance.eu 2589 min=Some(18) median=Some(27) observed=Some("2026-11-15T19:02:25.000Z")`.
- E2E in der Windows-App: Preistabelle 6.609 Items geladen; zweiter Abruf → `304 Not Modified`.
- `latest = null` real beobachtet bei `forever.rppvp.alliance.kr` → als „Nicht verfügbar“ angezeigt.

Preistabelle `AHL1|forever/normal/alliance/eu|<unix>|<rows>`; Zeile `item:median:minBuyout:quantity:median7d:median30d:low30d:high30d:soldPerDay×10`,
leeres Feld = unbekannt.

**Lizenz/Cache (ab 10.12.2026):** keine Speicherung über `Cache-Control` hinaus. Umsetzung: Fremdpreise liegen nur in
`market_cache.db` und werden beim Lesen/Start gelöscht, sobald `expires_at` erreicht ist (`cache::purge_expired`, Test
`expired_entries_are_not_served_and_get_purged`). Die Bulk-Tabelle wird zusätzlich nur **im Arbeitsspeicher** gehalten, um sie per
`If-None-Match` zu revalidieren (304 erneuert die Frist); sie wird nie persistent über die Frist hinaus gespeichert und nie
angezeigt, solange sie abgelaufen ist. Kein Preisarchiv; der Verlauf kommt bei Bedarf live vom Anbieter.

## auctionhouse.fyi (optional)

| | |
|---|---|
| Doku | https://auctionhouse.fyi/docs/api (quickstart, reference, markets) |
| Basis | `https://auctionhouse.fyi/api/v1` |
| Auth | öffentlich ohne Token; optional Bearer-Key |
| Märkte | dokumentiert: 6 US-Märkte (normal/pvp/rp × alliance/horde). Kein Markt-Listen-Endpoint (`/markets` → 404). Märkte gelten erst nach erfolgreichem Test als „bestätigt“. |
| Genutzt | `GET /ah/{market}/{key}` (stündlicher Snapshot, `row=[price, quantity, atMs]`, `live`) |
| Limits | anonym 60/min |

**Live-Nachweis (15.11.2026):** `GET /ah/forever.normal.horde.us/2589` → 200 `row=[20,27673,…]`, `live=false`.
`GET /ah/forever.normal.alliance.eu/2589` → **400 `{"error":"bad_market"}`** → App meldet „Markt wird nicht angeboten, für EU AHledger verwenden“.
`row=null` real beobachtet (Item 999999). Der `price` der Lesung ist laut Doku weder als Min noch als Median spezifiziert →
wird als „Referenzpreis“ geführt, nicht umetikettiert. Variantenschlüssel (`itemID + 2^31·v`) werden nicht abgeflacht.
History/Candles/Books sind feature-gated und nicht umgesetzt. Read-only, kein Upload.

## Blizzard Forever (experimentell, standardmäßig AUS)

| | |
|---|---|
| Quellen | Community: https://us.forums.blizzard.com/en/blizzard/t/wow-forever-api-what-works-so-far-plus-a-ts-client/60334 · https://mhuijskens.com/WoWForever/Api/ (Stand 05./06.11.2026). Von Blizzard **nicht** offiziell für Forever dokumentiert. |
| Auth | OAuth Client Credentials `POST https://oauth.battle.net/token` mit eigener Client-ID/-Secret (develop.battle.net). Secret nur in der Windows-Anmeldeinformationsverwaltung (`keyring`, Dienst „AzerothFarmAtlas“), Token nur im RAM. |
| Routen | `/data/wow/ruleset/index`, `/data/wow/ruleset/{id}/auctions/index` (Fallback `/auctions/` mit Slash – die Quellen widersprechen sich), `/auctions/{houseId}`, `/auctions/{houseId}/commodities`, Namespace `dynamic-forever-{region}` |
| Semantik | Commodity `unit_price` = pro Stück; Listing: `buyout / quantity`; nur Gebote → ausgeschlossen (gezählt); `bonus_lists` → eigene Variante. Duplikat-Houses über Signatur (SHA-256 der Auktions-IDs) erkannt und angezeigt. Fraktion aus dem **Namen** des Houses, House-ID immer sichtbar. |

**Live-Nachweis:** keiner – ohne Credentials liefert `/data/wow/ruleset/index` erwartungsgemäß 404 (getestet 15.11.2026).
Getestet mit Mocks/Fixtures nach dokumentiertem Schema (`tests/fixtures/blizzard`, als *konstruiert* gekennzeichnet):
OAuth, Index-Fallback, 60 Märkte (4 Rulesets × 15 Houses), leere Auktionen, Bid-only, Varianten, Duplikate, 401.

## Manuell

Eigene Preisnotizen (`user.db.manual_prices`), dauerhaft gespeichert, immer als „Manuell“ markiert, nie als Livepreis.

## Tests

`cargo test` (38 Tests, davon Provider/HTTP): 200, 304, 400 (bad_market), 401, 403, 404, 429 (+Retry-After), 5xx mit Retries,
Timeout/Offline, Größenlimit, leere Liste, `latest=null`, `row=null`, abgelaufener Cache, Marktisolation, Varianten.
