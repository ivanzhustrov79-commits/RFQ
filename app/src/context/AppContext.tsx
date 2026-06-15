import { createContext, useContext, useReducer, useEffect, useRef, useState, type ReactNode } from 'react';

export interface Email {
  id: number;
  rfqId: number;
  supplierId: number;
  messageId: string;
  subject: string;
  senderEmail: string;
  senderName: string;
  sentAt: string;
  stepAssigned: number;
  isInternal: boolean;
  isSentByUser: boolean;
  threadConfidence: number;
  hasConflict: boolean;
  baseSuggestedStep: number | null;
  smartConfirmedStep: number | null;
  isLowConfidence: boolean;
  isProvisional: boolean;
  body?: string;
  extracted?: {
    supplier: string | null;
    partNumbers: string[];
  };
  classification?: {
    step: number;
    confidence: number;
  };
  supplierName?: string;
}

export interface Supplier { id: string; name: string; logo: string; country: string; rating: number; kpi: any; }
export interface Rfq {
  id: string;
  threadId?: number;
  supplierId: number;
  rfqName: string;
  rfqNameSource: 'auto' | 'ai' | 'manual';
  ciNumber: string | null;
  status: 'Open' | 'Pending' | 'Approved' | 'Closed';
  currentStep: number;
  alarmCount: number;
  emailCount: number;
  enrichedCount: number;
  timestamp: string;
  partNumbers: string[];
}

// ── NEW: persisted RFQ name override map ──────────────────────────────────────
// Key: `supplier-${supplierId}`  Value: { name, source }
export interface RfqNameEntry {
  name: string;
  source: 'ai' | 'manual';
}

function statusFromStep(step: number): 'Open' | 'Pending' | 'Approved' | 'Closed' {
  if (step <= 1) return 'Open';
  if (step <= 4) return 'Pending';
  if (step >= 5) return 'Approved';
  return 'Open';
}

export interface Alarm { id: string; rfqId: string; type: string; message: string; timestamp: string; dismissed: boolean; }
export interface Exception { id: string; type: string; message: string; timestamp: string; resolved: boolean; }
export interface ChatMessage { id: string; role: string; text: string; timestamp: string; }

interface AppState {
  theme: 'dark' | 'light';
  fontSize: 'small' | 'medium' | 'big';
  useRealData: boolean;
  emails: Email[];
  thunderbirdData: any;
  isThunderbirdPanelOpen: boolean;
  isAlarmBoardOpen: boolean;
  isExceptionQueueOpen: boolean;
  isTroubleshootOpen: boolean;
  isSettingsOpen: boolean;
  syncedFolders: Set<string>;
  syncedFolderPaths: Record<string, string>;
  supplierSyncEnabled: Record<number, boolean>;
  syncFromDate: string | null;
  skippedAccounts: string[];
  selectedSupplierId: number | null;
  suppliers: any[];
  rfqs: Rfq[];
  selectedRfqId: string | null;
  alarms: Alarm[];
  exceptions: Exception[];
  troubleshootChat: ChatMessage[];
  aiMode: 'off' | 'auto' | 'full';
  componentStatuses: any[];
  troubleshootTarget: { level: number; targetId: string } | null;
  hiddenAccounts: Set<string>;
  nlpStats: { pending: number; processing: number; completed: number; failed: number };
  // ── NEW ──
  rfqNames: Record<string, RfqNameEntry>; // keyed by `supplier-${supplierId}`
}

