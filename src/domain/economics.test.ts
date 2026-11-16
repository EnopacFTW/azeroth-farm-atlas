import { describe, expect, it } from 'vitest';
import { modeledGoldPerHour, perKillModel } from './economics';
import type { MarketQuote, SpotDetail } from './types';

const loot = (itemId: number, context: 'normal_kill' | 'skinning', rate: number | null, vendorSell: number | null) => ({
  itemId, nameEn: `i${itemId}`, nameDe: null, quality: 1, context, rate, minQty: 1, maxQty: 1, groupId: 0, vendorSell, isCloth: 0 as const,
  sourceId: 'cmangos_classic', reliability: 'classic_fallback' as const,
});

const detail = {
  npcs: [
    { id: 1, inClassic: 1, spawns: 3, minCoin: 10, maxCoin: 30, skinMin: 100, loot: [loot(10, 'normal_kill', 0.5, 100), loot(11, 'normal_kill', null, 50), loot(12, 'skinning', 1, 40)] },
    { id: 2, inClassic: 1, spawns: 1, minCoin: 0, maxCoin: 0, skinMin: 200, loot: [loot(10, 'normal_kill', 1, 100), loot(12, 'skinning', 1, 40)] },
  ],
} as unknown as SpotDetail;

const q = (itemId: number, median: number, observedAt = new Date().toISOString()): MarketQuote => ({
  provider: 'ahledger', marketId: 'm', region: 'eu', ruleset: 'normal', faction: 'alliance', houseId: null, itemId, variantKey: null,
  minBuyoutCopper: median, medianCopper: median, referencePriceCopper: null, median7dCopper: null, median30dCopper: null, quantityListed: 1,
  auctions: 1, estimatedUnitsSoldPerDay: null, observedAt, fetchedAt: observedAt, cacheExpiresAt: null, isLiveSnapshot: false,
  sourceUrl: null, attributionText: '', attributionUrl: null, dataSourceNote: null, fromCache: false,
});

describe('per-kill model', () => {
  it('weights by spawns, keeps unknown rates out and flags partial', () => {
    const m = perKillModel(detail, [], { cutPercent: 5, staleMinutes: 120, canSkin: (s) => (s ?? 999) <= 150 })!;
    // item 10: 0.75*0.5*100 + 0.25*1*100 = 62.5; coin 0.75*20 = 15
    expect(m.coinCopper).toBe(15);
    expect(m.vendorOnlyCopper).toBe(78);
    expect(m.itemsWithoutRate).toBe(1);
    expect(m.partial).toBe(true);
    // skinning only for npc 1 (skill 150 >= 100): 0.75 * 40
    expect(m.skinningVendorCopper).toBe(30);
  });
  it('uses fresh AH price after cut when higher than vendor, ignores stale ones', () => {
    const fresh = perKillModel(detail, [q(10, 1000)], { cutPercent: 5, staleMinutes: 120, canSkin: () => true })!;
    expect(fresh.bestStrategyCopper).toBe(Math.round(0.625 * 950 + 15));
    const stale = perKillModel(detail, [q(10, 1000, new Date(Date.now() - 10 * 3600_000).toISOString())], { cutPercent: 5, staleMinutes: 120, canSkin: () => true })!;
    expect(stale.bestStrategyCopper).toBe(stale.vendorOnlyCopper);
  });
  it('gold/h needs a measured kill rate', () => {
    expect(modeledGoldPerHour(null, 500)).toBeNull();
    expect(modeledGoldPerHour(120, 500)).toBe(6);
  });
});
