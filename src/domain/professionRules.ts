import type { Profile, ProfessionId } from './types';

// Classic rules (cmangos Formulas.h / Wowpedia). Not verified against Forever – shown as classic_fallback in the UI.

/** Highest mob level that gives no XP ("grey"). cmangos MaNGOS::XP::GetGrayLevel. */
export function grayLevel(playerLevel: number): number {
  if (playerLevel <= 5) return 0;
  if (playerLevel <= 39) return playerLevel - 5 - Math.floor(playerLevel / 10);
  if (playerLevel <= 59) return playerLevel - 1 - Math.floor(playerLevel / 5);
  return playerLevel - 9;
}

export type ConColor = 'gray' | 'green' | 'yellow' | 'orange' | 'red';

export function conColor(playerLevel: number, mobLevel: number): ConColor {
  const d = mobLevel - playerLevel;
  if (d >= 5) return 'red';
  if (d >= 3) return 'orange';
  if (d >= -2) return 'yellow';
  if (mobLevel > grayLevel(playerLevel)) return 'green';
  return 'gray';
}

/** Classic: level <= 20 -> (level - 10) * 10 (min 1), above -> level * 5. */
export function skinningSkillFor(mobLevel: number): number {
  return mobLevel <= 20 ? Math.max(1, (mobLevel - 10) * 10) : mobLevel * 5;
}

export function skillOf(profile: Profile, id: ProfessionId): number | null {
  const p = [...profile.professions, ...profile.secondary].find((s) => s.id === id);
  return p ? p.skill : null;
}

export function hasProfession(profile: Profile, id: ProfessionId): boolean {
  return skillOf(profile, id) != null;
}

export const PROFESSION_LABEL: Record<ProfessionId, string> = {
  skinning: 'Kürschnerei', mining: 'Bergbau', herbalism: 'Kräuterkunde', leatherworking: 'Lederverarbeitung', tailoring: 'Schneiderei',
  engineering: 'Ingenieurskunst', alchemy: 'Alchemie', blacksmithing: 'Schmiedekunst', enchanting: 'Verzauberkunst',
  cooking: 'Kochkunst', first_aid: 'Erste Hilfe', fishing: 'Angeln',
};

/** Which gathered materials a crafting profession actually uses ("bei mir verwertbar"). */
export const USES: Partial<Record<ProfessionId, ('skinning' | 'cloth' | 'mining' | 'herbalism' | 'fishing')[]>> = {
  leatherworking: ['skinning'],
  tailoring: ['cloth'],
  first_aid: ['cloth'],
  blacksmithing: ['mining'],
  engineering: ['mining'],
  alchemy: ['herbalism'],
  cooking: ['fishing'],
};

/** Gathering skill-up colour in Classic: orange < req+25, yellow < req+50, green < req+100, grey beyond. */
export function gatherSkillColor(skill: number, req: number): 'red' | 'orange' | 'yellow' | 'green' | 'gray' {
  if (skill < req) return 'red';
  if (skill < req + 25) return 'orange';
  if (skill < req + 50) return 'yellow';
  if (skill < req + 100) return 'green';
  return 'gray';
}
