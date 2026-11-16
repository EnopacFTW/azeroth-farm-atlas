import { useEffect, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { CLASSES, OBJECTIVES, PRIMARY_PROFESSIONS, type FarmObjective, type Profile } from '@/domain/types';
import { professionLabel } from '@/domain/professionRules';
import { useActiveProfile, useSaveProfile } from '@/services/hooks';
import { useUi } from '@/store/ui';
import { tr } from '@/i18n';
import { Chip, cx, inputCls, Select } from './ui';

const CLASS_LABEL: Record<string, [string, string]> = {
  warrior: ['Krieger', 'Warrior'], paladin: ['Paladin', 'Paladin'], hunter: ['Jäger', 'Hunter'], rogue: ['Schurke', 'Rogue'], priest: ['Priester', 'Priest'],
  shaman: ['Schamane', 'Shaman'], mage: ['Magier', 'Mage'], warlock: ['Hexenmeister', 'Warlock'], druid: ['Druide', 'Druid'],
};
export const classLabel = (c: string) => (CLASS_LABEL[c] ? tr(...CLASS_LABEL[c]) : c);

const OBJECTIVE_LABEL: Record<FarmObjective, [string, string]> = {
  xp: ['XP', 'XP'], gold: ['Gold', 'Gold'], cloth: ['Stoff', 'Cloth'], skinning: ['Leder', 'Leather'], mining: ['Bergbau', 'Mining'], herbalism: ['Kräuter', 'Herbs'],
  fishing: ['Angeln', 'Fishing'], rare: ['Rares', 'Rares'], materials: ['Materialien', 'Materials'], professions: ['Berufe leveln', 'Level professions'],
};
export const objectiveLabel = (o: FarmObjective) => tr(...OBJECTIVE_LABEL[o]);

/** Edits the active profile in place; changes are persisted to SQLite (debounced). */
export function useEditableProfile() {
  const { profile } = useActiveProfile();
  const save = useSaveProfile();
  const [draft, setDraft] = useState<Profile | undefined>(profile);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => { if (profile && profile.id !== draft?.id) setDraft(profile); }, [profile?.id]);
  useEffect(() => { if (profile && draft && profile.id === draft.id && profile.updatedAt !== draft.updatedAt && !timer.current) setDraft(profile); }, [profile?.updatedAt]);
  const update = (patch: Partial<Profile>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = undefined; save.mutate(next); }, 350);
  };
  return { draft, update, saving: save.isPending, error: save.error };
}

