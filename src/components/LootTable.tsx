import type { LootContext, LootRow, MarketQuote } from '@/domain/types';
import { formatCopper } from '@/domain/money';
import { ContextLabel, ItemName, PriceCell, Rate, SourceBadge } from './data';
import { Empty } from './ui';

const ORDER: LootContext[] = ['normal_kill', 'skinning', 'mining_node', 'herb_node', 'fishing', 'quest'];

/** Loot split by context: kill loot, skinning, nodes, fishing and quest drops are never mixed. */
export function LootTables({ rows, quotes, quotesLoading, quotesError, onPick }: {
  rows: LootRow[]; quotes: MarketQuote[]; quotesLoading?: boolean; quotesError?: boolean; onPick?: (row: LootRow) => void;
}) {
  if (!rows.length) return <Empty>Keine Loot-Daten in der lokalen Datenbank.</Empty>;
  const q = new Map(quotes.map((x) => [x.itemId, x]));
  // collapse Forever relation rows (no rate) into a flag on the Classic row of the same item/context
  const merged = new Map<string, LootRow & { forever: boolean; classic: boolean }>();
  for (const r of rows) {
    const k = `${r.context}|${r.itemId}`;
    const prev = merged.get(k);
    const isForever = r.sourceId === 'questiedb_forever';
    if (!prev) merged.set(k, { ...r, forever: isForever, classic: !isForever });
    else {
      prev.forever ||= isForever;
      if (!isForever) { Object.assign(prev, { ...r, forever: prev.forever, classic: true }); }
    }
  }
  const groups = ORDER.map((ctx) => ({ ctx, rows: [...merged.values()].filter((r) => r.context === ctx).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1)) })).filter((g) => g.rows.length);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.ctx}>
          <h4 className="mb-1 text-[12.5px] font-semibold"><ContextLabel ctx={g.ctx} /> <span className="text-faint">({g.rows.length})</span></h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-[11px] uppercase tracking-wide text-faint">
                <tr className="border-b border-line">
                  <th className="py-1 pr-2 font-medium">Item</th>
                  <th className="py-1 pr-2 font-medium">ID</th>
                  <th className="py-1 pr-2 text-right font-medium">Chance</th>
                  <th className="py-1 pr-2 text-right font-medium">Menge</th>
                  <th className="py-1 pr-2 text-right font-medium">Händler</th>
                  <th className="py-1 pr-2 font-medium">AH-Preis (Stück)</th>
                  <th className="py-1 font-medium">Quelle</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.slice(0, 40).map((r) => (
                  <tr key={`${r.context}-${r.itemId}`} className="border-b border-line/50 hover:bg-panel-2" onClick={() => onPick?.(r)}>
                    <td className="py-1 pr-2"><ItemName id={r.itemId} nameDe={r.nameDe} nameEn={r.nameEn} quality={r.quality} /></td>
                    <td className="py-1 pr-2 num text-faint">{r.itemId}</td>
                    <td className="py-1 pr-2 text-right"><Rate rate={r.rate} /></td>
                    <td className="py-1 pr-2 text-right num text-muted">{r.minQty != null ? (r.minQty === r.maxQty ? r.minQty : `${r.minQty}–${r.maxQty}`) : '?'}</td>
                    <td className="py-1 pr-2 text-right num text-muted" title={r.vendorSell != null ? 'Classic-Händlerpreis (cmangos)' : 'unbekannt'}>{formatCopper(r.vendorSell)}</td>
                    <td className="py-1 pr-2"><PriceCell compact quote={q.get(r.itemId)} loading={quotesLoading} error={quotesError} /></td>
                    <td className="py-1">
                      <span className="inline-flex gap-1">
                        {r.forever && <SourceBadge source="questiedb_forever" />}
                        {r.classic && <SourceBadge source="cmangos_classic" />}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {g.rows.length > 40 && <p className="mt-1 text-[11.5px] text-faint">… {g.rows.length - 40} weitere (seltene) Einträge</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
