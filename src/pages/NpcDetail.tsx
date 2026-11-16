import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { WorldMap, type MapMarker } from '@/components/WorldMap';
import { LootTables } from '@/components/LootTable';
import { SourceBadge } from '@/components/data';
import { Badge, Empty, ErrorBox, Panel, Select, Spinner } from '@/components/ui';
import { api } from '@/services/tauri';
import { useQuotes } from '@/services/hooks';
import { formatCopper } from '@/domain/money';
import { nm, nmAlt, title, tr } from '@/i18n';

export const classificationLabel = (c: string | null | undefined) =>
  ({ normal: 'Normal', elite: 'Elite', rare_elite: tr('Rar-Elite', 'Rare elite'), boss: 'Boss', rare: tr('Rar', 'Rare') } as Record<string, string>)[c ?? ''];

export function NpcDetailPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ['npc', id], queryFn: () => api.getNpc(id), enabled: Number.isFinite(id) });
  const zones = useQuery({ queryKey: ['zones'], queryFn: api.listZones, staleTime: Infinity });
  const spawnZones = useMemo(() => [...new Set<number>((q.data?.spawns ?? []).map((s: number[]) => s[0]))], [q.data]);
  const [zone, setZone] = useState<number | null>(null);
  const activeZone = zone ?? spawnZones[0] ?? null;
  const itemIds = useMemo(() => [...new Set<number>((q.data?.loot ?? []).filter((l: any) => l.rate == null || l.rate > 0.005).map((l: any) => l.itemId))], [q.data]);
  const quotes = useQuotes(itemIds);
  if (q.isLoading) return <div className="p-6"><Spinner /></div>;
  if (q.error) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const n = q.data.npc;
  const z = zones.data?.find((x) => x.id === activeZone);
  const markers: MapMarker[] = q.data.spawns
    .filter((s: number[]) => s[0] === activeZone)
    .map((s: number[], i: number) => ({ key: String(i), x: s[1], y: s[2], kind: n.rank && [1, 2, 3].includes(n.rank) ? 'elite' : n.rank === 4 ? 'rare' : 'npc', label: nm(n), lines: [`Level ${n.levelMin}–${n.levelMax}`] }));
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-5">
        <div>
          <h1 className="font-display text-[20px] font-semibold text-ink">{nm(n)} {n.subName && <span className="text-[14px] text-muted">‹{n.subName}›</span>}</h1>
          <p className="text-[12.5px] text-faint">{nmAlt(n) ? `${nmAlt(n)} · ` : ''}NPC-ID <span className="selectable">{n.id}</span></p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>Level {n.levelMin}–{n.levelMax}</Badge>
            <Badge tone={n.rank ? 'bad' : 'neutral'}>{classificationLabel(n.classification) ?? tr('Klasse ?', 'Class ?')}</Badge>
            <Badge>{n.creatureType ?? tr('Typ unbekannt', 'Type unknown')}</Badge>
            <Badge tone={n.canSkin ? 'ok' : 'neutral'}>{n.canSkin === 1 ? tr(`Kürschnerbar ab ${n.skinMin}`, `Skinnable from ${n.skinMin}`) : n.canSkin === 0 ? tr('Nicht kürschnerbar', 'Not skinnable') : tr('Kürschnerbarkeit unbekannt', 'Skinnability unknown')}</Badge>
            {n.maxCoin ? <Badge>{tr('Münzen', 'Coins')} {formatCopper(n.minCoin)}–{formatCopper(n.maxCoin)}</Badge> : null}
            {n.friendlyTo && <Badge tone="info">{tr('Freundlich zu', 'Friendly to')} {n.friendlyTo}</Badge>}
            <SourceBadge source={n.srcCore} />{n.srcCombat && <SourceBadge source={n.srcCombat} />}
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-2">
            {spawnZones.length > 1 && (
              <Select ariaLabel="Zone" value={String(activeZone)} onChange={(v) => setZone(Number(v))} options={spawnZones.map((zid) => {
                const zz = zones.data?.find((x) => x.id === zid);
                return { value: String(zid), label: zz ? nm(zz) : `Zone ${zid}` };
              })} />
            )}
            {activeZone == null ? <Empty>{tr('Keine belegten Spawnkoordinaten – kein Kartenmarker.', 'No documented spawn coordinates – no map marker.')}</Empty> : (
              <WorldMap className="h-[440px] rounded-lg border border-line" zoneId={activeZone} zoneName={z ? nm(z) : `Zone ${activeZone}`} uiMapId={z?.uiMapId} markers={markers} />
            )}
          </div>
          <Panel title={tr('Spots mit diesem NPC', 'Spots with this NPC')}>
            {q.data.spots.length === 0 ? <Empty>{tr('In keinem generierten Spot.', 'Not in any generated spot.')}</Empty> : (
              <ul className="space-y-1 text-[12.5px]">{q.data.spots.map((s: any) => <li key={s.spotId}><Link to={`/spots/${encodeURIComponent(s.spotId)}`} className="text-ink hover:underline">{title(s)}</Link></li>)}</ul>
            )}
          </Panel>
        </div>
        <Panel title={tr('Loot (getrennt nach Kontext)', 'Loot (split by context)')}>
          <LootTables rows={q.data.loot} quotes={quotes.data ?? []} quotesLoading={quotes.isLoading && quotes.fetchStatus !== 'idle'} quotesError={!!quotes.error} />
        </Panel>
      </div>
    </div>
  );
}
