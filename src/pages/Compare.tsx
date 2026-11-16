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
import { availabilityInfo, gatherSkillName } from '@/components/SpotCard';
import { nm, title, tr } from '@/i18n';

export function ComparePage() {
  const { compare, toggleCompare, filters } = useUi();
  const { profile } = useActiveProfile();
  const sessions = useQuery({ queryKey: ['sessions', profile?.id], queryFn: () => api.listSessions(profile!.id), enabled: !!profile });
  const details = useQueries({ queries: compare.map((id) => ({ queryKey: ['spot', id], queryFn: () => api.getSpot(id) })) });
  if (compare.length === 0) return <div className="p-6"><Empty>{tr('Im Farmfinder bis zu vier Spots mit dem Vergleichs-Symbol markieren.', 'Mark up to four spots with the compare icon in the farm finder.')}</Empty></div>;
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
      <Panel title={`${tr('Vergleich', 'Compare')} (${rows.length})`}>
        {details.some((d) => d.isLoading) && <Spinner />}
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th />
              {rows.map((d) => (
                <th key={d.spot.id} className="py-2 pr-4 text-left align-top">
                  <div className="flex items-start gap-2">
                    <Link to={`/spots/${encodeURIComponent(d.spot.id)}`} className="text-[13px] font-semibold text-ink hover:underline">{title(d.spot)}</Link>
                    <button type="button" onClick={() => toggleCompare(d.spot.id)} className="text-faint hover:text-ink cursor-pointer" aria-label={tr('Entfernen', 'Remove')}><X className="size-4" /></button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {line('Zone', (d) => nm(d.zone))}
            {line(tr('Moblevel', 'Mob level'), (d) => (d.spot.levelMin != null ? `${d.spot.levelMin}–${d.spot.levelMax}` : `Zone ~${d.zone.levelMin}–${d.zone.levelMax}`))}
            {line(tr('Eignung (fitScore)', 'Fit (fitScore)'), (_d, i) => <span className="num text-gold-2">{scored[i]?.fitScore ?? '—'}</span>)}
            {line(tr('Verfügbarkeit', 'Availability'), (_d, i) => (scored[i] ? availabilityInfo(scored[i]!.availability).label : '—'))}
            {line('Skill', (d) => (d.spot.reqSkill != null ? `${d.spot.reqSkillType ? gatherSkillName(d.spot.reqSkillType) : ''} ${tr('ab', 'from')} ${d.spot.reqSkill}` : '—'))}
            {line(tr('Elite / Instanz', 'Elite / instance'), (d) => `${d.spot.hasElite ? 'Elite' : tr('keine Elites', 'no elites')} · ${d.spot.isInstance ? tr('Instanz', 'instance') : tr('offene Welt', 'open world')}`)}
            {line(tr('PvP-Risiko', 'PvP risk'), (_d, i) => ({ low: tr('gering', 'low'), medium: tr('mittel', 'medium'), high: tr('hoch', 'high'), unknown: tr('unbekannt', 'unknown') })[scored[i]?.pvpRisk ?? 'unknown'])}
            {line('Spawns', (d) => <span className="num">{d.spot.spawnCount}</span>)}
            {line(tr('Hauptdrops', 'Main drops'), (d) => <ul>{topDrops(d).map((l) => <li key={`${l.itemId}${l.context}`}>{nm(l)} <Rate rate={l.rate} /></li>)}</ul>)}
            {line(tr('Händler/Kill (Modell)', 'Vendor/kill (model)'), (d) => (d.spot.modelVendorCopperPerKill != null ? `${formatCopper(d.spot.modelVendorCopperPerKill)} (Classic${d.spot.modelVendorPartial ? tr(', Teilwert', ', partial') : ''})` : '—'))}
            {line(tr('Gemessene Kills/h', 'Measured kills/h'), (d) => {
              const k = measuredKillsPerHour(sessions.data ?? [], d.spot.id);
              return k ? `${Math.round(k.value)} (${k.sessions} Sessions)` : tr('keine Messung', 'not measured');
            })}
            {line(tr('Unsicherheiten', 'Uncertainties'), (_d, i) => <ul className="text-muted">{scored[i]?.missing.map((m, j) => <li key={j}>• {m}</li>)}</ul>)}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
