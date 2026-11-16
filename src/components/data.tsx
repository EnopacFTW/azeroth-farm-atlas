import { Link } from 'react-router-dom';
import { Coins, Drill, ExternalLink, Fish, Leaf, PawPrint, ScrollText, Sword } from 'lucide-react';
import type { LootContext, MarketQuote } from '@/domain/types';
import { formatCopper } from '@/domain/money';
import { ageText, freshness, freshnessLabel, valuationPrice } from '@/domain/market';
import { pct } from '@/domain/scoring';
import { useSettings } from '@/services/hooks';
import { openExternal } from '@/services/tauri';
import { dateTime, nm, nmAlt, num, tr } from '@/i18n';
import { Badge, cx } from './ui';

const QUALITY_CLS = ['text-q0', 'text-q1', 'text-q2', 'text-q3', 'text-q4', 'text-q5'];

export function ItemName({ id, nameDe, nameEn, quality, className }: { id: number; nameDe?: string | null; nameEn: string; quality?: number | null; className?: string }) {
  const alt = nmAlt({ nameDe, nameEn });
  return (
    <Link to={`/items/${id}`} title={`${alt ? `${alt} · ` : ''}Item-ID ${id}`} className={cx('hover:underline', QUALITY_CLS[quality ?? 1] ?? 'text-ink', className)}>
      {nm({ nameDe, nameEn })}
    </Link>
  );
}

export function NpcName({ id, nameDe, nameEn, className }: { id: number; nameDe?: string | null; nameEn: string; className?: string }) {
  const alt = nmAlt({ nameDe, nameEn });
  return (
    <Link to={`/mobs/${id}`} title={`${alt ? `${alt} · ` : ''}NPC-ID ${id}`} className={cx('hover:underline text-ink', className)}>
      {nm({ nameDe, nameEn })}
    </Link>
  );
}

function sourceInfo(source: string): { label: string; tone: 'ok' | 'warn' | 'info' | 'neutral'; title: string } | undefined {
  switch (source) {
    case 'questiedb_forever': return { label: 'Forever', tone: 'ok', title: tr('QuestieDB Flavor Forever (Client-/Spawndaten, forever_client_data)', 'QuestieDB flavor Forever (client/spawn data, forever_client_data)') };
    case 'cmangos_classic': return { label: tr('Classic-Fallback', 'Classic fallback'), tone: 'warn', title: tr('cmangos classic-db 1.12 – nicht für Forever verifiziert (classic_fallback)', 'cmangos classic-db 1.12 – not verified for Forever (classic_fallback)') };
    case 'classic_rules': return { label: tr('Classic-Regel', 'Classic rule'), tone: 'warn', title: tr('Classic-Formel/Skillgrenze (Wowpedia/cmangos), nicht Forever-geprüft', 'Classic formula/skill threshold (Wowpedia/cmangos), not checked on Forever') };
    case 'manual_zone_meta': return { label: tr('Manuell', 'Manual'), tone: 'neutral', title: tr('Manuell kuratierte Zonen-Metadaten (manual_unverified)', 'Manually curated zone metadata (manual_unverified)') };
    case 'atlas_clustering': return { label: tr('Auto-gruppiert', 'Auto-grouped'), tone: 'info', title: tr('Spot automatisch aus Forever-Spawnpunkten gruppiert', 'Spot grouped automatically from Forever spawn points') };
    case 'forever_client_data': return { label: 'Forever', tone: 'ok', title: 'forever_client_data' };
    case 'classic_fallback': return { label: tr('Classic-Fallback', 'Classic fallback'), tone: 'warn', title: 'classic_fallback' };
    default: return undefined;
  }
}

export function SourceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return <Badge title={tr('Keine Quelle', 'No source')}>{tr('unbekannt', 'unknown')}</Badge>;
  const s = sourceInfo(source) ?? { label: source, tone: 'neutral' as const, title: source };
  return (
    <Badge tone={s.tone} title={s.title}>
      {s.label}
    </Badge>
  );
}

