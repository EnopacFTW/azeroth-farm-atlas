import { Link } from 'react-router-dom';
import { Columns3, Drill, Fish, Flame, Leaf, MapPin, PawPrint, Shirt, Skull, Star, Users } from 'lucide-react';
import type { ScoredSpot } from '@/domain/scoring';
import { pct } from '@/domain/scoring';
import { formatCopper } from '@/domain/money';
import { nm, num, title, titleAlt, tr } from '@/i18n';
import { Badge, cx } from './ui';
import { LevelRange } from './data';
import { HoverCard, ItemTooltipBody } from './ItemTooltip';

export function availabilityInfo(a: string): { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' } {
  switch (a) {
    case 'ready': return { label: tr('Sofort farmbar', 'Farmable now'), tone: 'ok' };
    case 'skill_missing': return { label: tr('Skill fehlt', 'Skill missing'), tone: 'warn' };
    case 'profession_missing': return { label: tr('Beruf fehlt', 'Profession missing'), tone: 'warn' };
    case 'too_high': return { label: tr('Zu hoch', 'Too high'), tone: 'bad' };
    case 'incomplete_data': return { label: tr('Daten unvollständig', 'Incomplete data'), tone: 'info' };
    default: return { label: tr('Gefiltert', 'Filtered'), tone: 'neutral' };
  }
}

export const spotKindLabel = (k: string) =>
  ({
    mob_cluster: tr('Mob-Cluster', 'Mob cluster'), mob_scattered: tr('Verstreute Spawns', 'Scattered spawns'), rare_mob: tr('Rare-Mob', 'Rare mob'),
    node_zone: tr('Vorkommen', 'Nodes'), fishing_pool: tr('Fischschwärme', 'Fishing pools'), fishing_zone: tr('Angelgewässer', 'Fishing waters'),
    instance_run: tr('Instanz-Run', 'Instance run'),
  } as Record<string, string>)[k] ?? k;

export const gatherSkillName = (k: string) =>
  ({ skinning: tr('Kürschnern', 'Skinning'), mining: tr('Bergbau', 'Mining'), herbalism: tr('Kräuter', 'Herbalism'), fishing: tr('Angeln', 'Fishing') } as Record<string, string>)[k] ?? k;

