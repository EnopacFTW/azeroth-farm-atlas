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

## XP, Tooltips, Community-Spots
- XP pro Kill folgt der Classic-Formel (cmangos/Wowpedia) inkl. Elite ×2, Ausgeruht ×2 und Kreatur-XP-Faktor; Gruppen-XP
  ist vereinfacht (gleichmäßige Teilung). Forever-Änderungen an der XP-Kurve sind nicht berücksichtigt.
- Item-Tooltips zeigen lokale Daten (Qualität, Itemlevel, Händlerpreis, beste Quellen) und den gecachten AH-Preis; Werte
  der Forever-Itemisierung (neue Stats) sind nicht enthalten → dafür der Wowhead-Link.
- Community-Spots stammen überwiegend aus Classic-Guides; sie sind gegen Forever-Spawns aufgelöst, aber nicht im Spiel
  geprüft. Instanz-Spots haben keine Karte (keine Spawnkoordinaten in den Forever-Daten).
- Neutrale Mobs (QuestieDB „freundlich zu A und H“) gelten als angreifbar, wenn sie keine Humanoiden sind und Classic-Loot
  haben. Mobs, die nur einer Fraktion feindlich sind (z. B. Bauern in Hillsbrad), erscheinen nur, wenn ein Guide sie nennt,
  und dann nur für die passende Fraktion.

## Karten
- Keine mitgelieferten WoW-Zonenkarten (Urheberrecht); die App lädt auch keine herunter.
- Ist WoW: Forever oder Classic Era installiert, übernimmt „Alle Zonenkarten übernehmen“ (Weltatlas → Kartenbilder bzw.
  Button auf leeren Karten) die Weltkarten aller 49 Zonen/Städte/Schlachtfelder direkt aus dem lokalen Client – exakt
  ausgerichtet (Kartenbereich 1002 × 668 der 4 × 3 Kacheln = 0–100 %) und **vollständig erkundet**: Es wird die Kartengrafik
  verwendet, die der Client der UiMap zuordnet (UiMapXMapArt, Phase 0 – bei Forever teils neu gezeichnet), plus alle
  Einblendungen „erkundeter Gebiete“ (WorldMapOverlay: Ortschaften, Wege, Lager). Städte und Warsongschlucht/Arathibecken
  haben im Spiel keine solchen Einblendungen. Dungeons/Raids haben keine Zonenkarte.
- Gelesen werden nur unverschlüsselte, lokal vorhandene Dateien. Die vier Spieltabellen werden über feste File-IDs und ihre
  Spaltenstruktur erkannt; passt die Struktur nicht (künftiger Patch), nutzt die App die alten Kacheldateinamen
  (`src-tauri/src/wowclient/mod.rs`) ohne Ortschaften. Ändert Blizzard das Speicherformat, kommt eine Fehlermeldung.
- Nach einem WoW-Patch oder einem App-Update mit besseren Karten bietet die Karte „Karten aktualisieren“ an.
- Eigene Bilder (z. B. Screenshot der Ingame-Weltkarte) lassen sich weiterhin importieren und per Regler ausrichten;
  sie werden bei der Client-Übernahme nicht überschrieben.
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
