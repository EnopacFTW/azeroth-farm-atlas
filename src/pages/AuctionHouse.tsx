import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, Square, Trash2 } from 'lucide-react';
import { MarketSelector } from '@/components/MarketSelector';
import { PriceChart } from '@/components/PriceChart';
import { Attribution, PriceCell, providerName } from '@/components/data';
import { Badge, Button, Empty, ErrorBox, Field, inputCls, Panel, Spinner } from '@/components/ui';
import { api } from '@/services/tauri';
import { useActiveProfile, useMarketSelection, useQuotes } from '@/services/hooks';
import { formatCopper, parseCopper } from '@/domain/money';
import { ageText } from '@/domain/market';
import { dateTime, locale, nm, num, tr } from '@/i18n';

/** Optional background refresh (setting "Automatischer Preis-Refresh", default off). Uses ETag so unchanged tables cost nothing. */
export function useAutoRefresh() {
  const { settings } = useActiveProfile();
  const { provider, marketId } = useMarketSelection();
  const qc = useQueryClient();
  const minutes = settings?.refreshIntervalMin ?? 0;
  useEffect(() => {
    if (!minutes || !marketId || (provider !== 'ahledger' && provider !== 'blizzard_forever')) return;
    const t = setInterval(async () => {
      try { await api.syncMarketPrices(provider, marketId); } catch { /* status is recorded in Rust */ }
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['syncStatus'] });
    }, minutes * 60_000);
    return () => clearInterval(t);
  }, [minutes, provider, marketId, qc]);
}

