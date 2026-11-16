import { describe, expect, it } from 'vitest';
import { formatCopper, parseCopper, goldPerHour } from './money';
import { latLngToWow, mapBounds, waypoint, wowToLatLng, wowToPixel } from './coordinates';
import { chanceAtLeastOne, expectedKills, killsForConfidence } from './probability';
import { afterCut, freshness, quoteMatches, valuationPrice } from './market';
import { conColor, gatherSkillColor, grayLevel, skinningSkillFor } from './professionRules';
import { sessionStats } from './sessionMath';
import type { FarmSession, MarketQuote } from './types';

const quote = (over: Partial<MarketQuote> = {}): MarketQuote => ({
  provider: 'ahledger', marketId: 'forever.normal.alliance.eu', region: 'eu', ruleset: 'normal', faction: 'alliance', houseId: null,
  itemId: 2589, variantKey: null, minBuyoutCopper: 26, medianCopper: 27, referencePriceCopper: null, median7dCopper: null,
  median30dCopper: null, quantityListed: 100, auctions: 5, estimatedUnitsSoldPerDay: null, observedAt: new Date().toISOString(),
  fetchedAt: new Date().toISOString(), cacheExpiresAt: null, isLiveSnapshot: false, sourceUrl: null, attributionText: 'Prices from AHledger',
  attributionUrl: 'https://ahledger.com', dataSourceNote: null, fromCache: false, ...over,
});

describe('money', () => {
  it('formats integer copper as g/s/k', () => {
    expect(formatCopper(10_000)).toBe('1g');
    expect(formatCopper(12_345)).toBe('1g 23s 45k');
    expect(formatCopper(27)).toBe('27k');
    expect(formatCopper(0)).toBe('0k');
  });
  it('renders unknown as dash, never as 0', () => {
    expect(formatCopper(null)).toBe('—');
    expect(formatCopper(undefined)).toBe('—');
  });
  it('parses user input', () => {
    expect(parseCopper('1g 20s 5k')).toBe(12_005);
    expect(parseCopper('1,5g')).toBe(15_000);
    expect(parseCopper('250')).toBe(250);
    expect(parseCopper('abc')).toBeNull();
  });
  it('gold per hour needs time', () => {
    expect(goldPerHour(100_000, 30)).toBe(20);
    expect(goldPerHour(100_000, 0)).toBeNull();
  });
});

describe('coordinates (test 14: corners, no swapped axes)', () => {
  it('maps 0,0 and 100,100 to opposite corners', () => {
    expect(wowToLatLng(0, 0)).toEqual([-0, 0]);
    expect(wowToLatLng(100, 100)).toEqual([-100, 100]);
    expect(wowToLatLng(50, 50)).toEqual([-50, 50]);
    const [[south, west], [north, east]] = mapBounds();
    expect([south, west, north, east]).toEqual([-100, 0, 0, 100]);
  });
  it('x is horizontal, y vertical', () => {
    expect(wowToPixel(100, 0, { width: 1002, height: 668 })).toEqual({ px: 1002, py: 0 });
    expect(wowToPixel(0, 100, { width: 1002, height: 668 })).toEqual({ px: 0, py: 668 });
  });
  it('round trips', () => {
    const [lat, lng] = wowToLatLng(33.8, 45.8);
    const back = latLngToWow(lat, lng);
    expect(back.x).toBeCloseTo(33.8);
    expect(back.y).toBeCloseTo(45.8);
  });
  it('rejects out-of-range coordinates', () => {
    expect(() => wowToLatLng(101, 5)).toThrow();
  });
  it('waypoint text (test 12)', () => {
    expect(waypoint(33.84, 45.8)).toBe('/way 33.8 45.8');
    expect(waypoint(5, 7, 'Sumpfland')).toBe('/way Sumpfland 5.0 7.0');
  });
});

describe('rare drop probability (test 8)', () => {
  it('computes 1-(1-p)^n', () => {
    expect(chanceAtLeastOne(0.001, 1000)).toBeCloseTo(1 - Math.pow(0.999, 1000), 10);
    expect(chanceAtLeastOne(0.5, 2)).toBeCloseTo(0.75);
    expect(expectedKills(0.001)).toBe(1000);
    expect(killsForConfidence(0.01, 0.9)).toBe(230);
  });
  it('no number for unknown p', () => {
    expect(chanceAtLeastOne(null, 100)).toBeNull();
    expect(expectedKills(null)).toBeNull();
    expect(killsForConfidence(undefined, 0.9)).toBeNull();
  });
});

