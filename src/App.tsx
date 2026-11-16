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

export function App() {
  const { profile, settings, isLoading } = useActiveProfile();
  useAutoRefresh();

  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * (settings?.uiScale ?? 1)}px`;
  }, [settings?.uiScale]);

  if (!isDesktop) {
    return (
      <div className="mx-auto mt-24 max-w-xl p-6">
        <ErrorBox title="Nur als Windows-App lauffähig" error={{ message: 'Azeroth Farm Atlas ist eine Tauri-Desktop-App. Start: „npm run tauri dev“ oder den Installer verwenden. Im reinen Browser gibt es weder SQLite noch AH-Adapter.' }} />
      </div>
    );
  }
  if (isLoading || !profile) {
    return <div className="grid h-full place-items-center"><Spinner label="Lokale Datenbank wird geöffnet…" /></div>;
  }

  return (
    <Layout>
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