export function AuctionHousePage() {
  const { provider, marketId } = useMarketSelection();
  const { profile } = useActiveProfile();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['syncStatus'], queryFn: api.getMarketSyncStatus });
  const health = useQuery({ queryKey: ['health-cached'], queryFn: api.cachedProviderHealth });
  const [syncing, setSyncing] = useState(false);
  const [syncErr, setSyncErr] = useState<unknown>(null);
  const [term, setTerm] = useState(() => tr('Leinenstoff', 'Linen Cloth'));
  const [itemId, setItemId] = useState<number | null>(2589);
  const [range, setRange] = useState('7d');
  const hits = useQuery({ queryKey: ['ah-search', term], queryFn: () => api.search(term, ['item'], 10), enabled: term.trim().length >= 2 });
  const detail = useQuery({
    queryKey: ['quoteDetail', provider, marketId, itemId, range],
    queryFn: () => api.fetchQuoteDetail(provider, marketId!, itemId!, range),
    enabled: !!marketId && itemId != null, retry: false,
  });
  const watch = useQuery({ queryKey: ['watchlist', profile?.id], queryFn: () => api.listWatchlist(profile!.id), enabled: !!profile });
  const watchQuotes = useQuotes(watch.data ?? []);
  const watchNames = useQuery({ queryKey: ['watch-names', watch.data], queryFn: () => Promise.all((watch.data ?? []).map((i) => api.getItem(i).then((d) => d.item).catch(() => ({ id: i, nameEn: `#${i}` })))), enabled: !!watch.data?.length });
  const cur = status.data?.find((s) => s.provider === provider && s.marketId === marketId);
  const h = health.data?.find((x) => x.provider === provider);
  const dq = detail.data?.quote;

  const sync = async () => {
    if (!marketId) return;
    setSyncing(true); setSyncErr(null);
    try { await api.syncMarketPrices(provider, marketId); qc.invalidateQueries({ queryKey: ['quotes'] }); } catch (e) { setSyncErr(e); }
    finally { setSyncing(false); status.refetch(); }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1300px] space-y-4 p-5">
        <h1 className="font-display text-[20px] font-semibold">{tr('Auktionshaus', 'Auction house')}</h1>
        <Panel title={tr('Markt & Anbieter', 'Market & provider')}>
          <MarketSelector />
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px]">
            <span className="text-muted">Status {providerName(provider)}:</span>
            {h ? (h.reachable ? <Badge tone="ok">{tr('erreichbar · getestet', 'reachable · tested')} {ageText(h.checkedAt)}</Badge> : h.reachable === false ? <Badge tone="bad">{tr('Fehler', 'Error')}: {h.lastError}</Badge> : <Badge>{h.lastError ?? tr('nicht getestet', 'not tested')}</Badge>) : <Badge>{tr('noch nicht getestet', 'not tested yet')}</Badge>}
            {(provider === 'ahledger' || provider === 'blizzard_forever') && marketId && (
              <>
                <Button size="sm" onClick={sync} busy={syncing}><RefreshCw className="size-3.5" /> {provider === 'ahledger' ? tr('Bulk-Preistabelle laden', 'Load bulk price table') : tr('House synchronisieren (groß)', 'Sync house (large)')}</Button>
                {syncing && <Button size="sm" variant="ghost" onClick={() => api.cancelMarketSync()}><Square className="size-3.5" /> {tr('Abbrechen', 'Cancel')}</Button>}
              </>
            )}
            {cur && (
              <span className="text-faint">
                {tr('Letzter Sync', 'Last sync')} {cur.lastSuccessAt ? ageText(cur.lastSuccessAt) : tr('nie', 'never')} · {num(cur.items)} Items · Scan {cur.observedAt ? dateTime(cur.observedAt) : tr('unbekannt', 'unknown')}
                {cur.notModified ? tr(' · 304 unverändert', ' · 304 unchanged') : ''}{cur.note ? ` · ${cur.note}` : ''}{cur.lastError ? ` · ${tr('Fehler', 'Error')}: ${cur.lastError}` : ''}
              </span>
            )}
          </div>
          {syncErr ? <div className="mt-2"><ErrorBox error={syncErr} /></div> : null}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
          <Panel title={tr('Item suchen', 'Search item')}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-faint" />
              <input value={term} onChange={(e) => setTerm(e.target.value)} className={`${inputCls} w-full pl-8`} placeholder={tr('Item (DE/EN) oder ID', 'Item (EN/DE) or ID')} />
            </div>
            <ul className="mt-2 space-y-0.5 text-[12.5px]">
              {hits.data?.map((hit) => (
                <li key={hit.id}><button type="button" onClick={() => setItemId(hit.id)} className={`w-full rounded px-2 py-1 text-left hover:bg-panel-3 cursor-pointer ${itemId === hit.id ? 'bg-gold/10 text-gold-2' : ''}`}>{nm(hit)} <span className="text-faint">#{hit.id}</span></button></li>
              ))}
            </ul>
          </Panel>
          <Panel title={itemId ? <Link to={`/items/${itemId}`} className="hover:underline">{tr('Preis für Item', 'Price for item')} #{itemId}</Link> : tr('Preis', 'Price')} actions={
            provider === 'ahledger' && <div className="flex gap-1">{['24h', '7d', '30d'].map((r) => <Button key={r} size="sm" variant={range === r ? 'primary' : 'ghost'} onClick={() => setRange(r)}>{r}</Button>)}</div>
          }>
            {!marketId && <Empty>{tr('Erst einen Markt wählen.', 'Choose a market first.')}</Empty>}
            {detail.isLoading && <Spinner label={tr('Anfrage beim Anbieter…', 'Requesting from the provider…')} />}
            {detail.error && <ErrorBox title={tr('Preis nicht abrufbar – lokale Farmdaten bleiben nutzbar', 'Price unavailable – local farm data stays usable')} error={detail.error} />}
            {detail.data && !dq && <Empty>{tr('Kein Eintrag beim Anbieter (404) – kein Preis angenommen.', 'No entry at the provider (404) – no price assumed.')}</Empty>}
            {dq && (
              <div className="space-y-2 text-[12.5px]">
                <PriceCell quote={dq} />
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-muted md:grid-cols-3">
                  <span>{tr('Min-Sofortkauf', 'Min buyout')}: <b className="num text-ink">{formatCopper(dq.minBuyoutCopper)}</b></span>
                  <span>Median: <b className="num text-ink">{formatCopper(dq.medianCopper)}</b></span>
                  {dq.referencePriceCopper != null && <span>{tr('Referenzpreis', 'Reference price')}: <b className="num text-ink">{formatCopper(dq.referencePriceCopper)}</b></span>}
                  <span>{tr('Gelistet', 'Listed')}: <b className="num text-ink">{dq.quantityListed != null ? num(dq.quantityListed) : '—'}</b></span>
                  <span>{tr('Auktionen', 'Auctions')}: <b className="num text-ink">{dq.auctions ?? '—'}</b></span>
                  <span>{tr('Absatz/Tag (Schätzung)', 'Sold/day (estimate)')}: <b className="num text-ink">{dq.estimatedUnitsSoldPerDay != null ? num(dq.estimatedUnitsSoldPerDay, { maximumFractionDigits: 0 }) : '—'}</b></span>
                  <span>{tr('Live-Snapshot', 'Live snapshot')}: <b className="text-ink">{dq.isLiveSnapshot ? tr('ja', 'yes') : tr('nein', 'no')}</b></span>
                </div>
                <div className="text-[11.5px] text-faint">
                  {tr('Markt', 'Market')} {dq.marketId} · Scan {dq.observedAt ? dateTime(dq.observedAt) : tr('unbekannt', 'unknown')} · {tr('Abruf', 'Fetched')} {dateTime(dq.fetchedAt)}
                  {dq.cacheExpiresAt ? ` · ${tr('Cache bis', 'cache until')} ${new Date(dq.cacheExpiresAt).toLocaleTimeString(locale())}` : ''} · <Attribution quote={dq} />
                </div>
                {detail.data?.series && <PriceChart series={detail.data.series} />}
              </div>
            )}
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={`Watchlist (${watch.data?.length ?? 0})`}>
            {!watch.data?.length ? <Empty>{tr('Items über die Item-Detailseite auf die Watchlist setzen.', 'Add items to the watchlist from the item detail page.')}</Empty> : (
              <ul className="space-y-1 text-[12.5px]">
                {watch.data.map((id, i) => (
                  <li key={id} className="flex items-center gap-2">
                    <Link to={`/items/${id}`} className="min-w-0 flex-1 truncate hover:underline">{watchNames.data?.[i] ? nm(watchNames.data[i]) : `#${id}`}</Link>
                    <PriceCell compact quote={watchQuotes.data?.find((q) => q.itemId === id)} loading={watchQuotes.isLoading} error={!!watchQuotes.error} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11.5px] text-faint">{tr('Preisalarme/Windows-Benachrichtigungen sind in dieser Version nicht umgesetzt.', 'Price alerts/Windows notifications are not implemented in this version.')}</p>
          </Panel>
          <ManualPrices marketId={marketId} />
        </div>
      </div>
    </div>
  );
}

function ManualPrices({ marketId }: { marketId: string | null }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['manualPrices', marketId], queryFn: () => api.listManualPrices(marketId), enabled: !!marketId });
  const [item, setItem] = useState('');
  const [price, setPrice] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const add = async () => {
    const c = parseCopper(price);
    if (!marketId || !Number(item) || c == null) return;
    try { await api.setManualPrice({ itemId: Number(item), marketId, unitCopper: c, note: null }); setItem(''); setPrice(''); qc.invalidateQueries({ queryKey: ['manualPrices'] }); }
    catch (e) { setErr(e); }
  };
  return (
    <Panel title={tr('Manuelle Preisnotizen (privat, als „Manuell“ markiert)', 'Manual price notes (private, marked “Manual”)')}>
      {!marketId ? <Empty>{tr('Markt wählen.', 'Choose a market.')}</Empty> : (
        <>
          {err ? <ErrorBox error={err} /> : null}
          <div className="flex items-end gap-2">
            <Field label="Item-ID"><input value={item} onChange={(e) => setItem(e.target.value)} className={`${inputCls} w-24`} /></Field>
            <Field label={tr('Preis/Stück', 'Price/each')}><input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="1g 20s" className={`${inputCls} w-28`} /></Field>
            <Button size="sm" onClick={add}>{tr('Speichern', 'Save')}</Button>
          </div>
          <ul className="mt-2 space-y-1 text-[12.5px]">
            {list.data?.map((p) => (
              <li key={p.itemId} className="flex items-center gap-2">
                <Link to={`/items/${p.itemId}`} className="flex-1 hover:underline">#{p.itemId}</Link>
                <span className="num">{formatCopper(p.unitCopper)}</span>
                <span className="text-faint">{p.updatedAt ? ageText(p.updatedAt) : ''}</span>
                <button type="button" onClick={async () => { await api.deleteManualPrice(p.itemId, p.marketId); qc.invalidateQueries({ queryKey: ['manualPrices'] }); }} className="text-faint hover:text-bad cursor-pointer" aria-label={tr('Löschen', 'Delete')}><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-faint">{tr('Werden dauerhaft lokal gespeichert und nie als API-Livepreis angezeigt. Nutzung: Preisanbieter „Manuelle Preise“ wählen.', 'Stored permanently on this PC and never shown as a live API price. To use them, choose the price provider “Manual prices”.')}</p>
        </>
      )}
    </Panel>
  );
}
