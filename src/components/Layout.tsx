import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Coins, Columns3, Compass, Database, Hammer, Map, Search, Settings, Timer, Wifi, WifiOff } from 'lucide-react';
import { api, isDesktop, type SearchHit } from '@/services/tauri';
import { useActiveProfile, useProfiles, useSaveSettings } from '@/services/hooks';
import { marketLabel } from '@/domain/market';
import { getLang, nm, nmAlt, tr, type Lang } from '@/i18n';
import { providerName } from './data';
import { classLabel } from './ProfileBar';
import { UpdateBanner } from './UpdateBanner';
import { cx, Kbd } from './ui';

const nav = () => [
  { to: '/finder', label: tr('Farmfinder', 'Farm finder'), Icon: Compass },
  { to: '/atlas', label: tr('Weltatlas', 'World atlas'), Icon: Map },
  { to: '/professions', label: tr('Berufe', 'Professions'), Icon: Hammer },
  { to: '/auction-house', label: tr('Auktionshaus', 'Auction house'), Icon: Coins },
  { to: '/compare', label: tr('Vergleich', 'Compare'), Icon: Columns3 },
  { to: '/sessions', label: tr('Farmtracker', 'Farm tracker'), Icon: Timer },
  { to: '/sources', label: tr('Datenquellen', 'Data sources'), Icon: Database },
  { to: '/settings', label: tr('Einstellungen', 'Settings'), Icon: Settings },
];

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.key === '/' && document.activeElement?.tagName !== 'INPUT')) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const res = useQuery({ queryKey: ['search', debounced], queryFn: () => api.search(debounced, ['item', 'npc', 'zone'], 14), enabled: debounced.length >= 2 });
  const go = (h: SearchHit) => {
    setOpen(false);
    setQ('');
    if (h.kind === 'item') navigate(`/items/${h.id}`);
    else if (h.kind === 'npc') navigate(`/mobs/${h.id}`);
    else navigate(`/atlas?zone=${h.id}`);
  };
  const kindLabel = { item: 'Item', npc: 'NPC', zone: 'Zone', object: tr('Knoten', 'Node') } as const;
  return (
    <div className="relative w-[min(520px,40vw)]">
      <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-gold/60" />
      <input
        ref={input}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && res.data?.[0]) go(res.data[0]); if (e.key === 'Escape') setOpen(false); }}
        placeholder={tr('Item, Mob oder Zone suchen (DE/EN, ID)…', 'Search item, mob or zone (EN/DE, ID)…')}
        className="h-9 w-full rounded-xl border border-line-2/70 bg-[#0d1119]/80 pl-9 pr-16 text-[13px] text-ink outline-none transition-colors placeholder:text-faint hover:border-line-2 focus:border-gold/60 focus:ring-2 focus:ring-gold/20"
        aria-label={tr('Globale Suche', 'Global search')}
      />
      <span className="absolute right-2.5 top-2"><Kbd>{tr('Strg K', 'Ctrl K')}</Kbd></span>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-10 z-[1100] max-h-96 overflow-auto rounded-xl border border-line-2 bg-panel-2/95 py-1 shadow-2xl backdrop-blur">
          {res.isLoading && <div className="px-3 py-2 text-[12.5px] text-faint">{tr('Suche…', 'Searching…')}</div>}
          {res.data?.length === 0 && <div className="px-3 py-2 text-[12.5px] text-faint">{tr('Keine Treffer in der lokalen Datenbank.', 'No matches in the local database.')}</div>}
          {res.data?.map((h) => (
            <button key={`${h.kind}-${h.id}`} onMouseDown={() => go(h)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-panel-3 cursor-pointer">
              <span className="w-12 shrink-0 text-[11px] uppercase text-faint">{kindLabel[h.kind]}</span>
              <span className="text-ink">{nm(h)}</span>
              {nmAlt(h) && <span className="truncate text-[12px] text-faint">{nmAlt(h)}</span>}
              <span className="ml-auto text-[11px] text-faint">#{h.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileSwitcher() {
  const { profile } = useActiveProfile();
  const { data: profiles } = useProfiles();
  const qc = useQueryClient();
  if (!profiles || !profile) return null;
  return (
    <select
      aria-label={tr('Aktives Profil', 'Active profile')}
      value={profile.id}
      onChange={async (e) => {
        await api.setActiveProfile(e.target.value);
        await qc.invalidateQueries({ queryKey: ['settings'] });
      }}
      className="h-9 rounded-xl border border-line-2/70 bg-[#0d1119]/80 px-2.5 text-[13px] text-ink outline-none hover:border-line-2 focus:border-gold/60"
    >
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {tr('Profil', 'Profile')}: {p.name} · {p.level}
        </option>
      ))}
    </select>
  );
}

/** DE | EN switch; the choice is stored in the settings (user.db). */
export function LanguageSwitch() {
  const { settings } = useActiveProfile();
  const save = useSaveSettings();
  const lang = getLang();
  const set = (l: Lang) => { if (settings && l !== lang) save.mutate({ ...settings, language: l }); };
  return (
    <div role="group" aria-label={tr('Sprache', 'Language')} className="flex h-9 overflow-hidden rounded-xl border border-line-2/70 text-[12px] font-semibold">
      {(['de', 'en'] as const).map((l) => (
        <button key={l} type="button" onClick={() => set(l)} aria-pressed={lang === l}
          className={cx('px-3 uppercase cursor-pointer transition-colors', lang === l ? 'bg-gradient-to-b from-gold/30 to-gold/10 text-gold-2' : 'bg-[#0d1119]/80 text-muted hover:text-ink')}>
          {l}
        </button>
      ))}
    </div>
  );
}

