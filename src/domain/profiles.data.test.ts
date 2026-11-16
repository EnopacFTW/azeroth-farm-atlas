// @vitest-environment node
// Runs the briefing's test profiles A–F against the REAL seed database through the SAME candidate SQL the app uses.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FILTERS, rankSpots, scoreSpot, type FinderFilters } from './scoring';
import type { Profile, SpotCandidate } from './types';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..', '..');
const db = new DatabaseSync(path.join(root, 'src-tauri', 'resources', 'seed.db'), { readOnly: true });
const SQL = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'db', 'queries', 'spot_candidates.sql'), 'utf8');

function candidates(level: number, includeInstances = false): SpotCandidate[] {
  return db.prepare(SQL).all({ level, above: 5, below: 12, zone: null, include_instances: includeInstances ? 1 : 0 })
    .map((r: { j: string }) => JSON.parse(r.j));
}

const base: Profile = {
  id: 't', name: 'Test', level: 28, class: 'hunter', faction: 'alliance', region: 'eu', ruleset: 'normal', professions: [], secondary: [],
  playstyle: ['solo'], durationMin: 30, priorities: { xp: 50, gold: 50, profession: 50, rare: 10 }, goals: ['xp'], allowClassicFallback: true,
  market: { provider: 'ahledger', marketId: 'forever.normal.alliance.eu' },
};
const f = (o: Partial<FinderFilters> = {}): FinderFilters => ({ ...DEFAULT_FILTERS, ...o });

describe('Profil A – Hunter 28, Kürschnerei 140 (wichtigster E2E-Fall)', () => {
  const A: Profile = { ...base, name: 'Enopac (Demo)', professions: [{ id: 'skinning', skill: 140 }, { id: 'leatherworking', skill: 1, targetSkill: 150 }],
    goals: ['xp', 'gold', 'skinning'] };
  const ranked = rankSpots(A, candidates(28), f({ objectives: ['xp', 'gold', 'skinning'] }));
  const top = ranked.slice(0, 40).map((r) => r.spot.id);

  it('finds real leather/XP spots incl. Wetlands raptors and Duskwood worgs', () => {
    expect(ranked.length).toBeGreaterThan(20);
    expect(top.some((id) => id.startsWith('mob:wetlands-mottled'))).toBe(true);
    expect(ranked.some((r) => r.spot.zoneId === 10 && r.spot.tags.includes('skinning'))).toBe(true);
    const raptor = ranked.find((r) => r.spot.id === 'mob:wetlands-mottled-scytheclaw')!;
    expect(raptor.availability).toBe('ready');
    expect(raptor.why.join(' ')).toMatch(/Kürschnerbar mit 140/);
    expect(raptor.missing.join(' ')).toMatch(/Gold\/h: keine belastbaren Daten/);
  });

  it('every visible ready spot has mobs within the level window and no elites', () => {
    for (const r of ranked.filter((r) => r.availability === 'ready' && r.spot.levelMin != null)) {
      expect(r.spot.levelMin!).toBeLessThanOrEqual(31);
      expect(r.spot.hasElite).toBe(0);
    }
  });

  it('level 28 -> 45 recalculates (test 1)', () => {
    const at45 = rankSpots({ ...A, level: 45 }, candidates(45), f({ objectives: ['xp', 'skinning'] }));
    expect(at45[0].spot.levelMax!).toBeGreaterThan(35);
    expect(at45.map((r) => r.spot.id)).not.toEqual(ranked.map((r) => r.spot.id));
  });

  it('Kürschnerei 140 marks higher mobs as not yet skinnable (test 2)', () => {
    const c = candidates(45).find((s) => s.tags.includes('skinning') && (s.reqSkill ?? 0) > 200)!;
    const s = scoreSpot({ ...A, level: 45 }, c, f({ objectives: ['skinning'], showUnavailable: true, maxAbove: 20 }));
    expect(s.availability).toBe('skill_missing');
    expect(s.whyNot.join(' ')).toMatch(/Noch nicht kürschnerbar/);
  });
});

describe('Profil B – Mage 35, Schneiderei, Ziel Seidenstoff', () => {
  const B: Profile = { ...base, level: 35, class: 'mage', professions: [{ id: 'tailoring', skill: 150 }, { id: 'enchanting', skill: 120 }], goals: ['cloth', 'gold'] };
  it('cloth spots drop cloth; skinning alone is no cloth source (test 4)', () => {
    const ranked = rankSpots(B, candidates(35), f({ objectives: ['cloth'] }));
    expect(ranked.length).toBeGreaterThan(5);
    for (const r of ranked) expect(r.spot.tags).toContain('cloth');
    const silk = ranked.filter((r) => r.spot.items.some((i) => i.itemId === 4306));
    expect(silk.length).toBeGreaterThan(0);
  });
});

