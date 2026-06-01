// @ts-nocheck
import { useApp } from '@/context/AppContext';
import { format } from 'date-fns';
import { Activity } from 'lucide-react';

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
        <span className="text-micro" style={{ color: 'var(--text-tertiary)' }}>
          Last scan: {format(new Date(), 'HH:mm:ss')}
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
