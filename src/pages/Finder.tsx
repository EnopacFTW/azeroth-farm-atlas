import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleSlash, Info } from 'lucide-react';
import { ProfileBar } from '@/components/ProfileBar';
import { SpotCard } from '@/components/SpotCard';
import { WorldMap, type MapMarker } from '@/components/WorldMap';
import { Empty, ErrorBox, Select, Spinner } from '@/components/ui';
import { rankSpots, type SortKey } from '@/domain/scoring';
import { api } from '@/services/tauri';
import { useActiveProfile } from '@/services/hooks';
import { useUi } from '@/store/ui';

function useSplit(key: string, initial: number) {
  const [w, setW] = useState(() => {
    try { return Number(localStorage.getItem(key)) || initial; } catch { return initial; }
  });
  const drag = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const start = w;
    const move = (ev: MouseEvent) => setW(Math.min(900, Math.max(360, start + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  useEffect(() => { try { localStorage.setItem(key, String(w)); } catch { /* storage unavailable */ } }, [key, w]);
  return { w, drag };
}

export function FinderPage() {
  const { profile, settings } = useActiveProfile();
  const { filters, sort, setSort, selectedSpotId, selectSpot, compare, toggleCompare } = useUi();
  const qc = useQueryClient();
  const level = profile?.level ?? 1;
  const cand = useQuery({
    queryKey: ['candidates', level, filters.noInstances && filters.soloOnly ? 0 : 1],
    queryFn: () => api.searchSpots({ level, above: 8, below: 14, includeInstances: !(filters.noInstances && filters.soloOnly) }),
    placeholderData: (prev) => prev,
  });
  const favs = useQuery({ queryKey: ['favorites', profile?.id], queryFn: () => api.listFavorites(profile!.id), enabled: !!profile });
  const ranked = useMemo(() => (profile && cand.data ? rankSpots(profile, cand.data, { ...filters, showUnavailable: filters.showUnavailable || settings?.showUnavailable || false }, sort) : []), [profile, cand.data, filters, sort, settings?.showUnavailable]);
  const visible = ranked.slice(0, 150);
  const selected = ranked.find((r) => r.spot.id === selectedSpotId) ?? null;
  const { w, drag } = useSplit('finder.split', 520);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected && visible[0]) selectSpot(visible[0].spot.id);
  }, [visible[0]?.spot.id]);

  const detail = useQuery({ queryKey: ['spot', selected?.spot.id], queryFn: () => api.getSpot(selected!.spot.id), enabled: !!selected });
  const markers: MapMarker[] = useMemo(() => {
    if (!detail.data) return [];
    const npcName = new Map(detail.data.npcs.map((n) => [n.id, n]));
    const objName = new Map(detail.data.objects.map((o) => [o.id, o]));
    return detail.data.points.map(([t, id, x, y], i) => {
      if (t === 'npc') {
        const n = npcName.get(id)!;
        return { key: `${i}`, x, y, kind: n.rank && [1, 2, 3].includes(n.rank) ? 'elite' : n.rank === 4 ? 'rare' : 'npc', label: n.nameDe ?? n.nameEn,
          lines: [`Level ${n.levelMin}–${n.levelMax} · NPC ${id}`, n.canSkin === 1 ? `Kürschnern ab ${n.skinMin} (Classic-Formel)` : n.canSkin === 0 ? 'nicht kürschnerbar (Classic)' : 'Kürschnerbarkeit unbekannt', 'Quelle: QuestieDB Forever'] } satisfies MapMarker;
      }
      const o = objName.get(id)!;
      return { key: `${i}`, x, y, kind: o.nodeType, label: o.nameDe ?? o.nameEn, lines: [o.requiredSkill != null ? `Skill ${o.requiredSkill} (Classic-Regel)` : 'Skill unbekannt', 'Quelle: QuestieDB Forever'] } satisfies MapMarker;
    });
  }, [detail.data]);

  if (!profile) return null;
  const toggleFav = async (id: string) => {
    await api.toggleFavorite(profile.id, id);
    qc.invalidateQueries({ queryKey: ['favorites', profile.id] });
  };

  return (
    <div className="flex h-full flex-col">
      <ProfileBar />
      <div className="flex min-h-0 flex-1">
        <section style={{ width: w }} className="flex shrink-0 flex-col border-r border-line">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12.5px]">
            <span className="font-semibold text-ink num">{ranked.length}</span>
            <span className="text-muted">passende Spots</span>
            {ranked.length > visible.length && <span className="text-faint">(zeige {visible.length})</span>}
            {cand.isFetching && <Spinner label="" />}
            <div className="ml-auto">
              <Select<SortKey> ariaLabel="Sortieren" value={sort} onChange={setSort} className="h-7"
                options={[{ value: 'fit', label: 'Sortieren: Eignung' }, { value: 'level', label: 'Moblevel' }, { value: 'density', label: 'Spawndichte' }, { value: 'vendor', label: 'Händlerwert/Kill (Modell)' }]} />
            </div>
          </div>
          <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {cand.error && <ErrorBox error={cand.error} />}
            {cand.isLoading && <Spinner />}
            {!cand.isLoading && ranked.length === 0 && (
              <Empty>Keine Spots für diese Kombination. Prüfe Farmziel, Berufe/Skill oder aktiviere „Noch nicht farmbar anzeigen“.</Empty>
            )}
            {visible.map((s) => (
              <SpotCard key={s.spot.id} s={s} active={s.spot.id === selected?.spot.id} favorite={!!favs.data?.includes(s.spot.id)} inCompare={compare.includes(s.spot.id)}
                onSelect={() => selectSpot(s.spot.id)} onFavorite={() => toggleFav(s.spot.id)} onCompare={() => toggleCompare(s.spot.id)} />
            ))}
          </div>
        </section>
        <div onMouseDown={drag} className="w-1 shrink-0 cursor-col-resize bg-line/40 hover:bg-gold/40" role="separator" aria-label="Breite anpassen" />
        <section className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <WorldMap className="min-h-[320px] flex-[3]" zoneName={selected.spot.zone.nameDe ?? selected.spot.zone.nameEn} uiMapId={selected.spot.zone.uiMapId} markers={markers}
                hull={detail.data?.spot.hull} route={detail.data?.spot.route}
                focus={selected.spot.centerX != null ? { x: selected.spot.centerX, y: selected.spot.centerY!, r: selected.spot.radius ?? 6 } : null} />
              <div className="flex-[2] overflow-y-auto border-t border-line p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold text-ink">{selected.spot.titleDe}</h2>
                    <p className="text-[12px] text-faint">{selected.spot.titleEn}</p>
                  </div>
                  <Link to={`/spots/${encodeURIComponent(selected.spot.id)}`} className="ml-auto shrink-0 rounded-md border border-line bg-panel-3 px-3 py-1 text-[12.5px] text-gold hover:bg-line-2">Alle Details & AH-Preise →</Link>
                </div>
                <div className="mt-3 grid gap-4 md:grid-cols-3">
                  <Reasons title="Warum empfohlen?" icon={<CheckCircle2 className="size-4 text-ok" />} items={selected.why} empty="—" />
                  <Reasons title="Warum nicht?" icon={<CircleSlash className="size-4 text-warn" />} items={selected.whyNot} empty="Keine Einschränkungen gefunden." />
                  <Reasons title="Welche Daten fehlen?" icon={<Info className="size-4 text-info" />} items={selected.missing} empty="—" />
                </div>
                <div className="mt-3 text-[11.5px] text-faint">
                  Eignung {selected.fitScore}/100 aus: {selected.factors.map((f) => `${f.label} ${Math.round(f.value * 100)} % (Gewicht ${Math.round(f.weight)})`).join(' · ')}
                </div>
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-[13px] text-faint">Spot auswählen, um ihn auf der Karte zu sehen.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function Reasons({ title, icon, items, empty }: { title: string; icon: React.ReactNode; items: string[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">{icon}{title}</h3>
      {items.length ? (
        <ul className="space-y-1 text-[12.5px] leading-snug text-muted">{items.map((t, i) => <li key={i}>• {t}</li>)}</ul>
      ) : (
        <p className="text-[12.5px] text-faint">{empty}</p>
      )}
    </div>
  );
}
