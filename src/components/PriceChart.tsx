import type { PriceSeries } from '@/domain/types';
import { formatCopper } from '@/domain/money';
import { date, tr } from '@/i18n';

/** Small dependency-free SVG chart: median (gold) and min buyout (blue) over the provider's own history window. */
export function PriceChart({ series }: { series: PriceSeries }) {
  const pts = series.points.filter((p) => p.median != null || p.min != null);
  if (pts.length < 2) return null;
  const W = 760, H = 150, P = 28;
  const vals = pts.flatMap((p) => [p.median, p.min]).filter((v): v is number => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const t0 = Date.parse(pts[0].t), t1 = Date.parse(pts[pts.length - 1].t);
  const x = (t: string) => P + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / Math.max(1, hi - lo)) * (H - 2 * P);
  const path = (k: 'median' | 'min') => pts.filter((p) => p[k] != null).map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k]!).toFixed(1)}`).join(' ');
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[760px]" role="img" aria-label={tr('Preisverlauf', 'Price history')}>
        <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="#2a3242" />
        <text x={4} y={y(hi) + 4} fill="#6b7487" fontSize="10">{formatCopper(hi)}</text>
        <text x={4} y={y(lo) + 4} fill="#6b7487" fontSize="10">{formatCopper(lo)}</text>
        <path d={path('min')} fill="none" stroke="#6fa8dc" strokeWidth="1.2" opacity="0.8" />
        <path d={path('median')} fill="none" stroke="#d6b25e" strokeWidth="1.8" />
        <text x={P} y={H - 8} fill="#6b7487" fontSize="10">{date(pts[0].t)}</text>
        <text x={W - P} y={H - 8} fill="#6b7487" fontSize="10" textAnchor="end">{date(pts[pts.length - 1].t)}</text>
      </svg>
      <figcaption className="text-[11px] text-faint">
        <span className="text-gold">━ Median</span> · <span className="text-info">━ {tr('Min-Sofortkauf', 'Min buyout')}</span> · {tr(`Verlauf ${series.range} laut Anbieter (nicht lokal archiviert)`, `${series.range} history from the provider (not archived locally)`)}
      </figcaption>
    </figure>
  );
}
