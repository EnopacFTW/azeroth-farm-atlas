import type { MarketQuote } from './types';
import { tr } from '@/i18n';

export type Freshness = 'fresh' | 'stale' | 'expired' | 'unknown' | 'manual';

/** Badge for a quote. "fresh" only means a recent enough scan – not that the price is buyable/sellable right now. */
export function freshness(q: MarketQuote | null | undefined, staleMinutes: number, now = Date.now()): Freshness {
  if (!q) return 'unknown';
  if (q.provider === 'manual') return 'manual';
  if (q.cacheExpiresAt && Date.parse(q.cacheExpiresAt) <= now) return 'expired';
  if (!q.observedAt) return 'unknown';
  const age = now - Date.parse(q.observedAt);
  return age <= staleMinutes * 60_000 ? 'fresh' : 'stale';
}

const FRESHNESS: Record<Freshness, [string, string]> = {
  fresh: ['Aktuell', 'Current'], stale: ['Veraltet', 'Stale'], expired: ['Abgelaufen', 'Expired'], unknown: ['Nicht verfügbar', 'Not available'], manual: ['Manuell', 'Manual'],
};

export const freshnessLabel = (f: Freshness): string => tr(...FRESHNESS[f]);

/**
 * Robust unit price for valuation: median first (min buyout is only an offer and easily distorted by a single listing),
 * then min buyout, then an undocumented provider reference price. null = unknown.
 */
export function valuationPrice(q: MarketQuote | null | undefined): { copper: number; statistic: 'median' | 'min_buyout' | 'reference' | 'manual' } | null {
  if (!q) return null;
  if (q.provider === 'manual' && q.referencePriceCopper != null) return { copper: q.referencePriceCopper, statistic: 'manual' };
  if (q.medianCopper != null) return { copper: q.medianCopper, statistic: 'median' };
  if (q.minBuyoutCopper != null) return { copper: q.minBuyoutCopper, statistic: 'min_buyout' };
  if (q.referencePriceCopper != null) return { copper: q.referencePriceCopper, statistic: 'reference' };
  return null;
}

/** Price after the auction house cut (Classic: 5 % faction AH, 15 % neutral; user configurable). Deposit not included. */
export function afterCut(copper: number, cutPercent: number): number {
  return Math.floor(copper * (1 - cutPercent / 100));
}

export function ageText(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return tr('unbekannt', 'unknown');
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return tr('gerade eben', 'just now');
  if (mins < 60) return tr(`vor ${mins} min`, `${mins} min ago`);
  const h = Math.round(mins / 60);
  if (h < 48) return tr(`vor ${h} h`, `${h} h ago`);
  const d = Math.round(h / 24);
  return tr(`vor ${d} Tagen`, `${d} days ago`);
}

/** Guard against cross-market leakage: a quote is only usable for exactly the selected provider + market. */
export function quoteMatches(q: MarketQuote, provider: string, marketId: string): boolean {
  return q.provider === provider && q.marketId === marketId;
}

export function marketLabel(m: { region: string; ruleset: string; faction: string }): string {
  const rs: Record<string, string> = { normal: 'Normal', pvp: 'PvP', rp: 'RP', rppvp: 'RP-PvP' };
  const f: Record<string, string> = { alliance: tr('Allianz', 'Alliance'), horde: 'Horde', neutral: 'Neutral' };
  return `${m.region.toUpperCase()} · ${rs[m.ruleset] ?? m.ruleset} · ${f[m.faction] ?? m.faction}`;
}
