import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Badge, ErrorBox, Panel, Spinner } from '@/components/ui';
import { SourceBadge } from '@/components/data';
import { api, openExternal } from '@/services/tauri';

const OBJ = ['xp', 'gold', 'cloth', 'skinning', 'mining', 'herbalism', 'fishing', 'rare'];
const OBJ_DE: Record<string, string> = { xp: 'XP', gold: 'Gold', cloth: 'Stoff', skinning: 'Kürschnerei', mining: 'Bergbau', herbalism: 'Kräuter', fishing: 'Angeln', rare: 'Rares' };

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
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1300px] space-y-4 p-5">
        <h1 className="font-display text-[20px] font-semibold">Datenquellen & Datenqualität</h1>
        <Panel title="Datenbestand (lokale Seed-Datenbank)">
          <div className="grid grid-cols-2 gap-2 text-[12.5px] md:grid-cols-4 lg:grid-cols-6">
            {[
              ['Zonen', c.zones], ['NPCs', c.npcs], ['NPC-Spawnpunkte', c.npcSpawns], ['Items', c.items], ['Knoten-Typen', c.objects], ['Knoten-Spawns', c.objectSpawns],
              ['Loot-Beziehungen', c.loot], ['davon mit Rate', c.lootWithRate], ['Farmspots', c.spots], ['automatisch gruppiert', c.generatedSpots], ['kuratierte Routen', c.curatedRoutes],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded border border-line bg-panel-2 px-3 py-2"><div className="text-[11px] text-faint">{k}</div><div className="num text-[16px] font-semibold">{Number(v).toLocaleString('de-DE')}</div></div>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-faint">
            Build {info.data?.manifest?.builtAt ?? '–'} · Seed-SHA-256 <span className="selectable font-mono">{info.data?.manifest?.seedSha256?.slice(0, 16)}…</span> · Datenordner <span className="selectable font-mono">{info.data?.dataDir}</span>
          </p>
          <p className="mt-1 text-[12px] text-warn">Datenpriorität: forever_live_verified &gt; forever_client_data &gt; forever_player_observed &gt; classic_fallback &gt; manual_unverified. Es gibt derzeit keine live verifizierten oder spielerbeobachteten Forever-Daten in der Seed-DB.</p>
        </Panel>

        <Panel title="Quellen">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase text-faint"><tr className="border-b border-line"><th className="py-1">Quelle</th><th>Status</th><th>Lizenz</th><th>Version / Stand</th><th>Inhalt</th></tr></thead>
            <tbody>
              {sources.data!.map((s) => (
                <tr key={s.id} className="border-b border-line/50 align-top">
                  <td className="py-1.5 pr-2">
                    {s.url?.startsWith('https://') ? <button type="button" onClick={() => openExternal(s.url)} className="inline-flex items-center gap-1 text-gold hover:underline cursor-pointer">{s.name} <ExternalLink className="size-3" /></button> : s.name}
                  </td>
                  <td className="pr-2"><SourceBadge source={s.id} /> <span className="text-faint">{s.reliability}</span></td>
                  <td className="pr-2 text-muted">{s.license}</td>
                  <td className="max-w-56 break-all pr-2 font-mono text-[11px] text-faint">{s.version}</td>
                  <td className="text-muted">{s.notes}</td>
                </tr>
              ))}
              <tr className="align-top">
                <td className="py-1.5 pr-2">AH-Preise</td>
                <td className="pr-2"><Badge tone="info">live, zeitabhängig</Badge></td>
                <td className="pr-2 text-muted">AHledger-/auctionhouse.fyi-Bedingungen</td>
                <td className="pr-2 text-faint">nur Cache bis Cache-Control</td>
                <td className="text-muted">Getrennte Datenbank (market_cache.db). Abgelaufene Fremdpreise werden gelöscht, nicht archiviert.</td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <Panel title="Coverage: Spots je Levelband und Farmziel (offene Welt)">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase text-faint"><tr className="border-b border-line"><th className="py-1">Levelband</th>{OBJ.map((o) => <th key={o} className="text-right">{OBJ_DE[o]}</th>)}</tr></thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b} className="border-b border-line/50">
                  <td className="py-1 num">{b}</td>
                  {OBJ.map((o) => { const v = get(b, o); return <td key={o} className={`text-right num ${v === 0 ? 'font-semibold text-bad' : v < 3 ? 'text-warn' : 'text-muted'}`}>{v === 0 ? '0 – Lücke' : v}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-faint">Zählt automatisch gruppierte Spots. „Gold“ basiert auf Classic-Münzloot; Kürschnerei/Stoff-Tags teils auf Classic-Fallback. Keine kuratierten Routen vorhanden.</p>
        </Panel>

        <Panel title="Preisanbieter – letzter Test">
          {(health.data ?? []).length === 0 ? <p className="text-[12.5px] text-faint">Noch kein Verbindungstest – Einstellungen → Preisquellen → „Verbindung testen“.</p> : (
            <ul className="space-y-1 text-[12.5px]">
              {health.data!.map((h) => (
                <li key={h.provider}>
                  <span className="font-semibold">{h.provider}</span>: {h.reachable ? <span className="text-ok">erreichbar</span> : h.reachable === false ? <span className="text-bad">Fehler</span> : <span className="text-faint">nicht getestet</span>}
                  {' '}· getestet {h.checkedAt ? new Date(h.checkedAt).toLocaleString('de-DE') : '–'} · {h.testedEndpoint ?? ''} {h.lastError && <span className="text-bad">· {h.lastError}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Bekannte Grenzen">
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-muted">
            <li>Keine Blizzard-Kartenbilder (Urheberrecht) – Karten sind beschriftete 0–100-%-Koordinatenflächen mit echten Spawnmarkern.</li>
            <li>Dropchancen, Kürschnerbarkeit, Münzloot und Händlerpreise stammen aus Classic-Emulator-Daten (cmangos), nicht aus Forever-Messungen.</li>
            <li>Weltdrops (Referenz-Loottabellen) sind nicht einzelnen Spots zugeordnet.</li>
            <li>Forever-neue NPCs ohne Classic-Eintrag haben unbekannten Typ/Loot.</li>
            <li>Routen sind Luftlinien-Punktfolgen über Knoten-Spawns (Terrain nicht berücksichtigt); keine handkuratierten Routen.</li>
            <li>Gold/h und XP/h erscheinen nur nach eigenen gemessenen Sessions.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
