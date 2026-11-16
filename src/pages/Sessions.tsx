import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pause, Play, Plus, Square, Trash2 } from 'lucide-react';
import { Badge, Button, Empty, ErrorBox, Field, inputCls, Panel, Spinner, Stat } from '@/components/ui';
import { PriceCell } from '@/components/data';
import { api } from '@/services/tauri';
import { useActiveProfile, useMarketSelection, useQuotes } from '@/services/hooks';
import { formatCopper, parseCopper } from '@/domain/money';
import { formatDuration, liveActiveMs, sessionStats } from '@/domain/sessionMath';
import { freshness, valuationPrice } from '@/domain/market';
import type { FarmSession, SessionLoot } from '@/domain/types';

export function SessionsPage() {
  const { profile } = useActiveProfile();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sessions', profile?.id], queryFn: () => api.listSessions(profile!.id), enabled: !!profile });
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  useEffect(() => setFetchedAt(Date.now()), [q.dataUpdatedAt]);
  const active = q.data?.find((s) => s.state !== 'ended');
  const done = q.data?.filter((s) => s.state === 'ended') ?? [];
  const [err, setErr] = useState<unknown>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['sessions', profile?.id] });
  if (!profile) return null;
  const startFree = async () => {
    try { await api.startSession(profile.id, null, profile.market.provider, profile.market.marketId ?? null); refresh(); } catch (e) { setErr(e); }
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1300px] space-y-4 p-5">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-[20px] font-semibold">Farmtracker</h1>
          <div className="ml-auto flex gap-2">
            {!active && <Button variant="primary" onClick={startFree}><Play className="size-4" /> Freie Session starten</Button>}
            <Button onClick={() => api.exportSessions(profile.id, 'csv')}><Download className="size-4" /> CSV</Button>
            <Button onClick={() => api.exportSessions(profile.id, 'json')}><Download className="size-4" /> JSON</Button>
          </div>
        </div>
        {err ? <ErrorBox error={err} /> : null}
        {q.isLoading && <Spinner />}
        {active ? <ActiveSession s={active} fetchedAt={fetchedAt} onChange={refresh} /> : <Empty>Keine laufende Session. Starte eine im Spot-Detail („30-Minuten-Session starten“) oder als freie Session.</Empty>}
        <Panel title={`Abgeschlossene Sessions (${done.length})`} bodyClass="p-0">
          {done.length === 0 ? <div className="p-4"><Empty>Noch keine Messungen – ohne Messung zeigt die App keine Gold/h.</Empty></div> : (
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-[11px] uppercase text-faint">
                <tr className="border-b border-line">{['Start', 'Spot', 'Aktiv', 'Kills/h', 'XP/h', 'Netto', 'Gold/h (gemessen)', 'Unverkauft', ''].map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {done.map((s) => {
                  const st = sessionStats(s);
                  return (
                    <tr key={s.id} className="border-b border-line/50">
                      <td className="px-3 py-1.5 text-muted">{new Date(s.startedAt).toLocaleString('de-DE')}</td>
                      <td className="px-3 py-1.5">{s.spotId ? <Link to={`/spots/${encodeURIComponent(s.spotId)}`} className="hover:underline">{s.spotId.replace(/^\w+:/, '')}</Link> : <span className="text-faint">frei</span>}</td>
                      <td className="px-3 py-1.5 num">{formatDuration(s.activeMs)}</td>
                      <td className="px-3 py-1.5 num">{st.killsPerHour != null ? Math.round(st.killsPerHour) : '—'}</td>
                      <td className="px-3 py-1.5 num">{st.xpPerHour != null ? Math.round(st.xpPerHour).toLocaleString('de-DE') : '—'}</td>
                      <td className="px-3 py-1.5 num">{formatCopper(st.netCopper)}</td>
                      <td className="px-3 py-1.5 num text-gold-2">{st.netGoldPerHour != null ? `${st.netGoldPerHour.toFixed(2)} g/h` : '—'}</td>
                      <td className="px-3 py-1.5 num text-muted" title="Inventarwert, nicht realisiert">{formatCopper(st.unsoldInventoryCopper)}</td>
                      <td className="px-3 py-1.5"><button type="button" onClick={async () => { if (confirm('Session löschen?')) { await api.deleteSession(s.id); refresh(); } }} className="text-faint hover:text-bad cursor-pointer" aria-label="Löschen"><Trash2 className="size-4" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}

function ActiveSession({ s, fetchedAt, onChange }: { s: FarmSession; fetchedAt: number; onChange: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = liveActiveMs(s, fetchedAt, now);
  const act = async (a: 'pause' | 'resume' | 'end') => {
    try { await api.sessionAction(s.id, a); onChange(); } catch (e) { setErr(e); }
  };
  const patch = async (p: Parameters<typeof api.patchSession>[1]) => {
    try { await api.patchSession(s.id, p); onChange(); } catch (e) { setErr(e); }
  };
  const money = (k: 'rawCopper' | 'vendorCopper' | 'realizedAuctionCopper' | 'repairsCopper' | 'purchasesCopper', label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input defaultValue={s[k] != null ? formatCopper(s[k]) : ''} placeholder="z. B. 1g 20s" className={inputCls}
        onBlur={(e) => { const v = e.target.value.trim() === '' ? null : parseCopper(e.target.value); if (v !== null) patch({ [k]: v }); }} />
    </Field>
  );
  const num = (k: 'kills' | 'xpGained' | 'deaths', label: string) => (
    <Field label={label}>
      <input type="number" min={0} defaultValue={s[k] ?? ''} className={inputCls} onBlur={(e) => e.target.value !== '' && patch({ [k]: Math.max(0, Number(e.target.value)) })} />
    </Field>
  );
  const st = sessionStats({ ...s, activeMs: ms });
  return (
    <Panel title={<span className="flex items-center gap-2">Laufende Session {s.spotId && <Link to={`/spots/${encodeURIComponent(s.spotId)}`} className="font-normal text-gold hover:underline">{s.spotId}</Link>} <Badge tone={s.state === 'running' ? 'ok' : 'warn'}>{s.state === 'running' ? 'läuft' : 'pausiert'}</Badge></span>}>
      {err ? <div className="mb-3"><ErrorBox error={err} /></div> : null}
      <div className="flex flex-wrap items-center gap-4">
        <div className="num font-display text-[34px] font-semibold text-gold-2" aria-live="polite">{formatDuration(ms)}</div>
        {s.state === 'running' ? <Button onClick={() => act('pause')}><Pause className="size-4" /> Pause</Button> : <Button onClick={() => act('resume')}><Play className="size-4" /> Fortsetzen</Button>}
        <Button variant="danger" onClick={() => act('end')}><Square className="size-4" /> Beenden & speichern</Button>
        <span className="text-[11.5px] text-faint">Pausen werden abgezogen. Die Session ist in SQLite gespeichert und übersteht einen Neustart.</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        {num('kills', 'Kills')}
        {num('xpGained', 'XP erhalten')}
        {num('deaths', 'Tode')}
        {money('rawCopper', 'Rohgold (Münzen)')}
        {money('vendorCopper', 'Händlerverkauf')}
        {money('realizedAuctionCopper', 'AH verkauft (realisiert)', 'nur tatsächlich verkauft')}
        {money('repairsCopper', 'Reparatur')}
        {money('purchasesCopper', 'Verbrauch/Käufe', 'Munition, Essen…')}
      </div>
      <Field label="Notizen">
        <textarea defaultValue={s.notes ?? ''} rows={2} className={`${inputCls} mt-1 h-auto py-1.5`} onBlur={(e) => patch({ notes: e.target.value })} />
      </Field>
      <LootEditor s={s} onSave={(loot) => patch({ loot })} />
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Netto" value={formatCopper(st.netCopper)} hint="Roh + Händler + AH realisiert − Kosten" />
        <Stat label="Gold/h (gemessen)" value={st.netGoldPerHour != null ? `${st.netGoldPerHour.toFixed(2)} g` : '—'} hint="ab 1 aktiver Minute" />
        <Stat label="Kills/h" value={st.killsPerHour != null ? Math.round(st.killsPerHour) : '—'} />
        <Stat label="XP/h" value={st.xpPerHour != null ? Math.round(st.xpPerHour).toLocaleString('de-DE') : '—'} />
        <Stat label="Unverkaufte Beute" value={formatCopper(st.unsoldInventoryCopper)} hint="Marktwert, NICHT realisiert" />
      </div>
    </Panel>
  );
}

function LootEditor({ s, onSave }: { s: FarmSession; onSave: (loot: SessionLoot[]) => void }) {
  const market = useMarketSelection();
  const { settings } = useActiveProfile();
  const [loot, setLoot] = useState<SessionLoot[]>(s.loot);
  const [term, setTerm] = useState('');
  const hits = useQuery({ queryKey: ['loot-search', term], queryFn: () => api.search(term, ['item'], 8), enabled: term.trim().length >= 2 });
  const names = useQuery({ queryKey: ['loot-names', loot.map((l) => l.itemId).join(',')], queryFn: async () => Promise.all(loot.map((l) => api.getItem(l.itemId).then((d) => d.item).catch(() => null))), enabled: loot.length > 0 });
  const quotes = useQuotes(loot.map((l) => l.itemId));
  const qmap = useMemo(() => new Map((quotes.data ?? []).map((q) => [q.itemId, q])), [quotes.data]);
  const add = (itemId: number) => {
    if (!loot.some((l) => l.itemId === itemId)) setLoot([...loot, { itemId, quantity: 1, realizedCopper: null, unitPriceCopper: null, priceSource: null, priceObservedAt: null }]);
    setTerm('');
  };
  const save = () => {
    // AH value is taken over only when a price exists, with its provider and scan time; otherwise it stays unknown
    onSave(loot.map((l) => {
      const q = qmap.get(l.itemId);
      const v = valuationPrice(q);
      const f = freshness(q, settings?.staleMinutes ?? 120);
      if (l.unitPriceCopper == null && v && (f === 'fresh' || f === 'manual')) {
        return { ...l, unitPriceCopper: v.copper, priceSource: `${q!.provider}:${q!.marketId}:${v.statistic}`, priceObservedAt: q!.observedAt };
      }
      return l;
    }));
  };
  return (
    <div className="mt-4">
      <h4 className="mb-1.5 text-[12.5px] font-semibold">Beute</h4>
      <div className="relative mb-2 w-80">
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Item suchen (DE/EN) und hinzufügen…" className={`${inputCls} w-full`} />
        {term.length >= 2 && hits.data && (
          <div className="absolute z-50 mt-1 w-full rounded border border-line-2 bg-panel-2 py-1 shadow-xl">
            {hits.data.map((h) => <button key={h.id} type="button" onClick={() => add(h.id)} className="flex w-full gap-2 px-2 py-1 text-left text-[12.5px] hover:bg-panel-3 cursor-pointer"><Plus className="size-3.5 text-gold" />{h.nameDe ?? h.nameEn}<span className="ml-auto text-faint">#{h.id}</span></button>)}
          </div>
        )}
      </div>
      {loot.length > 0 && (
        <table className="w-full max-w-4xl text-[12.5px]">
          <thead className="text-left text-[11px] uppercase text-faint"><tr className="border-b border-line"><th className="py-1">Item</th><th>Menge</th><th>Realisiert (AH/Händler)</th><th>Marktpreis (Stück)</th><th /></tr></thead>
          <tbody>
            {loot.map((l, i) => (
              <tr key={l.itemId} className="border-b border-line/50">
                <td className="py-1"><Link to={`/items/${l.itemId}`} className="hover:underline">{names.data?.[i]?.nameDe ?? names.data?.[i]?.nameEn ?? `#${l.itemId}`}</Link></td>
                <td><input type="number" min={1} value={l.quantity} onChange={(e) => setLoot(loot.map((x) => x.itemId === l.itemId ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x))} className={`${inputCls} h-7 w-20`} /></td>
                <td><input placeholder="leer = unverkauft" defaultValue={l.realizedCopper != null ? formatCopper(l.realizedCopper) : ''} onBlur={(e) => setLoot(loot.map((x) => x.itemId === l.itemId ? { ...x, realizedCopper: e.target.value.trim() ? parseCopper(e.target.value) : null } : x))} className={`${inputCls} h-7 w-36`} /></td>
                <td>{l.unitPriceCopper != null ? <span className="num" title={`${l.priceSource ?? 'manuell'} · Scan ${l.priceObservedAt ?? '?'}`}>{formatCopper(l.unitPriceCopper)} <span className="text-faint">übernommen</span></span> : <PriceCell compact quote={qmap.get(l.itemId)} loading={quotes.isLoading && quotes.fetchStatus !== 'idle'} error={!!quotes.error} />}</td>
                <td><button type="button" onClick={() => setLoot(loot.filter((x) => x.itemId !== l.itemId))} className="text-faint hover:text-bad cursor-pointer" aria-label="Entfernen"><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={save}>Beute speichern</Button>
        <span className="text-[11.5px] text-faint">{market.marketId ? `Marktwert wird nur mit aktuellem Preis (${market.provider}) und Quelle übernommen.` : 'Kein Markt gewählt – kein Marktwert.'}</span>
      </div>
    </div>
  );
}

