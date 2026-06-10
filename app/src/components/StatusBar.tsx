import { useApp } from '@/context/AppContext';
import { safeFormat } from '@/lib/dateSafe';
import { Activity, Cpu, Database } from 'lucide-react';

export function StatusBar() {
  const { state } = useApp();

  return (
    <div className="h-8 flex items-center justify-between px-4 text-micro border-t" style={{ backgroundColor: 'var(--deep-plum-bg)', borderColor: 'var(--border-color)', color: 'var(--text-tertiary)' }}>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Database className="w-3 h-3" />
          {state.useRealData ? 'Live' : 'Training'}
        </span>
        <span className="flex items-center gap-1">
          <Activity className="w-3 h-3" />
          Last scan: {safeFormat(state.lastScan, 'HH:mm:ss')}
        </span>
        {(state.nlpStats.pending > 0 || state.nlpStats.processing > 0) && (
          <span className="flex items-center gap-1" style={{ color: 'var(--plum-accent)' }}>
            <Cpu className="w-3 h-3" />
            NLP: {state.nlpStats.pending} pending, {state.nlpStats.processing} processing
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span>{state.emails.length} emails</span>
        <span>{state.suppliers.length} suppliers</span>
      </div>
    </div>
  );
}