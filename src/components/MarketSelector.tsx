import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '@/services/tauri';
import { useActiveProfile, useSaveProfile } from '@/services/hooks';
import { marketLabelDe } from '@/domain/market';
import { Badge, Button, ErrorBox, Field, Select } from './ui';

const PROVIDERS = [
  { value: 'ahledger', label: 'AHledger (Standard, EU+US)' },
  { value: 'auctionhouse_fyi', label: 'auctionhouse.fyi (US-Snapshots)' },
  { value: 'blizzard_forever', label: 'Blizzard Forever (experimentell)' },
  { value: 'manual', label: 'Manuelle Preise' },
];

/** Region / ruleset / faction / house / provider for the active profile. Switching invalidates all price queries. */
export function MarketSelector() {
  const { profile } = useActiveProfile();
  const save = useSaveProfile();
  const qc = useQueryClient();
  const provider = profile?.market.provider ?? 'ahledger';
  const listProvider = provider === 'manual' ? 'ahledger' : provider;
  const markets = useQuery({ queryKey: ['markets', listProvider], queryFn: () => api.listMarkets(listProvider), retry: false, staleTime: 5 * 60_000 });
  if (!profile) return null;
  const setMarket = (patch: Partial<typeof profile.market>) => {
    save.mutate({ ...profile, market: { ...profile.market, ...patch } }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }) });
  };
  const list = markets.data ?? [];
  const sorted = [...list].sort((a, b) => Number(b.region === profile.region) - Number(a.region === profile.region) || a.id.localeCompare(b.id));
  const current = list.find((m) => m.id === profile.market.marketId);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Preisanbieter">
          <Select value={provider} onChange={(v) => setMarket({ provider: v, marketId: v === profile.market.provider ? profile.market.marketId : null })} options={PROVIDERS} />
        </Field>
        <Field label={provider === 'blizzard_forever' ? 'Ruleset · Auktionshaus (House-ID)' : 'Markt (Region · Ruleset · Fraktion)'}>
          <Select
            value={profile.market.marketId ?? ''}
            onChange={(v) => setMarket({ marketId: v || null })}
            className="min-w-80"
            options={[{ value: '', label: markets.isLoading ? 'Märkte werden geladen…' : '– Markt wählen –' },
              ...sorted.map((m) => ({ value: m.id, label: `${m.houseId ? m.label : marketLabelDe(m)}${m.confirmed ? '' : ' (laut Doku, unbestätigt)'}` }))]}
          />
        </Field>
        <Button size="sm" variant="ghost" onClick={() => qc.fetchQuery({ queryKey: ['markets', listProvider], queryFn: () => api.listMarkets(listProvider, true) })} title="Marktliste neu vom Anbieter laden">
          <RefreshCw className="size-3.5" /> Liste neu laden
        </Button>
      </div>
      {current && (current.region !== profile.region || current.faction !== profile.faction || current.ruleset !== profile.ruleset) && !current.houseId && (
        <Badge tone="warn">Markt passt nicht zum Profil ({profile.region.toUpperCase()} · {profile.ruleset} · {profile.faction}) – Preise gelten nur für {marketLabelDe(current)}</Badge>
      )}
      {provider === 'manual' && <p className="text-[12px] text-faint">Manuelle Preise werden pro Markt-ID gespeichert und immer als „Manuell“ gekennzeichnet.</p>}
      {markets.error && <ErrorBox title="Marktliste nicht verfügbar" error={markets.error} />}
    </div>
  );
}
