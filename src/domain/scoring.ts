import type { FarmObjective, Profile, ProfessionId, SpotCandidate } from './types';
import { conColor, grayLevel, hasProfession, PROFESSION_LABEL, skillOf, USES } from './professionRules';
import { formatCopper } from './money';

// ---------------------------------------------------------------------------------------------------------------------
// Filters (hard constraints) and transparent fit scoring. Documented in docs/architecture.md#scoring.
// fitScore (0-100) = weighted mean of the KNOWN factors only (unknown factors are removed, never scored as 0).
// economic values are reported separately and never mixed into fitScore.
// ---------------------------------------------------------------------------------------------------------------------

export interface FinderFilters {
  objectives: FarmObjective[];
  soloOnly: boolean;
  noElites: boolean;
  noInstances: boolean;
  lowPvpRisk: boolean;
  requireXp: boolean;
  usableForMe: boolean;
  foreverOnly: boolean;
  showUnavailable: boolean;
  maxAbove: number; // highest acceptable mob level above player level
}

export const DEFAULT_FILTERS: FinderFilters = {
  objectives: [],
  soloOnly: true,
  noElites: true,
  noInstances: true,
  lowPvpRisk: false,
  requireXp: false,
  usableForMe: false,
  foreverOnly: false,
  showUnavailable: false,
  maxAbove: 3,
};

export type Availability = 'ready' | 'skill_missing' | 'profession_missing' | 'too_high' | 'excluded' | 'incomplete_data';

export interface Factor { key: string; label: string; weight: number; value: number }

export interface ScoredSpot {
  spot: SpotCandidate;
  availability: Availability;
  visible: boolean;
  fitScore: number;
  factors: Factor[];
  why: string[];
  whyNot: string[];
  missing: string[];
  matchedObjectives: FarmObjective[];
  skinnableShare: number | null;
  pvpRisk: 'low' | 'medium' | 'high' | 'unknown';
  vendorPerKillCopper: number | null;
}

const OBJ_LABEL: Record<FarmObjective, string> = {
  xp: 'XP', gold: 'Gold', cloth: 'Stoff', skinning: 'Kürschnerei', mining: 'Bergbau', herbalism: 'Kräuterkunde', fishing: 'Angeln',
  rare: 'Rares', materials: 'Materialien', professions: 'Berufe',
};

const GATHER: Record<string, ProfessionId> = { mining: 'mining', herbalism: 'herbalism', fishing: 'fishing', skinning: 'skinning' };

export function pvpRisk(profile: Profile, spot: SpotCandidate): ScoredSpot['pvpRisk'] {
  const pvpRuleset = profile.ruleset === 'pvp' || profile.ruleset === 'rppvp';
  const c = spot.zone.control;
  if (spot.isInstance) return 'low';
  if (!c) return 'unknown';
  if (c === 'sanctuary' || !pvpRuleset) return 'low';
  if (c === profile.faction) return 'low';
  if (c === 'contested') return 'medium';
  return 'high';
}

function levelFit(player: number, min: number, max: number): number {
  // ideal: mobs 1-3 below to 1 above (fast solo kills, still good XP)
  const avg = (min + max) / 2;
  const d = avg - player;
  if (d >= -3 && d <= 1) return 1;
  if (d > 1) return Math.max(0, 1 - (d - 1) / 3);
  return Math.max(0, 1 - (-3 - d) / 7);
}

function densityFit(spawns: number): number {
  return Math.max(0, Math.min(1, Math.log10(Math.max(1, spawns)) / Math.log10(60)));
}

