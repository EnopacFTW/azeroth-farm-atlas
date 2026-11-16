# Lizenzen

**Projekt:** GPL-3.0-or-later (`LICENSE`). Grund: Die gebündelte Seed-Datenbank enthält aus GPL-3.0-Quellen abgeleitete Daten.

| Quelle | Lizenz | Verwendung | Pflicht |
|---|---|---|---|
| QuestieDB (Flavor Forever), Commit `4dbb824…` | GPL-3.0 | NPCs, Spawns, Objekte, Item-Drop-Beziehungen, deDE-Namen, UiMap-Zuordnung | Quellenangabe, Weitergabe unter GPL, Quelle/Build-Skript beilegen (`scripts/`) |
| cmangos classic-db `ClassicDB_1_12_1_z2815` | GPL-3.0 | Classic-Fallback: Kreaturtyp, Loot-Chancen, Kürschner-/Knoten-/Angelloot, Münzloot, Händlerpreise | wie oben |
| Wowpedia / cmangos `Formulas.h` | Fakten/Formeln | Kürschner-Skill-Formel, Erz-/Kräuter-Skillgrenzen, Grau-Level | Nennung als Quelle |
| AHledger API | eigene Terms | Live-Preise, Rezepte | Credit „Prices from AHledger“ verlinkt; Cache nur bis Cache-Control; keine Weitergabe als Feed; kommerzielle Nutzung lizenzpflichtig |
| auctionhouse.fyi API | eigene Bedingungen | Snapshot-Preise (US) | read-only, Quellenangabe |
| Blizzard Battle.net API | Blizzard Developer API Terms | optional, experimentell, mit eigenen Credentials | standardmäßig aus |
| World of Warcraft Namen/Daten | © Blizzard Entertainment | Spielnamen | Fanprojekt, nicht mit Blizzard verbunden |

**Karten:** Es werden **keine** Blizzard-Kartenbilder ausgeliefert oder geladen. Karten sind selbst erzeugte
Koordinatenflächen (SVG-Raster). Item-Icons werden nicht geladen.

**Laufzeit-Bibliotheken:** Tauri (MIT/Apache-2.0), React (MIT), Leaflet (BSD-2), TanStack Query (MIT), Zustand (MIT),
Zod (MIT), lucide-react (ISC), rusqlite/SQLite (MIT/Public Domain), reqwest (MIT/Apache-2.0), keyring (MIT/Apache-2.0).
