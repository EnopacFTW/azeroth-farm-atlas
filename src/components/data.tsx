import { Link } from 'react-router-dom';
import { Coins, Drill, ExternalLink, Fish, Leaf, PawPrint, ScrollText, Sword } from 'lucide-react';
import type { LootContext, MarketQuote } from '@/domain/types';
import { formatCopper } from '@/domain/money';
import { ageText, freshness, FRESHNESS_LABEL, valuationPrice } from '@/domain/market';
import { pct } from '@/domain/scoring';
import { useSettings } from '@/services/hooks';
import { openExternal } from '@/services/tauri';
import { Badge, cx } from './ui';

const QUALITY_CLS = ['text-q0', 'text-q1', 'text-q2', 'text-q3', 'text-q4', 'text-q5'];

export function ItemName({ id, nameDe, nameEn, quality, className }: { id: number; nameDe?: string | null; nameEn: string; quality?: number | null; className?: string }) {
  return (
    <Link to={`/items/${id}`} title={`${nameEn} · Item-ID ${id}`} className={cx('hover:underline', QUALITY_CLS[quality ?? 1] ?? 'text-ink', className)}>
      {nameDe || nameEn}
    </Link>
  );
}

export function NpcName({ id, nameDe, nameEn, className }: { id: number; nameDe?: string | null; nameEn: string; className?: string }) {
  return (
    <Link to={`/mobs/${id}`} title={`${nameEn} · NPC-ID ${id}`} className={cx('hover:underline text-ink', className)}>
      {nameDe || nameEn}
    </Link>
  );
}

const SOURCE_INFO: Record<string, { label: string; tone: 'ok' | 'warn' | 'info' | 'neutral'; title: string }> = {
  questiedb_forever: { label: 'Forever', tone: 'ok', title: 'QuestieDB Flavor Forever (Client-/Spawndaten, forever_client_data)' },
  cmangos_classic: { label: 'Classic-Fallback', tone: 'warn', title: 'cmangos classic-db 1.12 – nicht für Forever verifiziert (classic_fallback)' },
  classic_rules: { label: 'Classic-Regel', tone: 'warn', title: 'Classic-Formel/Skillgrenze (Wowpedia/cmangos), nicht Forever-geprüft' },
  manual_zone_meta: { label: 'Manuell', tone: 'neutral', title: 'Manuell kuratierte Zonen-Metadaten (manual_unverified)' },
  atlas_clustering: { label: 'Auto-gruppiert', tone: 'info', title: 'Spot automatisch aus Forever-Spawnpunkten gruppiert' },
  forever_client_data: { label: 'Forever', tone: 'ok', title: 'forever_client_data' },
  classic_fallback: { label: 'Classic-Fallback', tone: 'warn', title: 'classic_fallback' },
};

export function SourceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return <Badge title="Keine Quelle">unbekannt</Badge>;
  const s = SOURCE_INFO[source] ?? { label: source, tone: 'neutral' as const, title: source };
  return (
    <Badge tone={s.tone} title={s.title}>
      {s.label}
    </Badge>
  );
}

const CTX: Record<LootContext, { label: string; Icon: typeof Coins }> = {
  normal_kill: { label: 'Kill-Loot', Icon: Sword },
  skinning: { label: 'Kürschnern', Icon: PawPrint },
  herb_node: { label: 'Kräuterknoten', Icon: Leaf },
  mining_node: { label: 'Erzvorkommen', Icon: Drill },
  fishing: { label: 'Angeln', Icon: Fish },
  quest: { label: 'Questdrop', Icon: ScrollText },
};

export function ContextLabel({ ctx }: { ctx: LootContext }) {
  const c = CTX[ctx] ?? CTX.normal_kill;
  return (
    <span className="inline-flex items-center gap-1 text-muted">
      <c.Icon className="size-3.5" /> {c.label}
    </span>
  );
}
export const contextLabel = (ctx: LootContext) => CTX[ctx]?.label ?? ctx;

export function Rate({ rate }: { rate: number | null | undefined }) {
  if (rate == null) return <span className="text-faint" title="Dropchance unbekannt – nicht als 0 % werten">Rate unbekannt</span>;
  return <span className="num">{pct(rate)}</span>;
}

const STAT_LABEL = { median: 'Median', min_buyout: 'Min-Sofortkauf', reference: 'Referenzpreis', manual: 'Manuell' } as const;
const PROVIDER_NAME: Record<string, string> = { ahledger: 'AHledger', auctionhouse_fyi: 'auctionhouse.fyi', blizzard_forever: 'Blizzard (exp.)', manual: 'Manuell' };
export const providerName = (p: string) => PROVIDER_NAME[p] ?? p;

/** One AH price with provider, statistic, scan age and freshness. Missing data is shown as missing, never as 0. */
export function PriceCell({ quote, compact, loading, error }: { quote: MarketQuote | null | undefined; compact?: boolean; loading?: boolean; error?: boolean }) {
  const { data: settings } = useSettings();
  if (loading) return <span className="text-faint">lädt…</span>;
  if (error) return <span className="text-bad/80" title="Preisanbieter nicht erreichbar">offline</span>;
  const v = valuationPrice(quote);
  const f = freshness(quote, settings?.staleMinutes ?? 120);
  if (!quote || !v) return <Badge title={quote?.dataSourceNote ?? 'Kein Preis vom gewählten Anbieter für diesen Markt'}>Nicht verfügbar</Badge>;
  const tone = f === 'fresh' ? 'ok' : f === 'manual' ? 'info' : f === 'stale' ? 'warn' : 'bad';
  const title = [
    `${providerName(quote.provider)} · ${quote.marketId}`,
    `${STAT_LABEL[v.statistic]}: ${formatCopper(v.copper)} pro Stück`,
    quote.minBuyoutCopper != null && v.statistic !== 'min_buyout' ? `Min-Sofortkauf: ${formatCopper(quote.minBuyoutCopper)}` : null,
    quote.quantityListed != null ? `Gelistet: ${quote.quantityListed.toLocaleString('de-DE')}` : null,
    `Scan: ${quote.observedAt ? new Date(quote.observedAt).toLocaleString('de-DE') : 'unbekannt'} · Abruf: ${new Date(quote.fetchedAt).toLocaleString('de-DE')}`,
    quote.dataSourceNote,
  ].filter(Boolean).join('\n');
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span className="num text-ink">{formatCopper(v.copper)}</span>
      {!compact && <span className="text-[11px] text-faint">{STAT_LABEL[v.statistic]}</span>}
      <Badge tone={tone}>{FRESHNESS_LABEL[f]}{f !== 'manual' && quote.observedAt ? ` · ${ageText(quote.observedAt)}` : ''}</Badge>
    </span>
  );
}

export function Attribution({ quote, text, url }: { quote?: MarketQuote | null; text?: string; url?: string | null }) {
  const t = quote?.attributionText ?? text;
  const u = quote?.attributionUrl ?? url;
  if (!t) return null;
  return (
    <button type="button" onClick={() => u && openExternal(u)} className="inline-flex items-center gap-1 text-[11.5px] text-gold hover:text-gold-2 hover:underline cursor-pointer">
      {t} <ExternalLink className="size-3" />
    </button>
  );
}

export function LevelRange({ min, max }: { min: number | null | undefined; max: number | null | undefined }) {
  if (min == null) return <span className="text-faint">Level ?</span>;
  return <span className="num">Level {min === max ? min : `${min}–${max}`}</span>;
}
