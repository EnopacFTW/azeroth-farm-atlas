import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Empty, Panel, Spinner } from '@/components/ui';
import { Rate } from '@/components/data';
import { api } from '@/services/tauri';
import { useActiveProfile } from '@/services/hooks';
import { useUi } from '@/store/ui';
import { scoreSpot } from '@/domain/scoring';
import { formatCopper } from '@/domain/money';
import { measuredKillsPerHour } from '@/domain/sessionMath';
import type { SpotCandidate, SpotDetail } from '@/domain/types';

export function ComparePage() {
  const { compare, toggleCompare, filters } = useUi();
  const { profile } = useActiveProfile();
  const sessions = useQuery({ queryKey: ['sessions', profile?.id], queryFn: () => api.listSessions(profile!.id), enabled: !!profile });
  const details = useQueries({ queries: compare.map((id) => ({ queryKey: ['spot', id], queryFn: () => api.getSpot(id) })) });
  if (compare.length === 0) return <div className="p-6"><Empty>Im Farmfinder bis zu vier Spots mit dem Vergleichs-Symbol markieren.</Empty></div>;
  const rows = details.map((d) => d.data).filter(Boolean) as SpotDetail[];
  const scored = rows.map((d) => (profile ? scoreSpot(profile, { ...d.spot, zone: d.zone, npcs: d.npcs, objects: d.objects, items: [] } as SpotCandidate, filters) : null));
  const topDrops = (d: SpotDetail) => {
    const all = [...d.npcs.flatMap((n) => n.loot), ...d.objects.flatMap((o) => o.loot), ...d.zoneLoot].filter((l) => l.rate != null && l.context !== 'quest');
    const best = new Map<string, (typeof all)[number]>();
    for (const l of all) { const k = `${l.itemId}|${l.context}`; if (!best.has(k) || (best.get(k)!.rate ?? 0) < (l.rate ?? 0)) best.set(k, l); }
    return [...best.values()].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)).slice(0, 5);
  };
  const line = (label: string, f: (d: SpotDetail, i: number) => React.ReactNode) => (
    <tr className="border-b border-line/60 align-top">
      <th className="w-44 py-2 pr-3 text-left text-[12px] font-medium text-faint">{label}</th>
      {rows.map((d, i) => <td key={d.spot.id} className="py-2 pr-4 text-[12.5px]">{f(d, i)}</td>)}
    </tr>
  );
  return (
    <div className="h-full overflow-auto p-5">
      <Panel title={`Vergleich (${rows.length})`}>
        {details.some((d) => d.isLoading) && <Spinner />}
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th />
              {rows.map((d) => (
                <th key={d.spot.id} className="py-2 pr-4 text-left align-top">
                  <div className="flex items-start gap-2">
                    <Link to={`/spots/${encodeURIComponent(d.spot.id)}`} className="text-[13px] font-semibold text-ink hover:underline">{d.spot.titleDe}</Link>
                    <button type="button" onClick={() => toggleCompare(d.spot.id)} className="text-faint hover:text-ink cursor-pointer" aria-label="Entfernen"><X className="size-4" /></button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {line('Zone', (d) => d.zone.nameDe ?? d.zone.nameEn)}
            {line('Moblevel', (d) => (d.spot.levelMin != null ? `${d.spot.levelMin}–${d.spot.levelMax}` : `Zone ~${d.zone.levelMin}–${d.zone.levelMax}`))}
            {line('Eignung (fitScore)', (_d, i) => <span className="num text-gold-2">{scored[i]?.fitScore ?? '—'}</span>)}
            {line('Verfügbarkeit', (_d, i) => scored[i]?.availability ?? '—')}
            {line('Skill', (d) => (d.spot.reqSkill != null ? `${d.spot.reqSkillType} ab ${d.spot.reqSkill}` : '—'))}
            {line('Elite / Instanz', (d) => `${d.spot.hasElite ? 'Elite' : 'keine Elites'} · ${d.spot.isInstance ? 'Instanz' : 'offene Welt'}`)}
            {line('PvP-Risiko', (_d, i) => ({ low: 'gering', medium: 'mittel', high: 'hoch', unknown: 'unbekannt' } as const)[scored[i]?.pvpRisk ?? 'unknown'])}
            {line('Spawns', (d) => <span className="num">{d.spot.spawnCount}</span>)}
            {line('Hauptdrops', (d) => <ul>{topDrops(d).map((l) => <li key={`${l.itemId}${l.context}`}>{l.nameDe ?? l.nameEn} <Rate rate={l.rate} /></li>)}</ul>)}
            {line('Händler/Kill (Modell)', (d) => (d.spot.modelVendorCopperPerKill != null ? `${formatCopper(d.spot.modelVendorCopperPerKill)} (Classic${d.spot.modelVendorPartial ? ', Teilwert' : ''})` : '—'))}
            {line('Gemessene Kills/h', (d) => {
              const k = measuredKillsPerHour(sessions.data ?? [], d.spot.id);
              return k ? `${Math.round(k.value)} (${k.sessions} Sessions)` : 'keine Messung';
            })}
            {line('Unsicherheiten', (_d, i) => <ul className="text-muted">{scored[i]?.missing.map((m, j) => <li key={j}>• {m}</li>)}</ul>)}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
