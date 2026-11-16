import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import { ImagePlus, Maximize2, Minimize2 } from 'lucide-react';
import { imageOverlayBounds, mapBounds, waypoint, wowToLatLng, ZONE_PLANE, type MapCalibration } from '@/domain/coordinates';
import { api, copyText, isClientMap, mapImageUrl, type ZoneDensity } from '@/services/tauri';
import { ClientMapsButton } from './ClientMaps';
import { tr } from '@/i18n';
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

const PLANE = ZONE_PLANE;
const ll = (x: number, y: number) => wowToLatLng(x, y, PLANE);

// Grid image for the coordinate plane. Explicitly NOT a game map.
function gridSvg(): string {
  const W = 1500, H = 1000;
  const lines: string[] = [];
  for (let i = 0; i <= 100; i += 5) {
    const major = i % 10 === 0;
    const c = major ? '#2c3546' : '#1c2330';
    const x = i * 15, y = i * 10;
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${c}" stroke-width="${major ? 1.5 : 1}"/>`);
    lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c}" stroke-width="${major ? 1.5 : 1}"/>`);
    if (major && i > 0 && i < 100) {
      lines.push(`<text x="${x + 4}" y="16" fill="#56607a" font-size="13" font-family="Segoe UI">${i}</text>`);
      lines.push(`<text x="4" y="${y - 4}" fill="#56607a" font-size="13" font-family="Segoe UI">${i}</text>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#10151d"/>${lines.join('')}<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="#3a4558" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Soft spawn-density shading (all NPC + node spawns of the zone). Shows where the zone has content – not terrain. */
function densityImage(d: ZoneDensity): string | null {
  if (!d.total || typeof document === 'undefined') return null;
  const cell = 20;
  const canvas = document.createElement('canvas');
  canvas.width = d.cols * cell;
  canvas.height = d.rows * cell;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.filter = `blur(${cell * 0.9}px)`;
  const lmax = Math.log1p(d.max);
  for (let r = 0; r < d.rows; r++) {
    for (let c = 0; c < d.cols; c++) {
      const v = d.cells[r * d.cols + c];
      if (!v) continue;
      const a = 0.18 + 0.62 * (Math.log1p(v) / lmax);
      ctx.fillStyle = `rgba(92, 132, 104, ${a.toFixed(3)})`;
      ctx.fillRect(c * cell - cell * 0.4, r * cell - cell * 0.4, cell * 1.8, cell * 1.8);
    }
  }
  return canvas.toDataURL('image/png');
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
  btn.textContent = tr('Kopieren', 'Copy');
  btn.style.cssText = 'background:#232a37;border:1px solid #364053;color:#e7e9ef;border-radius:4px;padding:1px 6px;font-size:11px;cursor:pointer';
  btn.onclick = async () => {
    await copyText(way);
    btn.textContent = tr('Kopiert ✓', 'Copied ✓');
  };
  row.append(code, btn);
  el.appendChild(row);
  return el;
}

export interface WorldMapProps {
  zoneId?: number | null;
  zoneName: string;
  uiMapId?: number | null;
  markers: MapMarker[];
  hull?: [number, number][] | null;
  route?: [number, number][] | null;
  routeLabel?: string;
  focus?: { x: number; y: number; r?: number } | null;
  /** Live preview while aligning an imported image (Atlas). */
  calibrationOverride?: MapCalibration | null;
  imageOpacity?: number;
  className?: string;
}

export function WorldMap({ zoneId, zoneName, uiMapId, markers, hull, route, routeLabel, focus, calibrationOverride, imageOpacity = 1, className }: WorldMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const base = useRef<L.LayerGroup | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const image = useRef<L.ImageOverlay | null>(null);
  const attribution = useRef<string | null>(null);
  const [full, setFull] = useState(false);
  const navigate = useNavigate();
  const grid = useMemo(gridSvg, []);
  const asset = useQuery({ queryKey: ['mapAsset', zoneId], queryFn: () => api.getMapAsset(zoneId!), enabled: zoneId != null, staleTime: Infinity });
  const density = useQuery({ queryKey: ['zoneDensity', zoneId], queryFn: () => api.zoneDensity(zoneId!), enabled: zoneId != null && asset.isSuccess && !asset.data, staleTime: Infinity });
  const densityUrl = useMemo(() => (density.data ? densityImage(density.data) : null), [density.data]);
  const a = asset.data ?? null;

  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, {
      crs: L.CRS.Simple,
      minZoom: 1,
      maxZoom: 6,
      zoomSnap: 0.25,
      preferCanvas: true,
      attributionControl: true,
      maxBounds: L.latLngBounds(mapBounds(PLANE)).pad(0.15),
    });
    m.fitBounds(mapBounds(PLANE));
    m.attributionControl.setPrefix(false);
    base.current = L.layerGroup().addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  // base layer: imported image, otherwise grid + spawn density
  useEffect(() => {
    const m = map.current;
    const g = base.current;
    if (!m || !g) return;
    g.clearLayers();
    image.current = null;
    if (attribution.current) m.attributionControl.removeAttribution(attribution.current);
    if (a) {
      image.current = L.imageOverlay(mapImageUrl(a), imageOverlayBounds(calibrationOverride ?? a.calibration, PLANE), { opacity: imageOpacity }).addTo(g);
      attribution.current = isClientMap(a)
        ? tr('Karte © Blizzard Entertainment, aus deinem lokalen WoW-Client · Spawns: QuestieDB Forever', 'Map © Blizzard Entertainment, from your local WoW client · spawns: QuestieDB Forever')
        : tr('Eigenes Kartenbild (lokal importiert) · Spawns: QuestieDB Forever', 'Own map image (imported locally) · spawns: QuestieDB Forever');
    } else {
      L.imageOverlay(grid, mapBounds(PLANE)).addTo(g);
      if (densityUrl) L.imageOverlay(densityUrl, mapBounds(PLANE), { opacity: 0.9 }).addTo(g);
      attribution.current = tr('Koordinatenfläche 0–100 % (keine Blizzard-Karte) · Spawns: QuestieDB Forever', 'Coordinate plane 0–100 % (no Blizzard map) · spawns: QuestieDB Forever');
    }
    m.attributionControl.addAttribution(attribution.current);
  }, [a?.path, a?.calibration.x0, a?.calibration.y0, a?.calibration.x1, a?.calibration.y1, densityUrl, grid]);

  // live alignment preview without rebuilding the layer
  useEffect(() => {
    if (image.current && a) image.current.setBounds(L.latLngBounds(imageOverlayBounds(calibrationOverride ?? a.calibration, PLANE)));
  }, [calibrationOverride?.x0, calibrationOverride?.y0, calibrationOverride?.x1, calibrationOverride?.y1]);
  useEffect(() => { image.current?.setOpacity(imageOpacity); }, [imageOpacity]);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    if (hull && hull.length >= 3) {
      L.polygon(hull.map(([x, y]) => ll(x, y)), { color: '#d6b25e', weight: 1, fillOpacity: 0.07, dashArray: '4 4', interactive: false }).addTo(g);
    }
    if (route && route.length >= 2) {
      const pts = [...route, route[0]].map(([x, y]) => ll(x, y));
      L.polyline(pts, { color: '#6fa8dc', weight: 1.5, opacity: 0.85 })
        .bindTooltip(routeLabel ?? tr('Kürzeste Punktfolge (Luftlinie, Terrain nicht berücksichtigt)', 'Shortest point sequence (straight line, terrain not considered)'), { sticky: true })
        .addTo(g);
    }
    for (const mk of markers) {
      const isSpot = mk.kind === 'spot' || mk.kind === 'spot_active';
      const c = L.circleMarker(ll(mk.x, mk.y), {
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
      const b = L.latLngBounds(ll(Math.max(0, focus.x - r), Math.max(0, focus.y - r)), ll(Math.min(100, focus.x + r), Math.min(100, focus.y + r)));
      m.flyToBounds(b, { duration: 0.35, maxZoom: 4.5 });
    } else {
      m.fitBounds(mapBounds(PLANE));
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
        {a
          ? <span className="ml-1.5 text-ok/90" title={a.originalName ?? undefined}>{isClientMap(a) ? tr('Spielkarte (lokaler WoW-Client)', 'Game map (local WoW client)') : tr('Eigenes Kartenbild', 'Own map image')}</span>
          : <span className="ml-1.5 text-warn/90" title={tr('Grün schattiert: Dichte aller Forever-Spawns der Zone (kein Gelände)', 'Green shading: density of all Forever spawns in the zone (not terrain)')}>
              {tr('Koordinatenfläche + Spawndichte – kein Kartenbild', 'Coordinate plane + spawn density – no map image')}
            </span>}
      </div>
      <div className="absolute right-2 top-2 z-[500] flex items-start gap-1.5">
        {zoneId != null && uiMapId && asset.isSuccess && (!a || isClientMap(a)) && !calibrationOverride && <ClientMapsButton current={a} />}
        {zoneId != null && !calibrationOverride && (
          <button
            type="button"
            onClick={() => navigate(`/atlas?zone=${zoneId}&maps=1`)}
            title={a ? tr('Kartenbild ausrichten oder ersetzen', 'Align or replace the map image') : tr('Eigenes Kartenbild für diese Zone importieren', 'Import your own map image for this zone')}
            className="flex items-center gap-1 rounded border border-line bg-panel-2 px-2 py-1 text-[11.5px] text-muted hover:text-ink cursor-pointer"
          >
            <ImagePlus className="size-3.5" /> {a ? tr('Karte', 'Map') : tr('Karte hinzufügen', 'Add map')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setFull((f) => !f)}
          title={full ? tr('Vollbild beenden', 'Exit full screen') : tr('Karte im Vollbild', 'Map full screen')}
          className="rounded border border-line bg-panel-2 p-1.5 text-muted hover:text-ink cursor-pointer"
        >
          {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>
    </div>
  );
}
