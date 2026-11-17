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

Der Auto-Updater verlangt signierte Update-Pakete. Der private Schlüssel liegt **nur** auf dem Build-Rechner
(`%USERPROFILE%\.tauri\azeroth-farm-atlas.key`, nicht im Repo – sichern! Ohne ihn können installierte Apps keine
Updates mehr annehmen). Der öffentliche Schlüssel steht in `tauri.conf.json → plugins.updater.pubkey`.

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY="$env:USERPROFILE\.tauri\azeroth-farm-atlas.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run tauri build
```

Ergebnis (Version aus `tauri.conf.json`):

- `src-tauri\target\release\bundle\nsis\FarmForever_<version>_x64-setup.exe` (bevorzugt; pro Benutzer, DE/EN) + `.sig`
- `src-tauri\target\release\bundle\msi\FarmForever_<version>_x64_de-DE.msi` (+ en-US, je mit `.sig`)

Die Installer sind **nicht Authenticode-signiert** (kein Code-Signing-Zertifikat) → SmartScreen zeigt „Unbekannter
Herausgeber“. Die Update-Signatur (minisign) ist davon unabhängig und schützt nur den Updater-Kanal.

## Release & Auto-Update

Die App prüft beim Start `https://github.com/EnopacFTW/azeroth-farm-atlas/releases/latest/download/latest.json`
und bietet ein neues Release mit „Installieren & neu starten“ an (NSIS im Passiv-Modus, Benutzerdaten bleiben).

Neues Release:

1. Version in `package.json`, `src-tauri/Cargo.toml` und `src-tauri/tauri.conf.json` erhöhen.
2. Signiert bauen (oben).
3. `node scripts/release-manifest.mjs` schreibt `src-tauri/target/release/bundle/latest.json` (Version, Datum, URL und
   Signatur der NSIS-Setup-EXE).
4. GitHub-Release `v<version>` mit Setup-EXE, `.sig` und `latest.json` als Assets veröffentlichen.

## Installation / Daten / Deinstallation

- Installieren: Setup-EXE ausführen (keine Admin-Rechte nötig). WebView2 wird bei Bedarf still nachinstalliert.
- Benutzerdaten: `%APPDATA%\de.azerothfarmatlas.desktop\` – `game.db` (Kopie der Seed-DB), `user.db` (Profile, Sessions,
  Favoriten, Einstellungen, manuelle Preise), `market_cache.db` (Fremdpreis-Cache mit Ablauf), `backups\`.
- Zugangsdaten: Windows-Anmeldeinformationsverwaltung, Einträge „AzerothFarmAtlas“.
- Update: per Auto-Updater in der App oder neue Setup-EXE drüber installieren; `game.db` wird bei geänderter
  Seed-Prüfsumme atomar ersetzt, `user.db` und `maps\` (übernommene/eigene Kartenbilder) bleiben.
- Deinstallation über „Apps & Features“. Benutzerdaten bleiben erhalten (Ordner oben manuell löschen oder in der App
  „Einstellungen → Zurücksetzen“).

## CI-Hinweis

Frontend/Domain-Tests laufen plattformunabhängig. Der Installer muss auf einem Windows-Runner gebaut werden
(`windows-latest`, Rust stable, Node 22+, `npm ci && npm run tauri build`).

## Umbenennung (0.5.0)

Bis 0.4.x hieß die App „Azeroth Farm Atlas“ (Ordner `%LOCALAPPDATA%\Azeroth Farm Atlas`). Der FarmForever-Installer
entfernt diese alte Programm-Installation (NSIS-Hook `src-tauri/windows/hooks.nsh`) und ersetzt deren Verknüpfungen.
Bundle-ID (`de.azerothfarmatlas.desktop`), Datenordner, Anmeldeinformationsspeicher und Update-URL bleiben unverändert,
damit Profile, Sessions, Karten und API-Keys erhalten bleiben und der Auto-Updater der alten Versionen weiter funktioniert.
