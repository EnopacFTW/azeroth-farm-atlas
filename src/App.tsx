import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBox, Spinner } from './components/ui';
import { useActiveProfile } from './services/hooks';
import { isDesktop } from './services/tauri';
import { FinderPage } from './pages/Finder';
import { SpotDetailPage } from './pages/SpotDetail';
import { ItemDetailPage } from './pages/ItemDetail';
import { NpcDetailPage } from './pages/NpcDetail';
import { AtlasPage } from './pages/Atlas';
import { ProfessionsPage } from './pages/Professions';
import { ComparePage } from './pages/Compare';
import { SessionsPage } from './pages/Sessions';
import { SourcesPage } from './pages/Sources';
import { SettingsPage } from './pages/Settings';
import { AuctionHousePage, useAutoRefresh } from './pages/AuctionHouse';
import { setLang, tr } from './i18n';

export function App() {
  const { profile, settings, isLoading } = useActiveProfile();
  useAutoRefresh();
  // set before rendering children so every tr() below uses the saved language; the shell remounts on a switch
  const lang = settings?.language === 'en' ? 'en' : 'de';
  setLang(lang);

  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * (settings?.uiScale ?? 1)}px`;
  }, [settings?.uiScale]);

  if (!isDesktop) {
    return (
      <div className="mx-auto mt-24 max-w-xl p-6">
        <ErrorBox title={tr('Nur als Windows-App lauffähig', 'Runs only as a Windows app')} error={{ message: tr('Azeroth Farm Atlas ist eine Tauri-Desktop-App. Start: „npm run tauri dev“ oder den Installer verwenden. Im reinen Browser gibt es weder SQLite noch AH-Adapter.', 'Azeroth Farm Atlas is a Tauri desktop app. Start it with “npm run tauri dev” or the installer. A plain browser has neither SQLite nor the AH adapters.') }} />
      </div>
    );
  }
  if (isLoading || !profile) {
    return <div className="grid h-full place-items-center"><Spinner label={tr('Lokale Datenbank wird geöffnet…', 'Opening the local database…')} /></div>;
  }

  return (
    <Layout key={lang}>
      <Routes>
        <Route path="/" element={<Navigate to="/finder" replace />} />
        <Route path="/finder" element={<FinderPage />} />
        <Route path="/atlas" element={<AtlasPage />} />
        <Route path="/spots/:id" element={<SpotDetailPage />} />
        <Route path="/items/:id" element={<ItemDetailPage />} />
        <Route path="/mobs/:id" element={<NpcDetailPage />} />
        <Route path="/professions" element={<ProfessionsPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sources" element={<SourcesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/auction-house" element={<AuctionHousePage />} />
        <Route path="*" element={<Navigate to="/finder" replace />} />
      </Routes>
    </Layout>
  );
}
