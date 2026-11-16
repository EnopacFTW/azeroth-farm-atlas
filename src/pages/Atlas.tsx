import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, FolderSearch, Gamepad2, ImagePlus, Trash2 } from 'lucide-react';
import { useImportClientMaps, useWowClients } from '@/components/ClientMaps';
import { WorldMap, type MapMarker } from '@/components/WorldMap';
import { Badge, Button, Chip, cx, ErrorBox, inputCls, Spinner } from '@/components/ui';
import { api, errorText, isClientMap, type WowClient } from '@/services/tauri';
import { useActiveProfile } from '@/services/hooks';
import { skillOf } from '@/domain/professionRules';
import type { MapCalibration } from '@/domain/coordinates';
import { dateTime, nm, title, tr } from '@/i18n';
import { useUi } from '@/store/ui';

const continentLabel = (c: string) => ({ eastern_kingdoms: tr('Östliche Königreiche', 'Eastern Kingdoms'), kalimdor: 'Kalimdor' } as Record<string, string>)[c] ?? c;
const kindLabel = (k: string) =>
  ({ zone: tr('Zonen', 'Zones'), city: tr('Städte', 'Cities'), dungeon: 'Dungeons', raid: tr('Schlachtzüge', 'Raids'), battleground: tr('Schlachtfelder', 'Battlegrounds') } as Record<string, string>)[k] ?? k;
const controlLabel = (c: string) =>
  ({ alliance: tr('Allianzgebiet', 'Alliance territory'), horde: tr('Hordegebiet', 'Horde territory'), contested: tr('umkämpft', 'contested'), sanctuary: tr('Zuflucht', 'Sanctuary') } as Record<string, string>)[c] ?? c;

