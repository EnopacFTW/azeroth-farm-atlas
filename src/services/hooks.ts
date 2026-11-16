import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './tauri';
import type { AppSettings, MarketQuote, Profile } from '@/domain/types';

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity });
}

export function useProfiles() {
  return useQuery({ queryKey: ['profiles'], queryFn: api.listProfiles, staleTime: Infinity });
}

/** Active profile = settings.activeProfileId (fallback: first profile). */
export function useActiveProfile(): { profile: Profile | undefined; settings: AppSettings | undefined; isLoading: boolean } {
  const s = useSettings();
  const p = useProfiles();
  const profile = p.data?.find((x) => x.id === s.data?.activeProfileId) ?? p.data?.[0];
  return { profile, settings: s.data, isLoading: s.isLoading || p.isLoading };
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.saveProfile,
    onSuccess: (saved) => {
      qc.setQueryData<Profile[]>(['profiles'], (old) => {
        const list = old ?? [];
        return list.some((p) => p.id === saved.id) ? list.map((p) => (p.id === saved.id ? saved : p)) : [...list, saved];
      });
    },
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.saveSettings, onSuccess: (s) => qc.setQueryData(['settings'], s) });
}

/** Market of the active profile; quotes are keyed by provider + market so a market switch never shows foreign prices. */
export function useMarketSelection() {
  const { profile } = useActiveProfile();
  return { provider: profile?.market.provider ?? 'ahledger', marketId: profile?.market.marketId ?? null };
}

export function useQuotes(itemIds: number[], enabled = true) {
  const { provider, marketId } = useMarketSelection();
  const ids = [...new Set(itemIds)].sort((a, b) => a - b);
  return useQuery<MarketQuote[]>({
    queryKey: ['quotes', provider, marketId, ids],
    queryFn: () => api.fetchQuotes(provider, marketId!, ids),
    enabled: enabled && !!marketId && ids.length > 0,
    staleTime: 60_000,
    retry: false,
  });
}
