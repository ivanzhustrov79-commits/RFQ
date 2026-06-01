import { useEffect } from 'react';
import { AppProvider, useApp } from '@/context/AppContext';
import { HeaderBar } from '@/components/HeaderBar';
import { SupplierPane } from '@/components/SupplierPane';
import { RFQSummaryColumn } from '@/components/RFQSummaryColumn';
import { KanbanBoard } from '@/components/KanbanBoard';
import { AnalyticsPanel } from '@/components/AnalyticsPanel';
import { AlarmBoard } from '@/components/AlarmBoard';
import { ExceptionQueuePanel } from '@/components/ExceptionQueuePanel';
import { TroubleshootPanel } from '@/components/TroubleshootPanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ThunderbirdPanel } from '@/components/ThunderbirdPanel';
import { StatusBar } from '@/components/StatusBar';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function ThemedApp() {
  const { state } = useApp();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'font-small', 'font-medium', 'font-big');
    if (state.theme === 'light') root.classList.add('theme-light');
    root.classList.add(`font-${state.fontSize}`);
  }, [state.theme, state.fontSize]);

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--dark-bg)' }}
    >
      <HeaderBar />

      <div className="flex-1 flex overflow-hidden">
        <ErrorBoundary><SupplierPane /></ErrorBoundary>
        <ErrorBoundary><RFQSummaryColumn /></ErrorBoundary>
        <ErrorBoundary><KanbanBoard /></ErrorBoundary>
        <ErrorBoundary><AnalyticsPanel /></ErrorBoundary>
      </div>

      <StatusBar />

      <ThunderbirdPanel />
      <AlarmBoard />
      <ExceptionQueuePanel />
      <TroubleshootPanel />
      <SettingsPanel />
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <ThemedApp />
    </AppProvider>
  );
}

export default App;
