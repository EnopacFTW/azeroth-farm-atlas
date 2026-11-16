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
import { nm, title, titleAlt, tr } from '@/i18n';

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
        return { key: `${i}`, x, y, kind: n.rank && [1, 2, 3].includes(n.rank) ? 'elite' : n.rank === 4 ? 'rare' : 'npc', label: nm(n),
          lines: [`Level ${n.levelMin}–${n.levelMax} · NPC ${id}`, n.canSkin === 1 ? tr(`Kürschnern ab ${n.skinMin} (Classic-Formel)`, `Skinning from ${n.skinMin} (Classic formula)`) : n.canSkin === 0 ? tr('nicht kürschnerbar (Classic)', 'not skinnable (Classic)') : tr('Kürschnerbarkeit unbekannt', 'Skinnability unknown'), tr('Quelle: QuestieDB Forever', 'Source: QuestieDB Forever')] } satisfies MapMarker;
      }
      const o = objName.get(id)!;
      return { key: `${i}`, x, y, kind: o.nodeType, label: nm(o), lines: [o.requiredSkill != null ? `Skill ${o.requiredSkill} ${tr('(Classic-Regel)', '(Classic rule)')}` : tr('Skill unbekannt', 'Skill unknown'), tr('Quelle: QuestieDB Forever', 'Source: QuestieDB Forever')] } satisfies MapMarker;
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
            <span className="text-muted">{tr('passende Spots', 'matching spots')}</span>
            {ranked.length > visible.length && <span className="text-faint">({tr('zeige', 'showing')} {visible.length})</span>}
            {cand.isFetching && <Spinner label="" />}
            <div className="ml-auto">
              <Select<SortKey> ariaLabel={tr('Sortieren', 'Sort')} value={sort} onChange={setSort} className="h-7"
                options={[{ value: 'fit', label: tr('Sortieren: Eignung', 'Sort: fit') }, { value: 'level', label: tr('Moblevel', 'Mob level') }, { value: 'density', label: tr('Spawndichte', 'Spawn density') }, { value: 'vendor', label: tr('Händlerwert/Kill (Modell)', 'Vendor value/kill (model)') }, { value: 'xp', label: tr('XP/Kill', 'XP/kill') }]} />
            </div>
          </div>
          <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {cand.error && <ErrorBox error={cand.error} />}
            {cand.isLoading && <Spinner />}
            {!cand.isLoading && ranked.length === 0 && (
              <Empty>{tr('Keine Spots für diese Kombination. Prüfe Farmziel, Berufe/Skill oder aktiviere „Noch nicht farmbar anzeigen“.', 'No spots for this combination. Check farm goal, professions/skill or enable “Show not-yet-farmable”.')}</Empty>
            )}
            {visible.map((s) => (
              <SpotCard key={s.spot.id} s={s} active={s.spot.id === selected?.spot.id} favorite={!!favs.data?.includes(s.spot.id)} inCompare={compare.includes(s.spot.id)}
                onSelect={() => selectSpot(s.spot.id)} onFavorite={() => toggleFav(s.spot.id)} onCompare={() => toggleCompare(s.spot.id)} />
            ))}
          </div>
        </section>
        <div onMouseDown={drag} className="w-1 shrink-0 cursor-col-resize bg-line/40 hover:bg-gold/40" role="separator" aria-label={tr('Breite anpassen', 'Resize')} />
        <section className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <WorldMap className="min-h-[320px] flex-[3]" zoneId={selected.spot.zoneId} zoneName={nm(selected.spot.zone)} uiMapId={selected.spot.zone.uiMapId} markers={markers}
                hull={detail.data?.spot.hull} route={detail.data?.spot.route}
                focus={selected.spot.centerX != null ? { x: selected.spot.centerX, y: selected.spot.centerY!, r: selected.spot.radius ?? 6 } : null} />
              <div className="flex-[2] overflow-y-auto border-t border-line p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold text-ink">{title(selected.spot)}</h2>
                    <p className="text-[12px] text-faint">{titleAlt(selected.spot)}</p>
                  </div>
                  <Link to={`/spots/${encodeURIComponent(selected.spot.id)}`} className="ml-auto shrink-0 rounded-md border border-line bg-panel-3 px-3 py-1 text-[12.5px] text-gold hover:bg-line-2">{tr('Alle Details & AH-Preise →', 'All details & AH prices →')}</Link>
                </div>
                <div className="mt-3 grid gap-4 md:grid-cols-3">
                  <Reasons title={tr('Warum empfohlen?', 'Why recommended?')} icon={<CheckCircle2 className="size-4 text-ok" />} items={selected.why} empty="—" />
                  <Reasons title={tr('Warum nicht?', 'Why not?')} icon={<CircleSlash className="size-4 text-warn" />} items={selected.whyNot} empty={tr('Keine Einschränkungen gefunden.', 'No restrictions found.')} />
                  <Reasons title={tr('Welche Daten fehlen?', 'What data is missing?')} icon={<Info className="size-4 text-info" />} items={selected.missing} empty="—" />
                </div>
                <div className="mt-3 text-[11.5px] text-faint">
                  {tr('Eignung', 'Fit')} {selected.fitScore}/100 {tr('aus', 'from')}: {selected.factors.map((f) => `${f.label} ${Math.round(f.value * 100)} % (${tr('Gewicht', 'weight')} ${Math.round(f.weight)})`).join(' · ')}
                </div>
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-[13px] text-faint">{tr('Spot auswählen, um ihn auf der Karte zu sehen.', 'Select a spot to see it on the map.')}</div>
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
