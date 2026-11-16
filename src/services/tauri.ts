// Typed wrappers around the native Rust commands. The UI never calls a provider URL itself.
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { openUrl } from '@tauri-apps/plugin-opener';
import type {
  AppError, AppSettings, FarmSession, Market, MarketQuote, PriceSeries, Profile, ProviderHealth, SessionLoot, SpotCandidate, SpotDetail, SyncStatus,
} from '@/domain/types';
import type { MapCalibration } from '@/domain/coordinates';
import { tr } from '@/i18n';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop) {
    const e: AppError = { code: 'no_desktop', message: tr('Diese Ansicht läuft nur in der Windows-App (Tauri). Bitte „npm run tauri dev“ verwenden.', 'This view only runs in the Windows app (Tauri). Please use “npm run tauri dev”.') };
    throw e;
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (typeof e === 'object' && e && 'code' in e) throw e as AppError;
    throw { code: 'unknown', message: String(e) } satisfies AppError;
  }
}

export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as AppError).message);
  return String(e);
}

export interface AppInfo {
  version: string; dataDir: string; seedInstalledNow: boolean; httpUserAgent: string;
  manifest: { builtAt: string; seedSha256: string; counts: Record<string, unknown>; sources: { id: string; name: string; version: string; license: string }[] };
}
export interface SearchHit { kind: 'item' | 'npc' | 'zone' | 'object'; id: number; nameEn: string; nameDe: string | null }
export interface ManualPrice { itemId: number; marketId: string; unitCopper: number; note: string | null; updatedAt?: string | null }
export interface CraftingRecipe {
  recipe: { spellId: number; name: string; profession: string; skillRequired: number | null; acquisition: string };
  result: { id: number; name: string; quality: string; qtyMin: number; qtyMax: number; url: string };
  resultPrice: number | null; netValue: number | null; cost: number | null; margin: number | null; resultSalesPerDay: number | null;
  reagents: { id: number; name: string; qty: number; price: number | null }[];
}
export interface CraftingResponse {
  market: string; marketStatus: string; pricesAsOf: string | null; generatedAt: string; fetchedAt: string; notes: string;
  attribution: { text: string; url: string }; recipes: CraftingRecipe[];
}
export interface MapAsset { zoneId: number; fileName: string; path: string; width: number; height: number; calibration: MapCalibration; originalName: string | null; importedAt: string }
export interface ZoneDensity { zoneId: number; cols: number; rows: number; total: number; max: number; cells: number[] }

export interface WowClient { root: string; product: string; label: string; version: string }
export interface ClientMapImport { imported: number; keptOwn: number; missing: number[]; source: string }
/** Maps read from the local WoW client carry this prefix in originalName. */
export const isClientMap = (a: MapAsset | null | undefined) => !!a?.originalName?.startsWith('WoW-Client');

/** URL for an imported map image (asset protocol, scope $APPDATA/maps/*). */
export const mapImageUrl = (a: MapAsset) => convertFileSrc(a.path);

export interface CandidateQuery { level: number; below?: number; above?: number; zoneId?: number | null; includeInstances?: boolean }

