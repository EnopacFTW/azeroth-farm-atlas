import type { FarmSession } from './types';

export interface SessionStats {
  minutes: number;
  netCopper: number | null;
  netGoldPerHour: number | null;
  xpPerHour: number | null;
  killsPerHour: number | null;
  realizedCopper: number;
  unsoldInventoryCopper: number | null;
  itemsPerHour: Record<number, number>;
}

/**
 * A. measured net = (raw + vendor + realized AH - repairs - purchases) / minutes. Unsold loot is reported separately
 * as inventory value (never as income).
 */
export function sessionStats(s: FarmSession, nowMs = Date.now()): SessionStats {
  let ms = s.activeMs;
  if (s.state === 'running' && s.lastResumedAt) {
    // activeMs from Rust already includes the running part at read time; recompute live for the ticking timer
    ms = Math.max(ms, 0);
    void nowMs;
  }
  const minutes = ms / 60_000;
  const anyMoney = [s.rawCopper, s.vendorCopper, s.realizedAuctionCopper, s.repairsCopper, s.purchasesCopper].some((v) => v != null);
  const net = anyMoney
    ? (s.rawCopper ?? 0) + (s.vendorCopper ?? 0) + (s.realizedAuctionCopper ?? 0) - (s.repairsCopper ?? 0) - (s.purchasesCopper ?? 0)
    : null;
  const perHour = (v: number | null) => (v != null && minutes >= 1 ? v / (minutes / 60) : null);
  const realized = s.loot.reduce((a, l) => a + (l.realizedCopper ?? 0), 0);
  const unsoldKnown = s.loot.filter((l) => l.realizedCopper == null && l.unitPriceCopper != null);
  const unsold = unsoldKnown.length ? unsoldKnown.reduce((a, l) => a + (l.unitPriceCopper ?? 0) * l.quantity, 0) : null;
  const itemsPerHour: Record<number, number> = {};
  if (minutes >= 1) for (const l of s.loot) itemsPerHour[l.itemId] = l.quantity / (minutes / 60);
  return {
    minutes,
    netCopper: net,
    netGoldPerHour: net != null && minutes >= 1 ? net / 10_000 / (minutes / 60) : null,
    xpPerHour: perHour(s.xpGained),
    killsPerHour: perHour(s.kills),
    realizedCopper: realized,
    unsoldInventoryCopper: unsold,
    itemsPerHour,
  };
}

/** Live elapsed ms for a running session (UI ticker), pauses excluded. */
export function liveActiveMs(s: FarmSession, fetchedAtMs: number, nowMs = Date.now()): number {
  return s.state === 'running' ? s.activeMs + Math.max(0, nowMs - fetchedAtMs) : s.activeMs;
}

/** Measured kills/h for a spot across ended sessions with recorded kills (needs >= 10 active minutes). */
export function measuredKillsPerHour(sessions: FarmSession[], spotId: string): { value: number; sessions: number; minutes: number } | null {
  const rel = sessions.filter((s) => s.spotId === spotId && s.state === 'ended' && s.kills != null && s.activeMs > 0);
  const minutes = rel.reduce((a, s) => a + s.activeMs / 60_000, 0);
  const kills = rel.reduce((a, s) => a + (s.kills ?? 0), 0);
  if (minutes < 10) return null;
  return { value: kills / (minutes / 60), sessions: rel.length, minutes };
}

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