function StatusBar() {
  const info = useQuery({ queryKey: ['appInfo'], queryFn: api.appInfo, staleTime: Infinity });
  const health = useQuery({ queryKey: ['health-cached'], queryFn: api.cachedProviderHealth, refetchInterval: 60_000 });
  const { profile } = useActiveProfile();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const m = profile?.market;
  const h = health.data?.find((x) => x.provider === m?.provider);
  const [, ruleset, faction, region] = (m?.marketId ?? '').split('.');
  return (
    <footer className="ff-chrome flex h-7 shrink-0 items-center gap-4 border-t border-line/80 px-4 text-[11.5px] text-faint">
      <span className="flex items-center gap-1">{online ? <Wifi className="size-3.5 text-ok" /> : <WifiOff className="size-3.5 text-warn" />}{online ? 'online' : tr('offline – Farmdaten lokal verfügbar', 'offline – farm data available locally')}</span>
      {m?.marketId && (
        <span>
          {tr('Markt', 'Market')}: <span className="text-muted">{providerName(m.provider)} · {region ? marketLabel({ region, ruleset, faction }) : m.marketId}</span>
          {h && <span className={cx('ml-1.5', h.reachable ? 'text-ok' : h.reachable === false ? 'text-bad' : 'text-faint')}>● {h.reachable ? tr('erreichbar', 'reachable') : h.reachable === false ? tr('Fehler', 'error') : tr('ungetestet', 'untested')}</span>}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1"><BookOpen className="size-3.5" />
        {tr('Daten: QuestieDB Forever + Classic-Fallback', 'Data: QuestieDB Forever + Classic fallback')} · Build {info.data?.manifest?.builtAt?.slice(0, 10) ?? '–'}
      </span>
      <span>v{info.data?.version ?? '–'}{isDesktop ? '' : tr(' (Browser-Vorschau)', ' (browser preview)')}</span>
    </footer>
  );
}

const CLASS_COLOR: Record<string, string> = {
  warrior: '#c69b6d', paladin: '#f48cba', hunter: '#aad372', rogue: '#fff468', priest: '#ffffff', shaman: '#0070dd',
  mage: '#3fc7eb', warlock: '#8788ee', druid: '#ff7c0a',
};

/** Brand: logo mark + "FarmForever" wordmark. */
function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/app-icon.svg" alt="" className="size-8 drop-shadow-[0_0_10px_rgb(226_184_92/.35)]" />
      <div className="leading-none">
        <div className="ff-gold-text font-display text-[19px] font-bold tracking-[0.06em]">FarmForever</div>
        <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.22em] text-faint">WoW Forever · Farm Atlas 1–60</div>
      </div>
    </div>
  );
}

/** Active character at the bottom of the sidebar. */
function ProfileCard() {
  const { profile } = useActiveProfile();
  if (!profile) return null;
  const color = CLASS_COLOR[profile.class] ?? '#e2b85c';
  const horde = profile.faction === 'horde';
  return (
    <div className="relative overflow-hidden rounded-xl border border-line-2/70 bg-gradient-to-br from-panel-3/80 to-panel/60 p-3">
      <div aria-hidden className="absolute -right-6 -top-6 size-20 rounded-full blur-2xl" style={{ background: color, opacity: 0.18 }} />
      <div className="flex items-center gap-2.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg border text-[15px] font-bold" style={{ borderColor: `${color}66`, color, background: `${color}14` }}>
          {profile.level}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{profile.name}</div>
          <div className="truncate text-[11.5px]" style={{ color }}>{classLabel(profile.class)}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-faint">
        <span className={cx('size-2 rounded-full', horde ? 'bg-[#d4483e] shadow-[0_0_8px_#d4483e]' : 'bg-[#4f86e0] shadow-[0_0_8px_#4f86e0]')} />
        {horde ? tr('Horde', 'Horde') : tr('Allianz', 'Alliance')}
        <span className="text-line-2">·</span>
        <span className="truncate uppercase">{profile.region} {profile.ruleset}</span>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="ff-chrome relative flex h-14 shrink-0 items-center gap-5 px-4">
        <Brand />
        <GlobalSearch />
        <div className="ml-auto flex items-center gap-2"><LanguageSwitch /><ProfileSwitcher /></div>
        <div aria-hidden className="ff-divider absolute inset-x-0 bottom-0" />
      </header>
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
        <nav className="ff-chrome flex w-56 shrink-0 flex-col gap-1 border-r border-line/70 p-3" aria-label={tr('Hauptnavigation', 'Main navigation')}>
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-faint">{tr('Navigation', 'Navigation')}</div>
          {nav().map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cx(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-all',
                  isActive
                    ? 'bg-gradient-to-r from-gold/20 via-gold/[0.07] to-transparent text-gold-2 shadow-[inset_0_0_0_1px_rgb(226_184_92/.22)]'
                    : 'text-muted hover:bg-white/[0.03] hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span aria-hidden className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-gold shadow-[0_0_10px_rgb(226_184_92/.9)]" />}
                  <Icon className={cx('size-[18px] transition-colors', isActive ? 'text-gold' : 'text-faint group-hover:text-gold/80')} /> {label}
                </>
              )}
            </NavLink>
          ))}
          <div className="mt-auto"><ProfileCard /></div>
        </nav>
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
      <StatusBar />
    </div>
  );
}
