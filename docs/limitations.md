# Ehrliche Grenzen (Stand 15.11.2026)

## Daten
- **Dropchancen sind Classic-Fallback** (cmangos 1.12), nicht Forever-gemessen. QuestieDB Forever liefert nur die *Beziehung*
  „NPC droppt Item“ ohne Rate. Beides wird getrennt gekennzeichnet.
- **Kürschnerbarkeit, Kreaturtyp, Münzloot, Händlerpreise:** Classic-Fallback. Forever-neue NPCs ohne Classic-Eintrag → „unbekannt“.
- **Skillgrenzen** (Erz, Kräuter, Kürschnern-Formel, Angeln-Basis-Skill) sind Classic-Regeln, nicht gegen Forever geprüft.
- **Pristine Leather/Hide/Scale, Camping, Legacy-Perks:** nicht enthalten (keine belegte Datenquelle gefunden).
- **Weltdrops** (Referenz-Loottabellen, 19.125 Einträge) werden keinem Spot zugeordnet.
- **Spots sind automatisch gruppiert** (DBSCAN über Forever-Spawnpunkte); 0 handkuratierte Routen. Node-Routen sind
  Nearest-Neighbour/2-opt-Punktfolgen in Luftlinie („Terrain nicht berücksichtigt“).
- **Zonenkontrolle** für PvP-Hinweis = Classic-Gebietszuordnung (manuell).
- **Respawnzeiten, Angriffstyp, Flugpunkte, Händler-Ebene auf der Karte:** nicht vorhanden.
- **Gold/h und XP/h** gibt es nur aus eigenen gemessenen Sessions; die App enthält keine Community-Messungen.
- Coverage: in jedem Levelband ≥ 5 Spots pro Farmziel; dünn ist Bergbau 1–10 (5) und Angeln (7–20 je Band). Siehe `coverage-report.md`.

## Karten
- Keine echten WoW-Zonenkarten (Urheberrecht). Marker liegen auf einer 0–100-%-Koordinatenfläche. Ein Import eigener,
  rechtmäßig vorliegender Kartenbilder ist vorbereitet (Koordinatenmathematik getestet), aber nicht als UI umgesetzt.
- Kein Clustering-Plugin; viele Marker werden per Canvas gerendert.

## Märkte
- Blizzard-Adapter ist **nicht live getestet** (keine Credentials). Nur Mock-/Fixture-Tests nach Community-Schema.
- auctionhouse.fyi: nur öffentliche Item-Snapshots, kein Bulk-Sync, keine History (feature-gated).
- AHledger-Preisverlauf wird live angezeigt, nicht archiviert (Lizenz).
- Preisalarme/Windows-Benachrichtigungen, Tray, Updater: nicht umgesetzt.
- AH-Gebühr: konfigurierbar (Standard 5 %/15 %); Einstelldepot nicht berücksichtigt.

## App
- Kein SavedVariables-Import (spätere Phase).
- Kein Code-Signing-Zertifikat → unsignierter Installer.
- UI nur Deutsch (englische Namen als Untertitel/Suchaliasse).
- Fensterposition/-größe werden global (Plugin window-state) gespeichert, nicht pro Profil.
