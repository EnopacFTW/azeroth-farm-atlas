import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, KeyRound, Plug, Plus, Trash2, Upload } from 'lucide-react';
import { MarketSelector } from '@/components/MarketSelector';
import { Badge, Button, ErrorBox, Field, inputCls, Panel, Select } from '@/components/ui';
import { api, errorText } from '@/services/tauri';
import { useActiveProfile, useProfiles, useSaveProfile, useSaveSettings } from '@/services/hooks';
import type { AppSettings, Profile, ProviderHealth } from '@/domain/types';
import { CLASS_LABEL } from '@/components/ProfileBar';

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-4 p-5">
        <h1 className="font-display text-[20px] font-semibold">Einstellungen</h1>
        <Profiles />
        <Providers />
        <PriceRules />
        <DataManagement />
      </div>
    </div>
  );
}

function Profiles() {
  const { data: profiles } = useProfiles();
  const { profile: active } = useActiveProfile();
  const save = useSaveProfile();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['profiles'] }); qc.invalidateQueries({ queryKey: ['settings'] }); };
  const wrap = (f: () => Promise<unknown>) => async () => { setErr(null); try { await f(); refresh(); } catch (e) { setErr(e); } };
  const newProfile = wrap(async () => {
    const p: Profile = { ...(active as Profile), id: '', name: 'Neuer Charakter', level: 1, professions: [], secondary: [], goals: ['xp', 'gold'], ui: {} };
    const saved = await api.saveProfile(p);
    await api.setActiveProfile(saved.id);
  });
  return (
    <Panel title="Profile (lokal in SQLite)" actions={<>
      <Button size="sm" onClick={newProfile}><Plus className="size-3.5" /> Neu</Button>
      <Button size="sm" onClick={wrap(async () => { const p = await api.importProfile(); if (p) setMsg(`Importiert: ${p.name}`); })}><Upload className="size-3.5" /> JSON importieren</Button>
    </>}>
      {err ? <div className="mb-2"><ErrorBox error={err} /></div> : null}
      {msg && <p className="mb-2 text-[12px] text-ok">{msg}</p>}
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-[11px] uppercase text-faint"><tr className="border-b border-line"><th className="py-1">Name</th><th>Charakter</th><th>Region/Ruleset</th><th /></tr></thead>
        <tbody>
          {profiles?.map((p) => (
            <tr key={p.id} className="border-b border-line/50">
              <td className="py-1.5 pr-2">
                <input defaultValue={p.name} maxLength={40} className={`${inputCls} h-7 w-56`} onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && save.mutate({ ...p, name: e.target.value })} aria-label="Profilname" />
                {p.id === active?.id && <Badge tone="gold" className="ml-2">aktiv</Badge>}
              </td>
              <td className="text-muted">{CLASS_LABEL[p.class]} {p.level} · {p.faction === 'alliance' ? 'Allianz' : 'Horde'}</td>
              <td className="text-muted">{p.region.toUpperCase()} · {p.ruleset}</td>
              <td className="py-1 text-right">
                <div className="inline-flex gap-1">
                  {p.id !== active?.id && <Button size="sm" onClick={wrap(() => api.setActiveProfile(p.id))}>Aktivieren</Button>}
                  <Button size="sm" variant="ghost" title="Duplizieren" onClick={wrap(() => api.duplicateProfile(p.id))}><Copy className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" title="Als JSON exportieren (ohne Zugangsdaten)" onClick={wrap(async () => { const path = await api.exportProfile(p.id); if (path) setMsg(`Exportiert nach ${path}`); })}><Download className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" title="Löschen" onClick={wrap(async () => { if (confirm(`Profil „${p.name}“ löschen?`)) await api.deleteProfile(p.id); })}><Trash2 className="size-3.5" /></Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {active && (
        <div className="mt-3 flex flex-wrap gap-3">
          <Field label="Region (aktives Profil)">
            <Select value={active.region} onChange={(v) => save.mutate({ ...active, region: v })} options={['eu', 'us', 'kr', 'tw', 'cn'].map((r) => ({ value: r as Profile['region'], label: r.toUpperCase() }))} />
          </Field>
          <Field label="Datenqualität">
            <Select value={active.allowClassicFallback ? 'classic' : 'forever'} onChange={(v) => save.mutate({ ...active, allowClassicFallback: v === 'classic' })}
              options={[{ value: 'classic', label: 'Forever + Classic-Baseline' }, { value: 'forever', label: 'Nur Forever-Daten' }]} />
          </Field>
        </div>
      )}
    </Panel>
  );
}

const PROVIDER_ROWS = [
  { id: 'ahledger', name: 'AHledger', key: 'ahledgerEnabled' as const, doc: 'https://ahledger.com/developers', note: 'Öffentliche Endpunkte ohne Schlüssel; optional API-Key für höheres Limit (ab 10.12.2026: 30/min ohne Key).', secret: 'ahledger_api_key' },
  { id: 'auctionhouse_fyi', name: 'auctionhouse.fyi', key: 'fyiEnabled' as const, doc: 'https://auctionhouse.fyi/docs/api', note: 'Öffentliche stündliche Snapshots, dokumentiert nur für 6 US-Märkte. Read-only.', secret: 'fyi_api_key' },
  { id: 'blizzard_forever', name: 'Blizzard Forever', key: 'blizzardEnabled' as const, doc: 'https://mhuijskens.com/WoWForever/Api/', note: 'EXPERIMENTELL: von Blizzard nicht für Forever dokumentiert. Eigene Developer-Client-ID/-Secret nötig (develop.battle.net). Standardmäßig aus.', secret: null },
];

function Providers() {
  const { settings } = useActiveProfile();
  const saveSettings = useSaveSettings();
  const qc = useQueryClient();
  const creds = useQuery({ queryKey: ['credentials'], queryFn: api.credentialStatus });
  const [health, setHealth] = useState<Record<string, ProviderHealth | { error: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  if (!settings) return null;
  const setMarket = (patch: Partial<AppSettings['market']>) => saveSettings.mutate({ ...settings, market: { ...settings.market, ...patch } });
  const test = async (id: string) => {
    setTesting(id);
    try { setHealth((h) => ({ ...h, [id]: undefined as never })); const r = await api.providerHealth(id); setHealth((h) => ({ ...h, [id]: r })); }
    catch (e) { setHealth((h) => ({ ...h, [id]: { error: errorText(e) } })); }
    finally { setTesting(null); qc.invalidateQueries({ queryKey: ['health-cached'] }); }
  };
  const storeSecret = async (name: string) => {
    const v = vals[name];
    if (!v) return;
    await api.setCredential(name, v);
    setVals((x) => ({ ...x, [name]: '' }));
    qc.invalidateQueries({ queryKey: ['credentials'] });
  };
  const secretInput = (name: string, label: string) => (
    <div className="flex items-end gap-2">
      <Field label={`${label} ${creds.data?.[name] ? '· gespeichert ✓' : '· nicht gesetzt'}`}>
        <input type="password" autoComplete="off" value={vals[name] ?? ''} onChange={(e) => setVals((x) => ({ ...x, [name]: e.target.value }))} placeholder={creds.data?.[name] ? '•••••• (überschreiben)' : ''} className={`${inputCls} w-72`} />
      </Field>
      <Button size="sm" onClick={() => storeSecret(name)} disabled={!vals[name]}><KeyRound className="size-3.5" /> Sicher speichern</Button>
      {creds.data?.[name] && <Button size="sm" variant="ghost" onClick={async () => { await api.deleteCredential(name); qc.invalidateQueries({ queryKey: ['credentials'] }); }}>Löschen</Button>}
    </div>
  );
  return (
    <Panel title="Preisquellen & Markt">
      <MarketSelector />
      <div className="mt-4 space-y-3">
        {PROVIDER_ROWS.map((p) => {
          const h = health[p.id];
          return (
            <div key={p.id} className="rounded-md border border-line bg-panel-2 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer">
                  <input type="checkbox" checked={settings.market[p.key]} onChange={(e) => setMarket({ [p.key]: e.target.checked })} className="accent-[var(--color-gold)]" /> {p.name}
                </label>
                {p.id === 'blizzard_forever' && <Badge tone="warn">experimentell</Badge>}
                <Button size="sm" onClick={() => test(p.id)} busy={testing === p.id}><Plug className="size-3.5" /> Verbindung testen</Button>
                {h && 'error' in h && <span className="text-[12px] text-bad">{h.error}</span>}
                {h && !('error' in h) && (
                  <span className="text-[12px]">
                    {h.reachable ? <span className="text-ok">✓ erreichbar</span> : h.reachable === false ? <span className="text-bad">✗ Fehler</span> : <span className="text-faint">nicht getestet</span>}
                    <span className="text-faint"> · {h.lastResponseMs} ms · {h.marketsFound} Märkte{h.lastDataAt ? ` · letzter Scan ${new Date(h.lastDataAt).toLocaleString('de-DE')}` : ''}{h.testedEndpoint ? ` · ${h.testedEndpoint}` : ''}</span>
                    {h.lastError && <span className="text-bad"> · {h.lastError}</span>}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] text-faint">{p.note}</p>
              <div className="mt-2 space-y-2">
                {p.secret && secretInput(p.secret, 'API-Key (optional)')}
                {p.id === 'blizzard_forever' && (
                  <>
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Region"><Select value={settings.market.blizzardRegion} onChange={(v) => setMarket({ blizzardRegion: v })} options={['eu', 'us', 'kr', 'tw'].map((r) => ({ value: r, label: r.toUpperCase() }))} /></Field>
                      <Field label="Cache-Dauer (min)"><input type="number" min={5} max={1440} value={settings.market.blizzardCacheMinutes} onChange={(e) => setMarket({ blizzardCacheMinutes: Math.min(1440, Math.max(5, Number(e.target.value))) })} className={`${inputCls} w-24`} /></Field>
                    </div>
                    {secretInput('blizzard_client_id', 'Client-ID')}
                    {secretInput('blizzard_client_secret', 'Client-Secret')}
                    <p className="text-[11.5px] text-faint">Zugangsdaten liegen nur in der Windows-Anmeldeinformationsverwaltung („AzerothFarmAtlas“), nie in SQLite, Logs oder Exporten. OAuth-Token nur im Speicher.</p>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function PriceRules() {
  const { settings } = useActiveProfile();
  const save = useSaveSettings();
  if (!settings) return null;
  const set = (patch: Partial<AppSettings>) => save.mutate({ ...settings, ...patch });
  return (
    <Panel title="Preisregeln, Fenster & Darstellung">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="„Aktuell“ bis Scan-Alter (Minuten)" hint="Älter = „Veraltet“. Ein aktueller Scan ist nicht garantiert kauf-/verkaufbar.">
          <input type="number" min={5} max={10080} value={settings.staleMinutes} onChange={(e) => set({ staleMinutes: Math.max(5, Number(e.target.value)) })} className={inputCls} />
        </Field>
        <Field label="AH-Gebühr Fraktions-AH (%)" hint="Classic: 5 %">
          <input type="number" min={0} max={50} step={0.5} value={settings.ahCutPercentFaction} onChange={(e) => set({ ahCutPercentFaction: Number(e.target.value) })} className={inputCls} />
        </Field>
        <Field label="AH-Gebühr neutrales AH (%)" hint="Classic: 15 %">
          <input type="number" min={0} max={50} step={0.5} value={settings.ahCutPercentNeutral} onChange={(e) => set({ ahCutPercentNeutral: Number(e.target.value) })} className={inputCls} />
        </Field>
        <Field label="Automatischer Preis-Refresh" hint="Nur während die App läuft; Standard aus">
          <Select value={String(settings.refreshIntervalMin)} onChange={(v) => set({ refreshIntervalMin: Number(v) })} options={['0', '5', '15', '30', '60'].map((v) => ({ value: v, label: v === '0' ? 'aus (nur manuell)' : `alle ${v} min` }))} />
        </Field>
        <Field label="UI-Skalierung">
          <Select value={String(settings.uiScale)} onChange={(v) => set({ uiScale: Number(v) })} options={['0.875', '1', '1.125', '1.25', '1.5'].map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)} %` }))} />
        </Field>
        <div className="flex flex-col gap-2 pt-5 text-[12.5px] text-muted">
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={settings.alwaysOnTop} onChange={(e) => set({ alwaysOnTop: e.target.checked })} className="accent-[var(--color-gold)]" /> Immer im Vordergrund (zweiter Bildschirm)</label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={settings.showUnavailable} onChange={(e) => set({ showUnavailable: e.target.checked })} className="accent-[var(--color-gold)]" /> „Noch nicht farmbar“ immer anzeigen</label>
        </div>
      </div>
      <p className="mt-3 text-[11.5px] text-faint">Anbieter-Reihenfolge: {settings.providerPriority.join(' → ')}. Preise verschiedener Märkte werden nie gemittelt.</p>
    </Panel>
  );
}

function DataManagement() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<unknown>(null);
  return (
    <Panel title="Daten">
      {err ? <div className="mb-2"><ErrorBox error={err} /></div> : null}
      {msg && <p className="mb-2 text-[12px] text-ok">{msg}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <Button onClick={async () => { await api.clearPriceCache(); qc.invalidateQueries({ queryKey: ['quotes'] }); setMsg('Drittanbieter-Preiscache gelöscht.'); }}>Preiscache löschen</Button>
        <Button onClick={async () => { try { const p = await api.backupUserData(); if (p) setMsg(`Backup gespeichert: ${p}`); } catch (e) { setErr(e); } }}><Download className="size-4" /> Backup (Profile & Sessions)</Button>
        <div className="ml-auto flex items-end gap-2">
          <Field label="Alles lokal zurücksetzen – „LÖSCHEN“ eintippen"><input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`${inputCls} w-44`} /></Field>
          <Button variant="danger" disabled={confirm !== 'LÖSCHEN'} onClick={async () => { try { await api.resetLocalData(confirm); setConfirm(''); qc.invalidateQueries(); setMsg('Lokale Daten, Preiscache und Zugangsdaten gelöscht.'); } catch (e) { setErr(e); } }}>Zurücksetzen</Button>
        </div>
      </div>
      <p className="mt-2 text-[11.5px] text-faint">Spieldaten (game.db) werden bei Updates ersetzt; Profile und Sessions (user.db) nie. Vor Schema-Migrationen wird automatisch ein Backup im Datenordner angelegt. Keine Telemetrie.</p>
    </Panel>
  );
}
