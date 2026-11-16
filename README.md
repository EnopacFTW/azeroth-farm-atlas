# Azeroth Farm Atlas

Windows-Desktop-App (Tauri 2 · Rust · React/TypeScript · SQLite) für **World of Warcraft: Forever, Level 1–60**:
Farmfinder für XP, Gold, Stoff, Leder, Bergbau, Kräuter, Angeln und Rares mit belegten Forever-Spawns, Skillprüfung,
Zonenkarten (direkt aus deiner lokalen WoW-Installation oder eigene Bilder), Farmtracker und **echten Auktionshauspreisen**
(AHledger, auctionhouse.fyi, optional Blizzard). Oberfläche **Deutsch / English**, Auto-Updater über GitHub Releases.

*English:* Windows desktop app for WoW: Forever (levels 1–60) – farm finder, maps, profession planner, farm tracker and
live auction house prices. Switch the language with the DE/EN toggle in the header. Download the installer from
[Releases](https://github.com/EnopacFTW/azeroth-farm-atlas/releases); later versions install from inside the app.

> Planungs-, Nachschlage- und Tracking-Tool. Keine Spielautomatisierung, kein Speicherlesen, kein Packet-Sniffing.

## Schnellstart

```powershell
npm install
npm run data:fetch   # nur nach frischem Clone: Quelldaten nach data-raw/
npm run data:build   # erzeugt src-tauri/resources/seed.db (nicht im Repo)
npm run tauri dev
```

Installer bauen: `npm run tauri build` → `src-tauri\target\release\bundle\nsis\Azeroth Farm Atlas_0.1.0_x64-setup.exe`.
Voraussetzungen und Details: [docs/windows-build.md](docs/windows-build.md).

## Was die App kann

| Ansicht | Funktion |
|---|---|
| Farmfinder | Level-Regler 1–60, Klasse, Fraktion, 2 Primärberufe + Skill, Angeln, Farmziele, Filter (solo, Elites, Instanzen, PvP-Risiko, noch XP, verwertbar, Forever-only, nur Community-Tipps, nur AoE-Spots), Ergebnisliste mit Eignung, XP/Kill und Kills bis Levelaufstieg, Hauptdrops mit Item-Tooltips, Skill-Status, Karte, „Warum / Warum nicht / Welche Daten fehlen“ |
| Community-Spots | 198 recherchierte Farmspots aus öffentlichen Guides (Stoff, Leder, XP, AoE-Grinding, Essenzen, Perlen, Erz/Kräuter, Instanz-Runs), gegen Forever-Spawns aufgelöst, mit Quellenlinks |
| XP | XP pro Kill je Mob und Spot (Classic-Formel, Elite/Ausgeruht), Kills bis zum nächsten Level, Grau-ab-Level |
| Spot-Detail | Mobs mit NPC-ID/Level/Klasse/Kürschnerbarkeit, Loot getrennt nach Kill/Kürschnern/Knoten/Angeln/Quest mit Chance, Händler- und AH-Preis, Ertragsmodell (gemessen vs. modelliert), `/way`-Kopie, Rare-Drop-Rechner, Session starten |
| Weltatlas | Kontinent → Zone, Ebenen Spots/Erz/Kräuter/Fischschwärme, Marker nach Skill gefiltert, Zonenkarten mit einem Klick aus der lokalen WoW-Forever-/Classic-Era-Installation übernehmen, alternativ eigene Bilder importieren und ausrichten; ohne Bild Spawndichte als Grundkarte |
| Item / NPC | alle belegten Quellen inkl. Händler, passende Spots, Live-Preis mit Verlauf, Watchlist |
| Berufe | Sammelknoten nach Skillfarbe, Forever-Rezepte bis Zielskill mit Reagenzien und Preisen (AHledger) |
| Auktionshaus | Markt/Anbieter-Wahl, Providerstatus, Itempreis + Verlauf, Bulk-Sync mit ETag/304, Watchlist, manuelle Preise |
| Vergleich | 2–4 Spots nebeneinander |
| Farmtracker | Timer mit Pause, Kills/XP/Gold/Kosten/Loot, Gold/h gemessen, CSV/JSON-Export |
| Datenquellen | Quellen, Lizenzen, Build-Stand, Coverage-Matrix mit Lücken, Providertests |
| Einstellungen | Profile (neu/duplizieren/umbenennen/löschen/Export/Import), Anbieter + Credentials, Frischegrenze, AH-Gebühr, Refresh, UI-Skalierung, Immer-im-Vordergrund, Backup, Reset |

## Daten

10.118 NPCs · 55.329 Spawnpunkte · 14.889 Items · 316.092 Loot-Beziehungen · 25.115 Knoten-Spawns · 1.648 automatisch
gruppierte Spots (0 kuratierte Routen). Quellen: QuestieDB Forever (GPL-3.0) + cmangos classic-db als klar markierter
Classic-Fallback. Details: [docs/data-sources.md](docs/data-sources.md), [docs/coverage-report.md](docs/coverage-report.md),
[docs/limitations.md](docs/limitations.md).

## Dokumentation

- [docs/market-providers.md](docs/market-providers.md) – Endpunkte, Auth, Lizenz, Live-Nachweise
- [docs/architecture.md](docs/architecture.md) – Aufbau, Datenpipeline, Scoring-Gewichte
- [docs/licenses.md](docs/licenses.md) – Lizenzen (Projekt: GPL-3.0-or-later)

Prices from [AHledger](https://ahledger.com) · Prices from [auctionhouse.fyi](https://auctionhouse.fyi).
World of Warcraft © Blizzard Entertainment; dieses Projekt ist nicht mit Blizzard verbunden.
