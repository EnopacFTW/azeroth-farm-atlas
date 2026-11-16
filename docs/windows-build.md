# Windows-Build

## Voraussetzungen (Windows 10/11 x64)

| Komponente | Geprüft auf dem Build-Rechner (15.11.2026) |
|---|---|
| Node.js ≥ 22 (für `node:sqlite` im Daten-Build) | v24.18.0 |
| Rust (MSVC-Toolchain) | rustc 1.100.0 via `winget install Rustlang.Rustup` |
| Visual Studio Build Tools mit „Desktopentwicklung mit C++“ | VS Build Tools 2022 + VS Community 2026 |
| WebView2 Runtime | 157.x (Windows 11 vorinstalliert; der Installer lädt sie sonst per Bootstrapper) |
| Git | für `npm run data:fetch` |

```powershell
winget install Rustlang.Rustup
rustup default stable
```

## Entwickeln

```powershell
npm install
npm run data:fetch      # einmalig: QuestieDB (gepinnter Commit) + cmangos classic-db nach data-raw/
npm run data:build      # erzeugt src-tauri/resources/seed.db, data-manifest.json, docs/coverage-report.md
npm run tauri dev
```

`seed.db` (~51 MB) ist ein Build-Ergebnis und nicht im Git-Repo; nach einem frischen Clone sind `data:fetch` und
`data:build` einmal nötig, bevor `tauri dev`/`tauri build` startet. `data-manifest.json` ist eingecheckt und
dokumentiert die Quell-Hashes des erwarteten Builds.

## Tests

```powershell
npm test               # Vitest: Domain + Testprofile A–F gegen die echte Seed-DB
npm run test:rust      # cargo test: Provider, HTTP-Fehlerfälle, Cache, SQLite, Migration, Sessions
cd src-tauri; cargo test live_ahledger -- --ignored --nocapture   # echter AHledger-Request
```

E2E gegen das echte WebView2-Fenster (CDP):

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
npm run tauri dev       # oder die installierte App mit derselben Variable starten
# zweites Terminal:
npm run test:e2e
```

## Installer bauen

```powershell
npm run tauri build
```

Ergebnis:

- `src-tauri\target\release\azeroth-farm-atlas.exe` (portable, benötigt WebView2)
- `src-tauri\target\release\bundle\nsis\Azeroth Farm Atlas_0.1.0_x64-setup.exe` (bevorzugt; Installation pro Benutzer, DE/EN)
- `src-tauri\target\release\bundle\msi\Azeroth Farm Atlas_0.1.0_x64_de-DE.msi` (+ en-US)

Die Builds sind **nicht signiert** (kein Zertifikat vorhanden) → Windows SmartScreen zeigt „Unbekannter Herausgeber“.

## Installation / Daten / Deinstallation

- Installieren: Setup-EXE ausführen (keine Admin-Rechte nötig). WebView2 wird bei Bedarf still nachinstalliert.
- Benutzerdaten: `%APPDATA%\de.azerothfarmatlas.desktop\` – `game.db` (Kopie der Seed-DB), `user.db` (Profile, Sessions,
  Favoriten, Einstellungen, manuelle Preise), `market_cache.db` (Fremdpreis-Cache mit Ablauf), `backups\`.
- Zugangsdaten: Windows-Anmeldeinformationsverwaltung, Einträge „AzerothFarmAtlas“.
- Update: neue Setup-EXE drüber installieren; `game.db` wird bei geänderter Seed-Prüfsumme atomar ersetzt, `user.db` bleibt.
- Deinstallation über „Apps & Features“. Benutzerdaten bleiben erhalten (Ordner oben manuell löschen oder in der App
  „Einstellungen → Zurücksetzen“).

## CI-Hinweis

Frontend/Domain-Tests laufen plattformunabhängig. Der Installer muss auf einem Windows-Runner gebaut werden
(`windows-latest`, Rust stable, Node 22+, `npm ci && npm run tauri build`).
