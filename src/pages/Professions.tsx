import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Attribution } from '@/components/data';
import { Badge, Chip, cx, Empty, ErrorBox, inputCls, Panel, Spinner } from '@/components/ui';
import { api } from '@/services/tauri';
import { useActiveProfile, useMarketSelection } from '@/services/hooks';
import { gatherSkillColor, PROFESSION_LABEL } from '@/domain/professionRules';
import { DEFAULT_FILTERS, rankSpots } from '@/domain/scoring';
import { formatCopper } from '@/domain/money';
import type { FarmObjective, ProfessionId } from '@/domain/types';

const AHL_NAME: Partial<Record<ProfessionId, string>> = {
  leatherworking: 'Leatherworking', tailoring: 'Tailoring', engineering: 'Engineering', alchemy: 'Alchemy', blacksmithing: 'Blacksmithing',
  enchanting: 'Enchanting', cooking: 'Cooking', first_aid: 'First Aid',
};
const GATHER: Partial<Record<ProfessionId, FarmObjective>> = { mining: 'mining', herbalism: 'herbalism', skinning: 'skinning', fishing: 'fishing' };
const COLOR_CLS = { red: 'text-bad', orange: 'text-warn', yellow: 'text-gold-2', green: 'text-ok', gray: 'text-faint' } as const;

export function ProfessionsPage() {
  const { profile } = useActiveProfile();
  const profs = profile ? [...profile.professions, ...profile.secondary] : [];
  const [sel, setSel] = useState<ProfessionId | null>(null);
  const active = (sel && profs.find((p) => p.id === sel)) || profs[0];
  if (!profile) return null;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1300px] space-y-4 p-5">
        <h1 className="font-display text-[20px] font-semibold">Berufsplaner</h1>
        <p className="text-[12.5px] text-muted">Forever hat zwei Primärberufe plus Kochkunst, Erste Hilfe und Angeln (Skill bis 300). Rezepte kommen live von AHledger (Forever-Rezeptliste), Spawns aus QuestieDB Forever.</p>
        {profs.length === 0 ? <Empty>Im Profil sind keine Berufe eingetragen – im Farmfinder oben auswählen.</Empty> : (
          <div className="flex flex-wrap gap-1.5">
            {profs.map((p) => <Chip key={p.id} active={active?.id === p.id} onClick={() => setSel(p.id as ProfessionId)}>{PROFESSION_LABEL[p.id as ProfessionId]} {p.skill}{p.targetSkill ? ` → ${p.targetSkill}` : ''}</Chip>)}
          </div>
        )}
        {active && (GATHER[active.id as ProfessionId]
          ? <GatheringPlan id={active.id as ProfessionId} skill={active.skill} />
          : <CraftingPlan id={active.id as ProfessionId} skill={active.skill} target={active.targetSkill ?? Math.min(300, active.skill + 75)} />)}
      </div>
    </div>
  );
}

