import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Coins, Columns3, Compass, Database, Hammer, Map, Search, Settings, Timer, Wifi, WifiOff } from 'lucide-react';
import { api, isDesktop, type SearchHit } from '@/services/tauri';
import { useActiveProfile, useProfiles } from '@/services/hooks';
import { marketLabelDe } from '@/domain/market';
import { providerName } from './data';
import { cx, Kbd } from './ui';

const NAV = [
  { to: '/finder', label: 'Farmfinder', Icon: Compass },
  { to: '/atlas', label: 'Weltatlas', Icon: Map },
  { to: '/professions', label: 'Berufe', Icon: Hammer },
  { to: '/auction-house', label: 'Auktionshaus', Icon: Coins },
  { to: '/compare', label: 'Vergleich', Icon: Columns3 },
  { to: '/sessions', label: 'Farmtracker', Icon: Timer },
  { to: '/sources', label: 'Datenquellen', Icon: Database },
  { to: '/settings', label: 'Einstellungen', Icon: Settings },
];

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const nav = useNavigate();
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
    if (h.kind === 'item') nav(`/items/${h.id}`);
    else if (h.kind === 'npc') nav(`/mobs/${h.id}`);
    else nav(`/atlas?zone=${h.id}`);
  };
  const kindLabel = { item: 'Item', npc: 'NPC', zone: 'Zone', object: 'Knoten' } as const;
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
        placeholder="Item, Mob oder Zone suchen (DE/EN, ID)…"
        className="h-8 w-full rounded-md border border-line bg-panel-2 pl-8 pr-14 text-[13px] text-ink outline-none placeholder:text-faint focus:border-gold/60"
        aria-label="Globale Suche"
      />
      <span className="absolute right-2 top-1.5"><Kbd>Strg K</Kbd></span>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-9 z-[1100] max-h-96 overflow-auto rounded-md border border-line-2 bg-panel-2 py-1 shadow-xl">
          {res.isLoading && <div className="px-3 py-2 text-[12.5px] text-faint">Suche…</div>}
          {res.data?.length === 0 && <div className="px-3 py-2 text-[12.5px] text-faint">Keine Treffer in der lokalen Datenbank.</div>}
          {res.data?.map((h) => (
            <button key={`${h.kind}-${h.id}`} onMouseDown={() => go(h)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-panel-3 cursor-pointer">
              <span className="w-12 shrink-0 text-[11px] uppercase text-faint">{kindLabel[h.kind]}</span>
              <span className="text-ink">{h.nameDe || h.nameEn}</span>
              {h.nameDe && h.nameDe !== h.nameEn && <span className="truncate text-[12px] text-faint">{h.nameEn}</span>}
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
      aria-label="Aktives Profil"
      value={profile.id}
      onChange={async (e) => {
        await api.setActiveProfile(e.target.value);
        await qc.invalidateQueries({ queryKey: ['settings'] });
      }}
      className="h-8 rounded-md border border-line bg-panel-2 px-2 text-[13px] text-ink outline-none"
    >
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          Profil: {p.name} · {p.level}
        </option>
      ))}
    </select>
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
      <span className="flex items-center gap-1">{online ? <Wifi className="size-3.5 text-ok" /> : <WifiOff className="size-3.5 text-warn" />}{online ? 'online' : 'offline – Farmdaten lokal verfügbar'}</span>
      {m?.marketId && (
        <span>
          Markt: <span className="text-muted">{providerName(m.provider)} · {region ? marketLabelDe({ region, ruleset, faction }) : m.marketId}</span>
          {h && <span className={cx('ml-1.5', h.reachable ? 'text-ok' : h.reachable === false ? 'text-bad' : 'text-faint')}>● {h.reachable ? 'erreichbar' : h.reachable === false ? 'Fehler' : 'ungetestet'}</span>}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1"><BookOpen className="size-3.5" />
        Daten: QuestieDB Forever + Classic-Fallback · Build {info.data?.manifest?.builtAt?.slice(0, 10) ?? '–'}
      </span>
      <span>v{info.data?.version ?? '–'}{isDesktop ? '' : ' (Browser-Vorschau)'}</span>
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
        <div className="ml-auto flex items-center gap-2"><ProfileSwitcher /></div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-line bg-panel p-2" aria-label="Hauptnavigation">
          {NAV.map(({ to, label, Icon }) => (
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