/** Circular fit gauge (0–100): green ≥ 75, gold ≥ 50, otherwise muted. */
export function ScoreRing({ value, size = 44 }: { value: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 75 ? '#5fd39a' : v >= 50 ? '#e2b85c' : '#8b94a8';
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}
      title={tr('Eignung (fitScore) – keine Wirtschaftlichkeit', 'Fit (fitScore) – not profitability')}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / .07)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${(c * v) / 100} ${c}`} style={{ filter: `drop-shadow(0 0 4px ${color}88)` }} />
      </svg>
      <span className="num absolute text-[13px] font-bold" style={{ color }}>{v}</span>
    </div>
  );
}

export function SpotCard({ s, active, favorite, inCompare, onSelect, onFavorite, onCompare }: {
  s: ScoredSpot; active: boolean; favorite: boolean; inCompare: boolean; onSelect: () => void; onFavorite: () => void; onCompare: () => void;
}) {
  const sp = s.spot;
  const a = availabilityInfo(s.availability);
  const items = sp.items.slice(0, 6);
  const KindIcon = sp.reqSkillType === 'mining' ? Drill : sp.reqSkillType === 'herbalism' ? Leaf : sp.reqSkillType === 'fishing' ? Fish : sp.tags.includes('skinning') ? PawPrint : sp.tags.includes('cloth') ? Shirt : MapPin;
  return (
    <article
      onClick={onSelect}
      className={cx('group ff-fade-up relative cursor-pointer rounded-xl border px-3.5 py-3 transition-all duration-200',
        active
          ? 'border-gold/60 bg-gradient-to-br from-gold/[0.12] via-panel/80 to-panel/70 shadow-[0_0_0_1px_rgb(226_184_92/.25),0_12px_30px_-14px_rgb(226_184_92/.45)]'
          : 'border-line bg-gradient-to-br from-panel-2/80 to-panel/70 hover:-translate-y-px hover:border-gold/30 hover:shadow-[0_12px_28px_-16px_rgb(0_0_0/.9)]')}
      aria-selected={active}
    >
      <div className="flex items-start gap-2">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-gold/25 bg-gold/[0.08] text-gold shadow-[inset_0_1px_0_rgb(255_255_255/.06)]"><KindIcon className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold text-ink transition-colors group-hover:text-gold-2" title={titleAlt(sp) ?? undefined}>{title(sp)}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            <span>{nm(sp.zone)}</span>
            <span className="text-faint">·</span>
            {sp.levelMin != null ? <LevelRange min={sp.levelMin} max={sp.levelMax} /> : <span>Zone ~{sp.zone.levelMin}–{sp.zone.levelMax}</span>}
            <span className="text-faint">·</span>
            <span>{spotKindLabel(sp.kind)}</span>
            <span className="text-faint">·</span>
            <span className="num">{sp.spawnCount} Spawns</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <ScoreRing value={s.fitScore} />
          <Badge tone={a.tone}>{a.label}</Badge>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(sp.tags as string[]).includes('aoe') && <Badge tone="warn" title={tr('In AoE-Guides für Gruppen-Pulls empfohlen', 'Recommended for pack pulls in AoE guides')}><Flame className="size-3" /> AoE</Badge>}
        {sp.communitySources ? <Badge tone="info" title={tr('In recherchierten Farmguides empfohlen – Quellen in den Details', 'Recommended in researched farming guides – sources in the details')}><Users className="size-3" /> Community</Badge> : null}
        {sp.farmableBy && <Badge tone="warn">{sp.farmableBy === 'horde' ? tr('Nur Horde', 'Horde only') : tr('Nur Allianz', 'Alliance only')}</Badge>}
        {sp.hasElite ? <Badge tone="bad"><Skull className="size-3" /> Elite</Badge> : null}
        {sp.isInstance ? <Badge tone="warn">{tr('Instanz', 'Instance')}</Badge> : null}
        {s.pvpRisk === 'high' && <Badge tone="bad">{tr('PvP-Feindgebiet', 'PvP enemy territory')}</Badge>}
        {s.pvpRisk === 'medium' && <Badge tone="warn">{tr('umkämpft', 'contested')}</Badge>}
        {sp.reqSkill != null && sp.reqSkillType && (
          <Badge tone={s.availability === 'skill_missing' ? 'warn' : 'neutral'} title={tr('Classic-Regel, nicht Forever-geprüft', 'Classic rule, not checked on Forever')}>
            {gatherSkillName(sp.reqSkillType)} {tr('ab', 'from')} {sp.reqSkill}
          </Badge>
        )}
        {s.skinnableShare != null && <Badge tone="ok">{Math.round(s.skinnableShare * 100)} % {tr('kürschnerbar', 'skinnable')}</Badge>}
      </div>
      {items.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
          {items.map((i) => (
            <li key={`${i.itemId}-${i.context}`} className="text-muted">
              <HoverCard trigger={<span className={['text-q0', 'text-q1', 'text-q2', 'text-q3', 'text-q4'][i.quality ?? 1]}>{nm(i)}</span>}>
                {() => <ItemTooltipBody id={i.itemId} />}
              </HoverCard>{' '}
              <span className="num text-faint">{i.rate != null ? pct(i.rate) : '?'}</span>
            </li>
          ))}
        </ul>
      )}
      {s.xp && (
        <div className="mt-2 text-[12px] text-faint" title={tr('Classic-XP-Formel (cmangos/Wowpedia), Elite ×2, ohne Ausgeruht – nicht Forever-geprüft', 'Classic XP formula (cmangos/Wowpedia), elite ×2, without rested – not checked on Forever')}>
          XP/Kill: {s.xp.avg > 0 ? (
            <>
              <span className="num font-semibold text-info">≈ {num(s.xp.avg)}</span>
              {s.xp.min !== s.xp.max && <span className="num"> ({num(s.xp.min)}–{num(s.xp.max)})</span>}
              {s.xp.killsToLevel != null && <> · <span className="num text-muted">~{num(s.xp.killsToLevel)}</span> {tr('Kills bis Levelaufstieg', 'kills to level up')}</>}
              {s.xp.eliteShare > 0 && <span className="text-bad/80"> · {tr('inkl. Elite ×2', 'incl. elite ×2')}</span>}
            </>
          ) : <span className="text-warn">{tr('0 (grau)', '0 (gray)')}</span>}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-[12px]">
        <span className="text-faint" title={tr('Gold/h nur aus gemessenen Sessions', 'Gold/h only from measured sessions')}>
          Gold/h: <span className="text-muted">{tr('keine Daten', 'no data')}</span>
          {s.vendorPerKillCopper != null && <> · {tr('Händler/Kill', 'Vendor/kill')} ≈ <span className="num text-muted">{formatCopper(s.vendorPerKillCopper)}</span> <span className="text-warn/80">{tr('(Classic-Modell)', '(Classic model)')}</span></>}
        </span>
        <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Link to={`/spots/${encodeURIComponent(sp.id)}`} className="rounded px-2 py-0.5 text-gold hover:bg-panel-3">Details</Link>
          <button type="button" onClick={onCompare} title={tr('Zum Vergleich', 'Add to compare')} className={cx('rounded p-1 hover:bg-panel-3 cursor-pointer', inCompare ? 'text-info' : 'text-faint')}><Columns3 className="size-3.5" /></button>
          <button type="button" onClick={onFavorite} title={tr('Favorit', 'Favorite')} className={cx('rounded p-1 hover:bg-panel-3 cursor-pointer', favorite ? 'text-gold' : 'text-faint')}><Star className={cx('size-3.5', favorite && 'fill-current')} /></button>
        </div>
      </div>
    </article>
  );
}
