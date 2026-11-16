import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, Play, Skull } from 'lucide-react';
import { WorldMap, type MapMarker } from '@/components/WorldMap';
import { LootTables } from '@/components/LootTable';
import { Attribution, LevelRange, NpcName, providerName, Rate, SourceBadge } from '@/components/data';
import { gatherSkillName } from '@/components/SpotCard';
import { classificationLabel } from './NpcDetail';
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
import type { LootRow, SpotCandidate, SpotItem } from '@/domain/types';
import { nm, num, title, titleAlt, tr } from '@/i18n';

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
  if (q.error || !q.data) return <div className="p-6"><ErrorBox error={q.error ?? { message: tr('Spot nicht gefunden', 'Spot not found') }} /></div>;
  const d = q.data;
  const s = d.spot;
  const zoneName = nm(d.zone);
  // the matched main drops are what the "usable for my professions" line refers to
  const items = allLoot
    .filter((l) => l.rate != null && (l.context === 'skinning' || l.context === 'normal_kill' || l.context === 'mining_node' || l.context === 'herb_node' || l.context === 'fishing'))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
    .map((l): SpotItem => ({ itemId: l.itemId, nameEn: l.nameEn, nameDe: l.nameDe, quality: l.quality, rate: l.rate, context: l.context, isCloth: l.isCloth, foreverConfirmed: 0, vendorSell: l.vendorSell }));
  const asCandidate: SpotCandidate = { ...s, zone: d.zone, npcs: d.npcs, objects: d.objects, items } as SpotCandidate;
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
      return { key: String(i), x, y, kind: n.rank && [1, 2, 3].includes(n.rank) ? 'elite' : n.rank === 4 ? 'rare' : 'npc', label: nm(n), lines: [`Level ${n.levelMin}–${n.levelMax}`, 'QuestieDB Forever'] };
    }
    const o = objById.get(eid)!;
    return { key: String(i), x, y, kind: o.nodeType, label: nm(o), lines: [o.requiredSkill != null ? `Skill ${o.requiredSkill} ${tr('(Classic-Regel)', '(Classic rule)')}` : tr('Skill unbekannt', 'Skill unknown'), 'QuestieDB Forever'] };
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
  const cut = settings?.ahCutPercentFaction ?? 5;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1500px] space-y-4 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <button type="button" onClick={() => nav(-1)} className="mt-1 text-muted hover:text-ink cursor-pointer" aria-label={tr('Zurück', 'Back')}><ArrowLeft className="size-5" /></button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[20px] font-semibold text-ink">{title(s)}</h1>
            <p className="text-[12.5px] text-faint">{titleAlt(s) ? `${titleAlt(s)} · ` : ''}Spot-ID <span className="selectable">{s.id}</span></p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge>{zoneName}{d.zone.uiMapId ? ` · UiMap ${d.zone.uiMapId}` : ''}</Badge>
              {s.levelMin != null && <Badge><LevelRange min={s.levelMin} max={s.levelMax} /></Badge>}
              {s.hasElite ? <Badge tone="bad"><Skull className="size-3" /> Elite</Badge> : null}
              {s.isInstance ? <Badge tone="warn">{tr('Instanz', 'Instance')}</Badge> : null}
              {s.reqSkill != null && <Badge tone="warn" title={tr('Classic-Regel', 'Classic rule')}>Skill {s.reqSkill} ({s.reqSkillType ? gatherSkillName(s.reqSkillType) : '?'})</Badge>}
              <SourceBadge source="questiedb_forever" />
              {s.generated ? <SourceBadge source="atlas_clustering" /> : null}
              {scored && <Badge tone={scored.availability === 'ready' ? 'ok' : 'warn'}>{scored.availability === 'ready' ? tr('Sofort farmbar', 'Farmable now') : tr('Eingeschränkt – siehe „Warum nicht?“', 'Restricted – see “Why not?”')}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {center && <Button onClick={() => copyText(center)} title={center}><Copy className="size-4" /> {center}</Button>}
            <Button variant="primary" onClick={start} busy={starting}><Play className="size-4" /> {tr(`${profile?.durationMin ?? 30}-Minuten-Session starten`, `Start ${profile?.durationMin ?? 30}-minute session`)}</Button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          <WorldMap className="h-[460px] rounded-lg border border-line" zoneId={s.zoneId} zoneName={zoneName} uiMapId={d.zone.uiMapId} markers={markers} hull={s.hull} route={s.route}
            focus={s.centerX != null ? { x: s.centerX, y: s.centerY!, r: s.radius ?? 8 } : null} />
          <div className="space-y-4">
            {scored && (
              <Panel title={tr('Bewertung für dein Profil', 'Rating for your profile')}>
                <div className="grid gap-3 text-[12.5px]">
                  <div><div className="mb-1 font-semibold text-ok">{tr('Warum empfohlen?', 'Why recommended?')}</div><ul className="space-y-0.5 text-muted">{scored.why.map((t, i) => <li key={i}>• {t}</li>)}</ul></div>
                  {scored.whyNot.length > 0 && <div><div className="mb-1 font-semibold text-warn">{tr('Warum nicht?', 'Why not?')}</div><ul className="space-y-0.5 text-muted">{scored.whyNot.map((t, i) => <li key={i}>• {t}</li>)}</ul></div>}
                  <div><div className="mb-1 font-semibold text-info">{tr('Welche Daten fehlen?', 'What data is missing?')}</div><ul className="space-y-0.5 text-muted">{scored.missing.map((t, i) => <li key={i}>• {t}</li>)}</ul></div>
                </div>
              </Panel>
            )}
            <Panel title={tr('Ertrag (getrennte Qualitätsstufen)', 'Yield (separate quality levels)')}>
              <div className="grid grid-cols-2 gap-2">
                <Stat label={tr('A · Gemessen (Gold/h)', 'A · Measured (gold/h)')} value={kph ? tr('siehe Farmtracker', 'see farm tracker') : tr('keine Daten', 'no data')}
                  hint={kph ? `${kph.sessions} Sessions, ${Math.round(kph.minutes)} min, ${Math.round(kph.value)} Kills/h` : tr('Erst nach eigener Session mit Kills/Gold', 'Only after your own session with kills/gold')} />
                <Stat label={tr('B · Modell Händler/Kill', 'B · Model vendor/kill')} value={model ? formatCopper(model.vendorOnlyCopper) : '—'}
                  hint={model ? `${tr('Classic-Dropchancen', 'Classic drop rates')}${model.partial ? tr(' · Teilwert (unvollständig)', ' · partial value (incomplete)') : ''}` : tr('Keine Classic-Lootdaten', 'No Classic loot data')} tone={model?.partial ? 'warn' : undefined} />
                <Stat label={tr('B · Modell inkl. AH/Kill', 'B · Model incl. AH/kill')} value={model ? formatCopper(model.bestStrategyCopper) : '—'}
                  hint={tr(`max(Händler, AH-Median − ${cut} % Gebühr), nur aktuelle Preise`, `max(vendor, AH median − ${cut} % cut), current prices only`)} />
                <Stat label={tr('B · Kürschnern/Kill', 'B · Skinning/kill')} value={model && skinSkill != null ? formatCopper(model.skinningAhCopper) : '—'}
                  hint={skinSkill == null ? tr('Kein Kürschner', 'Not a skinner') : tr('nur Mobs, die du kürschnern kannst', 'only mobs you can skin')} />
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-faint">
                {tr('Gold/h wird nie aus AH-Daten allein konstruiert. Modellierte Gold/h = gemessene Kills/h × Wert/Kill', 'Gold/h is never built from AH data alone. Modeled gold/h = measured kills/h × value/kill')}
                {kph && model ? `: ≈ ${((kph.value * model.bestStrategyCopper) / 10_000).toFixed(1)} g/h ${tr('(Schätzung)', '(estimate)')}` : tr(' – benötigt eine gemessene Killrate.', ' – needs a measured kill rate.')}
                {' '}{tr('Min-Sofortkauf ist ein Angebotspreis, kein realisierter Verkauf.', 'Min buyout is an asking price, not a realised sale.')}
              </p>
              {firstQuote && <div className="mt-2 flex items-center gap-2 text-[11.5px] text-faint">{tr('Preise', 'Prices')}: {providerName(firstQuote.provider)} · {firstQuote.marketId} <Attribution quote={{ ...firstQuote, attributionUrl: firstQuote.provider === 'ahledger' ? 'https://ahledger.com' : firstQuote.attributionUrl }} /></div>}
              {quotes.error && <div className="mt-2"><ErrorBox title={tr('AH-Preise nicht verfügbar', 'AH prices unavailable')} error={quotes.error} /></div>}
              {!market.marketId && <p className="mt-2 text-[12px] text-warn">{tr('Kein AH-Markt gewählt (Einstellungen → Preisquellen).', 'No AH market selected (Settings → price sources).')}</p>}
            </Panel>
          </div>
        </div>

        {d.npcs.length > 0 && (
          <Panel title={`Mobs (${d.npcs.length})`} bodyClass="p-0">
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-[11px] uppercase tracking-wide text-faint">
                <tr className="border-b border-line">
                  {['NPC', 'ID', 'Level', tr('Klasse', 'Class'), tr('Typ', 'Type'), tr('Kürschnern', 'Skinning'), tr('Münzen', 'Coins'), 'Spawns', tr('Quellen', 'Sources')].map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.npcs.map((n) => (
                  <tr key={n.id} className="border-b border-line/50">
                    <td className="px-3 py-1.5"><NpcName id={n.id} nameDe={n.nameDe} nameEn={n.nameEn} /></td>
                    <td className="px-3 py-1.5 num text-faint">{n.id}</td>
                    <td className="px-3 py-1.5 num">{n.levelMin}–{n.levelMax}</td>
                    <td className="px-3 py-1.5">{classificationLabel(n.classification) ?? '?'}</td>
                    <td className="px-3 py-1.5 text-muted">{n.creatureType ?? tr('unbekannt', 'unknown')}</td>
                    <td className="px-3 py-1.5">{n.canSkin === 1 ? <span className={skinSkill != null && n.skinMin != null && skinSkill >= n.skinMin ? 'text-ok' : 'text-warn'}>{tr('ab', 'from')} {n.skinMin}–{n.skinMax}</span> : n.canSkin === 0 ? <span className="text-faint">{tr('nein', 'no')}</span> : <span className="text-faint">{tr('unbekannt', 'unknown')}</span>}</td>
                    <td className="px-3 py-1.5 num text-muted">{n.maxCoin ? `${formatCopper(n.minCoin)}–${formatCopper(n.maxCoin)}` : n.inClassic ? '—' : '?'}</td>
                    <td className="px-3 py-1.5 num">{n.spawns}</td>
                    <td className="px-3 py-1.5"><span className="inline-flex gap-1"><SourceBadge source={n.srcCore} />{n.srcCombat && <SourceBadge source={n.srcCombat} />}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11.5px] text-faint">{tr('Respawnzeiten und Angriffstyp sind nicht belegt und werden daher nicht angezeigt.', 'Respawn times and attack type are not documented and therefore not shown.')}</p>
          </Panel>
        )}

        <Panel title={tr('Beute – getrennt nach Quelle (Kill / Kürschnern / Knoten / Angeln / Quest)', 'Loot – split by source (kill / skinning / nodes / fishing / quest)')} actions={market.marketId && <span className="text-[11.5px] text-faint">AH: {providerName(market.provider)} · {market.marketId}</span>}>
          <LootTables rows={allLoot} quotes={quotes.data ?? []} quotesLoading={quotes.isLoading && quotes.fetchStatus !== 'idle'} quotesError={!!quotes.error} onPick={setPick} />
        </Panel>

        <RareCalculator pick={pick} />
        <p className="pb-4 text-[11.5px] text-faint">
          {tr('Datenstand: Spawns/NPCs QuestieDB Forever; Dropchancen, Kürschnerbarkeit, Händlerpreise cmangos classic-db (Classic-Fallback); Skillgrenzen Classic-Regeln.', 'Data: spawns/NPCs QuestieDB Forever; drop rates, skinnability, vendor prices cmangos classic-db (Classic fallback); skill thresholds Classic rules.')}
          {' '}{tr('Siehe', 'See')} <Link to="/sources" className="text-gold hover:underline">{tr('Datenquellen', 'Data sources')}</Link>.
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
  const exp = valid ? expectedKills(p) : null;
  const k90 = valid ? killsForConfidence(p, 0.9) : null;
  return (
    <Panel title={tr('Rare-Drop-Rechner', 'Rare drop calculator')}>
      <div className="flex flex-wrap items-end gap-4 text-[12.5px]">
        <div className="text-muted">Item: {pick ? <span className="text-ink">{nm(pick)}</span> : tr('in der Loot-Tabelle anklicken', 'click one in the loot table')} {pick && <>(<Rate rate={pick.rate} />)</>}</div>
        <label className="flex flex-col gap-1 text-muted">{tr('Eigene Chance in %', 'Own chance in %')}<input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={tr('z. B. 0,1', 'e.g. 0.1')} className={`${inputCls} w-28`} /></label>
        <label className="flex flex-col gap-1 text-muted">Kills (n)<input type="number" min={0} value={n} onChange={(e) => setN(Math.max(0, Number(e.target.value)))} className={`${inputCls} w-28`} /></label>
        <div className="grid grid-cols-3 gap-2">
          <Stat label={tr('≥ 1 Drop nach n Kills', '≥ 1 drop after n kills')} value={chance != null ? pct(chance) : '—'} />
          <Stat label={tr('Erwartete Kills', 'Expected kills')} value={exp ? num(Math.round(exp)) : '—'} />
          <Stat label={tr('Kills für 90 %', 'Kills for 90 %')} value={k90 != null ? num(k90) : '—'} />
        </div>
      </div>
      <p className="mt-2 text-[11.5px] text-faint">{tr('1 − (1 − p)ⁿ. Ohne belegte Rate wird keine Zahl berechnet. Keine Garantie, besonders bei Classic-Raten und kleinen Stichproben.', '1 − (1 − p)ⁿ. No number is computed without a documented rate. No guarantee, especially with Classic rates and small samples.')}</p>
    </Panel>
  );
}
