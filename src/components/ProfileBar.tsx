import { useEffect, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { CLASSES, OBJECTIVES, PRIMARY_PROFESSIONS, type FarmObjective, type Profile } from '@/domain/types';
import { PROFESSION_LABEL } from '@/domain/professionRules';
import { useActiveProfile, useSaveProfile } from '@/services/hooks';
import { useUi } from '@/store/ui';
import { Chip, cx, inputCls, Select } from './ui';

export const CLASS_LABEL: Record<string, string> = {
  warrior: 'Krieger', paladin: 'Paladin', hunter: 'Jäger', rogue: 'Schurke', priest: 'Priester', shaman: 'Schamane', mage: 'Magier', warlock: 'Hexenmeister', druid: 'Druide',
};
export const OBJECTIVE_LABEL: Record<FarmObjective, string> = {
  xp: 'XP', gold: 'Gold', cloth: 'Stoff', skinning: 'Leder', mining: 'Bergbau', herbalism: 'Kräuter', fishing: 'Angeln', rare: 'Rares',
  materials: 'Materialien', professions: 'Berufe leveln',
};

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
          <input aria-label="Charakterlevel" type="number" min={1} max={60} value={p.level}
            onChange={(e) => update({ level: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })} className={cx(inputCls, 'w-14 text-center num')} />
          <input aria-label="Level-Regler" type="range" min={1} max={60} step={1} value={p.level} onChange={(e) => update({ level: Number(e.target.value) })} className="w-40 accent-[var(--color-gold)]" />
        </div>
        <Select ariaLabel="Klasse" value={p.class} onChange={(v) => update({ class: v })} options={CLASSES.map((c) => ({ value: c, label: CLASS_LABEL[c] }))} />
        <Select ariaLabel="Fraktion" value={p.faction} onChange={(v) => update({ faction: v })} options={[{ value: 'alliance', label: 'Allianz' }, { value: 'horde', label: 'Horde' }]} />
        {[0, 1].map((slot) => {
          const cur = p.professions[slot];
          return (
            <div key={slot} className="flex items-center gap-1">
              <Select ariaLabel={`Primärberuf ${slot + 1}`} value={cur?.id ?? ''} onChange={(v) => setProf(slot as 0 | 1, v)}
                options={[{ value: '', label: `Beruf ${slot + 1}: –` }, ...PRIMARY_PROFESSIONS.filter((x) => x === cur?.id || !p.professions.some((q) => q.id === x)).map((x) => ({ value: x, label: PROFESSION_LABEL[x] }))]} />
              {cur && (
                <input aria-label={`Skill ${PROFESSION_LABEL[cur.id]}`} type="number" min={0} max={300} value={cur.skill} title="Aktueller Skill (0–300)"
                  onChange={(e) => setProf(slot as 0 | 1, cur.id, Math.min(300, Math.max(0, Number(e.target.value) || 0)))} className={cx(inputCls, 'w-16 text-center num')} />
              )}
            </div>
          );
        })}
        <div className="flex items-center gap-1">
          <span className="text-[12px] text-muted">Angeln</span>
          <input aria-label="Angel-Skill" type="number" min={0} max={300} placeholder="–" value={fishing?.skill ?? ''} title="Leer = nicht erlernt"
            onChange={(e) => {
              const v = e.target.value;
              const rest = p.secondary.filter((s) => s.id !== 'fishing');
              update({ secondary: v === '' ? rest : [...rest, { id: 'fishing', skill: Math.min(300, Math.max(0, Number(v))) }] });
            }} className={cx(inputCls, 'w-16 text-center num')} />
        </div>
        {error && <span className="text-[12px] text-bad">Speichern fehlgeschlagen</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Farmziel</span>
        {OBJECTIVES.filter((o) => o !== 'materials').map((o) => (
          <Chip key={o} active={objectives.includes(o)} onClick={() => toggleObjective(o)}>{OBJECTIVE_LABEL[o]}</Chip>
        ))}
        <button type="button" onClick={() => setAdvanced((a) => !a)} className="ml-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink cursor-pointer">
          <SlidersHorizontal className="size-3.5" /> Erweitert <ChevronDown className={cx('size-3.5 transition-transform', advanced && 'rotate-180')} />
        </button>
      </div>
      {advanced && (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-line bg-panel-2 px-3 py-2">
          {toggle('soloOnly', 'Nur solo')}
          {toggle('noElites', 'Keine Elites')}
          {toggle('noInstances', 'Keine Instanzen')}
          {toggle('lowPvpRisk', 'Geringes PvP-Risiko', 'Schließt Feindgebiet auf PvP-/RP-PvP-Rulesets aus (Classic-Zonenkontrolle)')}
          {toggle('requireXp', 'Noch XP vom Gegner', 'Blendet graue Mobs aus (Classic-Formel)')}
          {toggle('usableForMe', 'Bei mir verwertbar', 'Nur Spots mit Materialien für deine Handwerksberufe')}
          {toggle('foreverOnly', 'Nur Forever-Daten', 'Ignoriert Classic-Fallback (Dropchancen, Kürschnerbarkeit, Münzloot)')}
          {toggle('showUnavailable', 'Noch nicht farmbar anzeigen')}
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            Max. Moblevel über mir
            <input type="number" min={0} max={10} value={filters.maxAbove} onChange={(e) => setFilters({ maxAbove: Math.min(10, Math.max(0, Number(e.target.value))) })} className={cx(inputCls, 'h-7 w-12 text-center')} />
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            Ruleset
            <Select value={p.ruleset} onChange={(v) => update({ ruleset: v })} options={[{ value: 'normal', label: 'Normal' }, { value: 'pvp', label: 'PvP' }, { value: 'rp', label: 'RP' }, { value: 'rppvp', label: 'RP-PvP' }]} className="h-7" />
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            Dauer
            <Select value={String(p.durationMin) as '15' | '30' | '60' | '120'} onChange={(v) => update({ durationMin: Number(v) as Profile['durationMin'] })}
              options={['15', '30', '60', '120'].map((v) => ({ value: v as '15', label: `${v} min` }))} className="h-7" />
          </label>
          {(['xp', 'gold', 'profession', 'rare'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5 text-[12.5px] text-muted" title="Gewichtung 0–100">
              {{ xp: 'XP', gold: 'Gold', profession: 'Beruf', rare: 'Rares' }[k]}
              <input type="range" min={0} max={100} value={p.priorities[k]} onChange={(e) => update({ priorities: { ...p.priorities, [k]: Number(e.target.value) } })} className="w-20 accent-[var(--color-gold)]" />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
