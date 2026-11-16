import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Maximize2, Minimize2 } from 'lucide-react';
import { mapBounds, waypoint, wowToLatLng } from '@/domain/coordinates';
import { copyText } from '@/services/tauri';
import { cx } from './ui';

export type MarkerKind = 'npc' | 'elite' | 'rare' | 'ore' | 'herb' | 'fishing_pool' | 'spot' | 'spot_active';

export interface MapMarker {
  key: string;
  x: number;
  y: number;
  kind: MarkerKind;
  label: string;
  lines?: string[];
  dimmed?: boolean;
  onClick?: () => void;
}

const COLORS: Record<MarkerKind, string> = {
  npc: '#e7c873',
  elite: '#e06c6c',
  rare: '#b048f8',
  ore: '#c9cdd6',
  herb: '#5cc98a',
  fishing_pool: '#6fa8dc',
  spot: '#d6b25e',
  spot_active: '#f1d58a',
};

// Grid image for the coordinate plane. Explicitly NOT a game map.
function gridSvg(): string {
  const lines: string[] = [];
  for (let i = 0; i <= 100; i += 5) {
    const major = i % 10 === 0;
    const c = major ? '#2c3546' : '#1c2330';
    lines.push(`<line x1="${i * 10}" y1="0" x2="${i * 10}" y2="1000" stroke="${c}" stroke-width="${major ? 1.5 : 1}"/>`);
    lines.push(`<line x1="0" y1="${i * 10}" x2="1000" y2="${i * 10}" stroke="${c}" stroke-width="${major ? 1.5 : 1}"/>`);
    if (major && i > 0 && i < 100) {
      lines.push(`<text x="${i * 10 + 4}" y="16" fill="#56607a" font-size="13" font-family="Segoe UI">${i}</text>`);
      lines.push(`<text x="4" y="${i * 10 - 4}" fill="#56607a" font-size="13" font-family="Segoe UI">${i}</text>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000"><rect width="1000" height="1000" fill="#10151d"/>${lines.join('')}<rect x="1" y="1" width="998" height="998" fill="none" stroke="#3a4558" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function popupEl(m: MapMarker, zoneName?: string): HTMLElement {
  const el = document.createElement('div');
  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.textContent = m.label;
  el.appendChild(title);
  for (const l of m.lines ?? []) {
    const d = document.createElement('div');
    d.style.color = '#9aa3b5';
    d.textContent = l;
    el.appendChild(d);
  }
  const way = waypoint(m.x, m.y, zoneName);
  const row = document.createElement('div');
  row.style.marginTop = '6px';
  row.style.display = 'flex';
  row.style.gap = '6px';
  row.style.alignItems = 'center';
  const code = document.createElement('code');
  code.textContent = way;
  code.style.fontSize = '11.5px';
  const btn = document.createElement('button');
  btn.textContent = 'Kopieren';
  btn.style.cssText = 'background:#232a37;border:1px solid #364053;color:#e7e9ef;border-radius:4px;padding:1px 6px;font-size:11px;cursor:pointer';
  btn.onclick = async () => {
    await copyText(way);
    btn.textContent = 'Kopiert ✓';
  };
  row.append(code, btn);
  el.appendChild(row);
  return el;
}

export interface WorldMapProps {
  zoneName: string;
  uiMapId?: number | null;
  markers: MapMarker[];
  hull?: [number, number][] | null;
  route?: [number, number][] | null;
  routeLabel?: string;
  focus?: { x: number; y: number; r?: number } | null;
  className?: string;
}

export function WorldMap({ zoneName, uiMapId, markers, hull, route, routeLabel, focus, className }: WorldMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [full, setFull] = useState(false);
  const grid = useMemo(gridSvg, []);

  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, {
      crs: L.CRS.Simple,
      minZoom: 1,
      maxZoom: 6,
      zoomSnap: 0.25,
      preferCanvas: true,
      attributionControl: true,
      maxBounds: L.latLngBounds(mapBounds()).pad(0.15),
    });
    L.imageOverlay(grid, mapBounds()).addTo(m);
    m.fitBounds(mapBounds());
    m.attributionControl.setPrefix(false);
    m.attributionControl.addAttribution('Koordinatenfläche 0–100 % (keine Blizzard-Karte) · Spawns: QuestieDB Forever');
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, [grid]);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    if (hull && hull.length >= 3) {
      L.polygon(hull.map(([x, y]) => wowToLatLng(x, y)), { color: '#d6b25e', weight: 1, fillOpacity: 0.07, dashArray: '4 4', interactive: false }).addTo(g);
    }
    if (route && route.length >= 2) {
      const pts = [...route, route[0]].map(([x, y]) => wowToLatLng(x, y));
      L.polyline(pts, { color: '#6fa8dc', weight: 1.5, opacity: 0.85 })
        .bindTooltip(routeLabel ?? 'Kürzeste Punktfolge (Luftlinie, Terrain nicht berücksichtigt)', { sticky: true })
        .addTo(g);
    }
    for (const mk of markers) {
      const isSpot = mk.kind === 'spot' || mk.kind === 'spot_active';
      const c = L.circleMarker(wowToLatLng(mk.x, mk.y), {
        radius: isSpot ? (mk.kind === 'spot_active' ? 8 : 6) : 3.5,
        color: isSpot ? '#0e1117' : COLORS[mk.kind],
        weight: isSpot ? 2 : 1,
        fillColor: COLORS[mk.kind],
        fillOpacity: mk.dimmed ? 0.25 : isSpot ? 0.95 : 0.85,
        opacity: mk.dimmed ? 0.4 : 1,
      });
      c.bindTooltip(mk.label, { direction: 'top', offset: [0, -4] });
      c.bindPopup(() => popupEl(mk, zoneName));
      if (mk.onClick) c.on('click', mk.onClick);
      c.addTo(g);
    }
  }, [markers, hull, route, routeLabel, zoneName]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (focus) {
      const r = Math.max(6, (focus.r ?? 8) * 1.4);
      const b = L.latLngBounds(wowToLatLng(Math.max(0, focus.x - r), Math.max(0, focus.y - r)), wowToLatLng(Math.min(100, focus.x + r), Math.min(100, focus.y + r)));
      m.flyToBounds(b, { duration: 0.35, maxZoom: 4.5 });
    } else {
      m.fitBounds(mapBounds());
    }
  }, [focus?.x, focus?.y, focus?.r, uiMapId]);

  useEffect(() => {
    setTimeout(() => map.current?.invalidateSize(), 50);
  }, [full]);

  return (
    <div className={cx(full ? 'fixed inset-3 z-[1000] rounded-lg border border-line-2 shadow-2xl' : 'relative', 'overflow-hidden bg-[#10151d]', className)}>
      <div ref={host} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-14 top-2.5 z-[500] rounded bg-bg/85 px-2 py-1 text-[11.5px] text-muted">
        <span className="font-semibold text-ink">{zoneName}</span>
        {uiMapId ? <span className="ml-1.5 text-faint">UiMap {uiMapId}</span> : null}
        <span className="ml-1.5 text-warn/90">Koordinatenfläche – kein Kartenbild</span>
      </div>
      <button
        type="button"
        onClick={() => setFull((f) => !f)}
        title={full ? 'Vollbild beenden' : 'Karte im Vollbild'}
        className="absolute right-2 top-2 z-[500] rounded border border-line bg-panel-2 p-1.5 text-muted hover:text-ink cursor-pointer"
      >
        {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
    </div>
  );
}
