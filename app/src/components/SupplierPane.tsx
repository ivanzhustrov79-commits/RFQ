// @ts-nocheck
import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { Mail, Plus, X, ChevronDown, ChevronRight, Calendar, FolderOpen } from 'lucide-react';

function SupplierDot({ enabled }: { enabled: boolean }) {
  return (
    <span
      className="shrink-0 w-2.5 h-2.5 rounded-full"
      style={{ backgroundColor: enabled ? 'var(--green-success)' : 'var(--red-urgent)', opacity: 0.85 }}
    />
  );
}

export function SupplierPane() {
  const { state, dispatch } = useApp();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [addingFor, setAddingFor] = useState<number | null>(null);
  const [newPattern, setNewPattern] = useState('');
  const [saving, setSaving] = useState(false);
  const [mboxExpanded, setMboxExpanded] = useState(true);

  const handleSelect = (id: number) => {
    const isAlreadySelected = state.selectedSupplierId === id;
    dispatch({ type: 'SELECT_SUPPLIER', payload: isAlreadySelected ? null : id });
    dispatch({ type: 'SELECT_RFQ', payload: null });
  };

  const toggleSync = (e: React.MouseEvent, supplierId: number) => {
    e.stopPropagation();
    const current = state.supplierSyncEnabled[supplierId] !== false; // default true
    dispatch({ type: 'SET_SUPPLIER_SYNC', payload: { supplierId, enabled: !current } });
  };

  const toggleExpand = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setExpandedId(prev => prev === id ? null : id);
  };

  const handleAddPattern = async (supplierId: number) => {
    const pattern = newPattern.trim().toLowerCase();
    if (!pattern) return;
    const isEmail = pattern.includes('@') && pattern.includes('.');
    const isDomain = pattern.startsWith('@') && pattern.includes('.');
    if (!isEmail && !isDomain) {
      alert('Enter a full email (ivy@supplier.com) or domain (@supplier.com)');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`http://127.0.0.1:8721/db/supplier/${supplierId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_pattern: pattern }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNewPattern('');
      setAddingFor(null);
      const api = (window as any).electronAPI;
      if (api?.suppliers?.list) {
        const updated = await api.suppliers.list();
        if (updated?.suppliers) dispatch({ type: 'SET_SUPPLIERS', payload: updated.suppliers });
      }
    } catch (err) {
      console.error('[SUPPLIER] Failed to add contact:', err);
    } finally {
      setSaving(false);
    }
  };

  const syncedKeys = Array.from(state.syncedFolders);
  const syncedEntries = syncedKeys.map(key => ({
    key,
    path: state.syncedFolderPaths[key] || key,
    label: key.split('/').pop() || key,
  }));

  // Sort: syncing (enabled) first, paused last
  const sortedSuppliers = [...state.suppliers].sort((a, b) => {
    const aOn = state.supplierSyncEnabled[a.id] !== false;
    const bOn = state.supplierSyncEnabled[b.id] !== false;
    if (aOn && !bOn) return -1;
    if (!aOn && bOn) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="w-[220px] shrink-0 flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--deep-plum-bg)' }}>

      {/* ── Sync from date ── */}
      <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(107,61,139,0.12)' }}>
        <Calendar className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
        <div className="flex-1 min-w-0">
          <p className="text-micro" style={{ color: 'var(--text-tertiary)' }}>Sync from</p>
          <input
            type="date"
            value={state.syncFromDate || ''}
            onChange={e => dispatch({ type: 'SET_SYNC_FROM_DATE', payload: e.target.value || null })}
            className="w-full text-micro outline-none bg-transparent"
            style={{ color: 'var(--text-primary)', colorScheme: 'dark' }}
          />
        </div>
        {state.syncFromDate && (
          <button onClick={() => dispatch({ type: 'SET_SYNC_FROM_DATE', payload: null })} className="shrink-0 opacity-50 hover:opacity-80">
            <X className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
          </button>
        )}
      </div>

      {/* ── Header ── */}
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>Suppliers</h2>
        <span className="text-micro font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--brand-plum)', color: 'white' }}>
          {state.suppliers.length}
        </span>
      </div>

      {/* ── Supplier list ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {sortedSuppliers.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-micro" style={{ color: 'var(--text-tertiary)' }}>No suppliers yet</p>
          </div>
        ) : (
          sortedSuppliers.map((supplier: any) => {
            const isSelected = state.selectedSupplierId === supplier.id;
            const syncOn = state.supplierSyncEnabled[supplier.id] !== false;
            const isExpanded = expandedId === supplier.id;
            const patterns: any[] = supplier.contact_patterns || [];

            return (
              <div key={supplier.id}>
                <button
                  onClick={() => handleSelect(supplier.id)}
                  className="w-full text-left px-3 py-2 transition-colors"
                  style={{
                    borderLeft: isSelected ? '3px solid var(--plum-accent)' : '3px solid transparent',
                    backgroundColor: isSelected ? 'rgba(107,61,139,0.2)' : 'transparent',
                    opacity: syncOn ? 1 : 0.55,
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <div className="flex items-center gap-2">
                    {/* Sync toggle dot */}
                    <button
                      onClick={e => toggleSync(e, supplier.id)}
                      title={syncOn ? 'Syncing — click to pause' : 'Paused — click to enable'}
                      className="shrink-0"
                    >
                      <SupplierDot enabled={syncOn} />
                    </button>

                    <div className="flex-1 min-w-0">
                      <span className="text-small font-medium truncate block" style={{ color: 'var(--text-primary)' }}>
                        {supplier.name}
                      </span>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Mail className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                        <span className="text-micro" style={{ color: 'var(--text-tertiary)' }}>
                          {supplier.total_emails || 0} emails
                        </span>
                        {supplier.enriched_emails > 0 && (
                          <span className="text-micro" style={{ color: 'var(--green-success)' }}>
                            ({supplier.enriched_emails} AI)
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={e => toggleExpand(e, supplier.id)}
                      className="shrink-0 p-0.5 opacity-30 hover:opacity-70 transition-opacity"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                  </div>
                </button>

                {/* ── Contact patterns ── */}
                {isExpanded && (
                  <div className="px-3 pb-2" style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderLeft: '3px solid var(--border-color)' }}>
                    <p className="text-micro uppercase tracking-wider pt-2 pb-1" style={{ color: 'var(--text-tertiary)' }}>
                      Email patterns
                    </p>
                    {patterns.length === 0 ? (
                      <p className="text-micro italic mb-1" style={{ color: 'var(--text-tertiary)' }}>None</p>
                    ) : (
                      patterns.map((p: any, i: number) => (
                        <div key={i} className="flex items-center gap-1 mb-0.5">
                          <span
                            className="text-micro px-1 py-0.5 rounded flex-1 truncate"
                            style={{ backgroundColor: 'rgba(107,61,139,0.2)', color: 'var(--plum-accent)', fontFamily: 'monospace' }}
                            title={p.email_pattern}
                          >
                            {p.email_pattern}
                          </span>
                          <span className="text-micro shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                            {p.match_type === 'domain' ? '≈' : '='}
                          </span>
                        </div>
                      ))
                    )}
                    {addingFor === supplier.id ? (
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          autoFocus
                          value={newPattern}
                          onChange={e => setNewPattern(e.target.value)}
                          onKeyDown={e => {
                            e.stopPropagation();
                            if (e.key === 'Enter') handleAddPattern(supplier.id);
                            if (e.key === 'Escape') { setAddingFor(null); setNewPattern(''); }
                          }}
                          placeholder="@domain.com"
                          className="flex-1 min-w-0 text-micro px-1.5 py-1 rounded outline-none"
                          style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--brand-plum)', color: 'var(--text-primary)', fontFamily: 'monospace' }}
                        />
                        <button onClick={() => handleAddPattern(supplier.id)} disabled={saving}
                          className="shrink-0 text-micro px-1.5 py-1 rounded"
                          style={{ backgroundColor: 'var(--brand-plum)', color: 'white', opacity: saving ? 0.5 : 1 }}>
                          {saving ? '…' : 'Add'}
                        </button>
                        <button onClick={() => { setAddingFor(null); setNewPattern(''); }} className="shrink-0">
                          <X className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setAddingFor(supplier.id)}
                        className="flex items-center gap-1 mt-1 text-micro hover:opacity-80"
                        style={{ color: 'var(--plum-accent)' }}>
                        <Plus className="w-3 h-3" /> Add pattern
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* ── MBOXes section ── */}
        <div style={{ borderTop: '1px solid var(--border-color)' }}>
          <button
            onClick={() => setMboxExpanded(p => !p)}
            className="w-full flex items-center gap-2 px-3 py-2 transition-colors hover:bg-white/5"
          >
            <FolderOpen className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
            <span className="text-small font-medium flex-1 text-left" style={{ color: 'var(--text-secondary)' }}>
              MBOXes syncing
            </span>
            <span className="text-micro px-1 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(107,61,139,0.3)', color: 'var(--plum-accent)' }}>
              {syncedEntries.length}
            </span>
            {mboxExpanded ? <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />}
          </button>

          {mboxExpanded && (
            <div className="pb-2">
              {syncedEntries.length === 0 ? (
                <p className="px-3 text-micro italic" style={{ color: 'var(--text-tertiary)' }}>
                  No MBOXes selected
                </p>
              ) : (
                syncedEntries.map(({ key, label }) => (
                  <div
                    key={key}
                    className="flex items-center gap-2 px-3 py-1.5"
                  >
                    {/* Grey dot = syncing */}
                    <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--text-tertiary)' }} />
                    <span className="text-micro flex-1 truncate" style={{ color: 'var(--text-secondary)' }} title={key}>
                      {label}
                    </span>
                    <button
                      onClick={() => dispatch({ type: 'TOGGLE_FOLDER_SYNCED', payload: key })}
                      className="shrink-0 opacity-40 hover:opacity-80 transition-opacity"
                      title="Remove from sync"
                    >
                      <X className="w-3 h-3" style={{ color: 'var(--red-urgent)' }} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
