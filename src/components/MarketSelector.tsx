import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '@/services/tauri';
import { useActiveProfile, useSaveProfile } from '@/services/hooks';
import { marketLabel } from '@/domain/market';
import { tr } from '@/i18n';
import { Badge, Button, ErrorBox, Field, Select } from './ui';

const providers = () => [
  { value: 'ahledger', label: tr('AHledger (Standard, EU+US)', 'AHledger (default, EU+US)') },
  { value: 'auctionhouse_fyi', label: tr('auctionhouse.fyi (US-Snapshots)', 'auctionhouse.fyi (US snapshots)') },
  { value: 'blizzard_forever', label: tr('Blizzard Forever (experimentell)', 'Blizzard Forever (experimental)') },
  { value: 'manual', label: tr('Manuelle Preise', 'Manual prices') },
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
        <Field label={tr('Preisanbieter', 'Price provider')}>
          <Select value={provider} onChange={(v) => setMarket({ provider: v, marketId: v === profile.market.provider ? profile.market.marketId : null })} options={providers()} />
        </Field>
        <Field label={provider === 'blizzard_forever' ? tr('Ruleset · Auktionshaus (House-ID)', 'Ruleset · auction house (house ID)') : tr('Markt (Region · Ruleset · Fraktion)', 'Market (region · ruleset · faction)')}>
          <Select
            value={profile.market.marketId ?? ''}
            onChange={(v) => setMarket({ marketId: v || null })}
            className="min-w-80"
            options={[{ value: '', label: markets.isLoading ? tr('Märkte werden geladen…', 'Loading markets…') : tr('– Markt wählen –', '– Choose market –') },
              ...sorted.map((m) => ({ value: m.id, label: `${m.houseId ? m.label : marketLabel(m)}${m.confirmed ? '' : tr(' (laut Doku, unbestätigt)', ' (per docs, unconfirmed)')}` }))]}
          />
        </Field>
        <Button size="sm" variant="ghost" onClick={() => qc.fetchQuery({ queryKey: ['markets', listProvider], queryFn: () => api.listMarkets(listProvider, true) })} title={tr('Marktliste neu vom Anbieter laden', 'Reload the market list from the provider')}>
          <RefreshCw className="size-3.5" /> {tr('Liste neu laden', 'Reload list')}
        </Button>
      </div>
      {current && (current.region !== profile.region || current.faction !== profile.faction || current.ruleset !== profile.ruleset) && !current.houseId && (
        <Badge tone="warn">
          {tr('Markt passt nicht zum Profil', 'Market does not match the profile')} ({profile.region.toUpperCase()} · {profile.ruleset} · {profile.faction}) – {tr('Preise gelten nur für', 'prices only apply to')} {marketLabel(current)}
        </Badge>
      )}
      {provider === 'manual' && <p className="text-[12px] text-faint">{tr('Manuelle Preise werden pro Markt-ID gespeichert und immer als „Manuell“ gekennzeichnet.', 'Manual prices are stored per market ID and always marked “Manual”.')}</p>}
      {markets.error && <ErrorBox title={tr('Marktliste nicht verfügbar', 'Market list unavailable')} error={markets.error} />}
    </div>
  );
}