const CTX: Record<LootContext, { label: [string, string]; Icon: typeof Coins }> = {
  normal_kill: { label: ['Kill-Loot', 'Kill loot'], Icon: Sword },
  skinning: { label: ['Kürschnern', 'Skinning'], Icon: PawPrint },
  herb_node: { label: ['Kräuterknoten', 'Herb nodes'], Icon: Leaf },
  mining_node: { label: ['Erzvorkommen', 'Mining nodes'], Icon: Drill },
  fishing: { label: ['Angeln', 'Fishing'], Icon: Fish },
  quest: { label: ['Questdrop', 'Quest drop'], Icon: ScrollText },
};

export function ContextLabel({ ctx }: { ctx: LootContext }) {
  const c = CTX[ctx] ?? CTX.normal_kill;
  return (
    <span className="inline-flex items-center gap-1 text-muted">
      <c.Icon className="size-3.5" /> {tr(...c.label)}
    </span>
  );
}
export const contextLabel = (ctx: LootContext) => (CTX[ctx] ? tr(...CTX[ctx].label) : ctx);

export function Rate({ rate }: { rate: number | null | undefined }) {
  if (rate == null) return <span className="text-faint" title={tr('Dropchance unbekannt – nicht als 0 % werten', 'Drop rate unknown – do not read as 0 %')}>{tr('Rate unbekannt', 'Rate unknown')}</span>;
  return <span className="num">{pct(rate)}</span>;
}

const STAT_LABEL: Record<'median' | 'min_buyout' | 'reference' | 'manual', [string, string]> = {
  median: ['Median', 'Median'], min_buyout: ['Min-Sofortkauf', 'Min buyout'], reference: ['Referenzpreis', 'Reference price'], manual: ['Manuell', 'Manual'],
};
export const statLabel = (k: keyof typeof STAT_LABEL) => tr(...STAT_LABEL[k]);
export const providerName = (p: string) =>
  ({ ahledger: 'AHledger', auctionhouse_fyi: 'auctionhouse.fyi', blizzard_forever: tr('Blizzard (exp.)', 'Blizzard (exp.)'), manual: tr('Manuell', 'Manual') } as Record<string, string>)[p] ?? p;

/** One AH price with provider, statistic, scan age and freshness. Missing data is shown as missing, never as 0. */
export function PriceCell({ quote, compact, loading, error }: { quote: MarketQuote | null | undefined; compact?: boolean; loading?: boolean; error?: boolean }) {
  const { data: settings } = useSettings();
  if (loading) return <span className="text-faint">{tr('lädt…', 'loading…')}</span>;
  if (error) return <span className="text-bad/80" title={tr('Preisanbieter nicht erreichbar', 'Price provider unreachable')}>offline</span>;
  const v = valuationPrice(quote);
  const f = freshness(quote, settings?.staleMinutes ?? 120);
  if (!quote || !v) return <Badge title={quote?.dataSourceNote ?? tr('Kein Preis vom gewählten Anbieter für diesen Markt', 'No price from the selected provider for this market')}>{freshnessLabel('unknown')}</Badge>;
  const tone = f === 'fresh' ? 'ok' : f === 'manual' ? 'info' : f === 'stale' ? 'warn' : 'bad';
  const title = [
    `${providerName(quote.provider)} · ${quote.marketId}`,
    `${statLabel(v.statistic)}: ${formatCopper(v.copper)} ${tr('pro Stück', 'each')}`,
    quote.minBuyoutCopper != null && v.statistic !== 'min_buyout' ? `${statLabel('min_buyout')}: ${formatCopper(quote.minBuyoutCopper)}` : null,
    quote.quantityListed != null ? `${tr('Gelistet', 'Listed')}: ${num(quote.quantityListed)}` : null,
    `Scan: ${quote.observedAt ? dateTime(quote.observedAt) : tr('unbekannt', 'unknown')} · ${tr('Abruf', 'Fetched')}: ${dateTime(quote.fetchedAt)}`,
    quote.dataSourceNote,
  ].filter(Boolean).join('\n');
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span className="num text-ink">{formatCopper(v.copper)}</span>
      {!compact && <span className="text-[11px] text-faint">{statLabel(v.statistic)}</span>}
      <Badge tone={tone}>{freshnessLabel(f)}{f !== 'manual' && quote.observedAt ? ` · ${ageText(quote.observedAt)}` : ''}</Badge>
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
