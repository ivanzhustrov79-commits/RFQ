// @ts-nocheck
import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { Mail, Plus, X, ChevronDown, ChevronRight, Calendar, User, Folder } from 'lucide-react';

function FolderNameField({ supplier, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(supplier.folder_name_normalized || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`http://127.0.0.1:8721/db/supplier/${supplier.id}/folder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_name: value.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditing(false);
      onSaved();
    } catch (err) {
      console.error('[SUPPLIER] Failed to update folder:', err);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 mb-1">
        <input autoFocus value={value} onChange={e => setValue(e.target.value.toUpperCase())}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
          placeholder="FOLDER NAME"
          className="flex-1 min-w-0 text-micro px-1.5 py-1 rounded outline-none"
          style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--brand-plum)', color: 'var(--text-primary)', fontFamily: 'monospace' }} />
        <button onClick={handleSave} disabled={saving} className="shrink-0 text-micro px-1.5 py-1 rounded"
          style={{ backgroundColor: 'var(--brand-plum)', color: 'white', opacity: saving ? 0.5 : 1 }}>
          {saving ? '…' : 'Save'}
        </button>
        <button onClick={() => setEditing(false)} className="shrink-0">
          <X className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setEditing(true)}
      className="flex items-center gap-1 mb-1 text-micro hover:opacity-80 w-full text-left"
      style={{ color: supplier.folder_name_normalized ? 'var(--plum-accent)' : 'var(--text-tertiary)' }}>
      <Folder className="w-3 h-3 shrink-0" />
      <span style={{ fontFamily: 'monospace' }}>
        {supplier.folder_name_normalized || 'Set folder name…'}
      </span>
    </button>
  );
}

export function SupplierPane() {
  const { state, dispatch } = useApp();
  const [expandedId, setExpandedId] = useState(null);
  const [addingPattern, setAddingPattern] = useState(null);
  const [newPattern, setNewPattern] = useState('');
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [accountsExpanded, setAccountsExpanded] = useState(true);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierEmail, setNewSupplierEmail] = useState('');
  const [savingSupplier, setSavingSupplier] = useState(false);
  // ── Boss card (global config, not per-supplier — mirrors the Accounts section below) ──
  const [bossAddresses, setBossAddresses] = useState([]);
  const [bossExpanded, setBossExpanded] = useState(true);
  const [addingBoss, setAddingBoss] = useState(false);
  const [newBossEmail, setNewBossEmail] = useState('');
  const [savingBoss, setSavingBoss] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.thunderbird?.listAccounts) return;
    api.thunderbird.listAccounts().then((result) => {
      if (result?.accounts) setAccounts(result.accounts);
    }).catch(() => {});
  }, []);

  const refreshBossAddresses = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8721/db/boss-addresses');
      const data = await res.json();
      if (data?.addresses) setBossAddresses(data.addresses);
    } catch (err) { console.error('[BOSS] Failed to load addresses:', err); }
  };

  useEffect(() => { refreshBossAddresses(); }, []);

  const handleSelectSupplier = (id) => {
    const isAlreadySelected = state.selectedSupplierId === id;
    dispatch({ type: 'SELECT_SUPPLIER', payload: isAlreadySelected ? null : id });
    dispatch({ type: 'SELECT_RFQ', payload: null });
  };

  const toggleSupplierSync = (e, supplierId) => {
    e.stopPropagation();
    const current = state.supplierSyncEnabled[supplierId] !== false;
    const turningOn = current === false; // was off, now being switched on
    dispatch({ type: 'SET_SUPPLIER_SYNC', payload: { supplierId, enabled: !current } });

    if (turningOn) {
      // Targeted resync: re-scans all folders, but NLP-queueing is scoped to
      // just this supplier + Boss (see main.js's syncSpecificSupplier) — so
      // catching this one supplier up never burns qwen time on the rest of
      // the already-tracked suppliers' history.
      window.electronAPI?.thunderbird?.syncSupplier?.(supplierId)
        .then((result) => {
          if (result?.success) {
            console.log(`[SYNC] Targeted resync for supplier ${supplierId}: ${result.emailsScanned} emails scanned`);
          } else {
            console.error('[SYNC] Targeted resync failed:', result?.error);
          }
        })
        .catch((err) => console.error('[SYNC] Targeted resync error:', err));
    }
  };

  const toggleAccount = (accountName) => {
    const isSkipped = state.skippedAccounts.includes(accountName);
    const updated = isSkipped
      ? state.skippedAccounts.filter(a => a !== accountName)
      : [...state.skippedAccounts, accountName];
    dispatch({ type: 'SET_SKIPPED_ACCOUNTS', payload: updated });
  };

  const handleAddPattern = async (supplierId) => {
    const pattern = newPattern.trim().toLowerCase();
    if (!pattern) return;
    const isEmail = pattern.includes('@') && pattern.includes('.');
    const isDomain = pattern.startsWith('@') && pattern.includes('.');
    if (!isEmail && !isDomain) { alert('Enter full email or @domain.com'); return; }
    setSaving(true);
    try {
      const res = await fetch(`http://127.0.0.1:8721/db/supplier/${supplierId}/contacts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_pattern: pattern }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNewPattern(''); setAddingPattern(null);
      await refreshSuppliers();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const handleDeletePattern = async (supplierId, pattern) => {
    if (!confirm(`Delete pattern "${pattern}"?`)) return;
    try {
      const res = await fetch(
        `http://127.0.0.1:8721/db/supplier/${supplierId}/contacts?pattern=${encodeURIComponent(pattern)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error(await res.text());
      await refreshSuppliers();
    } catch (err) { console.error(err); }
  };

  const handleAddBoss = async () => {
    const email = newBossEmail.trim().toLowerCase();
    if (!email.includes('@') || !email.includes('.')) { alert('Enter a full email address'); return; }
    setSavingBoss(true);
    try {
      const res = await fetch('http://127.0.0.1:8721/db/boss-addresses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNewBossEmail(''); setAddingBoss(false);
      await refreshBossAddresses();
    } catch (err) { console.error(err); } finally { setSavingBoss(false); }
  };

  const handleDeleteBoss = async (email) => {
    if (!confirm(`Remove "${email}" from Boss addresses?`)) return;
    try {
      const res = await fetch(
        `http://127.0.0.1:8721/db/boss-addresses?email=${encodeURIComponent(email)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error(await res.text());
      await refreshBossAddresses();
    } catch (err) { console.error(err); }
  };

  const handleAddSupplier = async () => {
    const name = newSupplierName.trim();
    const email = newSupplierEmail.trim().toLowerCase();
    if (!name) return;
    setSavingSupplier(true);
    try {
      const domain = email.startsWith('@') ? email.slice(1) : email.split('@')[1] || '';
      const res = await fetch('http://127.0.0.1:8721/db/supplier', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email_domain: domain, contact_email: email, folder_name_normalized: name.toUpperCase() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      if (email && result.supplier_id) {
        const pattern = email.startsWith('@') ? email : email.includes('@') ? email : `@${email}`;
        await fetch(`http://127.0.0.1:8721/db/supplier/${result.supplier_id}/contacts`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email_pattern: pattern }),
        });
      }
      setNewSupplierName(''); setNewSupplierEmail(''); setAddingSupplier(false);
      if (result.supplier_id) {
        // Default new suppliers to sync-OFF. This keeps exactly one trigger
        // for syncSpecificSupplier (the toggle click) — whether the supplier
        // is brand new or just being re-enabled, the action is the same.
        dispatch({ type: 'SET_SUPPLIER_SYNC', payload: { supplierId: result.supplier_id, enabled: false } });
      }
      await refreshSuppliers();
    } catch (err) { console.error(err); } finally { setSavingSupplier(false); }
  };

  const refreshSuppliers = async () => {
    const api = window.electronAPI;
    if (api?.suppliers?.list) {
      const updated = await api.suppliers.list();
      if (updated?.suppliers) dispatch({ type: 'SET_SUPPLIERS', payload: updated.suppliers });
    }
  };

  // Human-readable display names for cryptic Thunderbird server hostnames
  const ACCOUNT_DISPLAY_NAMES = {
    'yandex.com': 'izhustrov@yandex (import-detal36)',
    'pop3.field-pro.ae': 'logistic@field-pro.ae (POP3)',
    'europa-parts-1.kz': 'europa-parts-1.kz (empty)',
    'Local Folders': 'Local Folders (sent/drafts)',
  };

  const sortedAccounts = [...accounts].sort((a, b) => {
    const aSkipped = state.skippedAccounts.includes(a.name);
    const bSkipped = state.skippedAccounts.includes(b.name);
    if (aSkipped && !bSkipped) return 1;
    if (!aSkipped && bSkipped) return -1;
    return b.totalEmails - a.totalEmails; // most emails first within each group
  });

  const sortedSuppliers = [...state.suppliers].sort((a, b) => {
    const aOn = state.supplierSyncEnabled[a.id] !== false;
    const bOn = state.supplierSyncEnabled[b.id] !== false;
    if (aOn && !bOn) return -1; if (!aOn && bOn) return 1;
    return a.name.localeCompare(b.name);
  });

  const S = { color: 'var(--text-tertiary)' };

  return (
    <div className="w-[220px] shrink-0 flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--deep-plum-bg)' }}>

      {/* Date */}
      <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(107,61,139,0.12)' }}>
        <Calendar className="w-3.5 h-3.5 shrink-0" style={S} />
        <div className="flex-1 min-w-0">
          <p className="text-micro" style={S}>Sync from</p>
          <input type="date" value={state.syncFromDate || ''}
            onChange={e => dispatch({ type: 'SET_SYNC_FROM_DATE', payload: e.target.value || null })}
            className="w-full text-micro outline-none bg-transparent"
            style={{ color: 'var(--text-primary)', colorScheme: 'dark' }} />
        </div>
        {state.syncFromDate && (
          <button onClick={() => dispatch({ type: 'SET_SYNC_FROM_DATE', payload: null })} className="shrink-0 opacity-50 hover:opacity-80">
            <X className="w-3 h-3" style={S} />
          </button>
        )}
      </div>

      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>Suppliers</h2>
        <div className="flex items-center gap-1.5">
          <span className="text-micro font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--brand-plum)', color: 'white' }}>
            {state.suppliers.length}
          </span>
          <button onClick={() => setAddingSupplier(p => !p)}
            className="w-5 h-5 rounded flex items-center justify-center hover:opacity-80"
            style={{ backgroundColor: addingSupplier ? 'var(--brand-plum)' : 'rgba(107,61,139,0.3)', color: 'white' }}
            title="Add supplier">
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Add supplier form */}
      {addingSupplier && (
        <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(107,61,139,0.1)' }}>
          <p className="text-micro uppercase tracking-wider mb-1.5" style={S}>New supplier</p>
          <input autoFocus value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddSupplier(); if (e.key === 'Escape') setAddingSupplier(false); }}
            placeholder="Name" className="w-full text-small px-2 py-1 rounded outline-none mb-1"
            style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
          <input value={newSupplierEmail} onChange={e => setNewSupplierEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddSupplier(); if (e.key === 'Escape') setAddingSupplier(false); }}
            placeholder="@domain.com (optional)" className="w-full text-small px-2 py-1 rounded outline-none mb-1.5"
            style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontFamily: 'monospace' }} />
          <div className="flex gap-1">
            <button onClick={handleAddSupplier} disabled={savingSupplier || !newSupplierName.trim()}
              className="flex-1 text-micro py-1 rounded"
              style={{ backgroundColor: 'var(--brand-plum)', color: 'white', opacity: (savingSupplier || !newSupplierName.trim()) ? 0.5 : 1 }}>
              {savingSupplier ? 'Saving…' : 'Add'}
            </button>
            <button onClick={() => { setAddingSupplier(false); setNewSupplierName(''); setNewSupplierEmail(''); }}
              className="px-2 py-1 rounded text-micro"
              style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-tertiary)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">

        {/* Supplier list */}
        {sortedSuppliers.map((supplier) => {
          const isSelected = state.selectedSupplierId === supplier.id;
          const syncOn = state.supplierSyncEnabled[supplier.id] !== false;
          const isExpanded = expandedId === supplier.id;
          const patterns = supplier.contact_patterns || [];
          return (
            <div key={supplier.id}>
              <button onClick={() => handleSelectSupplier(supplier.id)}
                className="w-full text-left px-2 py-2 transition-colors"
                style={{ borderLeft: isSelected ? '3px solid var(--plum-accent)' : '3px solid transparent', backgroundColor: isSelected ? 'rgba(107,61,139,0.2)' : 'transparent', opacity: syncOn ? 1 : 0.5 }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}>
                <div className="flex items-center gap-1.5">
                  <button onClick={e => toggleSupplierSync(e, supplier.id)}
                    title={syncOn ? 'Syncing — click to pause' : 'Paused — click to enable'}
                    className="shrink-0 w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: syncOn ? 'var(--green-success)' : 'var(--red-urgent)', opacity: 0.9 }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-small font-medium truncate block" style={{ color: 'var(--text-primary)' }}>{supplier.name}</span>
                    <div className="flex items-center gap-1">
                      <Mail className="w-3 h-3" style={S} />
                      <span className="text-micro" style={S}>{supplier.total_emails || 0} emails</span>
                      {supplier.enriched_emails > 0 && <span className="text-micro" style={{ color: 'var(--green-success)' }}>({supplier.enriched_emails} AI)</span>}
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setExpandedId(prev => prev === supplier.id ? null : supplier.id); }} className="shrink-0 opacity-30 hover:opacity-70" style={{ color: 'var(--text-tertiary)' }}>
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </button>
                </div>
              </button>
              {isExpanded && (
                <div className="px-3 pb-2" style={{ backgroundColor: 'rgba(0,0,0,0.15)', borderLeft: '3px solid var(--border-color)' }}>
                  {/* Folder name */}
                  <p className="text-micro uppercase tracking-wider pt-2 pb-1" style={S}>TB Folder</p>
                  <FolderNameField supplier={supplier} onSaved={refreshSuppliers} />

                  {/* Email patterns */}
                  <p className="text-micro uppercase tracking-wider pt-2 pb-1" style={S}>Email patterns</p>
                  {patterns.length === 0 ? <p className="text-micro italic mb-1" style={S}>None</p>
                    : patterns.map((p, i) => (
                      <div key={i} className="flex items-center gap-1 mb-0.5 group/pattern">
                        <span className="text-micro px-1 py-0.5 rounded flex-1 truncate" style={{ backgroundColor: 'rgba(107,61,139,0.2)', color: 'var(--plum-accent)', fontFamily: 'monospace' }} title={p.email_pattern}>{p.email_pattern}</span>
                        <span className="text-micro shrink-0" style={S}>{p.match_type === 'domain' ? '≈' : '='}</span>
                        <button
                          onClick={() => handleDeletePattern(supplier.id, p.email_pattern)}
                          className="shrink-0 opacity-0 group-hover/pattern:opacity-100 transition-opacity hover:opacity-80"
                          title="Delete pattern"
                        >
                          <X className="w-3 h-3" style={{ color: 'var(--red-urgent)' }} />
                        </button>
                      </div>
                    ))}
                  {addingPattern === supplier.id ? (
                    <div className="flex items-center gap-1 mt-1">
                      <input autoFocus value={newPattern} onChange={e => setNewPattern(e.target.value)}
                        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleAddPattern(supplier.id); if (e.key === 'Escape') { setAddingPattern(null); setNewPattern(''); } }}
                        placeholder="@domain.com" className="flex-1 min-w-0 text-micro px-1.5 py-1 rounded outline-none"
                        style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--brand-plum)', color: 'var(--text-primary)', fontFamily: 'monospace' }} />
                      <button onClick={() => handleAddPattern(supplier.id)} disabled={saving} className="shrink-0 text-micro px-1.5 py-1 rounded" style={{ backgroundColor: 'var(--brand-plum)', color: 'white', opacity: saving ? 0.5 : 1 }}>{saving ? '…' : 'Add'}</button>
                      <button onClick={() => { setAddingPattern(null); setNewPattern(''); }} className="shrink-0"><X className="w-3 h-3" style={S} /></button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingPattern(supplier.id)} className="flex items-center gap-1 mt-1 text-micro hover:opacity-80" style={{ color: 'var(--plum-accent)' }}>
                      <Plus className="w-3 h-3" /> Add pattern
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Accounts section */}
        <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '4px' }}>
          <button onClick={() => setAccountsExpanded(p => !p)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors">
            <User className="w-3.5 h-3.5 shrink-0" style={S} />
            <span className="text-small font-medium flex-1 text-left" style={{ color: 'var(--text-secondary)' }}>Accounts</span>
            <span className="text-micro" style={S}>{accounts.filter(a => !state.skippedAccounts.includes(a.name)).length}/{accounts.length}</span>
            {accountsExpanded ? <ChevronDown className="w-3 h-3" style={S} /> : <ChevronRight className="w-3 h-3" style={S} />}
          </button>
          {accountsExpanded && (
            <div className="pb-2">
              {accounts.length === 0
                ? <p className="px-3 text-micro italic" style={S}>Loading…</p>
                : sortedAccounts.map(({ name, totalEmails }) => {
                  const isSkipped = state.skippedAccounts.includes(name);
                  const displayName = ACCOUNT_DISPLAY_NAMES[name] || name;
                  return (
                    <button key={name} onClick={() => toggleAccount(name)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 transition-colors"
                      title={`${name}\nClick to ${isSkipped ? 'enable' : 'disable'}`}>
                      <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: isSkipped ? 'var(--red-urgent)' : 'var(--text-secondary)', opacity: isSkipped ? 0.6 : 0.8 }} />
                      <div className="flex-1 min-w-0">
                        <span className="text-micro truncate block" style={{ color: isSkipped ? 'var(--text-tertiary)' : 'var(--text-secondary)' }}>{displayName}</span>
                        <span className="text-micro" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }}>{totalEmails?.toLocaleString()} emails</span>
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
        </div>

        {/* ── Boss card: global config (one set, not per-supplier) — used by the
             backend's determine_sender_role to recognize Boss<->user correspondence
             for the PR step and the Downpayment "Boss -> me" condition. ── */}
        <div style={{ borderTop: '1px solid var(--border-color)' }}>
          <button onClick={() => setBossExpanded(p => !p)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors">
            <User className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--plum-accent)' }} />
            <span className="text-small font-medium flex-1 text-left" style={{ color: 'var(--text-secondary)' }}>Boss</span>
            <span className="text-micro font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--brand-plum)', color: 'white' }}>
              {bossAddresses.length}
            </span>
            {bossExpanded ? <ChevronDown className="w-3 h-3" style={S} /> : <ChevronRight className="w-3 h-3" style={S} />}
          </button>
          {bossExpanded && (
            <div className="px-3 pb-2">
              {bossAddresses.length === 0 ? (
                <p className="text-micro italic mb-1" style={S}>None — add Boss's email below</p>
              ) : (
                bossAddresses.map((b) => (
                  <div key={b.id} className="flex items-center gap-1 mb-0.5 group/boss">
                    <span className="text-micro px-1 py-0.5 rounded flex-1 truncate" style={{ backgroundColor: 'rgba(107,61,139,0.2)', color: 'var(--plum-accent)', fontFamily: 'monospace' }} title={b.email}>
                      {b.email}
                    </span>
                    <button
                      onClick={() => handleDeleteBoss(b.email)}
                      className="shrink-0 opacity-0 group-hover/boss:opacity-100 transition-opacity hover:opacity-80"
                      title="Remove"
                    >
                      <X className="w-3 h-3" style={{ color: 'var(--red-urgent)' }} />
                    </button>
                  </div>
                ))
              )}
              {addingBoss ? (
                <div className="flex items-center gap-1 mt-1">
                  <input autoFocus value={newBossEmail} onChange={e => setNewBossEmail(e.target.value)}
                    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleAddBoss(); if (e.key === 'Escape') { setAddingBoss(false); setNewBossEmail(''); } }}
                    placeholder="boss@company.com" className="flex-1 min-w-0 text-micro px-1.5 py-1 rounded outline-none"
                    style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--brand-plum)', color: 'var(--text-primary)', fontFamily: 'monospace' }} />
                  <button onClick={handleAddBoss} disabled={savingBoss} className="shrink-0 text-micro px-1.5 py-1 rounded" style={{ backgroundColor: 'var(--brand-plum)', color: 'white', opacity: savingBoss ? 0.5 : 1 }}>{savingBoss ? '…' : 'Add'}</button>
                  <button onClick={() => { setAddingBoss(false); setNewBossEmail(''); }} className="shrink-0"><X className="w-3 h-3" style={S} /></button>
                </div>
              ) : (
                <button onClick={() => setAddingBoss(true)} className="flex items-center gap-1 mt-1 text-micro hover:opacity-80" style={{ color: 'var(--plum-accent)' }}>
                  <Plus className="w-3 h-3" /> Add Boss email
                </button>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
