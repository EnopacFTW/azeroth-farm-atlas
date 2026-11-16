import { Link } from 'react-router-dom';
import { Columns3, Drill, Fish, Leaf, MapPin, PawPrint, Shirt, Skull, Star } from 'lucide-react';
import type { ScoredSpot } from '@/domain/scoring';
import { pct } from '@/domain/scoring';
import { formatCopper } from '@/domain/money';
import { Badge, cx } from './ui';
import { LevelRange } from './data';

const AVAIL: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  ready: { label: 'Sofort farmbar', tone: 'ok' },
  skill_missing: { label: 'Skill fehlt', tone: 'warn' },
  profession_missing: { label: 'Beruf fehlt', tone: 'warn' },
  too_high: { label: 'Zu hoch', tone: 'bad' },
  incomplete_data: { label: 'Daten unvollständig', tone: 'info' },
  excluded: { label: 'Gefiltert', tone: 'neutral' },
};

const KIND_LABEL: Record<string, string> = {
  mob_cluster: 'Mob-Cluster', mob_scattered: 'Verstreute Spawns', rare_mob: 'Rare-Mob', node_zone: 'Vorkommen', fishing_pool: 'Fischschwärme', fishing_zone: 'Angelgewässer',
};

export function SpotCard({ s, active, favorite, inCompare, onSelect, onFavorite, onCompare }: {
  s: ScoredSpot; active: boolean; favorite: boolean; inCompare: boolean; onSelect: () => void; onFavorite: () => void; onCompare: () => void;
}) {
  const sp = s.spot;
  const a = AVAIL[s.availability];
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
          <h3 className="truncate text-[13.5px] font-semibold text-ink" title={sp.titleEn}>{sp.titleDe}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            <span>{sp.zone.nameDe ?? sp.zone.nameEn}</span>
            <span className="text-faint">·</span>
            {sp.levelMin != null ? <LevelRange min={sp.levelMin} max={sp.levelMax} /> : <span>Zone ~{sp.zone.levelMin}–{sp.zone.levelMax}</span>}
            <span className="text-faint">·</span>
            <span>{KIND_LABEL[sp.kind]}</span>
            <span className="text-faint">·</span>
            <span className="num">{sp.spawnCount} Spawns</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="num text-[15px] font-semibold text-gold-2" title="Eignung (fitScore) – keine Wirtschaftlichkeit">{s.fitScore}</span>
          <Badge tone={a.tone}>{a.label}</Badge>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {sp.hasElite ? <Badge tone="bad"><Skull className="size-3" /> Elite</Badge> : null}
        {sp.isInstance ? <Badge tone="warn">Instanz</Badge> : null}
        {s.pvpRisk === 'high' && <Badge tone="bad">PvP-Feindgebiet</Badge>}
        {s.pvpRisk === 'medium' && <Badge tone="warn">umkämpft</Badge>}
        {sp.reqSkill != null && sp.reqSkillType && (
          <Badge tone={s.availability === 'skill_missing' ? 'warn' : 'neutral'} title="Classic-Regel, nicht Forever-geprüft">
            {{ skinning: 'Kürschnern', mining: 'Bergbau', herbalism: 'Kräuter', fishing: 'Angeln' }[sp.reqSkillType]} ab {sp.reqSkill}
          </Badge>
        )}
        {s.skinnableShare != null && <Badge tone="ok">{Math.round(s.skinnableShare * 100)} % kürschnerbar</Badge>}
      </div>
      {items.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
          {items.map((i) => (
            <li key={`${i.itemId}-${i.context}`} className="text-muted" title={`${i.nameEn} · ${i.context}${i.foreverConfirmed ? ' · Forever-Drop bestätigt' : ''}`}>
              <span className={['text-q0', 'text-q1', 'text-q2', 'text-q3', 'text-q4'][i.quality ?? 1]}>{i.nameDe ?? i.nameEn}</span>{' '}
              <span className="num text-faint">{i.rate != null ? pct(i.rate) : '?'}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-3 text-[12px]">
        <span className="text-faint" title="Gold/h nur aus gemessenen Sessions">
          Gold/h: <span className="text-muted">keine Daten</span>
          {s.vendorPerKillCopper != null && <> · Händler/Kill ≈ <span className="num text-muted">{formatCopper(s.vendorPerKillCopper)}</span> <span className="text-warn/80">(Classic-Modell)</span></>}
        </span>
        <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Link to={`/spots/${encodeURIComponent(sp.id)}`} className="rounded px-2 py-0.5 text-gold hover:bg-panel-3">Details</Link>
          <button type="button" onClick={onCompare} title="Zum Vergleich" className={cx('rounded p-1 hover:bg-panel-3 cursor-pointer', inCompare ? 'text-info' : 'text-faint')}><Columns3 className="size-3.5" /></button>
          <button type="button" onClick={onFavorite} title="Favorit" className={cx('rounded p-1 hover:bg-panel-3 cursor-pointer', favorite ? 'text-gold' : 'text-faint')}><Star className={cx('size-3.5', favorite && 'fill-current')} /></button>
        </div>
      </div>
    </article>
  );
}
