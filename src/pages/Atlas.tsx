import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { WorldMap, type MapMarker } from '@/components/WorldMap';
import { Badge, Chip, cx, ErrorBox, Spinner } from '@/components/ui';
import { api } from '@/services/tauri';
import { useActiveProfile } from '@/services/hooks';
import { skillOf } from '@/domain/professionRules';
import { useUi } from '@/store/ui';

const CONT: Record<string, string> = { eastern_kingdoms: 'Östliche Königreiche', kalimdor: 'Kalimdor' };
const KIND: Record<string, string> = { zone: 'Zonen', city: 'Städte', dungeon: 'Dungeons', raid: 'Schlachtzüge', battleground: 'Schlachtfelder' };

export function AtlasPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { profile } = useActiveProfile();
  const { layers, toggleLayer, showAllResources, setShowAllResources } = useUi();
  const zones = useQuery({ queryKey: ['zones'], queryFn: api.listZones, staleTime: Infinity });
  const zoneId = Number(params.get('zone')) || 11;
  const layer = useQuery({ queryKey: ['zoneLayer', zoneId], queryFn: () => api.zoneLayer(zoneId) });
  const mining = profile ? skillOf(profile, 'mining') : null;
  const herb = profile ? skillOf(profile, 'herbalism') : null;

  const markers: MapMarker[] = useMemo(() => {
    if (!layer.data) return [];
    const out: MapMarker[] = [];
    for (const n of layer.data.nodes) {
      if (!layers[n.nodeType as 'ore' | 'herb' | 'fishing_pool']) continue;
      const skill = n.nodeType === 'ore' ? mining : n.nodeType === 'herb' ? herb : null;
      const reachable = n.nodeType === 'fishing_pool' || (skill != null && n.requiredSkill != null && skill >= n.requiredSkill);
      if (!reachable && !showAllResources) continue;
      n.points.forEach(([x, y]: [number, number], i: number) =>
        out.push({ key: `n${n.objectId}-${i}`, x, y, kind: n.nodeType, dimmed: !reachable, label: n.nameDe ?? n.nameEn,
          lines: [n.requiredSkill != null ? `Skill ${n.requiredSkill} (Classic-Regel)${!reachable ? ' – fehlt' : ''}` : 'Skill unbekannt', 'Spawn: QuestieDB Forever'] }));
    }
    if (layers.spots) {
      for (const s of layer.data.spots) {
        if (s.kind === 'node_zone' || s.kind === 'fishing_pool') continue;
        out.push({ key: `s${s.id}`, x: s.centerX, y: s.centerY, kind: s.hasElite ? 'elite' : s.hasRare ? 'rare' : 'spot', label: s.titleDe,
          lines: [s.levelMin != null ? `Level ${s.levelMin}–${s.levelMax}` : '', 'Klick: Details öffnen'], onClick: () => nav(`/spots/${encodeURIComponent(s.id)}`) });
      }
    }
    return out;
  }, [layer.data, layers, mining, herb, showAllResources, nav]);

  const grouped = useMemo(() => {
    const g: Record<string, Record<string, any[]>> = {};
    for (const z of zones.data ?? []) {
      ((g[z.continent] ??= {})[z.kind] ??= []).push(z);
    }
    return g;
  }, [zones.data]);
  const z = zones.data?.find((x) => x.id === zoneId);

  return (
    <div className="flex h-full">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-line p-3">
        {zones.isLoading && <Spinner />}
        {Object.entries(grouped).map(([cont, kinds]) => (
          <div key={cont} className="mb-4">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gold">{CONT[cont] ?? cont}</h3>
            {['zone', 'city', 'dungeon', 'raid', 'battleground'].filter((k) => kinds[k]).map((k) => (
              <div key={k} className="mb-2">
                <div className="px-1 text-[10.5px] uppercase text-faint">{KIND[k]}</div>
                {kinds[k].map((zz: any) => (
                  <button key={zz.id} type="button" onClick={() => setParams({ zone: String(zz.id) })}
                    className={cx('flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] cursor-pointer', zz.id === zoneId ? 'bg-gold/12 text-gold-2' : 'text-muted hover:bg-panel-3 hover:text-ink')}>
                    <span className="flex-1 truncate">{zz.nameDe ?? zz.nameEn}</span>
                    {zz.levelMin != null && <span className="num text-[11px] text-faint">{zz.levelMin}–{zz.levelMax}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          <h2 className="mr-2 text-[14px] font-semibold text-ink">{z ? z.nameDe ?? z.nameEn : 'Zone'}</h2>
          {z?.control && <Badge tone={z.control === 'contested' ? 'warn' : 'neutral'} title="Classic-Zonenkontrolle (für PvP-Hinweis)">{({ alliance: 'Allianzgebiet', horde: 'Hordegebiet', contested: 'umkämpft', sanctuary: 'Zuflucht' } as Record<string, string>)[z.control]}</Badge>}
          {z?.levelMin != null && <Badge title="Aus Moblevels abgeleitet (10.–90. Perzentil)">Moblevel ~{z.levelMin}–{z.levelMax}</Badge>}
          <span className="ml-3 text-[11px] uppercase tracking-wider text-faint">Ebenen</span>
          <Chip active={layers.spots} onClick={() => toggleLayer('spots')}>Spots</Chip>
          <Chip active={layers.ore} onClick={() => toggleLayer('ore')}>Erz {mining != null ? `(${mining})` : '(kein Bergbau)'}</Chip>
          <Chip active={layers.herb} onClick={() => toggleLayer('herb')}>Kräuter {herb != null ? `(${herb})` : '(keine Kräuterkunde)'}</Chip>
          <Chip active={layers.fishing_pool} onClick={() => toggleLayer('fishing_pool')}>Fischschwärme</Chip>
          <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-muted cursor-pointer">
            <input type="checkbox" checked={showAllResources} onChange={(e) => setShowAllResources(e.target.checked)} className="accent-[var(--color-gold)]" /> Alle Ressourcen zeigen (auch ohne Skill)
          </label>
        </div>
        {layer.error && <div className="p-4"><ErrorBox error={layer.error} /></div>}
        <WorldMap className="min-h-0 flex-1" zoneName={z ? z.nameDe ?? z.nameEn : ''} uiMapId={z?.uiMapId} markers={markers} />
        <div className="border-t border-line px-4 py-1.5 text-[11.5px] text-faint">
          {markers.length} Marker · Spawnkoordinaten QuestieDB Forever (konvertiert) · Skillgrenzen Classic-Regeln · Flugpunkte/Händler nicht als Ebene vorhanden
        </div>
      </section>
    </div>
  );
}