type Action =
  | { type: 'SET_THEME'; payload: 'dark' | 'light' }
  | { type: 'SET_FONT_SIZE'; payload: 'small' | 'medium' | 'big' }
  | { type: 'TOGGLE_DATA_SOURCE' }
  | { type: 'SET_REAL_EMAILS'; payload: Email[] }
  | { type: 'MERGE_REAL_EMAILS'; payload: Email[] }
  | { type: 'SET_THUNDERBIRD_DATA'; payload: any }
  | { type: 'TOGGLE_THUNDERBIRD_PANEL' }
  | { type: 'TOGGLE_ALARM_BOARD' }
  | { type: 'TOGGLE_EXCEPTION_QUEUE' }
  | { type: 'TOGGLE_TROUBLESHOOT' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'TOGGLE_FOLDER_SYNCED'; payload: string }
  | { type: 'SET_SYNCED_FOLDER_PATH'; payload: { syncKey: string; mboxPath: string } }
  | { type: 'SET_SUPPLIER_SYNC'; payload: { supplierId: number; enabled: boolean } }
  | { type: 'SET_SYNC_FROM_DATE'; payload: string | null }
  | { type: 'SET_SKIPPED_ACCOUNTS'; payload: string[] }
  | { type: 'SELECT_SUPPLIER'; payload: number | null }
  | { type: 'SET_SUPPLIERS'; payload: any[] }
  | { type: 'SELECT_RFQ'; payload: string | null }
  | { type: 'DISMISS_ALARM'; payload: string }
  | { type: 'RESOLVE_EXCEPTION'; payload: string }
  | { type: 'ADD_CHAT_MESSAGE'; payload: ChatMessage }
  | { type: 'SET_AI_MODE'; payload: 'off' | 'auto' | 'full' }
  | { type: 'OPEN_TROUBLESHOOT'; payload: { level: number; targetId: string } }
  | { type: 'TOGGLE_HIDDEN_ACCOUNT'; payload: string }
  | { type: 'UPDATE_NLP_RESULTS'; payload: Record<string, { supplier_name: string | null; part_numbers: string[]; step: number; confidence: number }> }
  | { type: 'SET_NLP_STATS'; payload: { pending: number; processing: number; completed: number; failed: number } }
  | { type: 'APPLY_SUPPLIER_MAP'; payload: Record<string, { supplier_id: number; step_assigned: number }> }
  // ── NEW ──
  | { type: 'SET_RFQ_NAME'; payload: { supplierId: number; name: string; source: 'ai' | 'manual' } }
  | { type: 'OVERRIDE_EMAIL_STEP'; payload: { messageId: string; newStep: number } };