describe('market', () => {
  it('freshness from original scan time, not fetch time', () => {
    const old = quote({ observedAt: new Date(Date.now() - 5 * 3600_000).toISOString(), fetchedAt: new Date().toISOString() });
    expect(freshness(old, 120)).toBe('stale');
    expect(freshness(quote(), 120)).toBe('fresh');
    expect(freshness(quote({ observedAt: null }), 120)).toBe('unknown');
    expect(freshness(quote({ cacheExpiresAt: new Date(Date.now() - 1000).toISOString() }), 120)).toBe('expired');
    expect(freshness(quote({ provider: 'manual' }), 120)).toBe('manual');
    expect(freshness(null, 120)).toBe('unknown');
  });
  it('valuation prefers median and never invents a price', () => {
    expect(valuationPrice(quote())).toEqual({ copper: 27, statistic: 'median' });
    expect(valuationPrice(quote({ medianCopper: null }))).toEqual({ copper: 26, statistic: 'min_buyout' });
    expect(valuationPrice(quote({ medianCopper: null, minBuyoutCopper: null }))).toBeNull();
  });
  it('house cut and market isolation (test 20)', () => {
    expect(afterCut(10_000, 5)).toBe(9_500);
    expect(quoteMatches(quote(), 'ahledger', 'forever.pvp.horde.eu')).toBe(false);
    expect(quoteMatches(quote(), 'ahledger', 'forever.normal.alliance.eu')).toBe(true);
  });
});

describe('classic rules', () => {
  it('gray level (cmangos Formulas.h)', () => {
    expect(grayLevel(5)).toBe(0);
    expect(grayLevel(28)).toBe(21);
    expect(grayLevel(45)).toBe(35);
    expect(grayLevel(60)).toBe(51);
    expect(conColor(28, 21)).toBe('gray');
    expect(conColor(28, 22)).toBe('green');
    expect(conColor(28, 30)).toBe('yellow');
    expect(conColor(28, 33)).toBe('red');
  });
  it('skinning formula', () => {
    expect(skinningSkillFor(10)).toBe(1);
    expect(skinningSkillFor(20)).toBe(100);
    expect(skinningSkillFor(27)).toBe(135);
    expect(skinningSkillFor(60)).toBe(300);
  });
  it('gathering colours', () => {
    expect(gatherSkillColor(0, 245)).toBe('red');
    expect(gatherSkillColor(230, 230)).toBe('orange');
    expect(gatherSkillColor(300, 175)).toBe('gray');
  });
});

describe('session math (gold/h measured)', () => {
  const s: FarmSession = {
    id: 'a', profileId: 'p', spotId: 'x', startedAt: '', endedAt: '', state: 'ended', activeMs: 30 * 60_000, lastResumedAt: null,
    kills: 60, xpGained: 30_000, rawCopper: 5_000, vendorCopper: 20_000, realizedAuctionCopper: 15_000, repairsCopper: 2_000,
    purchasesCopper: 1_000, deaths: 0, notes: null, provider: null, marketId: null,
    loot: [{ itemId: 2319, quantity: 20, realizedCopper: null, unitPriceCopper: 100, priceSource: 'ahledger', priceObservedAt: null }],
  };
  it('computes net gold per active hour and keeps unsold loot separate', () => {
    const st = sessionStats(s);
    expect(st.netCopper).toBe(37_000);
    expect(st.netGoldPerHour).toBeCloseTo(7.4);
    expect(st.killsPerHour).toBe(120);
    expect(st.xpPerHour).toBe(60_000);
    expect(st.unsoldInventoryCopper).toBe(2_000);
  });
  it('no gold/h without money data', () => {
    const st = sessionStats({ ...s, rawCopper: null, vendorCopper: null, realizedAuctionCopper: null, repairsCopper: null, purchasesCopper: null });
    expect(st.netGoldPerHour).toBeNull();
  });
});