export function scoreSpot(profile: Profile, spot: SpotCandidate, filters: FinderFilters): ScoredSpot {
  const why: string[] = [];
  const whyNot: string[] = [];
  const missing: string[] = [];
  const factors: Factor[] = [];
  let availability: Availability = 'ready';
  let excluded = false;
  const L = profile.level;
  const isMob = spot.kind === 'mob_cluster' || spot.kind === 'mob_scattered' || spot.kind === 'rare_mob';
  const objectives = filters.objectives.length ? filters.objectives : profile.goals;
  const pr = profile.priorities;

  // ---- data quality: Forever-only mode drops tags that rest on Classic fallback data
  const tags = new Set(spot.tags);
  const classicOnlyTags: FarmObjective[] = [];
  if (filters.foreverOnly || !profile.allowClassicFallback) {
    if (tags.has('skinning')) { tags.delete('skinning'); classicOnlyTags.push('skinning'); }
    if (tags.has('cloth') && !spot.items.some((i) => i.isCloth && i.foreverConfirmed)) { tags.delete('cloth'); classicOnlyTags.push('cloth'); }
    if (tags.has('gold') && spot.avgCoinCopper != null) { tags.delete('gold'); classicOnlyTags.push('gold'); }
  }

  // ---- objective match (a tag is only "met" if the character can actually use it)
  const matched: FarmObjective[] = [];
  for (const o of objectives) {
    if (o === 'professions') {
      const mine = [...profile.professions, ...profile.secondary].map((p) => p.id);
      if (spot.professions.some((p) => mine.includes(p))) matched.push(o);
      continue;
    }
    if (tags.has(o)) matched.push(o);
  }
  if (objectives.length && !matched.length) {
    excluded = true;
    const lost = classicOnlyTags.filter((t) => objectives.includes(t));
    if (lost.length) {
      availability = 'incomplete_data';
      whyNot.push(`${lost.map((t) => OBJ_LABEL[t]).join(', ')} nur über Classic-Fallback belegt (Forever-only aktiv)`);
    } else {
      whyNot.push(`Passt zu keinem gewählten Farmziel (${objectives.map((o) => OBJ_LABEL[o]).join(', ')})`);
    }
  }

  // ---- hard: elites / instances / solo
  if (spot.hasElite && (filters.noElites || filters.soloOnly)) { excluded = true; whyNot.push('Elite-Gegner (Filter „Keine Elites“/„Nur solo“)'); }
  if (spot.isInstance && (filters.noInstances || filters.soloOnly)) { excluded = true; whyNot.push('Instanz (Filter „Keine Instanzen“)'); }

  // ---- PvP risk (derived only from zone control + ruleset)
  const risk = pvpRisk(profile, spot);
  if (filters.lowPvpRisk && risk === 'high') { excluded = true; whyNot.push('Feindliches Gebiet auf PvP-Ruleset'); }

  // ---- levels
  let skinnableShare: number | null = null;
  if (isMob && spot.levelMin != null && spot.levelMax != null) {
    const gray = grayLevel(L);
    if (spot.levelMin > L + filters.maxAbove) {
      excluded = true;
      if (availability === 'ready') availability = 'too_high';
      whyNot.push(`Mobs Level ${spot.levelMin}–${spot.levelMax} sind zu hoch (max. ${L + filters.maxAbove})`);
    }
    if (spot.levelMax <= gray) {
      whyNot.push(`Mobs grau (≤ ${gray}): keine XP mehr (Classic-Regel)`);
      if (filters.requireXp || (objectives.length === 1 && objectives[0] === 'xp')) excluded = true;
      tags.delete('xp');
    }
    factors.push({ key: 'level', label: 'Level-Eignung', weight: 30 * (0.5 + pr.xp / 100), value: levelFit(L, spot.levelMin, spot.levelMax) });
    why.push(`Mobs Level ${spot.levelMin}–${spot.levelMax} (dein Level: ${L}, Farbe: ${conColorDe(conColor(L, spot.levelMax))})`);
  } else if (!isMob && spot.zone.levelMax != null) {
    // gathering: danger from zone mobs
    const danger = spot.zone.levelMax - L;
    if (danger > 5) whyNot.push(`Zonen-Mobs bis Level ${spot.zone.levelMax} (abgeleitet) – gefährlich auf Level ${L}`);
    factors.push({ key: 'zone', label: 'Zonen-Gefahr', weight: 15, value: danger <= 0 ? 1 : Math.max(0, 1 - danger / 10) });
  }

  // ---- skills
  if (spot.reqSkillType && GATHER[spot.reqSkillType]) {
    const prof = GATHER[spot.reqSkillType];
    const skill = skillOf(profile, prof);
    if (spot.reqSkillType === 'skinning') {
      const skinnable = spot.npcs.filter((n) => n.canSkin === 1);
      const total = spot.npcs.reduce((a, n) => a + n.spawns, 0) || 1;
      const dropSkinningMatch = () => {
        const i = matched.indexOf('skinning');
        if (i >= 0) matched.splice(i, 1);
      };
      if (skill == null) {
        if (objectives.includes('skinning')) whyNot.push('Kein Kürschner – Kürschnerbeute nicht verfügbar');
        dropSkinningMatch();
        if (objectives.includes('skinning') && matched.length === 0) { excluded = true; availability = 'profession_missing'; }
      } else {
        const ok = skinnable.filter((n) => (n.skinMax ?? n.skinMin ?? 999) <= skill);
        skinnableShare = ok.reduce((a, n) => a + n.spawns, 0) / total;
        const reqMin = Math.min(...skinnable.map((n) => n.skinMin ?? 999));
        const reqMax = Math.max(...skinnable.map((n) => n.skinMax ?? 0));
        if (ok.length === 0) {
          whyNot.push(`Noch nicht kürschnerbar: benötigt ${reqMin}–${reqMax}, du hast ${skill} (Classic-Formel)`);
          dropSkinningMatch();
          if (objectives.includes('skinning') && matched.length === 0) { excluded = true; availability = 'skill_missing'; }
        } else {
          why.push(`Kürschnerbar mit ${skill}: ${ok.length} von ${skinnable.length} Mob-Typen (benötigt ${reqMin}–${reqMax}, Classic-Formel)`);
          factors.push({ key: 'skill', label: 'Kürschner-Skill passt', weight: 20 * (0.5 + pr.profession / 100), value: skinnableShare });
        }
      }
    } else {
      const req = spot.reqSkill;
      const label = PROFESSION_LABEL[prof];
      if (skill == null) {
        excluded = true;
        availability = 'profession_missing';
        whyNot.push(`${label} nicht erlernt${req != null ? ` (benötigt ${req})` : ''}`);
      } else if (req == null) {
        missing.push(`Benötigter ${label}-Skill unbekannt`);
      } else if (skill < req) {
        excluded = true;
        availability = 'skill_missing';
        whyNot.push(`Skill fehlt: ${label} ${req} benötigt, du hast ${skill}`);
      } else {
        const margin = skill - req;
        why.push(`${label} ${skill} ≥ ${req} – sofort farmbar${margin < 50 ? ' (gibt noch Skillpunkte)' : ''}`);
        factors.push({ key: 'skill', label: `${label}-Skill passt`, weight: 20 * (0.5 + pr.profession / 100), value: margin < 25 ? 1 : margin < 50 ? 0.85 : margin < 100 ? 0.6 : 0.35 });
      }
    }
  }

  // ---- usable for my crafting professions
  const usable = [...profile.professions, ...profile.secondary].flatMap((p) => (USES[p.id] ?? []).map((u) => ({ prof: p.id, uses: u })))
    .filter((u) => tags.has(u.uses) && (u.uses !== 'skinning' || hasProfession(profile, 'skinning')));
  if (usable.length) {
    const p = usable[0];
    const mat = spot.items.find((i) => (p.uses === 'skinning' ? i.context === 'skinning' : p.uses === 'cloth' ? i.isCloth : true));
    why.push(`${PROFESSION_LABEL[p.prof]} verwertet ${mat ? `${mat.nameDe ?? mat.nameEn}${mat.rate != null ? ` (${pct(mat.rate)})` : ''}` : 'diese Materialien'}`);
  } else if (filters.usableForMe) {
    excluded = true;
    whyNot.push('Keine Materialien für deine Handwerksberufe');
  }

  // ---- objective / density / risk factors
  if (objectives.length) {
    const prioW = (o: FarmObjective) => (o === 'xp' ? pr.xp : o === 'gold' ? pr.gold : o === 'rare' ? pr.rare : pr.profession) + 1;
    const total = objectives.reduce((a, o) => a + prioW(o), 0);
    const got = matched.reduce((a, o) => a + prioW(o), 0);
    factors.push({ key: 'objective', label: 'Farmziel-Treffer', weight: 25, value: got / total });
    if (matched.length) why.push(`Erfüllt: ${matched.map((m) => OBJ_LABEL[m]).join(', ')}`);
  }
  if (spot.spawnCount > 0) factors.push({ key: 'density', label: 'Spawndichte', weight: 15, value: densityFit(spot.spawnCount) });
  factors.push({
    key: 'risk', label: 'Solo/Risiko', weight: 10,
    value: (spot.hasElite ? 0.3 : 1) * (spot.isInstance ? 0.5 : 1) * (risk === 'high' ? 0.4 : risk === 'medium' ? 0.8 : 1),
  });
  if (spot.hasRare && objectives.includes('rare')) why.push('Enthält Rare-Mob oder seltene Drops (Rate siehe Details)');

  // ---- economics: Classic vendor model per kill (never a Gold/h)
  const vendorPerKill = isMob && profile.allowClassicFallback && !filters.foreverOnly ? spot.modelVendorCopperPerKill : null;
  if (vendorPerKill != null) {
    why.push(`Händlerwert ≈ ${formatCopper(vendorPerKill)}/Kill (Modell aus Classic-Dropchancen${spot.modelVendorPartial ? ', unvollständig' : ''})`);
  }
  missing.push('Gold/h: keine belastbaren Daten ohne gemessene Killrate (Farmtracker nutzen)');
  if (isMob && spot.items.some((i) => i.rate != null)) missing.push('Dropchancen stammen aus Classic-Emulator-Daten (cmangos), nicht Forever-gemessen');
  if (spot.npcs.some((n) => !n.inClassic)) missing.push('Einige Forever-NPCs fehlen in Classic-Daten: Typ/Loot unbekannt');
  if (spot.routeCurated === 0 && spot.routeKind) missing.push('Route ist eine Luftlinien-Punktfolge (Terrain nicht berücksichtigt)');
  if (spot.generated) missing.push('Spot automatisch aus Forever-Spawnpunkten gruppiert');

  // ---- fit score from known factors only
  const wsum = factors.reduce((a, f) => a + f.weight, 0);
  const fitScore = wsum ? Math.round((factors.reduce((a, f) => a + f.weight * f.value, 0) / wsum) * 100) : 0;

  if (excluded && availability === 'ready') availability = 'excluded';
  const visible = !excluded || (filters.showUnavailable && availability !== 'excluded');
  return {
    spot, availability, visible, fitScore, factors, why, whyNot, missing, matchedObjectives: matched, skinnableShare, pvpRisk: risk,
    vendorPerKillCopper: vendorPerKill,
  };
}

