// @ts-nocheck
import { useApp } from '@/context/AppContext';
import { Activity, Brain } from 'lucide-react';
import { format, isValid } from 'date-fns';

function safeFormat(dateValue: string | Date | null | undefined, fmt: string = 'HH:mm:ss', fallback: string = '—'): string {
  if (!dateValue) return fallback;
  try {
    let date: Date;
    if (dateValue instanceof Date) { date = dateValue; }
    else if (typeof dateValue === 'string' && (dateValue.includes('T') || dateValue.match(/^\d{4}-\d{2}-\d{2}/))) { date = new Date(dateValue); }
    else { date = new Date(dateValue); }
    return isValid(date) ? format(date, fmt) : fallback;
  } catch { return fallback; }
}

export function StatusBar() {
  const { state } = useApp();

  const statusColor = (status: string) => {
    switch (status) {
      case 'online': return 'var(--green-success)';
      case 'warning': return 'var(--amber-alert)';
      case 'offline': return 'var(--red-urgent)';
      default: return 'var(--text-tertiary)';
    }
  };

  return (
    <div
      className="h-7 flex items-center justify-between px-4 shrink-0 z-40"
      style={{
        backgroundColor: 'var(--header-bg)',
        borderTop: '1px solid var(--border-color)',
      }}
    >
      <div className="flex items-center gap-4">
        {state.componentStatuses.map(comp => (
          <div key={comp.name} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor(comp.status) }} />
            <span className="text-micro" style={{ color: 'var(--text-secondary)' }}>{comp.name}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4">
        {/* NLP Background Enrichment Indicator */}
        {(state.nlpStats.pending > 0 || state.nlpStats.processing > 0) && (
          <div className="flex items-center gap-1.5" title="Background NLP enrichment queue">
            <Brain className="w-3 h-3 animate-pulse" style={{ color: 'var(--plum-accent)' }} />
            <span className="text-micro" style={{ color: 'var(--plum-accent)' }}>
              NLP: {state.nlpStats.pending} pending{state.nlpStats.processing > 0 ? `, ${state.nlpStats.processing} processing` : ''}
            </span>
          </div>
        )}
        {state.nlpStats.completed > 0 && state.nlpStats.pending === 0 && state.nlpStats.processing === 0 && (
          <div className="flex items-center gap-1.5" title="All emails enriched">
            <Brain className="w-3 h-3" style={{ color: 'var(--green-success)' }} />
            <span className="text-micro" style={{ color: 'var(--green-success)' }}>
              NLP: {state.nlpStats.completed} enriched
            </span>
          </div>
        )}
        <span className="text-micro" style={{ color: 'var(--text-tertiary)' }}>
          {safeFormat(new Date(), 'HH:mm:ss')}
        </span>
        {state.exceptions.length > 10 && (
          <div className="flex items-center gap-1">
            <Activity className="w-3 h-3" style={{ color: 'var(--amber-alert)' }} />
            <span className="text-micro font-medium" style={{ color: 'var(--amber-alert)' }}>
              {state.exceptions.length} exceptions
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
