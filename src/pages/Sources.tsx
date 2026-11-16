import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Badge, ErrorBox, Panel, Spinner } from '@/components/ui';
import { SourceBadge } from '@/components/data';
import { api, openExternal } from '@/services/tauri';
import { dateTime, getLang, num, tr } from '@/i18n';

const OBJ = ['xp', 'gold', 'cloth', 'skinning', 'mining', 'herbalism', 'fishing', 'rare'];
const objName = (o: string) =>
  ({ xp: 'XP', gold: 'Gold', cloth: tr('Stoff', 'Cloth'), skinning: tr('Kürschnerei', 'Skinning'), mining: tr('Bergbau', 'Mining'), herbalism: tr('Kräuter', 'Herbs'), fishing: tr('Angeln', 'Fishing'), rare: 'Rares' } as Record<string, string>)[o] ?? o;

// The seed DB stores German source notes; English equivalents for the known sources.
const NOTES_EN: Record<string, string> = {
  questiedb_forever: 'NPCs, levels, spawn coordinates (converted for Forever), nodes, item ↔ NPC drop relations, vendors, German names.',
  cmangos_classic: 'Classic 1.12 drop rates, skinning/node/fishing loot, creature type, coin loot, vendor prices, fishing base skill. Not verified for Forever.',
  classic_rules: 'Skinning formula, ore/herb skill thresholds, gray level (Wowpedia / cmangos Formulas.h).',
  manual_zone_meta: 'German zone names, continent, zone type, zone control – maintained manually.',
  atlas_clustering: 'Spots grouped automatically from Forever spawn points (DBSCAN); node routes are straight-line point sequences.',
};

