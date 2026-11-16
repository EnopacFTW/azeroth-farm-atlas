import { z } from 'zod';

export const CLASSES = ['warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'] as const;
export const PRIMARY_PROFESSIONS = ['skinning', 'mining', 'herbalism', 'leatherworking', 'tailoring', 'engineering', 'alchemy', 'blacksmithing', 'enchanting'] as const;
export const SECONDARY_PROFESSIONS = ['cooking', 'first_aid', 'fishing'] as const;
export const OBJECTIVES = ['xp', 'gold', 'cloth', 'skinning', 'mining', 'herbalism', 'fishing', 'rare', 'materials', 'professions'] as const;

export type ClassId = (typeof CLASSES)[number];
export type ProfessionId = (typeof PRIMARY_PROFESSIONS)[number] | (typeof SECONDARY_PROFESSIONS)[number];
export type FarmObjective = (typeof OBJECTIVES)[number];
export type Reliability = 'forever_live_verified' | 'forever_client_data' | 'forever_player_observed' | 'classic_fallback' | 'manual_unverified';

const profSkill = z.object({ id: z.string(), skill: z.number().int().min(0).max(300), targetSkill: z.number().int().min(0).max(300).nullish() });

export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(40),
  level: z.number().int().min(1).max(60),
  class: z.enum(CLASSES),
  race: z.string().nullish(),
  faction: z.enum(['alliance', 'horde']),
  region: z.enum(['eu', 'us', 'kr', 'tw', 'cn']),
  ruleset: z.enum(['normal', 'pvp', 'rp', 'rppvp']),
  professions: z.array(profSkill.extend({ id: z.enum(PRIMARY_PROFESSIONS) })).max(2),
  secondary: z.array(profSkill.extend({ id: z.enum(SECONDARY_PROFESSIONS) })).default([]),
  playstyle: z.array(z.string()).default([]),
  durationMin: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)]),
  startZoneId: z.number().int().nullish(),
  priorities: z.object({ xp: z.number().min(0).max(100), gold: z.number().min(0).max(100), profession: z.number().min(0).max(100), rare: z.number().min(0).max(100) }),
  goals: z.array(z.enum(OBJECTIVES)),
  allowClassicFallback: z.boolean(),
  market: z.object({ provider: z.string(), marketId: z.string().nullish() }),
  ui: z.any().optional(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export interface CandidateNpc {
  id: number; nameEn: string; nameDe: string | null; levelMin: number | null; levelMax: number | null; rank: number | null;
  canSkin: 0 | 1 | null; skinMin: number | null; skinMax: number | null; creatureType: string | null; inClassic: 0 | 1; spawns: number;
}
export interface CandidateObject { id: number; nameEn: string; nameDe: string | null; nodeType: 'ore' | 'herb' | 'fishing_pool'; requiredSkill: number | null; spawns: number }
export interface SpotItem {
  itemId: number; nameEn: string; nameDe: string | null; quality: number | null; context: LootContext; rate: number | null;
  foreverConfirmed: 0 | 1; vendorSell: number | null; isCloth: 0 | 1;
}
export type LootContext = 'normal_kill' | 'skinning' | 'herb_node' | 'mining_node' | 'fishing' | 'quest';
export type SpotKind = 'mob_cluster' | 'mob_scattered' | 'rare_mob' | 'node_zone' | 'fishing_pool' | 'fishing_zone';

export interface ZoneRef {
  nameEn: string; nameDe: string | null; kind: string; control: 'alliance' | 'horde' | 'contested' | 'sanctuary' | null;
  uiMapId: number | null; levelMin: number | null; levelMax: number | null; fishingBaseSkill: number | null;
}

export interface SpotCandidate {
  id: string; slug: string; kind: SpotKind; titleEn: string; titleDe: string; zoneId: number; zone: ZoneRef;
  levelMin: number | null; levelMax: number | null; centerX: number | null; centerY: number | null; radius: number | null;
  spawnCount: number; tags: FarmObjective[]; professions: ProfessionId[]; hasElite: 0 | 1; hasRare: 0 | 1; isInstance: 0 | 1;
  reqSkillType: 'skinning' | 'mining' | 'herbalism' | 'fishing' | null; reqSkill: number | null;
  avgCoinCopper: number | null; modelVendorCopperPerKill: number | null; modelVendorPartial: 0 | 1 | null;
  routeKind: string | null; routeCurated: 0 | 1; generated: 0 | 1; srcCore: string;
  npcs: CandidateNpc[]; objects: CandidateObject[]; items: SpotItem[];
}

export interface LootRow {
  itemId: number; nameEn: string; nameDe: string | null; quality: number | null; context: LootContext; rate: number | null;
  minQty: number | null; maxQty: number | null; groupId: number | null; vendorSell: number | null; isCloth: 0 | 1;
  sourceId: string; reliability: Reliability;
}

export interface SpotDetail {
  spot: Omit<SpotCandidate, 'zone' | 'npcs' | 'objects' | 'items'> & { hull: [number, number][] | null; route: [number, number][] | null };
  zone: ZoneRef & { id: number; continent: string; srcMeta: string; srcMap: string | null };
  npcs: (CandidateNpc & { subName: string | null; classification: string | null; minCoin: number | null; maxCoin: number | null;
    srcCore: string; srcCombat: string | null; loot: LootRow[] })[];
  objects: (CandidateObject & { skillSource: string | null; srcCore: string; loot: LootRow[] })[];
  zoneLoot: LootRow[];
  points: ['npc' | 'object', number, number, number][];
}

export type ProviderId = 'ahledger' | 'blizzard_forever' | 'auctionhouse_fyi' | 'manual';

export interface Market {
  provider: ProviderId; id: string; region: string; ruleset: string; faction: string; label: string;
  houseId?: number; houseName?: string; confirmed: boolean;
}

export interface MarketQuote {
  provider: ProviderId; marketId: string; region: string; ruleset: string; faction: string; houseId: number | null;
  itemId: number; variantKey: string | null;
  minBuyoutCopper: number | null; medianCopper: number | null; referencePriceCopper: number | null;
  median7dCopper: number | null; median30dCopper: number | null; quantityListed: number | null; auctions: number | null;
  estimatedUnitsSoldPerDay: number | null; observedAt: string | null; fetchedAt: string; cacheExpiresAt: string | null;
  isLiveSnapshot: boolean; sourceUrl: string | null; attributionText: string; attributionUrl: string | null;
  dataSourceNote: string | null; fromCache: boolean;
}

export interface PriceSeries {
  provider: ProviderId; marketId: string; itemId: number; range: string;
  points: { t: string; min: number | null; median: number | null; quantity: number | null }[];
  attributionText: string; attributionUrl: string | null; fetchedAt: string;
}

export interface ProviderHealth {
  provider: string; enabled: boolean; reachable: boolean | null; checkedAt: string | null; lastSuccessAt: string | null;
  lastResponseMs: number | null; lastDataAt: string | null; credentialsRequired: boolean; credentialsConfigured: boolean;
  marketsFound: number; lastError: string | null; testedEndpoint: string | null; experimental: boolean;
}

export interface SyncStatus {
  provider: string; marketId: string; lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null;
  items: number; observedAt: string | null; notModified: boolean; note: string | null;
}

export interface MarketSettings { ahledgerEnabled: boolean; fyiEnabled: boolean; blizzardEnabled: boolean; blizzardRegion: string; blizzardCacheMinutes: number }

export interface AppSettings {
  activeProfileId: string | null; uiScale: number; alwaysOnTop: boolean; staleMinutes: number;
  ahCutPercentFaction: number; ahCutPercentNeutral: number; refreshIntervalMin: number; providerPriority: string[];
  market: MarketSettings; language: 'de' | 'en'; showUnavailable: boolean;
}

export interface SessionLoot { itemId: number; quantity: number; realizedCopper: number | null; unitPriceCopper: number | null; priceSource: string | null; priceObservedAt: string | null }
export interface FarmSession {
  id: string; profileId: string; spotId: string | null; startedAt: string; endedAt: string | null; state: 'running' | 'paused' | 'ended';
  activeMs: number; lastResumedAt: string | null; kills: number | null; xpGained: number | null; rawCopper: number | null;
  vendorCopper: number | null; realizedAuctionCopper: number | null; repairsCopper: number | null; purchasesCopper: number | null;
  deaths: number | null; notes: string | null; provider: string | null; marketId: string | null; loot: SessionLoot[];
}

export interface AppError { code: string; message: string; httpStatus?: number; retryAfterSecs?: number }
