// @ts-nocheck
import { useApp } from '@/context/AppContext';
import { Badge } from './Badge';
import { Bell, ChevronRight } from 'lucide-react';

export function RFQSummaryColumn() {
  const { state, dispatch, getFilteredRfqs } = useApp();
  const filteredRfqs = getFilteredRfqs();
  const selectedSupplier = state.suppliers.find(s => s.id === state.selectedSupplierId);

  return (
    <div
      className="w-[200px] shrink-0 flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--dark-bg)', borderRight: '1px solid var(--border-color)' }}
    >
      <div className="px-3 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>RFQs</h2>
        {selectedSupplier && (
          <p className="text-micro mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>{selectedSupplier.name}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filteredRfqs.length === 0 ? (
          <EmptyState message="No RFQs" />
        ) : (
          filteredRfqs.map((rfq) => (
            <button
              key={rfq.id}
              onClick={() => dispatch({ type: 'SELECT_RFQ', payload: rfq.id })}
              className="w-full flex flex-col gap-1 px-3 py-2.5 text-left transition-colors duration-150"
              style={{
                backgroundColor: state.selectedRfqId === rfq.id ? 'rgba(73,40,96,0.2)' : 'transparent',
                borderLeft: state.selectedRfqId === rfq.id ? '3px solid var(--brand-plum)' : '3px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (state.selectedRfqId !== rfq.id) e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.04)';
              }}
              onMouseLeave={(e) => {
                if (state.selectedRfqId !== rfq.id) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <div className="flex items-center gap-1.5">
                {rfq.ciNumber ? (
                  <span
                    className="text-small font-mono font-medium"
                    style={{ color: rfq.rfqNameSource === 'manual' ? 'var(--green-success)' : 'var(--blue-ci)' }}
                  >
                    {rfq.ciNumber}
                  </span>
                ) : (
                  <span className="text-small italic" style={{ color: 'var(--text-tertiary)' }}>Pending</span>
                )}
                {rfq.alarmCount > 0 && (
                  <Bell className="w-3 h-3" style={{ color: 'var(--red-urgent)' }} />
                )}
              </div>

              <span
                className="text-body truncate"
                style={{ color: state.selectedRfqId === rfq.id ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                title={rfq.rfqName}
              >
                {rfq.rfqName}
              </span>

              <div className="flex items-center gap-1.5">
                <Badge variant={rfq.status.toLowerCase() as 'open' | 'pending' | 'approved' | 'closed'}>
                  {rfq.status}
                </Badge>
                <ChevronRight className="w-3 h-3 ml-auto" style={{ color: 'var(--text-tertiary)' }} />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4">
      <div
        className="w-12 h-12 rounded-full mb-2 flex items-center justify-center"
        style={{ backgroundColor: 'var(--card-bg)' }}
      >
        <ChevronRight className="w-5 h-5" style={{ color: 'var(--text-tertiary)' }} />
      </div>
      <p className="text-small" style={{ color: 'var(--text-tertiary)' }}>{message}</p>
    </div>
  );
}
