import { grayLevel } from './professionRules';

// Classic kill XP (cmangos Formulas.h MaNGOS::XP::BaseGain/Gain, identical to warcraft.wiki.gg "Mob experience").
// Not verified against Forever – the UI labels it as Classic formula.

/** XP needed from level N to N+1 (index = level), Classic 1.x (warcraft.wiki.gg "Experience to level"). */
export const XP_TO_LEVEL: readonly number[] = [
  0, 400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600, 8800, 10100, 11400, 12900, 14400, 16000, 17700, 19400, 21300,
  23200, 25200, 27300, 29400, 31700, 34000, 36400, 38900, 41400, 44300, 47400, 50800, 54500, 58600, 62800, 67100, 71600, 76100,
  80800, 85700, 90700, 95800, 101000, 106300, 111800, 117500, 123200, 129100, 135100, 141200, 147500, 153900, 160400, 167100,
  173900, 180800, 187900, 195000, 202300, 209800,
];
export const MAX_LEVEL = 60;

/** Level difference at which a lower mob gives 0 XP (cmangos GetZeroDifference). */
export function zeroDifference(pl: number): number {
  if (pl < 8) return 5;
  if (pl < 10) return 6;
  if (pl < 12) return 7;
  if (pl < 16) return 8;
  if (pl < 20) return 9;
  if (pl < 30) return 11;
  if (pl < 40) return 12;
  if (pl < 45) return 13;
  if (pl < 50) return 14;
  if (pl < 55) return 15;
  if (pl < 60) return 16;
  return 17;
}

/** Base XP for one kill, integer maths as in cmangos BaseGain (Azeroth, nBaseExp = 45). */
export function baseKillXp(playerLevel: number, mobLevel: number): number {
  const pl = Math.max(1, Math.floor(playerLevel));
  const ml = Math.max(1, Math.floor(mobLevel));
  if (pl >= MAX_LEVEL) return 0;
  if (ml >= pl) {
    const diff = Math.min(ml - pl, 4);
    return Math.floor((Math.floor(((pl * 5 + 45) * (20 + diff)) / 10) + 1) / 2);
  }
  if (ml <= grayLevel(pl)) return 0;
  const zd = zeroDifference(pl);
  return Math.floor(((pl * 5 + 45) * (zd + ml - pl)) / zd);
}

/** Classic "IsElite": rank 1 elite, 2 rare elite, 3 boss (rank 4 = rare is not elite). */
export const isEliteRank = (rank: number | null | undefined) => rank === 1 || rank === 2 || rank === 3;

export interface KillXpOptions {
  rank?: number | null;
  /** creature_template.ExperienceMultiplier (Classic DB); null = unknown → 1. */
  xpMult?: number | null;
  rested?: boolean;
  /** Group size; Classic splits XP by level share – here an equal split approximation for same-level groups. */
  groupSize?: number;
}

/** XP for one kill incl. elite ×2, creature multiplier and rested ×2. */
export function killXp(playerLevel: number, mobLevel: number, o: KillXpOptions = {}): number {
  let xp = baseKillXp(playerLevel, mobLevel);
  if (isEliteRank(o.rank)) xp *= 2;
  xp = Math.floor(xp * (o.xpMult ?? 1));
  if (o.groupSize && o.groupSize > 1) xp = Math.floor(xp / o.groupSize);
  if (o.rested) xp *= 2;
  return xp;
}

/** XP range over a mob's level range (min/max level). */
export function killXpRange(playerLevel: number, levelMin: number, levelMax: number, o: KillXpOptions = {}): [number, number] {
  let lo = Infinity;
  let hi = 0;
  for (let l = levelMin; l <= Math.max(levelMin, levelMax); l++) {
    const x = killXp(playerLevel, l, o);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return [lo === Infinity ? 0 : lo, hi];
}

/** Average XP per kill over an even level spread. */
export function avgKillXp(playerLevel: number, levelMin: number, levelMax: number, o: KillXpOptions = {}): number {
  const n = Math.max(levelMin, levelMax) - levelMin + 1;
  let sum = 0;
  for (let l = levelMin; l <= levelMin + n - 1; l++) sum += killXp(playerLevel, l, o);
  return sum / n;
}

/** Kills needed for the rest of the current level (null if the mob gives no XP or at max level). */
export function killsToLevel(playerLevel: number, xpPerKill: number, xpIntoLevel = 0): number | null {
  const need = XP_TO_LEVEL[Math.floor(playerLevel)];
  if (!need || xpPerKill <= 0) return null;
  return Math.ceil(Math.max(0, need - xpIntoLevel) / xpPerKill);
}

export interface XpMob {
  levelMin: number | null;
  levelMax: number | null;
  rank: number | null;
  xpMult?: number | null;
  spawns: number;
}

export interface SpotXp {
  /** Spawn-weighted average XP per kill. */
  avg: number;
  min: number;
  max: number;
  /** Kills for the rest of the level at the average (null = no XP). */
  killsToLevel: number | null;
  /** Share of spawns that are elite (×2 XP, harder kills). */
  eliteShare: number;
}

/** XP of a mob spot for a player level: spawn-weighted over its mobs. Null if no mob has a level. */
export function spotXp(playerLevel: number, mobs: XpMob[], o: { rested?: boolean } = {}): SpotXp | null {
  const usable = mobs.filter((m) => m.levelMin != null);
  const total = usable.reduce((a, m) => a + Math.max(1, m.spawns), 0);
  if (!usable.length || !total) return null;
  let sum = 0;
  let min = Infinity;
  let max = 0;
  let elite = 0;
  for (const m of usable) {
    const opts = { rank: m.rank, xpMult: m.xpMult, rested: o.rested };
    const w = Math.max(1, m.spawns) / total;
    const [lo, hi] = killXpRange(playerLevel, m.levelMin!, m.levelMax ?? m.levelMin!, opts);
    sum += w * avgKillXp(playerLevel, m.levelMin!, m.levelMax ?? m.levelMin!, opts);
    min = Math.min(min, lo);
    max = Math.max(max, hi);
    if (isEliteRank(m.rank)) elite += w;
  }
  const avg = Math.round(sum);
  return { avg, min: min === Infinity ? 0 : min, max, killsToLevel: killsToLevel(playerLevel, avg), eliteShare: elite };
}

/** First player level at which a mob of this level gives no XP any more. */
export function grayFromLevel(mobLevel: number): number {
  for (let pl = 1; pl <= MAX_LEVEL; pl++) if (baseKillXp(pl, mobLevel) === 0) return pl;
  return MAX_LEVEL;
}