describe('Profil C – Warrior 45, Bergbau 225, Ziel Mithril', () => {
  const C: Profile = { ...base, level: 45, class: 'warrior', professions: [{ id: 'mining', skill: 225 }, { id: 'blacksmithing', skill: 200 }], goals: ['mining'] };
  const ranked = rankSpots(C, candidates(45), f({ objectives: ['mining'] }));
  it('real Mithril nodes with skill check', () => {
    const mith = ranked.filter((r) => r.spot.objects.some((o) => o.nameEn === 'Mithril Deposit'));
    expect(mith.length).toBeGreaterThan(3);
    expect(mith.every((r) => r.availability === 'ready')).toBe(true);
    expect(ranked.some((r) => r.spot.objects.some((o) => o.nameEn === 'Small Thorium Vein'))).toBe(false);
  });
  it('Bergbau 0 never recommends Thorium as ready (test 3)', () => {
    const none = rankSpots({ ...C, professions: [{ id: 'mining', skill: 0 }] }, candidates(45), f({ objectives: ['mining'], showUnavailable: true }));
    const thor = none.filter((r) => r.spot.objects.some((o) => /Thorium/.test(o.nameEn)));
    expect(thor.length).toBeGreaterThan(0);
    expect(thor.every((r) => r.availability === 'skill_missing')).toBe(true);
  });
});

describe('Profil D – Druid 55, Kräuterkunde 280', () => {
  const D: Profile = { ...base, level: 55, class: 'druid', professions: [{ id: 'herbalism', skill: 280 }, { id: 'alchemy', skill: 240 }], goals: ['herbalism'] };
  it('no high-end nodes above the skill', () => {
    const ranked = rankSpots(D, candidates(55), f({ objectives: ['herbalism'] }));
    expect(ranked.length).toBeGreaterThan(5);
    for (const r of ranked) expect(r.spot.reqSkill ?? 0).toBeLessThanOrEqual(280);
    expect(ranked.some((r) => /Plaguebloom|Icecap|Black Lotus/.test(r.spot.titleEn))).toBe(false);
    expect(ranked.some((r) => /Mountain Silversage/.test(r.spot.titleEn))).toBe(true);
  });
});

describe('Profil E – Hunter 60, Kürschnerei 300, Teufelssaurierleder', () => {
  const E: Profile = { ...base, level: 60, professions: [{ id: 'skinning', skill: 300 }, { id: 'leatherworking', skill: 300 }], goals: ['skinning'] };
  it('Un\'Goro devilsaurs appear with elite warning when elites are allowed', () => {
    const ranked = rankSpots(E, candidates(60), f({ objectives: ['skinning'], noElites: false, soloOnly: false }));
    const devil = ranked.find((r) => r.spot.id === 'mob:un-goro-crater-devilsaur');
    expect(devil).toBeTruthy();
    expect(devil!.spot.hasElite).toBe(1);
    expect(devil!.spot.items.some((i) => i.itemId === 15417 && i.context === 'skinning')).toBe(true);
  });
  it('and are hidden with "Keine Elites"', () => {
    const ranked = rankSpots(E, candidates(60), f({ objectives: ['skinning'] }));
    expect(ranked.some((r) => r.spot.id === 'mob:un-goro-crater-devilsaur')).toBe(false);
  });
});

describe('Profil F – Level 9 ohne Berufe, Gold + XP', () => {
  it('starting-zone spots without any gathering profession', () => {
    const F: Profile = { ...base, level: 9, class: 'warrior', goals: ['gold', 'xp'] };
    const ranked = rankSpots(F, candidates(9), f({ objectives: ['gold', 'xp'] }));
    expect(ranked.length).toBeGreaterThan(10);
    expect(ranked.slice(0, 10).every((r) => (r.spot.levelMax ?? 0) <= 12)).toBe(true);
    expect(ranked.every((r) => !['mining', 'herbalism'].includes(r.spot.reqSkillType ?? ''))).toBe(true);
  });
});

describe('Classic fallback switch (test 11)', () => {
  it('Forever-only drops skinning (Classic-only evidence) and marks it', () => {
    const A: Profile = { ...base, professions: [{ id: 'skinning', skill: 140 }], goals: ['skinning'] };
    const spot = candidates(28).find((s) => s.id === 'mob:wetlands-mottled-scytheclaw')!;
    const s = scoreSpot(A, spot, f({ objectives: ['skinning'], foreverOnly: true, showUnavailable: true }));
    expect(s.availability).toBe('incomplete_data');
    expect(s.vendorPerKillCopper).toBeNull();
  });
});
