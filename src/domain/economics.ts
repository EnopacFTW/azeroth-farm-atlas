import type { LootRow, MarketQuote, SpotDetail } from './types';
import { afterCut, freshness, valuationPrice } from './market';

export interface PerKillModel {
  /** Σ rate × avgQty × vendor price (+ avg coin). */
  vendorOnlyCopper: number;
  /** Same, but each item valued at max(vendor, AH after cut) when a FRESH AH price exists. */
  bestStrategyCopper: number;
  coinCopper: number;
  skinningVendorCopper: number;
  skinningAhCopper: number;
  itemsWithRate: number;
  itemsWithoutRate: number;
  itemsWithoutPrice: number;
  partial: boolean;
}

const avgQty = (l: LootRow) => ((l.minQty ?? 1) + (l.maxQty ?? l.minQty ?? 1)) / 2;

/**
 * Modeled expected value per kill (B. in the briefing). Spawn-weighted over the spot's NPCs. Only Classic rates are used;
 * rows without a rate are counted as missing (never as 0 %). This is NOT gold per hour.
 */
export function perKillModel(detail: SpotDetail, quotes: MarketQuote[], opts: { cutPercent: number; staleMinutes: number; canSkin: (npcSkinMin: number | null) => boolean }): PerKillModel | null {
  const npcs = detail.npcs.filter((n) => n.inClassic);
  if (!npcs.length) return null;
  const total = npcs.reduce((a, n) => a + n.spawns, 0);
  const q = new Map(quotes.map((x) => [x.itemId, x]));
  const ah = (itemId: number) => {
    const quote = q.get(itemId);
    if (!quote) return null;
    const f = freshness(quote, opts.staleMinutes);
    if (f !== 'fresh' && f !== 'manual') return null;
    const v = valuationPrice(quote);
    return v ? afterCut(v.copper, opts.cutPercent) : null;
  };
  const m: PerKillModel = { vendorOnlyCopper: 0, bestStrategyCopper: 0, coinCopper: 0, skinningVendorCopper: 0, skinningAhCopper: 0, itemsWithRate: 0, itemsWithoutRate: 0, itemsWithoutPrice: 0, partial: false };
  for (const n of npcs) {
    const w = n.spawns / total;
    const coin = ((n.minCoin ?? 0) + (n.maxCoin ?? 0)) / 2;
    m.coinCopper += w * coin;
    for (const l of n.loot) {
      if (l.context !== 'normal_kill' && l.context !== 'skinning') continue;
      if (l.sourceId !== 'cmangos_classic') continue;
      if (l.rate == null) { m.itemsWithoutRate++; continue; }
      m.itemsWithRate++;
      const e = w * l.rate * avgQty(l);
      const vendor = l.vendorSell;
      const market = ah(l.itemId);
      if (vendor == null && market == null) { m.itemsWithoutPrice++; continue; }
      if (l.context === 'skinning') {
        if (!opts.canSkin(n.skinMin)) continue;
        m.skinningVendorCopper += e * (vendor ?? 0);
        m.skinningAhCopper += e * Math.max(vendor ?? 0, market ?? 0);
      } else {
        m.vendorOnlyCopper += e * (vendor ?? 0);
        m.bestStrategyCopper += e * Math.max(vendor ?? 0, market ?? 0);
      }
    }
  }
  m.vendorOnlyCopper = Math.round(m.vendorOnlyCopper + m.coinCopper);
  m.bestStrategyCopper = Math.round(m.bestStrategyCopper + m.coinCopper);
  m.coinCopper = Math.round(m.coinCopper);
  m.skinningVendorCopper = Math.round(m.skinningVendorCopper);
  m.skinningAhCopper = Math.round(m.skinningAhCopper);
  m.partial = m.itemsWithoutPrice > 0 || m.itemsWithoutRate > 0 || detail.npcs.some((n) => !n.inClassic);
  return m;
}

/** Modeled gold/h only with a MEASURED kill rate: kills/h × value per kill. */
export function modeledGoldPerHour(killsPerHour: number | null, copperPerKill: number | null): number | null {
  if (killsPerHour == null || copperPerKill == null) return null;
  return (killsPerHour * copperPerKill) / 10_000;
}
