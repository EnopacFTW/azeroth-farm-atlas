import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, Play, Skull } from 'lucide-react';
import { WorldMap, type MapMarker } from '@/components/WorldMap';
import { LootTables } from '@/components/LootTable';
import { Attribution, LevelRange, NpcName, providerName, Rate, SourceBadge } from '@/components/data';
import { Badge, Button, ErrorBox, inputCls, Panel, Spinner, Stat } from '@/components/ui';
import { api, copyText, errorText } from '@/services/tauri';
import { useActiveProfile, useMarketSelection, useQuotes } from '@/services/hooks';
import { scoreSpot, pct } from '@/domain/scoring';
import { perKillModel } from '@/domain/economics';
import { formatCopper } from '@/domain/money';
import { waypoint } from '@/domain/coordinates';
import { chanceAtLeastOne, expectedKills, killsForConfidence } from '@/domain/probability';
import { measuredKillsPerHour } from '@/domain/sessionMath';
import { skillOf } from '@/domain/professionRules';
import { useUi } from '@/store/ui';
import type { LootRow, SpotCandidate } from '@/domain/types';

export function SpotDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { profile, settings } = useActiveProfile();
  const market = useMarketSelection();
  const filters = useUi((s) => s.filters);
  const q = useQuery({ queryKey: ['spot', id], queryFn: () => api.getSpot(id) });
  const sessions = useQuery({ queryKey: ['sessions', profile?.id], queryFn: () => api.listSessions(profile!.id), enabled: !!profile });
  const allLoot: LootRow[] = useMemo(() => (q.data ? [...q.data.npcs.flatMap((n) => n.loot), ...q.data.objects.flatMap((o) => o.loot), ...q.data.zoneLoot] : []), [q.data]);
  const itemIds = useMemo(() => [...new Set(allLoot.filter((l) => l.rate == null || l.rate >= 0.002).map((l) => l.itemId))].slice(0, 300), [allLoot]);
  const quotes = useQuotes(itemIds);
  const [pick, setPick] = useState<LootRow | null>(null);
  const [starting, setStarting] = useState(false);

  if (q.isLoading) return <div className="p-6"><Spinner /></div>;
  if (q.error || !q.data) return <div className="p-6"><ErrorBox error={q.error ?? { message: 'Spot nicht gefunden' }} /></div>;
  const d = q.data;
  const s = d.spot;
  const zoneName = d.zone.nameDe ?? d.zone.nameEn;
  const asCandidate: SpotCandidate = { ...s, zone: d.zone, npcs: d.npcs, objects: d.objects, items: [] } as SpotCandidate;
  const scored = profile ? scoreSpot(profile, asCandidate, filters) : null;
  const skinSkill = profile ? skillOf(profile, 'skinning') : null;
  const model = perKillModel(d, quotes.data ?? [], {
    cutPercent: settings?.ahCutPercentFaction ?? 5, staleMinutes: settings?.staleMinutes ?? 120,
    canSkin: (min) => skinSkill != null && min != null && skinSkill >= min,
  });
  const kph = measuredKillsPerHour(sessions.data ?? [], s.id);
  const center = s.centerX != null ? waypoint(s.centerX, s.centerY!, zoneName) : null;
  const npcById = new Map(d.npcs.map((n) => [n.id, n]));
  const objById = new Map(d.objects.map((o) => [o.id, o]));
  const markers: MapMarker[] = d.points.map(([t, eid, x, y], i) => {
    if (t === 'npc') {
      const n = npcById.get(eid)!;
      return { key: String(i), x, y, kind: n.rank && [1, 2, 3].includes(n.rank) ? 'elite' : n.rank === 4 ? 'rare' : 'npc', label: n.nameDe ?? n.nameEn, lines: [`Level ${n.levelMin}–${n.levelMax}`, 'QuestieDB Forever'] };
    }
    const o = objById.get(eid)!;
    return { key: String(i), x, y, kind: o.nodeType, label: o.nameDe ?? o.nameEn, lines: [o.requiredSkill != null ? `Skill ${o.requiredSkill} (Classic-Regel)` : 'Skill unbekannt', 'QuestieDB Forever'] };
  });

  const start = async () => {
    if (!profile) return;
    setStarting(true);
    try {
      await api.startSession(profile.id, s.id, market.provider, market.marketId);
      nav('/sessions');
    } catch (e) {
      alert(errorText(e));
    } finally {
      setStarting(false);
    }
  };

  const firstQuote = quotes.data?.[0];
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1500px] space-y-4 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <button type="button" onClick={() => nav(-1)} className="mt-1 text-muted hover:text-ink cursor-pointer" aria-label="Zurück"><ArrowLeft className="size-5" /></button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[20px] font-semibold text-ink">{s.titleDe}</h1>
            <p className="text-[12.5px] text-faint">{s.titleEn} · Spot-ID <span className="selectable">{s.id}</span></p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge>{zoneName}{d.zone.uiMapId ? ` · UiMap ${d.zone.uiMapId}` : ''}</Badge>
              {s.levelMin != null && <Badge><LevelRange min={s.levelMin} max={s.levelMax} /></Badge>}
              {s.hasElite ? <Badge tone="bad"><Skull className="size-3" /> Elite</Badge> : null}
              {s.isInstance ? <Badge tone="warn">Instanz</Badge> : null}
              {s.reqSkill != null && <Badge tone="warn" title="Classic-Regel">Skill {s.reqSkill} ({s.reqSkillType})</Badge>}
              <SourceBadge source="questiedb_forever" />
              {s.generated ? <SourceBadge source="atlas_clustering" /> : null}
              {scored && <Badge tone={scored.availability === 'ready' ? 'ok' : 'warn'}>{scored.availability === 'ready' ? 'Sofort farmbar' : 'Eingeschränkt – siehe „Warum nicht?“'}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {center && <Button onClick={() => copyText(center)} title={center}><Copy className="size-4" /> {center}</Button>}
            <Button variant="primary" onClick={start} busy={starting}><Play className="size-4" /> {profile?.durationMin ?? 30}-Minuten-Session starten</Button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          <WorldMap className="h-[460px] rounded-lg border border-line" zoneName={zoneName} uiMapId={d.zone.uiMapId} markers={markers} hull={s.hull} route={s.route}
            focus={s.centerX != null ? { x: s.centerX, y: s.centerY!, r: s.radius ?? 8 } : null} />
          <div className="space-y-4">
            {scored && (
              <Panel title="Bewertung für dein Profil">
                <div className="grid gap-3 text-[12.5px]">
                  <div><div className="mb-1 font-semibold text-ok">Warum empfohlen?</div><ul className="space-y-0.5 text-muted">{scored.why.map((t, i) => <li key={i}>• {t}</li>)}</ul></div>
                  {scored.whyNot.length > 0 && <div><div className="mb-1 font-semibold text-warn">Warum nicht?</div><ul className="space-y-0.5 text-muted">{scored.whyNot.map((t, i) => <li key={i}>• {t}</li>)}</ul></div>}
                  <div><div className="mb-1 font-semibold text-info">Welche Daten fehlen?</div><ul className="space-y-0.5 text-muted">{scored.missing.map((t, i) => <li key={i}>• {t}</li>)}</ul></div>
                </div>
              </Panel>
            )}
            <Panel title="Ertrag (getrennte Qualitätsstufen)">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="A · Gemessen (Gold/h)" value={kph ? 'siehe Farmtracker' : 'keine Daten'} hint={kph ? `${kph.sessions} Sessions, ${Math.round(kph.minutes)} min, ${Math.round(kph.value)} Kills/h` : 'Erst nach eigener Session mit Kills/Gold'} />
                <Stat label="B · Modell Händler/Kill" value={model ? formatCopper(model.vendorOnlyCopper) : '—'} hint={model ? `Classic-Dropchancen${model.partial ? ' · Teilwert (unvollständig)' : ''}` : 'Keine Classic-Lootdaten'} tone={model?.partial ? 'warn' : undefined} />
                <Stat label="B · Modell inkl. AH/Kill" value={model ? formatCopper(model.bestStrategyCopper) : '—'} hint={`max(Händler, AH-Median − ${settings?.ahCutPercentFaction ?? 5} % Gebühr), nur aktuelle Preise`} />
                <Stat label="B · Kürschnern/Kill" value={model && skinSkill != null ? formatCopper(model.skinningAhCopper) : '—'} hint={skinSkill == null ? 'Kein Kürschner' : 'nur Mobs, die du kürschnern kannst'} />
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-faint">
                Gold/h wird nie aus AH-Daten allein konstruiert. Modellierte Gold/h = gemessene Kills/h × Wert/Kill
                {kph && model ? `: ≈ ${((kph.value * model.bestStrategyCopper) / 10_000).toFixed(1)} g/h (Schätzung)` : ' – benötigt eine gemessene Killrate.'}
                {' '}Min-Sofortkauf ist ein Angebotspreis, kein realisierter Verkauf.
              </p>
              {firstQuote && <div className="mt-2 flex items-center gap-2 text-[11.5px] text-faint">Preise: {providerName(firstQuote.provider)} · {firstQuote.marketId} <Attribution quote={{ ...firstQuote, attributionUrl: firstQuote.provider === 'ahledger' ? 'https://ahledger.com' : firstQuote.attributionUrl }} /></div>}
              {quotes.error && <div className="mt-2"><ErrorBox title="AH-Preise nicht verfügbar" error={quotes.error} /></div>}
              {!market.marketId && <p className="mt-2 text-[12px] text-warn">Kein AH-Markt gewählt (Einstellungen → Preisquellen).</p>}
            </Panel>
          </div>
        </div>

        {d.npcs.length > 0 && (
          <Panel title={`Mobs (${d.npcs.length})`} bodyClass="p-0">
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-[11px] uppercase tracking-wide text-faint">
                <tr className="border-b border-line">
                  {['NPC', 'ID', 'Level', 'Klasse', 'Typ', 'Kürschnern', 'Münzen', 'Spawns', 'Quellen'].map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.npcs.map((n) => (
                  <tr key={n.id} className="border-b border-line/50">
                    <td className="px-3 py-1.5"><NpcName id={n.id} nameDe={n.nameDe} nameEn={n.nameEn} /></td>
                    <td className="px-3 py-1.5 num text-faint">{n.id}</td>
                    <td className="px-3 py-1.5 num">{n.levelMin}–{n.levelMax}</td>
                    <td className="px-3 py-1.5">{({ normal: 'normal', elite: 'Elite', rare_elite: 'Rar-Elite', boss: 'Boss', rare: 'Rar' } as Record<string, string>)[n.classification ?? ''] ?? '?'}</td>
                    <td className="px-3 py-1.5 text-muted">{n.creatureType ?? 'unbekannt'}</td>
                    <td className="px-3 py-1.5">{n.canSkin === 1 ? <span className={skinSkill != null && n.skinMin != null && skinSkill >= n.skinMin ? 'text-ok' : 'text-warn'}>ab {n.skinMin}–{n.skinMax}</span> : n.canSkin === 0 ? <span className="text-faint">nein</span> : <span className="text-faint">unbekannt</span>}</td>
                    <td className="px-3 py-1.5 num text-muted">{n.maxCoin ? `${formatCopper(n.minCoin)}–${formatCopper(n.maxCoin)}` : n.inClassic ? '—' : '?'}</td>
                    <td className="px-3 py-1.5 num">{n.spawns}</td>
                    <td className="px-3 py-1.5"><span className="inline-flex gap-1"><SourceBadge source={n.srcCore} />{n.srcCombat && <SourceBadge source={n.srcCombat} />}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11.5px] text-faint">Respawnzeiten und Angriffstyp sind nicht belegt und werden daher nicht angezeigt.</p>
          </Panel>
        )}

        <Panel title="Beute – getrennt nach Quelle (Kill / Kürschnern / Knoten / Angeln / Quest)" actions={market.marketId && <span className="text-[11.5px] text-faint">AH: {providerName(market.provider)} · {market.marketId}</span>}>
          <LootTables rows={allLoot} quotes={quotes.data ?? []} quotesLoading={quotes.isLoading && quotes.fetchStatus !== 'idle'} quotesError={!!quotes.error} onPick={setPick} />
        </Panel>

        <RareCalculator pick={pick} />
        <p className="pb-4 text-[11.5px] text-faint">
          Datenstand: Spawns/NPCs QuestieDB Forever; Dropchancen, Kürschnerbarkeit, Händlerpreise cmangos classic-db (Classic-Fallback); Skillgrenzen Classic-Regeln.
          Siehe <Link to="/sources" className="text-gold hover:underline">Datenquellen</Link>.
        </p>
      </div>
    </div>
  );
}

function RareCalculator({ pick }: { pick: LootRow | null }) {
  const [n, setN] = useState(500);
  const [custom, setCustom] = useState('');
  const p = custom !== '' ? Number(custom.replace(',', '.')) / 100 : pick?.rate ?? null;
  const valid = p != null && Number.isFinite(p) && p >= 0 && p <= 1;
  const chance = valid ? chanceAtLeastOne(p, n) : null;
  return (
    <Panel title="Rare-Drop-Rechner">
      <div className="flex flex-wrap items-end gap-4 text-[12.5px]">
        <div className="text-muted">Item: {pick ? <span className="text-ink">{pick.nameDe ?? pick.nameEn}</span> : 'in der Loot-Tabelle anklicken'} {pick && <>(<Rate rate={pick.rate} />)</>}</div>
        <label className="flex flex-col gap-1 text-muted">Eigene Chance in %<input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="z. B. 0,1" className={`${inputCls} w-28`} /></label>
        <label className="flex flex-col gap-1 text-muted">Kills (n)<input type="number" min={0} value={n} onChange={(e) => setN(Math.max(0, Number(e.target.value)))} className={`${inputCls} w-28`} /></label>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="≥ 1 Drop nach n Kills" value={chance != null ? pct(chance) : '—'} />
          <Stat label="Erwartete Kills" value={valid ? Math.round(expectedKills(p) ?? 0).toLocaleString('de-DE') || '—' : '—'} />
          <Stat label="Kills für 90 %" value={valid ? (killsForConfidence(p, 0.9)?.toLocaleString('de-DE') ?? '—') : '—'} />
        </div>
      </div>
      <p className="mt-2 text-[11.5px] text-faint">1 − (1 − p)ⁿ. Ohne belegte Rate wird keine Zahl berechnet. Keine Garantie, besonders bei Classic-Raten und kleinen Stichproben.</p>
    </Panel>
  );
}