function GatheringPlan({ id, skill }: { id: ProfessionId; skill: number }) {
  const { profile } = useActiveProfile();
  const cand = useQuery({ queryKey: ['candidates-all', profile!.level], queryFn: () => api.searchSpots({ level: profile!.level, above: 8, below: 20 }) });
  const objective = GATHER[id]!;
  const nodes = useMemo(() => {
    const m = new Map<string, { name: string; nameEn: string; req: number | null; spots: number; spawns: number }>();
    for (const s of cand.data ?? []) for (const o of s.objects) {
      if ((id === 'mining' && o.nodeType !== 'ore') || (id === 'herbalism' && o.nodeType !== 'herb')) continue;
      const k = o.nameEn;
      const e = m.get(k) ?? { name: o.nameDe ?? o.nameEn, nameEn: o.nameEn, req: o.requiredSkill, spots: 0, spawns: 0 };
      e.spots++; e.spawns += o.spawns;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => (a.req ?? 999) - (b.req ?? 999));
  }, [cand.data, id]);
  const ranked = useMemo(() => (profile && cand.data ? rankSpots(profile, cand.data, { ...DEFAULT_FILTERS, objectives: [objective] }).slice(0, 12) : []), [profile, cand.data, objective]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(id === 'mining' || id === 'herbalism') && (
        <Panel title={`${PROFESSION_LABEL[id]}: Vorkommen nach Skill (du: ${skill})`}>
          {cand.isLoading ? <Spinner /> : (
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-[11px] uppercase text-faint"><tr className="border-b border-line"><th className="py-1">Knoten</th><th>Skill</th><th>Farbe</th><th className="text-right">Zonen</th><th className="text-right">Spawns</th></tr></thead>
              <tbody>
                {nodes.map((n) => {
                  const c = n.req != null ? gatherSkillColor(skill, n.req) : null;
                  return (
                    <tr key={n.nameEn} className="border-b border-line/50">
                      <td className="py-1" title={n.nameEn}>{n.name}</td>
                      <td className="num">{n.req ?? '?'}</td>
                      <td className={c ? COLOR_CLS[c] : 'text-faint'}>{c ? ({ red: 'Skill fehlt', orange: 'orange', yellow: 'gelb', green: 'grün', gray: 'grau' } as const)[c] : 'unbekannt'}</td>
                      <td className="text-right num text-muted">{n.spots}</td>
                      <td className="text-right num text-muted">{n.spawns}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11.5px] text-faint">Skillgrenzen und Farben: Classic-Regeln (orange &lt; +25, gelb &lt; +50, grün &lt; +100). Nicht gegen Forever geprüft.</p>
        </Panel>
      )}
      <Panel title="Passende Farmspots jetzt">
        {ranked.length === 0 ? <Empty>Keine sofort farmbaren Spots für dein Level/Skill.</Empty> : (
          <ul className="space-y-1 text-[12.5px]">
            {ranked.map((r) => (
              <li key={r.spot.id} className="flex items-center gap-2">
                <Link to={`/spots/${encodeURIComponent(r.spot.id)}`} className="min-w-0 flex-1 truncate text-ink hover:underline">{r.spot.titleDe}</Link>
                {r.spot.reqSkill != null && <span className="num text-faint">Skill {r.spot.reqSkill}</span>}
                <span className="num text-gold-2">{r.fitScore}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function CraftingPlan({ id, skill, target }: { id: ProfessionId; skill: number; target: number }) {
  const market = useMarketSelection();
  const [to, setTo] = useState(target);
  const name = AHL_NAME[id];
  const ahMarket = market.provider === 'ahledger' ? market.marketId : null;
  const q = useQuery({ queryKey: ['crafting', ahMarket, name], queryFn: () => api.fetchCrafting(ahMarket!, name!), enabled: !!ahMarket && !!name, staleTime: 5 * 60_000, retry: false });
  const recipes = useMemo(() => (q.data?.recipes ?? []).filter((r) => r.recipe.skillRequired != null && r.recipe.skillRequired >= Math.max(0, skill - 25) && r.recipe.skillRequired <= to)
    .sort((a, b) => (a.recipe.skillRequired ?? 0) - (b.recipe.skillRequired ?? 0)), [q.data, skill, to]);
  const reagents = useMemo(() => {
    const m = new Map<number, { id: number; name: string; recipes: number; price: number | null }>();
    for (const r of recipes) for (const g of r.reagents) {
      const e = m.get(g.id) ?? { id: g.id, name: g.name, recipes: 0, price: g.price };
      e.recipes++;
      m.set(g.id, e);
    }
    return [...m.values()].sort((a, b) => b.recipes - a.recipes);
  }, [recipes]);
  if (!name) return <Empty>Für {PROFESSION_LABEL[id]} gibt es keine Rezeptdaten.</Empty>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
        <span>Skill {skill} →</span>
        <input type="number" min={skill} max={300} value={to} onChange={(e) => setTo(Math.min(300, Math.max(skill, Number(e.target.value))))} className={cx(inputCls, 'w-20')} aria-label="Zielskill" />
        {!ahMarket && <Badge tone="warn">Rezeptdaten benötigen AHledger als Preisanbieter</Badge>}
        {q.data && <span className="text-faint">Preise Stand {q.data.pricesAsOf ? new Date(q.data.pricesAsOf).toLocaleString('de-DE') : 'unbekannt'} · {q.data.market} · <Attribution text={q.data.attribution?.text ?? 'Prices from AHledger'} url={q.data.attribution?.url ?? 'https://ahledger.com'} /></span>}
      </div>
      {q.isLoading && <Spinner label="Rezepte werden von AHledger geladen…" />}
      {q.error && <ErrorBox title="Rezeptdaten nicht verfügbar" error={q.error} />}
      {q.data && (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Panel title={`Rezepte bis Skill ${to} (${recipes.length})`} bodyClass="p-0">
            <div className="max-h-[560px] overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-panel text-left text-[11px] uppercase text-faint"><tr className="border-b border-line"><th className="px-3 py-1.5">Skill</th><th>Rezept</th><th>Erwerb</th><th>Reagenzien</th><th className="pr-3 text-right">Kosten</th></tr></thead>
                <tbody>
                  {recipes.map((r) => (
                    <tr key={r.recipe.spellId} className="border-b border-line/50 align-top">
                      <td className="px-3 py-1 num">{r.recipe.skillRequired}</td>
                      <td className="py-1"><Link to={`/items/${r.result.id}`} className="hover:underline">{r.recipe.name}</Link></td>
                      <td className="py-1 text-muted">{r.recipe.acquisition === 'trainer' ? 'Lehrer' : 'unbekannt'}</td>
                      <td className="py-1 text-muted">{r.reagents.map((g) => <span key={g.id} className="mr-2 inline-block"><Link to={`/items/${g.id}`} className="hover:underline">{g.qty}× {g.name}</Link></span>)}</td>
                      <td className="py-1 pr-3 text-right num">{formatCopper(r.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Benötigte Materialien – farmen oder kaufen">
            <ul className="space-y-1 text-[12.5px]">
              {reagents.slice(0, 30).map((g) => (
                <li key={g.id} className="flex items-center gap-2">
                  <Link to={`/items/${g.id}`} className="min-w-0 flex-1 truncate text-ink hover:underline" title="Bezugsquellen & Farmspots anzeigen">{g.name}</Link>
                  <span className="text-faint">{g.recipes} Rezepte</span>
                  <span className="num text-muted" title="AHledger-Preis pro Stück">{formatCopper(g.price)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-faint">Skill-up-Farben je Rezept liefert die API nicht – die Liste zeigt die Mindest-Skillstufe. Klick auf ein Material zeigt belegte Farmquellen.</p>
          </Panel>
        </div>
      )}
    </div>
  );
}
