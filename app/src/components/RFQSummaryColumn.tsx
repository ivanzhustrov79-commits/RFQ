// @ts-nocheck
import { useState, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { Badge } from './Badge';
import { Bell, ChevronRight, Pencil, Check, X } from 'lucide-react';

export function RFQSummaryColumn() {
  const { state, dispatch, getFilteredRfqs } = useApp();
  const filteredRfqs = getFilteredRfqs();
  const selectedSupplier = state.suppliers.find(s => s.id === state.selectedSupplierId);

  // Inline edit state: which RFQ is being edited + draft value
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelectRfq = (rfq: any) => {
    if (editingId) return; // don't navigate while editing
    const isAlreadySelected = state.selectedRfqId === rfq.id;
    if (isAlreadySelected) {
      dispatch({ type: 'SELECT_RFQ', payload: null });
      dispatch({ type: 'SELECT_SUPPLIER', payload: null });
    } else {
      dispatch({ type: 'SELECT_RFQ', payload: rfq.id });
      dispatch({ type: 'SELECT_SUPPLIER', payload: rfq.supplierId });
    }
  };

  const startEdit = (e: React.MouseEvent, rfq: any) => {
    e.stopPropagation();
    setEditingId(rfq.id);
    setDraftName(rfq.rfqName);
    // Focus after render
    setTimeout(() => inputRef.current?.select(), 30);
  };

  const commitEdit = (rfq: any) => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== rfq.rfqName) {
      dispatch({
        type: 'SET_RFQ_NAME',
        payload: { supplierId: rfq.supplierId, name: trimmed, source: 'manual' },
      });
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

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
          filteredRfqs.map((rfq) => {
            const isSelected = state.selectedRfqId === rfq.id;
            const isEditing = editingId === rfq.id;

            return (
              <button
                key={rfq.id}
                onClick={() => handleSelectRfq(rfq)}
                className="w-full flex flex-col gap-1 px-3 py-2.5 text-left transition-colors duration-150"
                style={{
                  backgroundColor: isSelected ? 'rgba(73,40,96,0.2)' : 'transparent',
                  borderLeft: isSelected ? '3px solid var(--brand-plum)' : '3px solid transparent',
                }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.04)'; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {/* Row 1: CI number / pending + alarm bell */}
                <div className="flex items-center gap-1.5">
                  {rfq.ciNumber ? (
                    <span className="text-small font-mono font-medium" style={{ color: 'var(--blue-ci)' }}>
                      {rfq.ciNumber}
                    </span>
                  ) : (
                    <span className="text-small italic" style={{ color: 'var(--text-tertiary)' }}>Pending</span>
                  )}
                  {rfq.alarmCount > 0 && (
                    <Bell className="w-3 h-3" style={{ color: 'var(--red-urgent)' }} />
                  )}
                </div>

                {/* Row 2: RFQ name — editable */}
                <div className="flex items-center gap-1 group/name w-full">
                  {isEditing ? (
                    <>
                      <input
                        ref={inputRef}
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') commitEdit(rfq);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 text-body rounded px-1 py-0.5 outline-none"
                        style={{
                          backgroundColor: 'var(--card-bg)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--brand-plum)',
                          fontSize: 'inherit',
                        }}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); commitEdit(rfq); }}
                        className="shrink-0 rounded p-0.5 hover:opacity-80"
                        style={{ color: 'var(--green-success)' }}
                        title="Save"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
                        className="shrink-0 rounded p-0.5 hover:opacity-80"
                        style={{ color: 'var(--text-tertiary)' }}
                        title="Cancel"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span
                        className="text-body truncate flex-1"
                        style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                        title={rfq.rfqName}
                      >
                        {rfq.rfqName}
                      </span>

                      {/* Source dot: purple = AI, green = manual, grey = rule */}
                      <span
                        className="shrink-0 w-1.5 h-1.5 rounded-full"
                        title={
                          rfq.rfqNameSource === 'ai' ? 'AI-generated name' :
                          rfq.rfqNameSource === 'manual' ? 'Manually set' :
                          'Auto-generated'
                        }
                        style={{
                          backgroundColor:
                            rfq.rfqNameSource === 'ai' ? 'var(--brand-plum)' :
                            rfq.rfqNameSource === 'manual' ? 'var(--green-success)' :
                            'var(--text-tertiary)',
                          opacity: 0.7,
                        }}
                      />

                      {/* Edit pencil — only visible on hover */}
                      <button
                        onClick={(e) => startEdit(e, rfq)}
                        className="shrink-0 opacity-0 group-hover/name:opacity-100 transition-opacity rounded p-0.5 hover:opacity-80"
                        style={{ color: 'var(--text-tertiary)' }}
                        title="Edit name"
                      >
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Row 3: status badge + counts */}
                <div className="flex items-center gap-1.5">
                  <Badge variant={rfq.status.toLowerCase() as 'open' | 'pending' | 'approved' | 'closed'}>
                    {rfq.status}
                  </Badge>
                  <span className="text-micro ml-1" style={{ color: 'var(--text-tertiary)' }}>
                    {rfq.emailCount} email{rfq.emailCount !== 1 ? 's' : ''}
                  </span>
                  {rfq.enrichedCount > 0 && (
                    <span className="text-micro" style={{ color: 'var(--green-success)' }}>
                      ({rfq.enrichedCount} AI)
                    </span>
                  )}
                  <ChevronRight className="w-3 h-3 ml-auto" style={{ color: 'var(--text-tertiary)' }} />
                </div>
              </button>
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
      <p className="text-small" style={{ color: 'var(--text-tertiary)' }}>{message}</p>
    </div>
  );
}
