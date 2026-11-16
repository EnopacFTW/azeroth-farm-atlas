import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { Attribution, ContextLabel, NpcName, PriceCell, providerName, Rate, SourceBadge } from '@/components/data';
import { Badge, Button, Empty, ErrorBox, Panel, Spinner } from '@/components/ui';
import { PriceChart } from '@/components/PriceChart';
import { api } from '@/services/tauri';
import { useActiveProfile, useMarketSelection } from '@/services/hooks';
import { formatCopper } from '@/domain/money';
import type { LootContext } from '@/domain/types';

const KIND: Record<string, string> = { mob_cluster: 'Mob-Cluster', mob_scattered: 'Verstreut', rare_mob: 'Rare', node_zone: 'Vorkommen', fishing_pool: 'Schwärme', fishing_zone: 'Gewässer' };

export function ItemDetailPage() {
  const id = Number(useParams().id);
  const { profile } = useActiveProfile();
  const market = useMarketSelection();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['item', id], queryFn: () => api.getItem(id), enabled: Number.isFinite(id) });
  const price = useQuery({
    queryKey: ['quoteDetail', market.provider, market.marketId, id],
    queryFn: () => api.fetchQuoteDetail(market.provider, market.marketId!, id, '7d'),
    enabled: !!market.marketId,
    retry: false,
  });
  const watch = useQuery({ queryKey: ['watchlist', profile?.id], queryFn: () => api.listWatchlist(profile!.id), enabled: !!profile });
  const zones = useQuery({ queryKey: ['zones'], queryFn: api.listZones, staleTime: Infinity });
  const zoneName = (zid: number | null) => {
    const z = zones.data?.find((x) => x.id === zid);
    return z ? z.nameDe ?? z.nameEn : zid ? `Zone ${zid}` : '–';
  };
  if (q.isLoading) return <div className="p-6"><Spinner /></div>;
  if (q.error) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const d = q.data;
  const it = d.item;
  const watching = watch.data?.includes(id);
  // Classic rows carry the rate; Forever rows confirm the relation
  const npc = new Map<string, any>();
  for (const s of d.npcSources) {
    const k = `${s.npcId}|${s.context}`;
    const prev = npc.get(k);
    if (!prev) npc.set(k, { ...s, forever: s.sourceId === 'questiedb_forever', classic: s.sourceId !== 'questiedb_forever' });
    else {
      if (s.sourceId === 'questiedb_forever') prev.forever = true;
      else Object.assign(prev, { ...s, forever: prev.forever, classic: true });
    }
  }
  const npcRows = [...npc.values()].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1300px] space-y-4 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className={`font-display text-[20px] font-semibold ${['text-q0', 'text-q1', 'text-q2', 'text-q3', 'text-q4', 'text-q5'][it.quality ?? 1]}`}>{it.nameDe ?? it.nameEn}</h1>
            <p className="text-[12.5px] text-faint">{it.nameEn} · Item-ID <span className="selectable">{it.id}</span></p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {it.itemLevel != null && <Badge>Itemlevel {it.itemLevel}</Badge>}
              {it.requiredLevel ? <Badge>Benötigt Level {it.requiredLevel}</Badge> : null}
              <Badge title="Classic-Händlerpreis (cmangos)">Händler: {formatCopper(it.vendorSell)}</Badge>
              {it.stackSize ? <Badge>Stapel {it.stackSize}</Badge> : null}
              <SourceBadge source={it.srcCore} />
              {it.srcEcon && <SourceBadge source={it.srcEcon} />}
              {!it.inForever && <Badge tone="warn">Nicht in QuestieDB Forever – nur Classic-Eintrag</Badge>}
            </div>
          </div>
          {profile && (
            <Button onClick={async () => { await api.toggleWatch(profile.id, id); qc.invalidateQueries({ queryKey: ['watchlist', profile.id] }); }}>
              <Eye className="size-4" /> {watching ? 'Von Watchlist entfernen' : 'Auf Watchlist'}
            </Button>
          )}
        </div>

        <Panel title="Auktionshaus" actions={market.marketId && <span className="text-[11.5px] text-faint">{providerName(market.provider)} · {market.marketId}</span>}>
          {!market.marketId && <Empty>Kein Markt gewählt – Einstellungen → Preisquellen.</Empty>}
          {price.isLoading && <Spinner label="Preis wird beim Anbieter abgefragt…" />}
          {price.error && <ErrorBox title="Preis nicht abrufbar" error={price.error} />}
          {price.data && !price.data.quote && <Empty>Der Anbieter kennt dieses Item auf diesem Markt nicht (404). Kein Preis wird angenommen.</Empty>}
          {price.data?.quote && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-4 text-[13px]">
                <PriceCell quote={price.data.quote} />
                <span className="text-muted">Min-Sofortkauf <span className="num text-ink">{formatCopper(price.data.quote.minBuyoutCopper)}</span></span>
                <span className="text-muted">Median <span className="num text-ink">{formatCopper(price.data.quote.medianCopper)}</span></span>
                <span className="text-muted">7T-Median <span className="num text-ink">{formatCopper(price.data.quote.median7dCopper)}</span></span>
                <span className="text-muted">30T-Median <span className="num text-ink">{formatCopper(price.data.quote.median30dCopper)}</span></span>
                <span className="text-muted">Gelistet <span className="num text-ink">{price.data.quote.quantityListed?.toLocaleString('de-DE') ?? '—'}</span></span>
                <span className="text-muted" title="Schätzung des Anbieters, kein garantierter Absatz">Absatz/Tag ≈ <span className="num text-ink">{price.data.quote.estimatedUnitsSoldPerDay?.toLocaleString('de-DE', { maximumFractionDigits: 0 }) ?? '—'}</span></span>
              </div>
              <div className="text-[11.5px] text-faint">
                Scan: {price.data.quote.observedAt ? new Date(price.data.quote.observedAt).toLocaleString('de-DE') : 'unbekannt'} · Abruf: {new Date(price.data.quote.fetchedAt).toLocaleString('de-DE')}
                {price.data.quote.dataSourceNote ? ` · ${price.data.quote.dataSourceNote}` : ''} · <Attribution quote={price.data.quote} />
              </div>
              {price.data.series && price.data.series.points.length > 1 && <PriceChart series={price.data.series} />}
            </div>
          )}
        </Panel>

        <Panel title={`Bezugsquellen – NPC-Drops & Kürschnern (${npcRows.length})`} bodyClass="p-0">
          {npcRows.length === 0 ? <div className="p-4"><Empty>Keine belegten NPC-Quellen.</Empty></div> : (
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-[11px] uppercase tracking-wide text-faint">
                <tr className="border-b border-line">{['Quelle', 'NPC', 'Level', 'Zone', 'Chance', 'Spawns', 'Belege'].map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {npcRows.slice(0, 120).map((s) => (
                  <tr key={`${s.npcId}-${s.context}`} className="border-b border-line/50">
                    <td className="px-3 py-1"><ContextLabel ctx={s.context as LootContext} /></td>
                    <td className="px-3 py-1"><NpcName id={s.npcId} nameDe={s.nameDe} nameEn={s.nameEn} />{s.rank ? <span className="ml-1 text-[11px] text-bad">{s.rank === 4 ? 'rar' : 'elite'}</span> : null}</td>
                    <td className="px-3 py-1 num">{s.levelMin}–{s.levelMax}</td>
                    <td className="px-3 py-1 text-muted">{zoneName(s.zoneId)}</td>
                    <td className="px-3 py-1"><Rate rate={s.rate} /></td>
                    <td className="px-3 py-1 num text-muted">{s.spawns || <span className="text-faint" title="Keine Koordinaten – kein Kartenmarker">ohne Marker</span>}</td>
                    <td className="px-3 py-1"><span className="inline-flex gap-1">{s.forever && <SourceBadge source="questiedb_forever" />}{s.classic && <SourceBadge source="cmangos_classic" />}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Knoten & Angeln">
            {d.objectSources.length + d.zoneSources.length === 0 ? <Empty>Keine Knoten-/Angelquellen.</Empty> : (
              <ul className="space-y-1 text-[12.5px]">
                {d.objectSources.map((o: any) => <li key={`o${o.objectId}`}><ContextLabel ctx={o.context} /> · {o.nameDe ?? o.nameEn} {o.requiredSkill != null && <span className="text-faint">(Skill {o.requiredSkill})</span>} · <Rate rate={o.rate} /> <SourceBadge source={o.sourceId} /></li>)}
                {d.zoneSources.map((z: any) => <li key={`z${z.zoneId}`}><ContextLabel ctx="fishing" /> · {z.nameDe ?? z.nameEn} {z.fishingBaseSkill != null && <span className="text-faint">(Basis-Skill {Math.max(1, z.fishingBaseSkill)})</span>} · <Rate rate={z.rate} /> <SourceBadge source={z.sourceId} /></li>)}
              </ul>
            )}
          </Panel>
          <Panel title={`Händler (${d.vendors.length})`}>
            {d.vendors.length === 0 ? <Empty>Kein Händler in QuestieDB Forever.</Empty> : (
              <ul className="space-y-1 text-[12.5px]">
                {d.vendors.slice(0, 30).map((v: any) => <li key={v.npcId}><NpcName id={v.npcId} nameDe={v.nameDe} nameEn={v.nameEn} /> <span className="text-faint">{v.subName ? `‹${v.subName}›` : ''} · {zoneName(v.zoneId)} {v.friendlyTo ? `· freundlich: ${v.friendlyTo}` : ''}</span></li>)}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title={`Passende Farmspots (${d.spots.length})`}>
          {d.spots.length === 0 ? <Empty>Kein generierter Spot enthält dieses Item unter seinen Hauptdrops.</Empty> : (
            <ul className="grid gap-1.5 text-[12.5px] md:grid-cols-2">
              {d.spots.map((s: any) => (
                <li key={s.spotId} className="flex items-center gap-2 rounded border border-line bg-panel-2 px-2.5 py-1.5">
                  <Link to={`/spots/${encodeURIComponent(s.spotId)}`} className="min-w-0 flex-1 truncate text-ink hover:underline">{s.titleDe}</Link>
                  <span className="text-faint">{KIND[s.kind]}</span>
                  {s.levelMin != null && <span className="num text-muted">{s.levelMin}–{s.levelMax}</span>}
                  <Rate rate={s.rate} />
                  {s.hasElite ? <Badge tone="bad">Elite</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
