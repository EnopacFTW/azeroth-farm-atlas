import { describe, expect, it } from 'vitest';
import { avgKillXp, baseKillXp, grayFromLevel, killXp, killXpRange, killsToLevel, spotXp, XP_TO_LEVEL, zeroDifference } from './xp';

describe('Classic kill XP (cmangos BaseGain)', () => {
  it('same level = level × 5 + 45', () => {
    expect(baseKillXp(10, 10)).toBe(95);
    expect(baseKillXp(28, 28)).toBe(185);
    expect(baseKillXp(59, 59)).toBe(340);
  });
  it('higher mobs +5 % per level, capped at +4', () => {
    expect(baseKillXp(10, 12)).toBe(105);
    expect(baseKillXp(10, 14)).toBe(114);
    expect(baseKillXp(10, 20)).toBe(baseKillXp(10, 14));
  });
  it('lower mobs scale with zero difference, gray gives 0', () => {
    expect(zeroDifference(10)).toBe(7);
    expect(baseKillXp(10, 8)).toBe(67);
    expect(baseKillXp(28, 22)).toBe(84); // 185 × (11 − 6) / 11
    expect(baseKillXp(28, 21)).toBe(0); // gray level 21
    expect(baseKillXp(60, 60)).toBe(0);
  });
  it('elite ×2, creature multiplier, rested ×2, group split', () => {
    expect(killXp(30, 30, { rank: 1 })).toBe(390);
    expect(killXp(30, 30, { rank: 4 })).toBe(195); // rare (not elite)
    expect(killXp(30, 30, { xpMult: 0 })).toBe(0);
    expect(killXp(30, 30, { rested: true })).toBe(390);
    expect(killXp(30, 30, { groupSize: 3 })).toBe(65);
  });
  it('ranges, averages and kills to level', () => {
    expect(killXpRange(28, 27, 29)).toEqual([baseKillXp(28, 27), baseKillXp(28, 29)]);
    expect(avgKillXp(28, 28, 28)).toBe(185);
    expect(XP_TO_LEVEL[10]).toBe(7600);
    expect(killsToLevel(10, 95)).toBe(80);
    expect(killsToLevel(10, 95, 7505)).toBe(1);
    expect(killsToLevel(10, 0)).toBeNull();
  });
});

describe('spot XP', () => {
  it('weights by spawns and counts elites double', () => {
    const r = spotXp(28, [{ levelMin: 28, levelMax: 28, rank: 0, spawns: 3 }, { levelMin: 28, levelMax: 28, rank: 1, spawns: 1 }])!;
    expect(r.avg).toBe(Math.round(185 * 0.75 + 370 * 0.25));
    expect([r.min, r.max]).toEqual([185, 370]);
    expect(r.eliteShare).toBe(0.25);
    expect(r.killsToLevel).toBe(Math.ceil(41400 / r.avg));
    expect(spotXp(28, [{ levelMin: null, levelMax: null, rank: 0, spawns: 2 }])).toBeNull();
  });
  it('gray-from level', () => {
    expect(grayFromLevel(21)).toBe(28); // 21 is gray at 28
    expect(grayFromLevel(60)).toBe(60);
  });
});
