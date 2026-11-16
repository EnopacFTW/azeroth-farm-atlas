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
- Keine mitgelieferten WoW-Zonenkarten (Urheberrecht); die App lädt auch keine herunter. Eigene, rechtmäßig vorliegende
  Bilder (z. B. Screenshot der Ingame-Weltkarte) lassen sich im Weltatlas pro Zone oder ordnerweise importieren und per
  Regler ausrichten. Die Ausrichtung ist Handarbeit – es gibt keine automatische Erkennung des Kartenrahmens.
- Ohne Bild: 0–100-%-Koordinatenfläche (3:2) mit Spawndichte-Schattierung aller Forever-Spawns. Sie zeigt, wo die Zone
  Inhalt hat, nicht Gelände, Wege oder Wasser.
- Kein Clustering-Plugin; viele Marker werden per Canvas gerendert.

## Märkte
- Blizzard-Adapter ist **nicht live getestet** (keine Credentials). Nur Mock-/Fixture-Tests nach Community-Schema.
- auctionhouse.fyi: nur öffentliche Item-Snapshots, kein Bulk-Sync, keine History (feature-gated).
- AHledger-Preisverlauf wird live angezeigt, nicht archiviert (Lizenz).
- Preisalarme/Windows-Benachrichtigungen, Tray: nicht umgesetzt.
- AH-Gebühr: konfigurierbar (Standard 5 %/15 %); Einstelldepot nicht berücksichtigt.

## App
- Kein SavedVariables-Import (spätere Phase).
- Kein Code-Signing-Zertifikat → Installer ohne Authenticode-Signatur (SmartScreen-Warnung). Updates sind mit dem
  Projektschlüssel (minisign) signiert; der Updater nimmt nur so signierte Pakete an.
- UI Deutsch und Englisch. Gespeicherte Hinweise im Preiscache (z. B. „304 unverändert“) bleiben in der Sprache, in der
  sie abgerufen wurden; Quellnamen der Seed-DB sind teils nur deutsch.
- Fensterposition/-größe werden global (Plugin window-state) gespeichert, nicht pro Profil.