const initialState: AppState = {
  theme: 'dark', fontSize: 'medium', useRealData: false,
  emails: [], thunderbirdData: null,
  isThunderbirdPanelOpen: false, isAlarmBoardOpen: false,
  isExceptionQueueOpen: false, isTroubleshootOpen: false,
  isSettingsOpen: false, syncedFolders: new Set(), syncedFolderPaths: {},
  supplierSyncEnabled: {}, syncFromDate: null, skippedAccounts: [
    'eivanova@europa-parts.kz', 'eivanova@import-detal36.ru', 'eivanova@agro-pro2014.ru',
    'izhustrov@agro-pro2014.ru', 'logistic@import-detal36.ru', 'logistic@field-pro.ae',
    'yandex.com', 'pop3.field-pro.ae',
  ], suppliers: [],
  selectedSupplierId: null, rfqs: [], threads: [],
  selectedRfqId: null, selectedThreadId: null, alarms: [], exceptions: [],
  troubleshootChat: [], aiMode: 'off', componentStatuses: [], troubleshootTarget: null, hiddenAccounts: new Set(),
  nlpStats: { pending: 0, processing: 0, completed: 0, failed: 0 },
  rfqNames: {},
};

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_THEME': return { ...state, theme: action.payload };
    case 'SET_FONT_SIZE': return { ...state, fontSize: action.payload };
    case 'TOGGLE_DATA_SOURCE': return { ...state, useRealData: !state.useRealData };
    case 'SET_REAL_EMAILS': return { ...state, emails: action.payload, useRealData: true };
    case 'MERGE_REAL_EMAILS': {
      const existingMap = new Map(state.emails.map(e => [e.messageId, e]));
      const merged = [...state.emails];
      for (const incoming of action.payload) {
        const existing = existingMap.get(incoming.messageId);
        if (!existing) {
          merged.push(incoming);
        } else if (incoming.supplierId && !existing.supplierId) {
          // Update supplierId on existing email if incoming has it
          const idx = merged.findIndex(e => e.messageId === incoming.messageId);
          if (idx >= 0) merged[idx] = { ...existing, supplierId: incoming.supplierId };
        }
      }
      return { ...state, emails: merged, useRealData: true };
    }
    case 'SET_THUNDERBIRD_DATA': return { ...state, thunderbirdData: action.payload };
    case 'TOGGLE_THUNDERBIRD_PANEL': return { ...state, isThunderbirdPanelOpen: !state.isThunderbirdPanelOpen };
    case 'TOGGLE_ALARM_BOARD': return { ...state, isAlarmBoardOpen: !state.isAlarmBoardOpen };
    case 'TOGGLE_EXCEPTION_QUEUE': return { ...state, isExceptionQueueOpen: !state.isExceptionQueueOpen };
    case 'TOGGLE_TROUBLESHOOT': return { ...state, isTroubleshootOpen: !state.isTroubleshootOpen };
    case 'TOGGLE_SETTINGS': return { ...state, isSettingsOpen: !state.isSettingsOpen };
    case 'TOGGLE_FOLDER_SYNCED': {
      const n = new Set(state.syncedFolders);
      const paths = { ...state.syncedFolderPaths };
      if (n.has(action.payload)) { n.delete(action.payload); delete paths[action.payload]; }
      else { n.add(action.payload); }
      return { ...state, syncedFolders: n, syncedFolderPaths: paths };
    }
    case 'SET_SYNCED_FOLDER_PATH':
      return { ...state, syncedFolderPaths: { ...state.syncedFolderPaths, [action.payload.syncKey]: action.payload.mboxPath } };
    case 'SET_SUPPLIER_SYNC':
      return { ...state, supplierSyncEnabled: { ...state.supplierSyncEnabled, [action.payload.supplierId]: action.payload.enabled } };
    case 'SET_SYNC_FROM_DATE':
      return { ...state, syncFromDate: action.payload };
    case 'SET_SKIPPED_ACCOUNTS':
      return { ...state, skippedAccounts: action.payload };
    case 'SELECT_SUPPLIER': return { ...state, selectedSupplierId: action.payload };
    case 'SELECT_RFQ': return { ...state, selectedRfqId: action.payload };
    case 'SET_THREADS': return { ...state, threads: action.payload };
    case 'SELECT_THREAD': return { ...state, selectedThreadId: action.payload };
    case 'DISMISS_ALARM': return { ...state, alarms: state.alarms.map(a => a.id === action.payload ? { ...a, dismissed: true } : a) };
    case 'RESOLVE_EXCEPTION': return { ...state, exceptions: state.exceptions.map(e => e.id === action.payload ? { ...e, resolved: true } : e) };
    case 'ADD_CHAT_MESSAGE': return { ...state, troubleshootChat: [...state.troubleshootChat, action.payload] };
    case 'SET_AI_MODE': return { ...state, aiMode: action.payload };
    case 'OPEN_TROUBLESHOOT': return { ...state, isTroubleshootOpen: true, troubleshootTarget: action.payload };
    case 'TOGGLE_HIDDEN_ACCOUNT': {
      const h = new Set(state.hiddenAccounts);
      if (h.has(action.payload)) h.delete(action.payload); else h.add(action.payload);
      return { ...state, hiddenAccounts: h };
    }
    case 'UPDATE_NLP_RESULTS': {
      const results = action.payload;
      const updatedEmails = state.emails.map(e => {
        const result = results[e.messageId];
        if (!result) return e;
        return {
          ...e,
          supplierId: result.supplier_id ?? e.supplierId,
          extracted: {
            supplier: result.supplier_name || null,
            partNumbers: result.part_numbers || [],
          },
          classification: {
            step: result.step ?? 0,
            confidence: result.confidence || 0,
          },
          stepAssigned: result.step != null ? result.step : e.stepAssigned,
        };
      });
      return { ...state, emails: updatedEmails };
    }
    case 'SET_NLP_STATS': return { ...state, nlpStats: action.payload };
    case 'APPLY_SUPPLIER_MAP': {
      const map = action.payload;
      const updatedEmails = state.emails.map(e => {
        const entry = map[e.messageId];
        if (!entry) return e;
        return {
          ...e,
          supplierId: entry.supplier_id,
          stepAssigned: entry.step_assigned ?? e.stepAssigned,
        };
      });
      return { ...state, emails: updatedEmails };
    }
    case 'SET_SUPPLIERS': return { ...state, suppliers: action.payload };
    // ── NEW ──
    case 'SET_RFQ_NAME': {
      const key = `supplier-${action.payload.supplierId}`;
      return {
        ...state,
        rfqNames: {
          ...state.rfqNames,
          [key]: { name: action.payload.name, source: action.payload.source },
        },
      };
    }
    case 'OVERRIDE_EMAIL_STEP': {
      const { messageId, newStep } = action.payload;
      return {
        ...state,
        emails: state.emails.map(e =>
          e.messageId === messageId
            ? { ...e, stepAssigned: newStep, isLowConfidence: false, hasConflict: false }
            : e
        ),
      };
    }
    default: return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  getFilteredEmails: () => Email[];
  getSupplierKpis: (id: string) => any;
  getFilteredRfqs: () => Rfq[];
  getSelectedRfqParts: () => any[];
  getSelectedRfqAlarms: () => Alarm[];
}

