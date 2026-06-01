// @ts-nocheck
import { useApp } from '@/context/AppContext';
import { useState } from 'react';
import { X, AlertTriangle, Wand2, CheckSquare, Square, Check } from 'lucide-react';
import { format, parseISO } from 'date-fns';

export function ExceptionQueuePanel() {
  const { state, dispatch } = useApp();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [visible, setVisible] = useState(false);

  if (state.isExceptionQueueOpen && !visible) setTimeout(() => setVisible(true), 10);
  if (!state.isExceptionQueueOpen && visible) setTimeout(() => setVisible(false), 0);
  if (!state.isExceptionQueueOpen && !visible) return null;

  const handleClose = () => { setVisible(false); setTimeout(() => dispatch({ type: 'TOGGLE_EXCEPTION_QUEUE' }), 250); };

  const toggleSelect = (id: number) => { setSelectedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const selectAll = () => { setSelectedIds(state.exceptions.length > 0 && selectedIds.size === state.exceptions.length ? new Set() : new Set(state.exceptions.map(e => e.id))); };
  const resolveAll = () => { selectedIds.forEach(id => dispatch({ type: 'RESOLVE_EXCEPTION', payload: id })); setSelectedIds(new Set()); };

  return (
    <>
      <div className="fixed inset-0 z-[80] transition-opacity duration-200" style={{ backgroundColor: 'black', opacity: visible ? 0.6 : 0 }} onClick={handleClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[400px] z-[90] flex flex-col transition-transform duration-250 ease-out" style={{ backgroundColor: 'var(--deep-plum-bg)', borderLeft: '1px solid var(--border-color)', boxShadow: '-4px 0 24px rgba(0,0,0,0.6)', transform: visible ? 'translateX(0)' : 'translateX(100%)' }}>
        <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" style={{ color: 'var(--amber-alert)' }} />
            <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>Exception Queue</h2>
            <span className="text-micro font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--amber-alert)', color: 'black' }}>{state.exceptions.length}</span>
          </div>
          <button onClick={handleClose} className="p-1 rounded-md transition-colors hover:bg-white/10"><X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} /></button>
        </div>

        {state.exceptions.length > 10 && (
          <div className="flex items-center gap-2 px-4 py-2 text-small" style={{ backgroundColor: 'rgba(245,166,35,0.1)', color: 'var(--amber-alert)' }}>
            <AlertTriangle className="w-4 h-4 shrink-0" />{state.exceptions.length} active exceptions - review recommended
          </div>
        )}

        {state.exceptions.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <button onClick={selectAll} className="flex items-center gap-1.5 text-small transition-colors" style={{ color: 'var(--text-secondary)' }}>
              {selectedIds.size === state.exceptions.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}Select All ({selectedIds.size})
            </button>
            {selectedIds.size > 0 && <button onClick={resolveAll} className="flex items-center gap-1.5 text-micro px-3 py-1 rounded-md" style={{ backgroundColor: 'var(--green-success)', color: 'black' }}><Check className="w-3.5 h-3.5" />Resolve All</button>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
          {state.exceptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12"><AlertTriangle className="w-10 h-10 mb-3" style={{ color: 'var(--text-tertiary)' }} /><p className="text-body" style={{ color: 'var(--text-secondary)' }}>No exceptions</p></div>
          ) : state.exceptions.map(ex => (
            <div key={ex.id} className="flex flex-col gap-1.5 p-3 rounded-md" style={{ backgroundColor: selectedIds.has(ex.id) ? 'rgba(73,40,96,0.2)' : 'var(--card-bg)', border: selectedIds.has(ex.id) ? '1px solid var(--brand-plum)' : '1px solid var(--border-color)' }}>
              <div className="flex items-start gap-2">
                <button onClick={() => toggleSelect(ex.id)} className="mt-0.5 shrink-0" style={{ color: 'var(--text-secondary)' }}>{selectedIds.has(ex.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button>
                <div className="flex-1 min-w-0">
                  <p className="text-body truncate" style={{ color: 'var(--text-primary)' }} title={ex.emailSubject}>{ex.emailSubject}</p>
                  <p className="text-small mt-0.5" style={{ color: 'var(--amber-alert)' }}>{ex.reason}</p>
                  {ex.aiSuggestion && <div className="flex items-start gap-1 mt-1.5 p-1.5 rounded" style={{ backgroundColor: 'rgba(155,91,175,0.1)' }}><Wand2 className="w-3 h-3 shrink-0 mt-0.5" style={{ color: 'var(--plum-accent)'}} /><p className="text-micro" style={{ color: 'var(--plum-accent)' }}>{ex.aiSuggestion}</p></div>}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-micro" style={{ color: 'var(--text-tertiary)' }}>{format(parseISO(ex.createdAt), 'MMM d, HH:mm')}</span>
                    <button onClick={() => dispatch({ type: 'RESOLVE_EXCEPTION', payload: ex.id })} className="text-micro px-2 py-0.5 rounded-md" style={{ backgroundColor: 'var(--green-success)', color: 'black' }}>Resolve</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
