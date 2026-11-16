import { ExternalLink } from 'lucide-react';
import { openExternal } from '@/services/tauri';
import { getLang, tr } from '@/i18n';
import { cx } from './ui';

export type WowheadKind = 'item' | 'npc' | 'object' | 'zone';

/** Wowhead's WoW Forever database (wowhead.com/forever/…), German pages under /forever/de/. Opened in the default browser. */
export function wowheadUrl(kind: WowheadKind, id: number): string {
  return `https://www.wowhead.com/forever/${getLang() === 'de' ? 'de/' : ''}${kind}=${Math.floor(id)}`;
}

export function WowheadButton({ kind, id, className, compact }: { kind: WowheadKind; id: number; className?: string; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void openExternal(wowheadUrl(kind, id)); }}
      title={tr('Auf Wowhead (WoW Forever) im Browser öffnen', 'Open on Wowhead (WoW Forever) in the browser')}
      className={cx('inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] font-normal text-muted hover:border-line-2 hover:text-ink cursor-pointer', className)}
    >
      <ExternalLink className="size-3" />{!compact && 'Wowhead'}
    </button>
  );
}
