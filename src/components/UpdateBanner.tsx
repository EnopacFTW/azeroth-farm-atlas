import { useEffect, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Download } from 'lucide-react';
import { isDesktop } from '@/services/tauri';
import { tr } from '@/i18n';
import { Button, Panel } from './ui';

// Signed in-app updates (tauri-plugin-updater, GitHub Releases latest.json). Offline or no release: nothing is shown.
async function findUpdate(): Promise<Update | null> {
  if (!isDesktop) return null;
  try { return await check(); } catch { return null; }
}

export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { findUpdate().then(setUpdate); }, []);
  if (!update) return null;
  return (
    <div className="flex items-center gap-3 border-b border-line bg-gold/10 px-4 py-1.5 text-[12.5px]">
      <span>{tr(`Version ${update.version} ist verfügbar.`, `Version ${update.version} is available.`)}</span>
      <Button size="sm" variant="primary" busy={busy} onClick={async () => { setBusy(true); await update.downloadAndInstall(); await relaunch(); }}>
        <Download className="size-3.5" /> {tr('Installieren & neu starten', 'Install & restart')}
      </Button>
    </div>
  );
}

export function UpdatePanel() {
  const [state, setState] = useState<string | null>(null);
  return (
    <Panel title={tr('Updates', 'Updates')}>
      <Button size="sm" onClick={async () => { const u = await findUpdate(); setState(u ? tr(`Version ${u.version} verfügbar`, `Version ${u.version} available`) : tr('Kein Update gefunden (oder Updater noch nicht eingerichtet).', 'No update found (or updater not set up yet).')); }}>
        {tr('Nach Updates suchen', 'Check for updates')}
      </Button>
      {state && <p className="mt-2 text-[12px] text-muted">{state}</p>}
    </Panel>
  );
}
