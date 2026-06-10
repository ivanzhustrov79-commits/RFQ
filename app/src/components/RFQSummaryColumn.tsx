import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ChevronRight, Bell, Save, X } from 'lucide-react';
import { Badge } from './Badge';

export function RFQSummaryColumn() {
  const { state, dispatch, getFilteredRfqs } = useApp();
  const rfqs = getFilteredRfqs();
  const selectedSupplier = state.suppliers.find(s => s.id === state.selectedSupplierId);

  // State for inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCi, setEditCi] = useState('');

  const startEditing = (rfq: any) => {
    setEditingId(rfq.id);
    setEditName(rfq.rfqName);
    setEditCi(rfq.ciNumber || '');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName('');
    setEditCi('');
  };

  const saveEditing = async (supplierId: number) => {
    if (!editName.trim()) return;

    // 1. Update local state immediately for snappy UI
    dispatch({
      type: 'UPDATE_RFQ_OVERRIDE',
      payload: { supplierId, rfqName: editName.trim(), ciNumber: editCi.trim() || null }
    });

    // 2. Save to Python backend
    try {
      await fetch('http://127.0.0.1:8721/db/rfqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: supplierId,
          rfq_name: editName.trim(),
          ci_number: editCi.trim() || null,
        }),
      });
    } catch (err) {
      console.error('Failed to save RFQ override:', err);
    }

    cancelEditing();
  };

  return (
    <div 
      className="w-[200px] shrink-0 flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--dark-bg)', borderRight: '1px solid var(--border-color)' }}
    >
      <div className="px-3 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>RFQs</h2>
        {selectedSupplier && (
          <p className="text-micro mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
            {selectedSupplier.name}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {rfqs.length === 0 ? (
          <EmptyState message="No RFQs" />
        ) : (
          rfqs.map(rfq => {
            const isEditing = editingId === rfq.id;
            const isSelected = state.selectedRfqId === rfq.id;

            return (
              <div
                key={rfq.id}
                className="w-full flex flex-col gap-1 px-3 py-2.5 text-left transition-colors duration-150"
                style={{
                  backgroundColor: isSelected ? 'rgba(73,40,96,0.2)' : 'transparent',
                  borderLeft: isSelected ? '3px solid var(--brand-plum)' : '3px solid transparent',
                }}
                onClick={() => !isEditing && dispatch({ type: 'SELECT_RFQ', payload: rfq.id })}
                onMouseEnter={(e) => {
                  if (!isSelected && !isEditing) e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.04)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected && !isEditing) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {isEditing ? (
                  // --- EDIT MODE ---
                  <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="RFQ Name"
                      className="w-full px-2 py-1 rounded text-small outline-none"
                      style={{ backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)', border: '1px solid var(--brand-plum)' }}
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && saveEditing(rfq.supplierId)}
                    />
                    <input
                      type="text"
                      value={editCi}
                      onChange={(e) => setEditCi(e.target.value)}
                      placeholder="CI / PO Number"
                      className="w-full px-2 py-1 rounded text-small outline-none"
                      style={{ backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                      onKeyDown={(e) => e.key === 'Enter' && saveEditing(rfq.supplierId)}
                    />
                    <div className="flex gap-1 mt-1">
                      <button
                        onClick={() => saveEditing(rfq.supplierId)}
                        className="flex-1 flex items-center justify-center gap-1 py-1 rounded text-micro font-medium"
                        style={{ backgroundColor: 'var(--green-success)', color: 'black' }}
                      >
                        <Save className="w-3 h-3" /> Save
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="flex-1 flex items-center justify-center gap-1 py-1 rounded text-micro font-medium"
                        style={{ backgroundColor: 'var(--border-light)', color: 'var(--text-secondary)' }}
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  // --- VIEW MODE ---
                  <>
                    <div className="flex items-center gap-1.5">
                      {rfq.ciNumber ? (
                        <span
                          className="text-small font-mono font-medium cursor-pointer hover:underline"
                          style={{ color: rfq.rfqNameSource === 'manual' ? 'var(--green-success)' : 'var(--blue-ci)' }}
                          onClick={() => startEditing(rfq)}
                          title="Click to edit CI & Name"
                        >
                          {rfq.ciNumber}
                        </span>
                      ) : (
                        <span
                          className="text-small italic cursor-pointer hover:underline"
                          style={{ color: 'var(--text-tertiary)' }}
                          onClick={() => startEditing(rfq)}
                          title="Click to add CI number"
                        >
                          Pending CI
                        </span>
                      )}
                      {rfq.alarmCount > 0 && <Bell className="w-3 h-3" style={{ color: 'var(--red-urgent)' }} />}
                    </div>

                    <span
                      className="text-body truncate cursor-pointer"
                      style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                      title={rfq.rfqName}
                      onDoubleClick={() => startEditing(rfq)}
                    >
                      {rfq.rfqName}
                      {rfq.rfqNameSource === 'manual' && (
                        <span className="ml-1 text-micro" style={{ color: 'var(--green-success)' }}>✎</span>
                      )}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <Badge variant={rfq.status.toLowerCase() as any}>{rfq.status}</Badge>
                      <ChevronRight className="w-3 h-3 ml-auto" style={{ color: 'var(--text-tertiary)' }} />
                    </div>
                  </>
                )}
              </div>
            );
          })
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
      <p className="text-small" style={{ color: 'var(--text-tertiary)' }}>
        {message}
      </p>
    </div>
  );
}