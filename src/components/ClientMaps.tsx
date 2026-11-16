import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gamepad2 } from 'lucide-react';
import { api, errorText, isDesktop, type ClientMapImport, type WowClient } from '@/services/tauri';
import { tr } from '@/i18n';
import { Button } from './ui';

/** Local WoW installations (Forever first). Detected once per app start. */
export function useWowClients() {
  return useQuery({ queryKey: ['wowClients'], queryFn: api.detectWowClients, enabled: isDesktop, staleTime: Infinity });
}

export function importSummary(r: ClientMapImport): string {
  const parts = [tr(`${r.imported} Zonenkarten übernommen (${r.source.replace('WoW-Client · ', '')})`, `${r.imported} zone maps taken over (${r.source.replace('WoW-Client · ', '')})`)];
  if (r.keptOwn) parts.push(tr(`${r.keptOwn} eigene Bilder behalten`, `${r.keptOwn} own images kept`));
  if (r.missing.length) parts.push(tr(`${r.missing.length} Zonen ohne Karte im Client`, `${r.missing.length} zones without a map in the client`));
  return parts.join(' · ');
}

/** Reads all zone maps from a local client; refreshes every map query afterwards. */
export function useImportClientMaps() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const run = async (client: WowClient, replaceOwn = false) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.importClientMaps(client, replaceOwn);
      setMsg({ tone: 'ok', text: importSummary(r) });
      await qc.invalidateQueries({ queryKey: ['mapAsset'] });
      await qc.invalidateQueries({ queryKey: ['mapAssets'] });
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, setMsg, run };
}

/** Small call-to-action on maps without an image: take the maps over from the detected client. */
export function ClientMapsButton() {
  const clients = useWowClients();
  const imp = useImportClientMaps();
  const c = clients.data?.[0];
  if (!c) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="primary" busy={imp.busy} onClick={() => imp.run(c)} title={tr(`Liest die Weltkarten aller Zonen aus ${c.root} (${c.label} ${c.version}). Bleibt lokal auf diesem PC.`, `Reads the world maps of all zones from ${c.root} (${c.label} ${c.version}). Stays local on this PC.`)}>
        <Gamepad2 className="size-3.5" /> {tr(`Karten aus ${c.label} laden`, `Load maps from ${c.label}`)}
      </Button>
      {imp.msg?.tone === 'bad' && <span className="max-w-72 rounded bg-bg/90 px-2 py-1 text-[11px] text-bad">{imp.msg.text}</span>}
    </div>
  );
}
