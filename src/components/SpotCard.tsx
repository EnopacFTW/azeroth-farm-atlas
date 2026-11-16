import { Link } from 'react-router-dom';
import { Columns3, Drill, Fish, Leaf, MapPin, PawPrint, Shirt, Skull, Star } from 'lucide-react';
import type { ScoredSpot } from '@/domain/scoring';
import { pct } from '@/domain/scoring';
import { formatCopper } from '@/domain/money';
import { nm, nmAlt, title, titleAlt, tr } from '@/i18n';
import { Badge, cx } from './ui';
import { LevelRange } from './data';

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
  } as Record<string, string>)[k] ?? k;

export const gatherSkillName = (k: string) =>
  ({ skinning: tr('Kürschnern', 'Skinning'), mining: tr('Bergbau', 'Mining'), herbalism: tr('Kräuter', 'Herbalism'), fishing: tr('Angeln', 'Fishing') } as Record<string, string>)[k] ?? k;

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
      className={cx('cursor-pointer rounded-lg border px-3.5 py-3 transition-colors', active ? 'border-gold/60 bg-gold/[0.06]' : 'border-line bg-panel hover:border-line-2')}
      aria-selected={active}
    >
      <div className="flex items-start gap-2">
        <KindIcon className="mt-0.5 size-4 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-semibold text-ink" title={titleAlt(sp) ?? undefined}>{title(sp)}</h3>
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
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="num text-[15px] font-semibold text-gold-2" title={tr('Eignung (fitScore) – keine Wirtschaftlichkeit', 'Fit (fitScore) – not profitability')}>{s.fitScore}</span>
          <Badge tone={a.tone}>{a.label}</Badge>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
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
            <li key={`${i.itemId}-${i.context}`} className="text-muted" title={`${nmAlt(i) ?? nm(i)} · ${i.context}${i.foreverConfirmed ? tr(' · Forever-Drop bestätigt', ' · Forever drop confirmed') : ''}`}>
              <span className={['text-q0', 'text-q1', 'text-q2', 'text-q3', 'text-q4'][i.quality ?? 1]}>{nm(i)}</span>{' '}
              <span className="num text-faint">{i.rate != null ? pct(i.rate) : '?'}</span>
            </li>
          ))}
        </ul>
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