export function SourcesPage() {
  const sources = useQuery({ queryKey: ['sources'], queryFn: api.listSources, staleTime: Infinity });
  const cov = useQuery({ queryKey: ['coverage'], queryFn: api.getCoverage, staleTime: Infinity });
  const info = useQuery({ queryKey: ['appInfo'], queryFn: api.appInfo, staleTime: Infinity });
  const health = useQuery({ queryKey: ['health-cached'], queryFn: api.cachedProviderHealth });
  if (sources.isLoading || cov.isLoading) return <div className="p-6"><Spinner /></div>;
  if (sources.error) return <div className="p-6"><ErrorBox error={sources.error} /></div>;
  const bands: string[] = [...new Set<string>(cov.data.bands.map((b: any) => b.band))];
  const get = (band: string, o: string) => cov.data.bands.find((b: any) => b.band === band && b.objective === o)?.spots ?? 0;
  const c = cov.data.counts;
  const en = getLang() === 'en';
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1300px] space-y-4 p-5">
        <h1 className="font-display text-[20px] font-semibold">{tr('Datenquellen & Datenqualität', 'Data sources & data quality')}</h1>
        <Panel title={tr('Datenbestand (lokale Seed-Datenbank)', 'Data inventory (local seed database)')}>
          <div className="grid grid-cols-2 gap-2 text-[12.5px] md:grid-cols-4 lg:grid-cols-6">
            {[
              [tr('Zonen', 'Zones'), c.zones], ['NPCs', c.npcs], [tr('NPC-Spawnpunkte', 'NPC spawn points'), c.npcSpawns], ['Items', c.items], [tr('Knoten-Typen', 'Node types'), c.objects], [tr('Knoten-Spawns', 'Node spawns'), c.objectSpawns],
              [tr('Loot-Beziehungen', 'Loot relations'), c.loot], [tr('davon mit Rate', 'with a rate'), c.lootWithRate], [tr('Farmspots', 'Farm spots'), c.spots], [tr('automatisch gruppiert', 'auto-grouped'), c.generatedSpots], [tr('kuratierte Routen', 'curated routes'), c.curatedRoutes],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded border border-line bg-panel-2 px-3 py-2"><div className="text-[11px] text-faint">{k}</div><div className="num text-[16px] font-semibold">{num(Number(v))}</div></div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-faint">
            Build {info.data?.manifest?.builtAt ?? '–'} · Seed-SHA-256 <span className="selectable font-mono">{info.data?.manifest?.seedSha256?.slice(0, 16)}…</span> · {tr('Datenordner', 'Data folder')} <span className="selectable font-mono">{info.data?.dataDir}</span>
          </p>
          <p className="mt-1 text-[12px] text-warn">{tr('Datenpriorität', 'Data priority')}: forever_live_verified &gt; forever_client_data &gt; forever_player_observed &gt; classic_fallback &gt; manual_unverified. {tr('Es gibt derzeit keine live verifizierten oder spielerbeobachteten Forever-Daten in der Seed-DB.', 'The seed DB currently contains no live-verified or player-observed Forever data.')}</p>
        </Panel>

        <Panel title={tr('Quellen', 'Sources')}>
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase text-faint"><tr className="border-b border-line"><th className="py-1">{tr('Quelle', 'Source')}</th><th>Status</th><th>{tr('Lizenz', 'License')}</th><th>{tr('Version / Stand', 'Version / date')}</th><th>{tr('Inhalt', 'Content')}</th></tr></thead>
            <tbody>
              {sources.data!.map((s) => (
                <tr key={s.id} className="border-b border-line/50 align-top">
                  <td className="py-1.5 pr-2">
                    {s.url?.startsWith('https://') ? <button type="button" onClick={() => openExternal(s.url)} className="inline-flex items-center gap-1 text-gold hover:underline cursor-pointer">{s.name} <ExternalLink className="size-3" /></button> : s.name}
                  </td>
                  <td className="pr-2"><SourceBadge source={s.id} /> <span className="text-faint">{s.reliability}</span></td>
                  <td className="pr-2 text-muted">{s.license}</td>
                  <td className="max-w-56 break-all pr-2 font-mono text-[11px] text-faint">{s.version}</td>
                  <td className="text-muted">{en ? NOTES_EN[s.id] ?? s.notes : s.notes}</td>
                </tr>
              ))}
              <tr className="border-b border-line/50 align-top">
                <td className="py-1.5 pr-2">{tr('Kartenbilder', 'Map images')}</td>
                <td className="pr-2"><Badge>{tr('vom Nutzer importiert', 'imported by the user')}</Badge></td>
                <td className="pr-2 text-muted">{tr('Rechte beim Nutzer / Blizzard', 'rights with the user / Blizzard')}</td>
                <td className="pr-2 text-faint">{tr('lokal, Ordner „maps“', 'local, “maps” folder')}</td>
                <td className="text-muted">{tr('Die App liefert keine Kartenbilder mit und lädt keine herunter. Ohne Import: Koordinatenfläche mit Spawndichte.', 'The app ships and downloads no map images. Without an import: coordinate plane with spawn density.')}</td>
              </tr>
              <tr className="align-top">
                <td className="py-1.5 pr-2">{tr('AH-Preise', 'AH prices')}</td>
                <td className="pr-2"><Badge tone="info">{tr('live, zeitabhängig', 'live, time-dependent')}</Badge></td>
                <td className="pr-2 text-muted">{tr('AHledger-/auctionhouse.fyi-Bedingungen', 'AHledger / auctionhouse.fyi terms')}</td>
                <td className="pr-2 text-faint">{tr('nur Cache bis Cache-Control', 'cache only until Cache-Control')}</td>
                <td className="text-muted">{tr('Getrennte Datenbank (market_cache.db). Abgelaufene Fremdpreise werden gelöscht, nicht archiviert.', 'Separate database (market_cache.db). Expired third-party prices are deleted, not archived.')}</td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <Panel title={tr('Coverage: Spots je Levelband und Farmziel (offene Welt)', 'Coverage: spots per level band and farm goal (open world)')}>
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase text-faint"><tr className="border-b border-line"><th className="py-1">{tr('Levelband', 'Level band')}</th>{OBJ.map((o) => <th key={o} className="text-right">{objName(o)}</th>)}</tr></thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b} className="border-b border-line/50">
                  <td className="py-1 num">{b}</td>
                  {OBJ.map((o) => { const v = get(b, o); return <td key={o} className={`text-right num ${v === 0 ? 'font-semibold text-bad' : v < 3 ? 'text-warn' : 'text-muted'}`}>{v === 0 ? tr('0 – Lücke', '0 – gap') : v}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-faint">{tr('Zählt automatisch gruppierte Spots. „Gold“ basiert auf Classic-Münzloot; Kürschnerei/Stoff-Tags teils auf Classic-Fallback. Keine kuratierten Routen vorhanden.', 'Counts auto-grouped spots. “Gold” is based on Classic coin loot; skinning/cloth tags partly on Classic fallback. No curated routes.')}</p>
        </Panel>

        <Panel title={tr('Preisanbieter – letzter Test', 'Price providers – last test')}>
          {(health.data ?? []).length === 0 ? <p className="text-[12.5px] text-faint">{tr('Noch kein Verbindungstest – Einstellungen → Preisquellen → „Verbindung testen“.', 'No connection test yet – Settings → price sources → “Test connection”.')}</p> : (
            <ul className="space-y-1 text-[12.5px]">
              {health.data!.map((h) => (
                <li key={h.provider}>
                  <span className="font-semibold">{h.provider}</span>: {h.reachable ? <span className="text-ok">{tr('erreichbar', 'reachable')}</span> : h.reachable === false ? <span className="text-bad">{tr('Fehler', 'error')}</span> : <span className="text-faint">{tr('nicht getestet', 'not tested')}</span>}
                  {' '}· {tr('getestet', 'tested')} {h.checkedAt ? dateTime(h.checkedAt) : '–'} · {h.testedEndpoint ?? ''} {h.lastError && <span className="text-bad">· {h.lastError}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={tr('Bekannte Grenzen', 'Known limitations')}>
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-muted">
            <li>{tr('Keine mitgelieferten Blizzard-Kartenbilder (Urheberrecht). Eigene Bilder lassen sich im Weltatlas importieren und ausrichten; sonst Koordinatenfläche mit Spawndichte und echten Markern.', 'No bundled Blizzard map images (copyright). Your own images can be imported and aligned in the world atlas; otherwise a coordinate plane with spawn density and real markers.')}</li>
            <li>{tr('Dropchancen, Kürschnerbarkeit, Münzloot und Händlerpreise stammen aus Classic-Emulator-Daten (cmangos), nicht aus Forever-Messungen.', 'Drop rates, skinnability, coin loot and vendor prices come from Classic emulator data (cmangos), not Forever measurements.')}</li>
            <li>{tr('Weltdrops (Referenz-Loottabellen) sind nicht einzelnen Spots zugeordnet.', 'World drops (reference loot tables) are not assigned to spots.')}</li>
            <li>{tr('Forever-neue NPCs ohne Classic-Eintrag haben unbekannten Typ/Loot.', 'NPCs new in Forever without a Classic entry have unknown type/loot.')}</li>
            <li>{tr('Routen sind Luftlinien-Punktfolgen über Knoten-Spawns (Terrain nicht berücksichtigt); keine handkuratierten Routen.', 'Routes are straight-line point sequences over node spawns (terrain not considered); no hand-curated routes.')}</li>
            <li>{tr('Gold/h und XP/h erscheinen nur nach eigenen gemessenen Sessions.', 'Gold/h and XP/h only appear after your own measured sessions.')}</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
