import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/tauri';
import { useQuotes } from '@/services/hooks';
import { formatCopper } from '@/domain/money';
import { pct } from '@/domain/scoring';
import { nm, nmAlt, tr } from '@/i18n';
import { PriceCell } from './data';
import { WowheadButton } from './Wowhead';
import { Spinner } from './ui';

const QUALITY_CLS = ['text-q0', 'text-q1', 'text-q2', 'text-q3', 'text-q4', 'text-q5'];

export const itemClassLabel = (c: number | null | undefined) =>
  c == null ? null : ({
    0: tr('Verbrauchbar', 'Consumable'), 1: tr('Behälter', 'Container'), 2: tr('Waffe', 'Weapon'), 4: tr('Rüstung', 'Armor'),
    5: tr('Reagenz', 'Reagent'), 6: tr('Munition', 'Projectile'), 7: tr('Handwerkswaren', 'Trade goods'), 9: tr('Rezept', 'Recipe'),
    11: tr('Köcher', 'Quiver'), 12: tr('Quest', 'Quest'), 13: tr('Schlüssel', 'Key'), 15: tr('Verschiedenes', 'Miscellaneous'),
  } as Record<number, string>)[c] ?? null;

/** Hover card: opens after a short delay, stays open while the pointer is over the trigger or the card. */
export function HoverCard({ trigger, children }: { trigger: ReactNode; children: () => ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const openT = useRef<number>(0);
  const closeT = useRef<number>(0);
  useEffect(() => () => { clearTimeout(openT.current); clearTimeout(closeT.current); }, []);
  const enter = () => {
    clearTimeout(closeT.current);
    if (pos) return;
    openT.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const below = r.bottom + 260 < window.innerHeight;
      setPos({ x: Math.min(r.left, window.innerWidth - 330), y: below ? r.bottom + 4 : r.top - 4, below });
    }, 350);
  };
  const leave = () => {
    clearTimeout(openT.current);
    closeT.current = window.setTimeout(() => setPos(null), 180);
  };
  return (
    <span ref={ref} onMouseEnter={enter} onMouseLeave={leave} className="inline">
      {trigger}
      {pos && createPortal(
        <div
          role="tooltip"
          onMouseEnter={() => clearTimeout(closeT.current)}
          onMouseLeave={leave}
          style={{ left: Math.max(8, pos.x), top: pos.y, transform: pos.below ? undefined : 'translateY(-100%)' }}
          className="fixed z-[2000] w-80 rounded-md border border-line-2 bg-panel px-3 py-2.5 text-[12px] shadow-2xl"
        >
          {children()}
        </div>,
        document.body,
      )}
    </span>
  );
}

/** Tooltip body for an item: local seed data (no network) plus the cached AH quote of the selected market. */
export function ItemTooltipBody({ id }: { id: number }) {
  const q = useQuery({ queryKey: ['item', id], queryFn: () => api.getItem(id), staleTime: Infinity });
  const quotes = useQuotes([id]);
  if (q.isLoading) return <Spinner />;
  const it = q.data?.item;
  if (!it) return <span className="text-faint">{tr('Item nicht in der lokalen Datenbank.', 'Item not in the local database.')}</span>;
  const rows: any[] = (q.data.npcSources ?? []).filter((s: any) => s.rate != null).sort((a: any, b: any) => b.rate - a.rate).slice(0, 3);
  const nodes: any[] = (q.data.objectSources ?? []).slice(0, 2);
  const cls = itemClassLabel(it.itemClass);
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className={`font-semibold ${QUALITY_CLS[it.quality ?? 1] ?? 'text-ink'}`}>{nm(it)}</div>
          {nmAlt(it) && <div className="text-[11px] text-faint">{nmAlt(it)}</div>}
        </div>
        <WowheadButton kind="item" id={it.id} />
      </div>
      <div className="flex flex-wrap gap-x-3 text-[11.5px] text-muted">
        {cls && <span>{cls}</span>}
        {it.itemLevel != null && <span>{tr('Itemlevel', 'Item level')} {it.itemLevel}</span>}
        {it.requiredLevel ? <span>{tr('Benötigt Level', 'Requires level')} {it.requiredLevel}</span> : null}
        {it.stackSize > 1 && <span>{tr('Stapel', 'Stack')} {it.stackSize}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-[11.5px]">
        <span className="text-faint">{tr('Händler', 'Vendor')}: <span className="num text-muted">{formatCopper(it.vendorSell)}</span></span>
        <span className="text-faint">AH: </span><PriceCell compact quote={quotes.data?.[0]} loading={quotes.isLoading && quotes.fetchStatus !== 'idle'} error={!!quotes.error} />
      </div>
      {(rows.length > 0 || nodes.length > 0) && (
        <div className="border-t border-line pt-1.5 text-[11.5px]">
          <div className="mb-0.5 text-faint">{tr('Beste Quellen (Classic-Raten)', 'Best sources (Classic rates)')}</div>
          <ul className="space-y-0.5">
            {rows.map((r) => <li key={`${r.npcId}-${r.context}`} className="flex gap-2"><span className="min-w-0 flex-1 truncate text-muted">{nm(r)} <span className="text-faint">L{r.levelMin}{r.levelMax !== r.levelMin ? `–${r.levelMax}` : ''}</span></span><span className="num text-ink">{pct(r.rate)}</span></li>)}
            {nodes.map((o) => <li key={`o${o.objectId}`} className="truncate text-muted">{nm(o)}{o.requiredSkill != null ? ` · Skill ${o.requiredSkill}` : ''}</li>)}
          </ul>
        </div>
      )}
      {!it.inForever && <div className="text-[11px] text-warn">{tr('Nicht in den Forever-Daten (QuestieDB) belegt.', 'Not documented in the Forever data (QuestieDB).')}</div>}
    </div>
  );
}
