import { create } from 'zustand';
import { DEFAULT_FILTERS, type FinderFilters, type SortKey } from '@/domain/scoring';

// Transient UI state only. Persistent data (profiles, sessions, settings) lives in SQLite via Rust.
interface UiState {
  filters: FinderFilters;
  sort: SortKey;
  selectedSpotId: string | null;
  compare: string[];
  mapZoneId: number | null;
  layers: { npcs: boolean; ore: boolean; herb: boolean; fishing_pool: boolean; spots: boolean; route: boolean; hull: boolean };
  showAllResources: boolean;
  setFilters: (f: Partial<FinderFilters>) => void;
  setSort: (s: SortKey) => void;
  selectSpot: (id: string | null) => void;
  toggleCompare: (id: string) => void;
  setMapZone: (id: number | null) => void;
  toggleLayer: (k: keyof UiState['layers']) => void;
  setShowAllResources: (v: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  filters: DEFAULT_FILTERS,
  sort: 'fit',
  selectedSpotId: null,
  compare: [],
  mapZoneId: null,
  layers: { npcs: true, ore: true, herb: true, fishing_pool: true, spots: true, route: true, hull: true },
  showAllResources: false,
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  setSort: (sort) => set({ sort }),
  selectSpot: (selectedSpotId) => set({ selectedSpotId }),
  toggleCompare: (id) =>
    set((s) => ({ compare: s.compare.includes(id) ? s.compare.filter((x) => x !== id) : [...s.compare, id].slice(-4) })),
  setMapZone: (mapZoneId) => set({ mapZoneId }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setShowAllResources: (showAllResources) => set({ showAllResources }),
}));
