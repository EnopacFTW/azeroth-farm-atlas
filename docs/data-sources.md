# Datenquellen

| Datenblock | Quelle | Status in der App |
|---|---|---|
| NPC-Namen (EN), Level, Rang, Spawnkoordinaten (Forever-konvertiert), Zonen | QuestieDB `data/Forever/foreverNpcDB.lua` @ `4dbb824…` | `forever_client_data` |
| Erz-/Kräuterknoten, Fischschwärme + Spawns | QuestieDB `foreverObjectDB.lua` | `forever_client_data` |
| Item-Namen, Itemlevel, „NPC droppt Item“, Händler-NPCs | QuestieDB `foreverItemDB.lua` | `forever_client_data` (ohne Rate) |
| Deutsche Namen (NPC/Item/Objekt) | QuestieDB `l10n/Forever/*/deDE.lua` | `forever_client_data` |
| UiMap-IDs je Zone | QuestieDB `data/Forever/conversion.json` | `forever_client_data` |
| Dropchancen, Kürschner-/Knoten-/Angelloot, Kreaturtyp, Münzloot, Händlerpreise, Angel-Basisskill | cmangos classic-db `ClassicDB_1_12_1_z2815` (sha256 `4f92db52…`) | `classic_fallback` |
| Kürschner-Formel, Erz-/Kräuter-Skillgrenzen, Grau-Level | Wowpedia / cmangos `Formulas.h` | `classic_fallback` |
| Deutsche Zonennamen, Kontinent, Zonentyp, Zonenkontrolle | `scripts/data/zones.json` (manuell) | `manual_unverified` |
| AH-Preise, Preisverlauf, Rezepte/Reagenzien | AHledger / auctionhouse.fyi / Blizzard (live) | zeitabhängiger Cache |

Nicht genutzt: Wowhead (keine Massenkopie), TheWoWDB (API während des Baus nicht zuverlässig erreichbar, Timeouts),
Stein-N/WoW-Quest-Database (Questdaten, für Farmspots nicht nötig).

Zahlen: siehe `coverage-report.md` (automatisch erzeugt).