export type SortKey = 'fit' | 'level' | 'density' | 'vendor';

export function rankSpots(profile: Profile, spots: SpotCandidate[], filters: FinderFilters, sort: SortKey = 'fit'): ScoredSpot[] {
  const scored = spots.map((s) => scoreSpot(profile, s, filters)).filter((s) => s.visible);
  const cmp: Record<SortKey, (a: ScoredSpot, b: ScoredSpot) => number> = {
    fit: (a, b) => b.fitScore - a.fitScore || b.spot.spawnCount - a.spot.spawnCount,
    level: (a, b) => (a.spot.levelMin ?? 0) - (b.spot.levelMin ?? 0),
    density: (a, b) => b.spot.spawnCount - a.spot.spawnCount,
    // unknown economic values sort last, never as 0
    vendor: (a, b) => (b.vendorPerKillCopper ?? -1) - (a.vendorPerKillCopper ?? -1),
  };
  return scored.sort((a, b) => (a.availability === 'ready' ? 0 : 1) - (b.availability === 'ready' ? 0 : 1) || cmp[sort](a, b));
}

function conColorDe(c: string): string {
  return ({ gray: 'grau', green: 'grün', yellow: 'gelb', orange: 'orange', red: 'rot' } as Record<string, string>)[c] ?? c;
}

export function pct(rate: number): string {
  const p = rate * 100;
  return `${p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2)} %`.replace('.', ',');
}
