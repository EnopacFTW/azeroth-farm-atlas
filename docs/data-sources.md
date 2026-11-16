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
| XP pro Kill (Basis-XP, Zero-Difference, Elite ×2, Ausgeruht ×2), XP je Level | cmangos `Formulas.h`, warcraft.wiki.gg „Mob experience“ / „Experience to level“; `ExperienceMultiplier` aus cmangos `creature_template` | `classic_fallback` |
| Community-Farmspots (174) | `scripts/data/community-spots.json`: Warcraft Tavern (Cloth Farming, 1–60 Grinding, Skinning 1–300), Almar's Guides (Classic Farming), wow-professions.com (Leder-Guides), Boostroom (WoW Forever Farming Spots), Method.gg (Herbalism in WoW Forever) | `manual_unverified`, beim Build gegen Forever-Spawns aufgelöst |
| Deutsche Zonennamen, Kontinent, Zonentyp, Zonenkontrolle | `scripts/data/zones.json` (manuell) | `manual_unverified` |
| AH-Preise, Preisverlauf, Rezepte/Reagenzien | AHledger / auctionhouse.fyi / Blizzard (live) | zeitabhängiger Cache |

Community-Spots: Aus den Guides werden nur Fakten übernommen (Zone, Mob-/Lagername, ungefähre Koordinate, Zielitem) und
in eigenen Worten notiert; jeder Spot verlinkt seine Quellen. Der Build sucht die passenden Forever-NPCs/-Knoten und
verwirft Einträge, die sich nicht auflösen lassen (Bericht in `coverage-report.md`). Reddit ließ sich nicht auswerten:
reddit.com blockiert automatisierte Abrufe, und die Websuche lieferte keine Reddit-Threads – die großen Guide-Seiten
fassen den Community-Konsens aber zusammen.

Wowhead: nur Links (Item-/NPC-Seiten unter `wowhead.com/forever/…` im Browser). Das Wowhead-Tooltip-Skript wird bewusst
nicht eingebunden (Fremdcode im App-Fenster mit Zugriff auf die App-Funktionen); die Tooltips in der App nutzen lokale Daten.

Nicht genutzt: Wowhead-Daten (keine Massenkopie), TheWoWDB (API während des Baus nicht zuverlässig erreichbar, Timeouts),
Stein-N/WoW-Quest-Database (Questdaten, für Farmspots nicht nötig).

Zahlen: siehe `coverage-report.md` (automatisch erzeugt).
