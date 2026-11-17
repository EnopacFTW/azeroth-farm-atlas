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

**Karten:** Es werden **keine** Blizzard-Kartenbilder ausgeliefert, heruntergeladen oder im Repository gespeichert.
Auf Wunsch liest die App die Weltkarten (© Blizzard Entertainment) aus der **lokal installierten** WoW-Forever- bzw.
Classic-Era-Installation des Nutzers (nur lesend, lokaler CASC-Speicher, kein CDN, kein Spielprozess) und legt sie nur
im lokalen Datenordner ab. Die Tabellen-Spaltenlayouts stammen aus
WoWDBDefs (wowdev); die File-IDs der Tabellen aus der Community-Listfile (wowdev). Ohne Client: selbst erzeugte Koordinatenflächen mit Spawndichte oder eigene importierte Bilder.
Item-Icons werden nicht geladen.

**Schriften (eingebettet):** Inter und Cinzel über @fontsource (SIL Open Font License 1.1).

**Laufzeit-Bibliotheken:** Tauri (MIT/Apache-2.0), React (MIT), Leaflet (BSD-2), TanStack Query (MIT), Zustand (MIT),
Zod (MIT), lucide-react (ISC), rusqlite/SQLite (MIT/Public Domain), reqwest (MIT/Apache-2.0), keyring (MIT/Apache-2.0).