export const api = {
  appInfo: () => call<AppInfo>('app_info'),
  searchSpots: (query: CandidateQuery) => call<SpotCandidate[]>('search_spots', { query }),
  getSpot: (id: string) => call<SpotDetail>('get_spot', { id }),
  getItem: (id: number) => call<any>('get_item', { id }),
  getNpc: (id: number) => call<any>('get_npc', { id }),
  search: (q: string, kinds?: string[], limit?: number) => call<SearchHit[]>('search', { q, kinds, limit }),
  listZones: () => call<any[]>('list_zones'),
  zoneLayer: (zoneId: number) => call<any>('zone_layer', { zoneId }),
  listSources: () => call<any[]>('list_sources'),
  getCoverage: () => call<any>('get_coverage'),
  zoneDensity: (zoneId: number) => call<ZoneDensity>('zone_density', { zoneId }),
  getMapAsset: (zoneId: number) => call<MapAsset | null>('get_map_asset', { zoneId }),
  listMapAssets: () => call<MapAsset[]>('list_map_assets'),
  importMapImage: (zoneId: number) => call<MapAsset | null>('import_map_image', { zoneId }),
  importMapFolder: () => call<{ imported: MapAsset[]; skipped: string[] } | null>('import_map_folder'),
  setMapCalibration: (zoneId: number, calibration: MapCalibration) => call<MapAsset>('set_map_calibration', { zoneId, calibration }),
  deleteMapAsset: (zoneId: number) => call<void>('delete_map_asset', { zoneId }),
  detectWowClients: () => call<WowClient[]>('detect_wow_clients'),
  pickWowClient: () => call<WowClient[] | null>('pick_wow_client'),
  importClientMaps: (c: WowClient, replaceOwn: boolean) => call<ClientMapImport>('import_client_maps', { root: c.root, product: c.product, replaceOwn }),

  listProfiles: () => call<Profile[]>('list_profiles'),
  saveProfile: (profile: Profile) => call<Profile>('save_profile', { profile }),
  deleteProfile: (id: string) => call<void>('delete_profile', { id }),
  duplicateProfile: (id: string) => call<Profile>('duplicate_profile', { id }),
  setActiveProfile: (id: string) => call<void>('set_active_profile', { id }),
  exportProfile: (id: string) => call<string | null>('export_profile', { id }),
  importProfile: () => call<Profile | null>('import_profile'),

  startSession: (profileId: string, spotId: string | null, provider: string | null, marketId: string | null) =>
    call<FarmSession>('start_session', { profileId, spotId, provider, marketId }),
  sessionAction: (id: string, action: 'pause' | 'resume' | 'end') => call<FarmSession>('session_action', { id, action }),
  patchSession: (id: string, patch: Partial<Omit<FarmSession, 'loot'>> & { loot?: SessionLoot[] }) => call<FarmSession>('patch_session', { id, patch }),
  listSessions: (profileId: string) => call<FarmSession[]>('list_sessions', { profileId }),
  deleteSession: (id: string) => call<void>('delete_session', { id }),
  exportSessions: (profileId: string, format: 'csv' | 'json') => call<string | null>('export_sessions', { profileId, format }),

  listMarkets: (provider: string, refresh = false) => call<Market[]>('list_markets', { provider, refresh }),
  fetchQuotes: (provider: string, marketId: string, itemIds: number[]) => call<MarketQuote[]>('fetch_quotes', { provider, marketId, itemIds }),
  fetchQuoteDetail: (provider: string, marketId: string, itemId: number, range = '7d', variantKey?: string | null) =>
    call<{ quote: MarketQuote | null; series: PriceSeries | null }>('fetch_quote_detail', { provider, marketId, itemId, range, variantKey }),
  fetchCrafting: (marketId: string, profession: string) => call<CraftingResponse>('fetch_crafting', { marketId, profession }),
  syncMarketPrices: (provider: string, marketId: string) => call<SyncStatus>('sync_market_prices', { provider, marketId }),
  cancelMarketSync: () => call<void>('cancel_market_sync'),
  getMarketSyncStatus: () => call<SyncStatus[]>('get_market_sync_status'),
  providerHealth: (provider: string) => call<ProviderHealth>('provider_health', { provider }),
  cachedProviderHealth: () => call<ProviderHealth[]>('cached_provider_health'),
  setCredential: (name: string, value: string) => call<void>('set_credential', { name, value }),
  deleteCredential: (name: string) => call<void>('delete_credential', { name }),
  credentialStatus: () => call<Record<string, boolean>>('credential_status'),
  clearPriceCache: () => call<void>('clear_price_cache'),
  setManualPrice: (price: ManualPrice) => call<void>('set_manual_price', { price }),
  deleteManualPrice: (itemId: number, marketId: string) => call<void>('delete_manual_price', { itemId, marketId }),
  listManualPrices: (marketId?: string | null) => call<ManualPrice[]>('list_manual_prices', { marketId }),

  getSettings: () => call<AppSettings>('get_settings'),
  saveSettings: (settings: AppSettings) => call<AppSettings>('save_settings', { settings }),
  toggleFavorite: (profileId: string, spotId: string) => call<boolean>('toggle_favorite', { profileId, spotId }),
  listFavorites: (profileId: string) => call<string[]>('list_favorites', { profileId }),
  toggleWatch: (profileId: string, itemId: number) => call<boolean>('toggle_watch', { profileId, itemId }),
  listWatchlist: (profileId: string) => call<number[]>('list_watchlist', { profileId }),
  backupUserData: () => call<string | null>('backup_user_data'),
  resetLocalData: (confirm: string) => call<void>('reset_local_data', { confirm }),
};

export async function copyText(text: string): Promise<void> {
  if (isDesktop) await writeText(text);
  else await navigator.clipboard.writeText(text);
}

export async function openExternal(url: string): Promise<void> {
  if (!/^https:\/\//.test(url)) return;
  if (isDesktop) await openUrl(url);
  else window.open(url, '_blank', 'noopener');
}
