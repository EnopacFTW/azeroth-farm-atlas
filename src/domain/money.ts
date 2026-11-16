import { getLang, num } from '@/i18n';

// All prices are integer copper. 100 copper = 1 silver, 100 silver = 1 gold, 10_000 copper = 1 gold.

export function splitCopper(copper: number): { g: number; s: number; c: number; negative: boolean } {
  const negative = copper < 0;
  const v = Math.round(Math.abs(copper));
  return { g: Math.floor(v / 10_000), s: Math.floor((v % 10_000) / 100), c: v % 100, negative };
}

/** "12g 3s 4k" style (German "k" = Kupfer, English "c"). null/undefined renders as an em dash (unknown, NOT zero). */
export function formatCopper(copper: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (copper == null || !Number.isFinite(copper)) return '—';
  const { g, s, c, negative } = splitCopper(copper);
  const parts: string[] = [];
  if (g) parts.push(`${num(g)}g`);
  if (s || (g && c && !opts.compact)) parts.push(`${s}s`);
  if ((c || (!g && !s)) && !(opts.compact && g >= 10)) parts.push(`${c}${getLang() === 'en' ? 'c' : 'k'}`);
  return (negative ? '−' : '') + parts.join(' ');
}

export function goldPerHour(copper: number, minutes: number): number | null {
  if (!(minutes > 0)) return null;
  return copper / 10_000 / (minutes / 60);
}

/** Parses "1g 20s 5k", "1.5g", "120s", "250" (copper). Returns null for invalid input. */
export function parseCopper(input: string): number | null {
  const t = input.trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  let total = 0;
  let matched = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*([gskc])/g)) {
    matched = true;
    const v = Number(m[1]);
    total += m[2] === 'g' ? v * 10_000 : m[2] === 's' ? v * 100 : v;
  }
  return matched ? Math.round(total) : null;
}