const AppContext = createContext<AppContextType | null>(null);

function getSavedSettings(): Partial<AppState> {
  try {
    const s = localStorage.getItem('rfq-settings');
    if (s) {
      const p = JSON.parse(s);
      return {
        theme: p.theme || 'dark',
        fontSize: p.fontSize || 'medium',
        syncedFolders: new Set(p.syncedFolders || []),
        syncedFolderPaths: p.syncedFolderPaths || {},
        hiddenAccounts: new Set(p.hiddenAccounts || []),
        rfqNames: p.rfqNames || {},
        supplierSyncEnabled: p.supplierSyncEnabled || {},
        syncFromDate: p.syncFromDate || null,
        skippedAccounts: p.skippedAccounts || [],
      };
    }
  } catch (e) {}
  return {};
}

function saveSettings(state: AppState) {
  try {
    localStorage.setItem('rfq-settings', JSON.stringify({
      theme: state.theme,
      fontSize: state.fontSize,
      syncedFolders: Array.from(state.syncedFolders),
      syncedFolderPaths: state.syncedFolderPaths,
      hiddenAccounts: Array.from(state.hiddenAccounts),
      rfqNames: state.rfqNames,
      supplierSyncEnabled: state.supplierSyncEnabled,
      syncFromDate: state.syncFromDate,
      skippedAccounts: state.skippedAccounts,   // ← persist AI/manual names across sessions
    }));
  } catch (e) {}
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState, (init) => ({ ...init, ...getSavedSettings() }));

  // Track which supplier IDs we've already requested a name for (avoids duplicate calls)
  const nameRequestedRef = useRef<Set<number>>(new Set());
  const folderBufferRef = useRef<Record<string, any[]>>({});

  useEffect(() => {
    saveSettings(state);
  }, [state.theme, state.fontSize, state.syncedFolders, state.syncedFolderPaths,
      state.hiddenAccounts, state.rfqNames, state.supplierSyncEnabled,
      state.syncFromDate, state.skippedAccounts]);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.thunderbird?.setSkippedAccounts) {
      api.thunderbird.setSkippedAccounts(state.skippedAccounts);
    }
  }, [state.skippedAccounts]);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.thunderbird?.setSyncFromDate) {
      api.thunderbird.setSyncFromDate(state.syncFromDate);
    }
  }, [state.syncFromDate]);

  // ── NEW: Trigger AI name generation when first sent email per supplier arrives ──
  useEffect(() => {
    if (state.emails.length === 0) return;

    // Find all sent emails, grouped by supplierId
    const sentBySupplier = new Map<number, Email>();
    for (const email of state.emails) {
      if (!email.isSentByUser) continue;
      const sid = email.supplierId || 0;
      if (sid === 0) continue;
      // Keep earliest sent email (most likely the original RFQ outreach)
      const existing = sentBySupplier.get(sid);
      if (!existing || email.sentAt < existing.sentAt) {
        sentBySupplier.set(sid, email);
      }
    }

    for (const [supplierId, sentEmail] of sentBySupplier) {
      const key = `supplier-${supplierId}`;

      // Skip if we already have an AI or manual name for this supplier
      if (state.rfqNames[key]) continue;

      // Skip if we already fired a request this session
      if (nameRequestedRef.current.has(supplierId)) continue;
      nameRequestedRef.current.add(supplierId);

      // Find supplier display name
      const supplier = state.suppliers.find((s: any) => s.id === supplierId);
      const supplierName = supplier?.name || sentEmail.supplierName || `Supplier #${supplierId}`;

      // Fire and forget — result dispatched when it arrives
      (async () => {
        try {
          const res = await fetch('http://127.0.0.1:8721/rfq/generate-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              supplier_name: supplierName,
              subject: sentEmail.subject || '',
              body_text: sentEmail.body || '',
              supplier_id: supplierId,
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const result = await res.json();

          if (result?.rfq_name) {
            dispatch({
              type: 'SET_RFQ_NAME',
              payload: { supplierId, name: result.rfq_name, source: result.source === 'ai' ? 'ai' : 'ai' },
            });
          }
        } catch (err) {
          console.warn(`[RFQ-NAME] Failed to generate name for supplier ${supplierId}:`, err);
        }
      })();
    }
  }, [state.emails, state.suppliers]);
  // Note: intentionally excludes state.rfqNames from deps to avoid re-running after we set names

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;

    if (api.nlp) {
      api.nlp.onResults((results: any) => { dispatch({ type: 'UPDATE_NLP_RESULTS', payload: results }); });
      api.nlp.onStats((stats: any) => { dispatch({ type: 'SET_NLP_STATS', payload: stats }); });
    }

    if (api.thunderbird?.onAutoSync) {
      api.thunderbird.onAutoSync((data: any) => {
        if (data.profiles) dispatch({ type: 'SET_THUNDERBIRD_DATA', payload: { profiles: data.profiles } });
        if (data.missingFolders?.length > 0) {
          for (const syncKey of data.missingFolders) dispatch({ type: 'TOGGLE_FOLDER_SYNCED', payload: syncKey });
        }
      });
    }

    if (api.thunderbird?.onFolderUpdate) {
      api.thunderbird.onFolderUpdate((data: any) => {
        if (data.emails?.length > 0) {
          const syncKey = data.syncKey || 'unknown';
          folderBufferRef.current[syncKey] = data.emails;
          const allEmails = Object.values(folderBufferRef.current).flat();
          dispatch({ type: 'SET_REAL_EMAILS', payload: allEmails });
        }
      });
    }

    const fetchSuppliers = async () => {
      if (api.suppliers?.list) {
        try {
          const result = await api.suppliers.list();
          if (result.suppliers) dispatch({ type: 'SET_SUPPLIERS', payload: result.suppliers });
        } catch (e) {}
      }
    };
    fetchSuppliers();
    const si = setInterval(fetchSuppliers, 30000);
    return () => { clearInterval(si); };
  }, []);

  // supplier map fetch removed - supplierId now set directly from folder name in main.js

  // Fetch thread email IDs when thread selected
  const [threadMessageIds, setThreadMessageIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!state.selectedThreadId) {
      setThreadMessageIds(new Set());
      return;
    }
    fetch(`http://127.0.0.1:8721/db/thread/${state.selectedThreadId}`)
      .then(r => r.json())
      .then(d => {
        const ids = new Set<string>((d.emails || []).map((e: any) => e.message_id));
        setThreadMessageIds(ids);
      })
      .catch(() => setThreadMessageIds(new Set()));
  }, [state.selectedThreadId]);

  const getFilteredEmails = () => {
    let emails = state.emails;
    if (state.selectedSupplierId !== null) {
      const selectedId = Number(state.selectedSupplierId);
      emails = emails.filter(e => Number(e.supplierId) === selectedId);
    }
    // Deduplicate by messageId
    const seen = new Set<string>();
    emails = emails.filter(e => {
      if (seen.has(e.messageId)) return false;
      seen.add(e.messageId);
      return true;
    });
    // Filter by thread using DB message IDs
    if (state.selectedThreadId && threadMessageIds.size > 0) {
      emails = emails.filter(e => threadMessageIds.has(e.messageId));
    }
    return emails;
  };

  const getSupplierKpis = (_id: string) => ({});

  // Fetch threads from DB when supplier changes
  useEffect(() => {
    if (!state.selectedSupplierId) {
      dispatch({ type: 'SET_THREADS', payload: [] });
      return;
    }
    fetch(`http://127.0.0.1:8721/db/supplier/${state.selectedSupplierId}/threads`)
      .then(r => r.json())
      .then(d => dispatch({ type: 'SET_THREADS', payload: d.threads || [] }))
      .catch(() => dispatch({ type: 'SET_THREADS', payload: [] }));
  }, [state.selectedSupplierId]);

  const getFilteredRfqs = (): Rfq[] => {
    // Use DB threads if available
    if (state.threads.length > 0) {
      const supplier = state.suppliers.find((s: any) => s.id === state.selectedSupplierId);
      const supplierName = supplier?.name || '';

      return state.threads.map((t: any) => {
        const storedName = state.rfqNames[`thread-${t.id}`];
        const rfqName = storedName?.name || t.subject_prefix;
        const rfqNameSource = storedName?.source || 'auto';
        const maxStep = t.latest_step ?? 0;

        return {
          id: `thread-${t.id}`,
          threadId: t.id,
          supplierId: t.supplier_id,
          rfqName,
          rfqNameSource,
          ciNumber: null,
          status: statusFromStep(maxStep),
          currentStep: maxStep,
          alarmCount: 0,
          emailCount: t.email_count,
          enrichedCount: t.enriched_count || 0,
          timestamp: t.last_email_at || '',
          partNumbers: [],
        };
      });
    }

    // Fallback: one RFQ per supplier (old behavior, shown before threads load)
    if (state.emails.length === 0) return [];
    const bySupplier = new Map<number, Email[]>();
    for (const e of state.emails) {
      const sid = e.supplierId || 0;
      if (!bySupplier.has(sid)) bySupplier.set(sid, []);
      bySupplier.get(sid)!.push(e);
    }
    const rfqs: Rfq[] = [];
    for (const [supplierId, emails] of bySupplier) {
      if (supplierId === 0) continue;
      if (state.selectedSupplierId !== null && supplierId !== state.selectedSupplierId) continue;
      const rfqKey = `supplier-${supplierId}`;
      const storedName = state.rfqNames[rfqKey];
      const supplier = state.suppliers.find((s: any) => s.id === supplierId);
      const supplierName = supplier?.name || `Supplier #${supplierId}`;
      const maxStep = Math.max(...emails.map(e => e.stepAssigned || 0));
      const latestDate = emails.reduce((latest, e) => (e.sentAt || '') > latest ? (e.sentAt || '') : latest, '');
      const enrichedCount = emails.filter(e => e.classification && e.classification.confidence > 0).length;
      const partSet = new Set<string>();
      for (const e of emails) if (e.extracted?.partNumbers) for (const p of e.extracted.partNumbers) partSet.add(p);
      let rfqName: string;
      let rfqNameSource: 'auto' | 'ai' | 'manual';
      if (storedName) { rfqName = storedName.name; rfqNameSource = storedName.source; }
      else if (partSet.size > 0) { rfqName = `${supplierName} — ${Array.from(partSet).slice(0, 2).join(', ')}`; rfqNameSource = 'auto'; }
      else { rfqName = supplierName; rfqNameSource = 'auto'; }
      rfqs.push({ id: rfqKey, supplierId, rfqName, rfqNameSource, ciNumber: null, status: statusFromStep(maxStep), currentStep: maxStep, alarmCount: 0, emailCount: emails.length, enrichedCount, timestamp: latestDate, partNumbers: Array.from(partSet) });
    }
    rfqs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return rfqs;
  };

  const getSelectedRfqParts = () => [];
  const getSelectedRfqAlarms = () => state.alarms;

  return (
    <AppContext.Provider value={{ state, dispatch, getFilteredEmails, getSupplierKpis, getFilteredRfqs, getSelectedRfqParts, getSelectedRfqAlarms }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
