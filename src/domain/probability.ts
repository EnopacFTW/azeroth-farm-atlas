/** P(at least one drop in n kills) = 1 - (1-p)^n. Returns null for unknown p (never a number without data). */
export function chanceAtLeastOne(p: number | null | undefined, n: number): number | null {
  if (p == null || !Number.isFinite(p) || p < 0 || p > 1 || !(n >= 0)) return null;
  return 1 - Math.pow(1 - p, Math.floor(n));
}

/** Expected kills for one drop = 1/p (mean of the geometric distribution). Not a guarantee. */
export function expectedKills(p: number | null | undefined): number | null {
  if (p == null || !(p > 0) || p > 1) return null;
  return 1 / p;
}

/** Kills needed for a given confidence, e.g. 0.9 -> ln(0.1)/ln(1-p). */
export function killsForConfidence(p: number | null | undefined, confidence: number): number | null {
  if (p == null || !(p > 0) || p >= 1 || !(confidence > 0 && confidence < 1)) return p === 1 ? 1 : null;
  return Math.ceil(Math.log(1 - confidence) / Math.log(1 - p));
}
