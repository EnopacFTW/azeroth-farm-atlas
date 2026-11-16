# Architektur

```
WebView2 (React/TS/Vite, Tailwind, TanStack Query, Zustand, Zod, Leaflet CRS.Simple)
  src/domain     reine, getestete Logik: scoring, market, economics, coordinates, professionRules, probability, sessionMath
  src/services   typisierte invoke()-Wrapper – das UI ruft nie selbst Anbieter-URLs auf
        │ Tauri IPC (54 Commands, Payloads in Rust validiert)
Rust (src-tauri/src)
  db/game.rs     read-only game.db (Seed), JSON-Aufbau in SQLite, FTS5-Suche (DE/EN)
  db/user.rs     user.db: Migrationen (transaktional, Backup vorher), Profile, Sessions, Favoriten, Settings, manuelle Preise
  market/        http (Allowlist, Retry, ETag, Limits) → ahledger | auctionhouse_fyi | blizzard_forever → model (Normalform) → cache (Ablauf)
  security/      credentials (Windows Credential Manager), network_policy (SSRF-Schutz)
```

Statische Spieldaten (`game.db`) und zeitabhängige Drittanbieterpreise (`market_cache.db`) liegen in getrennten Dateien
mit getrenntem Lebenszyklus. Capabilities: `core:default`, Always-on-top, Clipboard-Write, Window-State, Opener nur `https://*`.
Kein fs-/shell-/http-Plugin im Frontend.

## Datenpipeline (`npm run data:build`)

1. QuestieDB Forever Lua-Tabellen werden mit einem eigenen Literal-Parser gelesen (`scripts/lib/lua-table.mjs`, kein Lua-Eval).
2. cmangos-SQL-Dump wird mit einem eigenen INSERT-Parser gelesen (`scripts/lib/sql-dump.mjs`, kein SQL-Import).
3. Loot: Gruppen-Semantik von mangos (Gruppe 0 unabhängig; Gruppen > 0 mit 0-%-Einträgen teilen den Rest gleich),
   negative Chance = Questdrop, Referenzen (Weltdrops) übersprungen.
4. Spots: DBSCAN (eps 6 %, minPts 3) je NPC und Zone, Zusammenführung naher Cluster gleichen Typs mit ≤ 6 Level Spanne;
   Rares als Einzelspots; verstreute Patrouillen als „verstreute Spawns“; Erz/Kräuter/Fischschwärme je Zone mit NN+2-opt-Route.
5. Je Spot: Hauptdrops (spawn-gewichtete Classic-Rate + Forever-Bestätigung), Classic-Händlerwert/Kill (Teilwert-Flag).
6. FTS5-Index, Coverage, Manifest mit SHA-256.

## Scoring (`src/domain/scoring.ts`)

**Harte Filter:** Farmziel muss sachlich erfüllt sein (Tag aus Daten; Kürschnerei nur mit Beruf), Elites/Instanzen
(„Nur solo“, „Keine Elites“, „Keine Instanzen“), PvP-Feindgebiet (optional), Moblevel > Level + maxAbove (Standard 3),
graue Mobs bei „Noch XP“, fehlender Sammelberuf/Skill (→ „Skill fehlt“, nur mit „Noch nicht farmbar anzeigen“ sichtbar),
Forever-only entfernt Tags, die nur auf Classic-Fallback beruhen.

**fitScore (0–100)** = gewichteter Mittelwert nur der *bekannten* Faktoren:

| Faktor | Basisgewicht | Wert |
|---|---|---|
| Level-Eignung | 30 × (0,5 + XP-Prio/100) | 1 bei Ø-Moblevel −3…+1, linear fallend bis +4 bzw. −10 |
| Zonen-Gefahr (Sammelspots) | 15 | 1 wenn Zonen-Max ≤ Level, sonst −10 %/Level |
| Skill passt | 20 × (0,5 + Berufs-Prio/100) | Kürschnern: Anteil kürschnerbarer Spawns; Sammeln: 1 (<+25), 0,85 (<+50), 0,6 (<+100), 0,35 |
| Farmziel-Treffer | 25 | prioritätsgewichteter Anteil erfüllter Ziele |
| Spawndichte | 15 | log10(Spawns)/log10(60) |
| Solo/Risiko | 10 | ×0,3 Elite, ×0,5 Instanz, ×0,4 PvP-Feindgebiet, ×0,8 umkämpft |

Unbekannte Faktoren werden weggelassen, nie mit 0 bewertet. Wirtschaftlichkeit fließt **nicht** in den fitScore ein:
Händlerwert/Kill (Classic-Modell) und AH-Wert/Kill werden getrennt angezeigt; Gold/h nur aus Messungen
(oder gemessene Kills/h × Wert/Kill, ausdrücklich als Schätzung).

Begründungen („Warum empfohlen?“, „Warum nicht?“, „Welche Daten fehlen?“) werden aus denselben Prüfungen erzeugt.
