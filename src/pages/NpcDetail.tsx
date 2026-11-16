import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { WorldMap, type MapMarker } from '@/components/WorldMap';
import { LootTables } from '@/components/LootTable';
import { SourceBadge } from '@/components/data';
import { Badge, Empty, ErrorBox, Panel, Select, Spinner } from '@/components/ui';
import { api } from '@/services/tauri';
import { useQuotes } from '@/services/hooks';
import { formatCopper } from '@/domain/money';
import { useState } from 'react';

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
    .map((s: number[], i: number) => ({ key: String(i), x: s[1], y: s[2], kind: n.rank && [1, 2, 3].includes(n.rank) ? 'elite' : n.rank === 4 ? 'rare' : 'npc', label: n.nameDe ?? n.nameEn, lines: [`Level ${n.levelMin}–${n.levelMax}`] }));
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-5">
        <div>
          <h1 className="font-display text-[20px] font-semibold text-ink">{n.nameDe ?? n.nameEn} {n.subName && <span className="text-[14px] text-muted">‹{n.subName}›</span>}</h1>
          <p className="text-[12.5px] text-faint">{n.nameEn} · NPC-ID <span className="selectable">{n.id}</span></p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>Level {n.levelMin}–{n.levelMax}</Badge>
            <Badge tone={n.rank ? 'bad' : 'neutral'}>{({ normal: 'Normal', elite: 'Elite', rare_elite: 'Rar-Elite', boss: 'Boss', rare: 'Rar' } as Record<string, string>)[n.classification ?? ''] ?? 'Klasse ?'}</Badge>
            <Badge>{n.creatureType ?? 'Typ unbekannt'}</Badge>
            <Badge tone={n.canSkin ? 'ok' : 'neutral'}>{n.canSkin === 1 ? `Kürschnerbar ab ${n.skinMin}` : n.canSkin === 0 ? 'Nicht kürschnerbar' : 'Kürschnerbarkeit unbekannt'}</Badge>
            {n.maxCoin ? <Badge>Münzen {formatCopper(n.minCoin)}–{formatCopper(n.maxCoin)}</Badge> : null}
            {n.friendlyTo && <Badge tone="info">Freundlich zu {n.friendlyTo}</Badge>}
            <SourceBadge source={n.srcCore} />{n.srcCombat && <SourceBadge source={n.srcCombat} />}
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-2">
            {spawnZones.length > 1 && (
              <Select ariaLabel="Zone" value={String(activeZone)} onChange={(v) => setZone(Number(v))} options={spawnZones.map((zid) => {
                const zz = zones.data?.find((x) => x.id === zid);
                return { value: String(zid), label: zz ? zz.nameDe ?? zz.nameEn : `Zone ${zid}` };
              })} />
            )}
            {activeZone == null ? <Empty>Keine belegten Spawnkoordinaten – kein Kartenmarker.</Empty> : (
              <WorldMap className="h-[440px] rounded-lg border border-line" zoneName={z ? z.nameDe ?? z.nameEn : `Zone ${activeZone}`} uiMapId={z?.uiMapId} markers={markers} />
            )}
          </div>
          <Panel title="Spots mit diesem NPC">
            {q.data.spots.length === 0 ? <Empty>In keinem generierten Spot.</Empty> : (
              <ul className="space-y-1 text-[12.5px]">{q.data.spots.map((s: any) => <li key={s.spotId}><Link to={`/spots/${encodeURIComponent(s.spotId)}`} className="text-ink hover:underline">{s.titleDe}</Link></li>)}</ul>
            )}
          </Panel>
        </div>
        <Panel title="Loot (getrennt nach Kontext)">
          <LootTables rows={q.data.loot} quotes={quotes.data ?? []} quotesLoading={quotes.isLoading && quotes.fetchStatus !== 'idle'} quotesError={!!quotes.error} />
        </Panel>
      </div>
    </div>
  );
}
