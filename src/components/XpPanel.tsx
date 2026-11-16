import { useState } from 'react';
import { grayFromLevel, killXpRange, MAX_LEVEL, spotXp, XP_TO_LEVEL, type XpMob } from '@/domain/xp';
import { num, tr } from '@/i18n';
import { Panel, Stat } from './ui';
import { SourceBadge } from './data';

/** Kill XP (Classic formula) for the active profile level, for one mob or a whole spot (spawn-weighted). */
export function XpPanel({ mobs, level }: { mobs: XpMob[]; level: number }) {
  const [rested, setRested] = useState(false);
  const xp = spotXp(level, mobs, { rested });
  if (!xp) return null;
  const lmin = Math.min(...mobs.map((m) => m.levelMin ?? 99));
  const lmax = Math.max(...mobs.map((m) => m.levelMax ?? m.levelMin ?? 0));
  const grayAt = grayFromLevel(lmax);
  const levels = [...new Set([level - 2, level - 1, level, level + 1, level + 2, level + 3].filter((l) => l >= 1 && l < MAX_LEVEL))];
  const single = mobs.length === 1;
  return (
    <Panel
      title={tr('Erfahrung pro Kill', 'Experience per kill')}
      actions={
        <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <input type="checkbox" checked={rested} onChange={(e) => setRested(e.target.checked)} className="accent-[var(--color-gold)]" />
          {tr('Ausgeruht (×2)', 'Rested (×2)')}
        </label>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <Stat label={tr(`XP/Kill bei Level ${level}`, `XP/kill at level ${level}`)} value={xp.avg > 0 ? num(xp.avg) : tr('0 (grau)', '0 (gray)')}
          hint={xp.min !== xp.max ? `${num(xp.min)}–${num(xp.max)}${single ? '' : tr(' · nach Spawns gewichtet', ' · weighted by spawns')}` : undefined} />
        <Stat label={tr(`Kills bis Level ${level + 1}`, `Kills to level ${level + 1}`)} value={xp.killsToLevel != null ? `~${num(xp.killsToLevel)}` : '—'}
          hint={XP_TO_LEVEL[level] ? tr(`${num(XP_TO_LEVEL[level])} XP für das ganze Level`, `${num(XP_TO_LEVEL[level])} XP for the whole level`) : undefined} />
        <Stat label={tr('Grau ab Spielerlevel', 'Gray from player level')} value={grayAt >= MAX_LEVEL ? '—' : String(grayAt)}
          hint={tr(`Moblevel ${lmin}–${lmax}`, `Mob level ${lmin}–${lmax}`)} />
      </div>
      <table className="mt-3 w-full text-[12px]">
        <thead className="text-left text-[11px] uppercase tracking-wide text-faint">
          <tr className="border-b border-line">
            <th className="py-1 font-medium">{tr('Dein Level', 'Your level')}</th>
            <th className="py-1 text-right font-medium">XP/Kill</th>
            <th className="py-1 text-right font-medium">{tr('Kills bis Level', 'Kills to level')}</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((pl) => {
            const r = spotXp(pl, mobs, { rested });
            const [lo, hi] = single ? killXpRange(pl, mobs[0].levelMin ?? 1, mobs[0].levelMax ?? mobs[0].levelMin ?? 1, { rank: mobs[0].rank, xpMult: mobs[0].xpMult, rested }) : [r?.min ?? 0, r?.max ?? 0];
            return (
              <tr key={pl} className={pl === level ? 'bg-gold/[0.06] font-semibold' : 'border-b border-line/40'}>
                <td className="py-0.5 num">{pl}</td>
                <td className="py-0.5 text-right num">{r && r.avg > 0 ? `${num(r.avg)}${lo !== hi ? ` (${num(lo)}–${num(hi)})` : ''}` : tr('0 (grau)', '0 (gray)')}</td>
                <td className="py-0.5 text-right num text-muted">{r?.killsToLevel != null ? `~${num(r.killsToLevel)}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
        <SourceBadge source="classic_rules" />
        {tr('Classic-Formel (cmangos Formulas.h): gleiches Level = Level × 5 + 45, +5 %/Level darüber (max. +4), darunter bis grau linear auf 0; Elite ×2, Ausgeruht ×2. Gruppen teilen die XP. Nicht Forever-geprüft.',
          'Classic formula (cmangos Formulas.h): same level = level × 5 + 45, +5 %/level above (max +4), below linearly to 0 at gray; elite ×2, rested ×2. Groups split XP. Not checked on Forever.')}
        {mobs.some((m) => m.xpMult != null && m.xpMult !== 1) && <span className="text-warn">{tr('Enthält Mobs mit abweichendem XP-Faktor.', 'Includes mobs with a different XP factor.')}</span>}
      </p>
    </Panel>
  );
}