export function AtlasPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { profile } = useActiveProfile();
  const { layers, toggleLayer, showAllResources, setShowAllResources } = useUi();
  const zones = useQuery({ queryKey: ['zones'], queryFn: api.listZones, staleTime: Infinity });
  const assets = useQuery({ queryKey: ['mapAssets'], queryFn: api.listMapAssets });
  const zoneId = Number(params.get('zone')) || 11;
  const mapsOpen = params.get('maps') === '1';
  const layer = useQuery({ queryKey: ['zoneLayer', zoneId], queryFn: () => api.zoneLayer(zoneId) });
  const mining = profile ? skillOf(profile, 'mining') : null;
  const herb = profile ? skillOf(profile, 'herbalism') : null;
  const [calDraft, setCalDraft] = useState<MapCalibration | null>(null);
  const [opacity, setOpacity] = useState(1);

  const markers: MapMarker[] = useMemo(() => {
    if (!layer.data) return [];
    const out: MapMarker[] = [];
    for (const n of layer.data.nodes) {
      if (!layers[n.nodeType as 'ore' | 'herb' | 'fishing_pool']) continue;
      const skill = n.nodeType === 'ore' ? mining : n.nodeType === 'herb' ? herb : null;
      const reachable = n.nodeType === 'fishing_pool' || (skill != null && n.requiredSkill != null && skill >= n.requiredSkill);
      if (!reachable && !showAllResources && !calDraft) continue;
      n.points.forEach(([x, y]: [number, number], i: number) =>
        out.push({ key: `n${n.objectId}-${i}`, x, y, kind: n.nodeType, dimmed: !reachable, label: nm(n),
          lines: [n.requiredSkill != null ? `Skill ${n.requiredSkill} ${tr('(Classic-Regel)', '(Classic rule)')}${!reachable ? tr(' – fehlt', ' – missing') : ''}` : tr('Skill unbekannt', 'Skill unknown'), 'Spawn: QuestieDB Forever'] }));
    }
    if (layers.spots) {
      for (const s of layer.data.spots) {
        if (s.kind === 'node_zone' || s.kind === 'fishing_pool') continue;
        out.push({ key: `s${s.id}`, x: s.centerX, y: s.centerY, kind: s.hasElite ? 'elite' : s.hasRare ? 'rare' : 'spot', label: title(s),
          lines: [s.levelMin != null ? `Level ${s.levelMin}–${s.levelMax}` : '', tr('Klick: Details öffnen', 'Click: open details')], onClick: () => nav(`/spots/${encodeURIComponent(s.id)}`) });
      }
    }
    return out;
  }, [layer.data, layers, mining, herb, showAllResources, nav, calDraft != null]);

  const grouped = useMemo(() => {
    const g: Record<string, Record<string, any[]>> = {};
    for (const z of zones.data ?? []) {
      ((g[z.continent] ??= {})[z.kind] ??= []).push(z);
    }
    return g;
  }, [zones.data]);
  const z = zones.data?.find((x) => x.id === zoneId);
  const withImage = new Set((assets.data ?? []).map((a) => a.zoneId));
  useEffect(() => setCalDraft(null), [zoneId]);

  return (
    <div className="flex h-full">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-line p-3">
        {zones.isLoading && <Spinner />}
        {Object.entries(grouped).map(([cont, kinds]) => (
          <div key={cont} className="mb-4">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gold">{continentLabel(cont)}</h3>
            {['zone', 'city', 'dungeon', 'raid', 'battleground'].filter((k) => kinds[k]).map((k) => (
              <div key={k} className="mb-2">
                <div className="px-1 text-[10.5px] uppercase text-faint">{kindLabel(k)}</div>
                {kinds[k].map((zz: any) => (
                  <button key={zz.id} type="button" onClick={() => setParams({ zone: String(zz.id), ...(mapsOpen ? { maps: '1' } : {}) })}
                    className={cx('flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] cursor-pointer', zz.id === zoneId ? 'bg-gold/12 text-gold-2' : 'text-muted hover:bg-panel-3 hover:text-ink')}>
                    <span className="flex-1 truncate">{nm(zz)}</span>
                    {withImage.has(zz.id) && <span className="size-1.5 rounded-full bg-ok" title={tr('Eigenes Kartenbild vorhanden', 'Own map image present')} />}
                    {zz.levelMin != null && <span className="num text-[11px] text-faint">{zz.levelMin}–{zz.levelMax}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          <h2 className="mr-2 text-[14px] font-semibold text-ink">{z ? nm(z) : 'Zone'}</h2>
          {z?.control && <Badge tone={z.control === 'contested' ? 'warn' : 'neutral'} title={tr('Classic-Zonenkontrolle (für PvP-Hinweis)', 'Classic zone control (for the PvP hint)')}>{controlLabel(z.control)}</Badge>}
          {z?.levelMin != null && <Badge title={tr('Aus Moblevels abgeleitet (10.–90. Perzentil)', 'Derived from mob levels (10th–90th percentile)')}>{tr('Moblevel', 'Mob level')} ~{z.levelMin}–{z.levelMax}</Badge>}
          <span className="ml-3 text-[11px] uppercase tracking-wider text-faint">{tr('Ebenen', 'Layers')}</span>
          <Chip active={layers.spots} onClick={() => toggleLayer('spots')}>Spots</Chip>
          <Chip active={layers.ore} onClick={() => toggleLayer('ore')}>{tr('Erz', 'Ore')} {mining != null ? `(${mining})` : tr('(kein Bergbau)', '(no mining)')}</Chip>
          <Chip active={layers.herb} onClick={() => toggleLayer('herb')}>{tr('Kräuter', 'Herbs')} {herb != null ? `(${herb})` : tr('(keine Kräuterkunde)', '(no herbalism)')}</Chip>
          <Chip active={layers.fishing_pool} onClick={() => toggleLayer('fishing_pool')}>{tr('Fischschwärme', 'Fishing pools')}</Chip>
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted cursor-pointer">
            <input type="checkbox" checked={showAllResources} onChange={(e) => setShowAllResources(e.target.checked)} className="accent-[var(--color-gold)]" /> {tr('Alle Ressourcen zeigen (auch ohne Skill)', 'Show all resources (even without skill)')}
          </label>
          <Chip tone="info" active={mapsOpen} onClick={() => setParams(mapsOpen ? { zone: String(zoneId) } : { zone: String(zoneId), maps: '1' })}>
            <ImagePlus className="size-3.5" /> {tr('Kartenbilder', 'Map images')}
          </Chip>
        </div>
        {mapsOpen && z && (
          <MapImagePanel zoneId={zoneId} zoneName={nm(z)} uiMapId={z.uiMapId} draft={calDraft} setDraft={setCalDraft} opacity={opacity} setOpacity={setOpacity} />
        )}
        {layer.error && <div className="p-4"><ErrorBox error={layer.error} /></div>}
        <WorldMap className="min-h-0 flex-1" zoneId={zoneId} zoneName={z ? nm(z) : ''} uiMapId={z?.uiMapId} markers={markers} calibrationOverride={calDraft} imageOpacity={calDraft ? opacity : 1} />
        <div className="border-t border-line px-4 py-1.5 text-[11.5px] text-faint">
          {markers.length} Marker · {tr('Spawnkoordinaten QuestieDB Forever (konvertiert) · Skillgrenzen Classic-Regeln · Flugpunkte/Händler nicht als Ebene vorhanden', 'Spawn coordinates QuestieDB Forever (converted) · skill thresholds Classic rules · no flight-path/vendor layer')}
        </div>
      </section>
    </div>
  );
}

/** Import, align and remove the user's own map image for a zone. */
function MapImagePanel({ zoneId, zoneName, uiMapId, draft, setDraft, opacity, setOpacity }: {
  zoneId: number; zoneName: string; uiMapId: number | null; draft: MapCalibration | null; setDraft: (c: MapCalibration | null) => void; opacity: number; setOpacity: (v: number) => void;
}) {
  const qc = useQueryClient();
  const asset = useQuery({ queryKey: ['mapAsset', zoneId], queryFn: () => api.getMapAsset(zoneId), staleTime: Infinity });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const a = asset.data;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['mapAsset'] });
    await qc.invalidateQueries({ queryKey: ['mapAssets'] });
  };
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ tone: 'ok', text });
      await refresh();
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const cal = draft ?? a?.calibration ?? null;
  const setField = (k: keyof MapCalibration, v: number) => cal && setDraft({ ...cal, [k]: Math.round(v * 10) / 10 });
  const field = (k: keyof MapCalibration, label: string) => (
    <label className="flex items-center gap-1.5 text-[12px] text-muted">
      <span className="w-28">{label}</span>
      <input type="range" min={-20} max={120} step={0.1} value={cal?.[k] ?? 0} onChange={(e) => setField(k, Number(e.target.value))} className="w-40 accent-[var(--color-gold)]" />
      <input type="number" step={0.1} value={cal?.[k] ?? 0} onChange={(e) => setField(k, Number(e.target.value))} className={cx(inputCls, 'h-7 w-20 text-right num')} />
    </label>
  );

  return (
    <div className="space-y-2 border-b border-line bg-panel-2/60 px-4 py-3 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{tr('Kartenbild', 'Map image')} · {zoneName}</span>
        {a ? <Badge tone="ok">{a.originalName ?? a.fileName} · {a.width}×{a.height} px · {dateTime(a.importedAt)}</Badge> : <Badge>{tr('kein Bild – Spawndichte als Grundkarte', 'no image – spawn density as base map')}</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" busy={busy} onClick={() => run(async () => ((await api.importMapImage(zoneId)) ? tr('Bild importiert. Jetzt mit den Reglern ausrichten.', 'Image imported. Now align it with the sliders.') : null))}>
            <ImagePlus className="size-3.5" /> {a ? tr('Bild ersetzen', 'Replace image') : tr('Bild importieren', 'Import image')}
          </Button>
          <Button size="sm" busy={busy} onClick={() => run(async () => {
            const r = await api.importMapFolder();
            if (!r) return null;
            return `${r.imported.length} ${tr('importiert', 'imported')}${r.skipped.length ? ` · ${r.skipped.length} ${tr('übersprungen', 'skipped')}: ${r.skipped.slice(0, 4).join('; ')}${r.skipped.length > 4 ? ' …' : ''}` : ''}`;
          })}>
            <FolderOpen className="size-3.5" /> {tr('Ordner importieren', 'Import folder')}
          </Button>
          {a && (
            <Button size="sm" variant="danger" busy={busy} onClick={() => run(async () => { await api.deleteMapAsset(zoneId); setDraft(null); return tr('Kartenbild entfernt.', 'Map image removed.'); })}>
              <Trash2 className="size-3.5" /> {tr('Entfernen', 'Remove')}
            </Button>
          )}
        </div>
      </div>
      <ClientMapsRow />
      {a && cal && !isClientMap(a) && (
        <div className="space-y-1.5 rounded-md border border-line bg-panel px-3 py-2">
          <div className="text-[11.5px] text-faint">
            {tr('Ausrichten: Wo liegen WoW-Koordinate 0/0 (oben links) und 100/100 (unten rechts) im Bild? Angaben in % der Bildbreite/-höhe. Die Erz-, Kräuter- und Spot-Marker dienen als Referenz – verschieben, bis sie auf Wegen, Minen und Lagern sitzen.',
              'Align: where are WoW coordinates 0/0 (top left) and 100/100 (bottom right) in the image? Values in % of image width/height. Ore, herb and spot markers act as reference – adjust until they sit on roads, mines and camps.')}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {field('x0', tr('Links (x = 0)', 'Left (x = 0)'))}
            {field('x1', tr('Rechts (x = 100)', 'Right (x = 100)'))}
            {field('y0', tr('Oben (y = 0)', 'Top (y = 0)'))}
            {field('y1', tr('Unten (y = 100)', 'Bottom (y = 100)'))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              {tr('Bild-Deckkraft (Vorschau)', 'Image opacity (preview)')}
              <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-28 accent-[var(--color-gold)]" />
            </label>
            <Button size="sm" variant="ghost" onClick={() => setDraft({ x0: 0, y0: 0, x1: 100, y1: 100 })}>{tr('Ganzes Bild = 0–100 %', 'Whole image = 0–100 %')}</Button>
            {draft && <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{tr('Verwerfen', 'Discard')}</Button>}
            <Button size="sm" variant="primary" disabled={!draft} busy={busy} onClick={() => run(async () => { await api.setMapCalibration(zoneId, draft!); setDraft(null); return tr('Ausrichtung gespeichert.', 'Alignment saved.'); })}>
              {tr('Ausrichtung speichern', 'Save alignment')}
            </Button>
          </div>
        </div>
      )}
      {msg && <div className={msg.tone === 'ok' ? 'text-ok' : 'text-bad'}>{msg.text}</div>}
      <details className="text-[11.5px] text-faint">
        <summary className="cursor-pointer text-muted">{tr('Woher bekomme ich Kartenbilder?', 'Where do I get map images?')}</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>{tr('Am einfachsten: „Alle Zonenkarten übernehmen“ liest die Weltkarten direkt aus deiner installierten WoW-Forever- oder Classic-Era-Version (nur lesend, nichts wird heruntergeladen). Sie passen ohne Ausrichten.', 'Easiest: “Take over all zone maps” reads the world maps straight from your installed WoW Forever or Classic Era client (read-only, nothing is downloaded). They fit without alignment.')}</li>
          <li>{tr('Im Spiel die Weltkarte (M) der Zone öffnen und einen Screenshot machen (Druck-Taste, landet im WoW-Ordner „Screenshots“). Am besten auf die Karte zuschneiden.', 'Open the world map (M) of the zone in game and take a screenshot (Print Screen key, saved to the WoW “Screenshots” folder). Ideally crop it to the map.')}</li>
          <li>{tr(`Für den Ordner-Import Dateien nach UiMap-ID (hier ${uiMapId ?? '?'}), Zonen-ID (${zoneId}) oder Zonennamen (DE/EN) benennen, z. B. „${zoneName}.png“.`, `For the folder import, name files by UiMap ID (here ${uiMapId ?? '?'}), zone ID (${zoneId}) or zone name (EN/DE), e.g. “${zoneName}.png”.`)}</li>
          <li>{tr('Die App lädt keine Karten aus dem Internet: Blizzard-Kartenbilder sind urheberrechtlich geschützt. Bilder bleiben lokal in deinem Datenordner (Ordner „maps“).', 'The app does not download maps: Blizzard map art is copyrighted. Images stay local in your data folder (“maps” folder).')}</li>
        </ul>
      </details>
    </div>
  );
}

/** Take the world maps of all zones over from a local WoW installation. */
function ClientMapsRow() {
  const clients = useWowClients();
  const imp = useImportClientMaps();
  const [picked, setPicked] = useState<WowClient[] | null>(null);
  const list = picked ?? clients.data ?? [];
  const [sel, setSel] = useState(0);
  const c = list[Math.min(sel, list.length - 1)];
  const pick = async () => {
    imp.setMsg(null);
    try {
      const r = await api.pickWowClient();
      if (r) { setPicked(r); setSel(0); }
    } catch (e) {
      imp.setMsg({ tone: 'bad', text: errorText(e) });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel px-3 py-2">
      <Gamepad2 className="size-4 text-gold" />
      <span className="text-muted">{tr('Aus deiner WoW-Installation', 'From your WoW installation')}:</span>
      {clients.isLoading ? <Spinner /> : list.length === 0 ? (
        <span className="text-faint">{tr('nicht automatisch gefunden', 'not found automatically')}</span>
      ) : list.length === 1 ? (
        <span className="text-ink">{c.label} {c.version} <span className="text-faint">· {c.root}</span></span>
      ) : (
        <select className={cx(inputCls, 'h-7')} value={sel} onChange={(e) => setSel(Number(e.target.value))}>
          {list.map((i, n) => <option key={i.root + i.product} value={n}>{i.label} {i.version} · {i.root}</option>)}
        </select>
      )}
      <div className="ml-auto flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={pick}><FolderSearch className="size-3.5" /> {tr('WoW-Ordner wählen …', 'Choose WoW folder …')}</Button>
        {c && (
          <Button size="sm" variant="primary" busy={imp.busy} onClick={() => imp.run(c)} title={tr('Eigene importierte Bilder bleiben erhalten.', 'Your own imported images are kept.')}>
            {tr('Alle Zonenkarten übernehmen', 'Take over all zone maps')}
          </Button>
        )}
      </div>
      {imp.msg && <div className={cx('w-full', imp.msg.tone === 'ok' ? 'text-ok' : 'text-bad')}>{imp.msg.text}</div>}
    </div>
  );
}
