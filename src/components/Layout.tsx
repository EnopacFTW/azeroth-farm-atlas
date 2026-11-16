import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Coins, Columns3, Compass, Database, Hammer, Map, Search, Settings, Timer, Wifi, WifiOff } from 'lucide-react';
import { api, isDesktop, type SearchHit } from '@/services/tauri';
import { useActiveProfile, useProfiles, useSaveSettings } from '@/services/hooks';
import { marketLabel } from '@/domain/market';
import { getLang, nm, nmAlt, tr, type Lang } from '@/i18n';
import { providerName } from './data';
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
      <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-faint" />
      <input
        ref={input}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && res.data?.[0]) go(res.data[0]); if (e.key === 'Escape') setOpen(false); }}
        placeholder={tr('Item, Mob oder Zone suchen (DE/EN, ID)…', 'Search item, mob or zone (EN/DE, ID)…')}
        className="h-8 w-full rounded-md border border-line bg-panel-2 pl-8 pr-14 text-[13px] text-ink outline-none placeholder:text-faint focus:border-gold/60"
        aria-label={tr('Globale Suche', 'Global search')}
      />
      <span className="absolute right-2 top-1.5"><Kbd>{tr('Strg K', 'Ctrl K')}</Kbd></span>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-9 z-[1100] max-h-96 overflow-auto rounded-md border border-line-2 bg-panel-2 py-1 shadow-xl">
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
      className="h-8 rounded-md border border-line bg-panel-2 px-2 text-[13px] text-ink outline-none"
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
    <div role="group" aria-label={tr('Sprache', 'Language')} className="flex h-8 overflow-hidden rounded-md border border-line text-[12px]">
      {(['de', 'en'] as const).map((l) => (
        <button key={l} type="button" onClick={() => set(l)} aria-pressed={lang === l}
          className={cx('px-2.5 uppercase cursor-pointer', lang === l ? 'bg-gold/15 text-gold-2' : 'bg-panel-2 text-muted hover:text-ink')}>
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
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11.5px] text-faint">
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

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
        <div className="flex items-center gap-2">
          <img src="/app-icon.svg" alt="" className="size-6" />
          <span className="font-display text-[15px] font-semibold tracking-wide text-gold-2">Azeroth Farm Atlas</span>
          <span className="rounded bg-panel-3 px-1.5 text-[10.5px] text-faint">WoW Forever · 1–60</span>
        </div>
        <GlobalSearch />
        <div className="ml-auto flex items-center gap-2"><LanguageSwitch /><ProfileSwitcher /></div>
      </header>
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-line bg-panel p-2" aria-label={tr('Hauptnavigation', 'Main navigation')}>
          {nav().map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cx('flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors', isActive ? 'bg-gold/12 text-gold-2' : 'text-muted hover:bg-panel-3 hover:text-ink')
              }
            >
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
      <StatusBar />
    </div>
  );
}