export function ProfileBar() {
  const { draft: p, update, error } = useEditableProfile();
  const { filters, setFilters } = useUi();
  const [advanced, setAdvanced] = useState(false);
  if (!p) return null;
  const objectives = filters.objectives.length ? filters.objectives : p.goals;
  const toggleObjective = (o: FarmObjective) => {
    const next = objectives.includes(o) ? objectives.filter((x) => x !== o) : [...objectives, o];
    setFilters({ objectives: next });
    update({ goals: next });
  };
  const setProf = (slot: 0 | 1, id: string, skill?: number) => {
    const list = [...p.professions];
    if (id === '') list.splice(slot, 1);
    else list[slot] = { id: id as Profile['professions'][number]['id'], skill: skill ?? list[slot]?.skill ?? 1, targetSkill: list[slot]?.targetSkill ?? null };
    update({ professions: list.filter(Boolean) });
  };
  const fishing = p.secondary.find((s) => s.id === 'fishing');
  const toggle = (k: keyof typeof filters, label: string, title?: string) => (
    <label className="flex items-center gap-1.5 text-[12.5px] text-muted cursor-pointer" title={title}>
      <input type="checkbox" checked={!!filters[k]} onChange={(e) => setFilters({ [k]: e.target.checked })} className="accent-[var(--color-gold)]" /> {label}
    </label>
  );

  return (
    <div className="border-b border-line bg-panel/60 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Lvl</span>
          <input aria-label={tr('Charakterlevel', 'Character level')} type="number" min={1} max={60} value={p.level}
            onChange={(e) => update({ level: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })} className={cx(inputCls, 'w-14 text-center num')} />
          <input aria-label={tr('Level-Regler', 'Level slider')} type="range" min={1} max={60} step={1} value={p.level} onChange={(e) => update({ level: Number(e.target.value) })} className="w-40 accent-[var(--color-gold)]" />
        </div>
        <Select ariaLabel={tr('Klasse', 'Class')} value={p.class} onChange={(v) => update({ class: v })} options={CLASSES.map((c) => ({ value: c, label: classLabel(c) }))} />
        <Select ariaLabel={tr('Fraktion', 'Faction')} value={p.faction} onChange={(v) => update({ faction: v })} options={[{ value: 'alliance', label: tr('Allianz', 'Alliance') }, { value: 'horde', label: 'Horde' }]} />
        {[0, 1].map((slot) => {
          const cur = p.professions[slot];
          return (
            <div key={slot} className="flex items-center gap-1">
              <Select ariaLabel={tr(`Primärberuf ${slot + 1}`, `Primary profession ${slot + 1}`)} value={cur?.id ?? ''} onChange={(v) => setProf(slot as 0 | 1, v)}
                options={[{ value: '', label: tr(`Beruf ${slot + 1}: –`, `Profession ${slot + 1}: –`) }, ...PRIMARY_PROFESSIONS.filter((x) => x === cur?.id || !p.professions.some((q) => q.id === x)).map((x) => ({ value: x, label: professionLabel(x) }))]} />
              {cur && (
                <input aria-label={`Skill ${professionLabel(cur.id)}`} type="number" min={0} max={300} value={cur.skill} title={tr('Aktueller Skill (0–300)', 'Current skill (0–300)')}
                  onChange={(e) => setProf(slot as 0 | 1, cur.id, Math.min(300, Math.max(0, Number(e.target.value) || 0)))} className={cx(inputCls, 'w-16 text-center num')} />
              )}
            </div>
          );
        })}
        <div className="flex items-center gap-1">
          <span className="text-[12px] text-muted">{tr('Angeln', 'Fishing')}</span>
          <input aria-label={tr('Angel-Skill', 'Fishing skill')} type="number" min={0} max={300} placeholder="–" value={fishing?.skill ?? ''} title={tr('Leer = nicht erlernt', 'Empty = not learned')}
            onChange={(e) => {
              const v = e.target.value;
              const rest = p.secondary.filter((s) => s.id !== 'fishing');
              update({ secondary: v === '' ? rest : [...rest, { id: 'fishing', skill: Math.min(300, Math.max(0, Number(v))) }] });
            }} className={cx(inputCls, 'w-16 text-center num')} />
        </div>
        {error && <span className="text-[12px] text-bad">{tr('Speichern fehlgeschlagen', 'Saving failed')}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-faint">{tr('Farmziel', 'Farm goal')}</span>
        {OBJECTIVES.filter((o) => o !== 'materials').map((o) => (
          <Chip key={o} active={objectives.includes(o)} onClick={() => toggleObjective(o)}>{objectiveLabel(o)}</Chip>
        ))}
        <button type="button" onClick={() => setAdvanced((a) => !a)} className="ml-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink cursor-pointer">
          <SlidersHorizontal className="size-3.5" /> {tr('Erweitert', 'Advanced')} <ChevronDown className={cx('size-3.5 transition-transform', advanced && 'rotate-180')} />
        </button>
      </div>
      {advanced && (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-line bg-panel-2 px-3 py-2">
          {toggle('soloOnly', tr('Nur solo', 'Solo only'))}
          {toggle('noElites', tr('Keine Elites', 'No elites'))}
          {toggle('noInstances', tr('Keine Instanzen', 'No instances'))}
          {toggle('lowPvpRisk', tr('Geringes PvP-Risiko', 'Low PvP risk'), tr('Schließt Feindgebiet auf PvP-/RP-PvP-Rulesets aus (Classic-Zonenkontrolle)', 'Excludes enemy territory on PvP/RP-PvP rulesets (Classic zone control)'))}
          {toggle('requireXp', tr('Noch XP vom Gegner', 'Mobs still give XP'), tr('Blendet graue Mobs aus (Classic-Formel)', 'Hides gray mobs (Classic formula)'))}
          {toggle('usableForMe', tr('Bei mir verwertbar', 'Usable for me'), tr('Nur Spots mit Materialien für deine Handwerksberufe', 'Only spots with materials for your crafting professions'))}
          {toggle('communityOnly', tr('Nur Community-Tipps', 'Community picks only'), tr('Nur Spots, die in recherchierten Farmguides empfohlen werden (Quellen im Spot)', 'Only spots recommended in researched farming guides (sources in the spot)'))}
          {toggle('foreverOnly', tr('Nur Forever-Daten', 'Forever data only'), tr('Ignoriert Classic-Fallback (Dropchancen, Kürschnerbarkeit, Münzloot)', 'Ignores Classic fallback (drop rates, skinnability, coin loot)'))}
          {toggle('showUnavailable', tr('Noch nicht farmbar anzeigen', 'Show not-yet-farmable'))}
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            {tr('Max. Moblevel über mir', 'Max. mob levels above me')}
            <input type="number" min={0} max={10} value={filters.maxAbove} onChange={(e) => setFilters({ maxAbove: Math.min(10, Math.max(0, Number(e.target.value))) })} className={cx(inputCls, 'h-7 w-12 text-center')} />
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            Ruleset
            <Select value={p.ruleset} onChange={(v) => update({ ruleset: v })} options={[{ value: 'normal', label: 'Normal' }, { value: 'pvp', label: 'PvP' }, { value: 'rp', label: 'RP' }, { value: 'rppvp', label: 'RP-PvP' }]} className="h-7" />
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            {tr('Dauer', 'Duration')}
            <Select value={String(p.durationMin) as '15' | '30' | '60' | '120'} onChange={(v) => update({ durationMin: Number(v) as Profile['durationMin'] })}
              options={['15', '30', '60', '120'].map((v) => ({ value: v as '15', label: `${v} min` }))} className="h-7" />
          </label>
          {(['xp', 'gold', 'profession', 'rare'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-[12.5px] text-muted" title={tr('Gewichtung 0–100', 'Weight 0–100')}>
              {{ xp: 'XP', gold: 'Gold', profession: tr('Beruf', 'Profession'), rare: 'Rares' }[k]}
              <input type="range" min={0} max={100} value={p.priorities[k]} onChange={(e) => update({ priorities: { ...p.priorities, [k]: Number(e.target.value) } })} className="w-20 accent-[var(--color-gold)]" />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
