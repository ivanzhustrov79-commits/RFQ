import { createContext, useContext, useReducer, useEffect, useMemo, type ReactNode } from 'react';

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
  extracted?: { supplier: string | null; partNumbers: string[]; };
  classification?: { step: number; confidence: number; };
}

// Fixed interfaces to match SQLite backend (IDs are numbers)
export interface Supplier { 
  id: number; 
  name: string; 
  email_domain?: string;
  contact_email?: string;
  default_currency?: string;
  email_count?: number;
  openRfqCount?: number;
  // legacy fields
  logo?: string; country?: string; rating?: number; kpi?: any;
}

export interface Rfq { 
  id: string; 
  supplierId: number; 
  supplierName: string;
  rfqName: string;
  rfqNameSource: 'auto' | 'manual';
  ciNumber: string | null;
  status: 'Open' | 'Pending' | 'Approved' | 'Closed';
  currentStep: number;
  emailCount: number;
  alarmCount: number;
  parts: any[];
  // legacy
  partNumber?: string; description?: string; timestamp?: string; qty?: number;
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
  
  // Fixed types: number instead of string
  suppliers: Supplier[];
  selectedSupplierId: number | null;
  rfqs: Rfq[];
  selectedRfqId: string | null;
  
  alarms: Alarm[];
  exceptions: Exception[];
  troubleshootChat: ChatMessage[];
  aiMode: 'off' | 'auto' | 'full';
  componentStatuses: any[];
  troubleshootTarget: { level: number; targetId: string } | null;
  hiddenAccounts: Set<string>;
}

type Action =
  | { type: 'SET_THEME'; payload: 'dark' | 'light' }
  | { type: 'SET_FONT_SIZE'; payload: 'small' | 'medium' | 'big' }
  | { type: 'TOGGLE_DATA_SOURCE' }
  | { type: 'SET_REAL_EMAILS'; payload: Email[] }
  | { type: 'SET_THUNDERBIRD_DATA'; payload: any }
  | { type: 'TOGGLE_THUNDERBIRD_PANEL' }
  | { type: 'TOGGLE_ALARM_BOARD' }
  | { type: 'TOGGLE_EXCEPTION_QUEUE' }
  | { type: 'TOGGLE_TROUBLESHOOT' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'TOGGLE_FOLDER_SYNCED'; payload: string }
  | { type: 'SELECT_SUPPLIER'; payload: number | null } // Fixed type
  | { type: 'SELECT_RFQ'; payload: string | null }
  | { type: 'DISMISS_ALARM'; payload: string }
  | { type: 'RESOLVE_EXCEPTION'; payload: string }
  | { type: 'ADD_CHAT_MESSAGE'; payload: ChatMessage }
  | { type: 'SET_AI_MODE'; payload: 'off' | 'auto' | 'full' }
  | { type: 'OPEN_TROUBLESHOOT'; payload: { level: number; targetId: string } }
  | { type: 'TOGGLE_HIDDEN_ACCOUNT'; payload: string }
  | { type: 'UPDATE_EMAIL_STEP'; payload: { emailId: number; newStep: number } }
  | { type: 'SET_SUPPLIERS'; payload: Supplier[] }; // New action

const initialState: AppState = {
  theme: 'dark', fontSize: 'medium', useRealData: false,
  emails: [], thunderbirdData: null,
  isThunderbirdPanelOpen: false, isAlarmBoardOpen: false,
  isExceptionQueueOpen: false, isTroubleshootOpen: false,
  isSettingsOpen: false, syncedFolders: new Set(),
  suppliers: [], selectedSupplierId: null, rfqs: [],
  selectedRfqId: null, alarms: [], exceptions: [],
  troubleshootChat: [], aiMode: 'off', componentStatuses: [], troubleshootTarget: null, hiddenAccounts: new Set(),
};

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_THEME': return { ...state, theme: action.payload };
    case 'SET_FONT_SIZE': return { ...state, fontSize: action.payload };
    case 'TOGGLE_DATA_SOURCE': return { ...state, useRealData: !state.useRealData };
    case 'SET_REAL_EMAILS': return { ...state, emails: action.payload, useRealData: true };
    case 'SET_THUNDERBIRD_DATA': return { ...state, thunderbirdData: action.payload };
    case 'TOGGLE_THUNDERBIRD_PANEL': return { ...state, isThunderbirdPanelOpen: !state.isThunderbirdPanelOpen };
    case 'TOGGLE_ALARM_BOARD': return { ...state, isAlarmBoardOpen: !state.isAlarmBoardOpen };
    case 'TOGGLE_EXCEPTION_QUEUE': return { ...state, isExceptionQueueOpen: !state.isExceptionQueueOpen };
    case 'TOGGLE_TROUBLESHOOT': return { ...state, isTroubleshootOpen: !state.isTroubleshootOpen };
    case 'TOGGLE_SETTINGS': return { ...state, isSettingsOpen: !state.isSettingsOpen };
    case 'TOGGLE_FOLDER_SYNCED': { const n = new Set(state.syncedFolders); if (n.has(action.payload)) n.delete(action.payload); else n.add(action.payload); return { ...state, syncedFolders: n }; }
    case 'SELECT_SUPPLIER': return { ...state, selectedSupplierId: action.payload };
    case 'SELECT_RFQ': return { ...state, selectedRfqId: action.payload };
    case 'DISMISS_ALARM': return { ...state, alarms: state.alarms.map(a => a.id === action.payload ? { ...a, dismissed: true } : a) };
    case 'RESOLVE_EXCEPTION': return { ...state, exceptions: state.exceptions.map(e => e.id === action.payload ? { ...e, resolved: true } : e) };
    case 'ADD_CHAT_MESSAGE': return { ...state, troubleshootChat: [...state.troubleshootChat, action.payload] };
    case 'SET_AI_MODE': return { ...state, aiMode: action.payload };
    case 'OPEN_TROUBLESHOOT': return { ...state, isTroubleshootOpen: true, troubleshootTarget: action.payload };
    case 'TOGGLE_HIDDEN_ACCOUNT': { const h = new Set(state.hiddenAccounts); if (h.has(action.payload)) h.delete(action.payload); else h.add(action.payload); return { ...state, hiddenAccounts: h }; }
    case 'SET_SUPPLIERS': return { ...state, suppliers: action.payload }; // New reducer case
    case 'UPDATE_EMAIL_STEP': {
      const updatedEmails = state.emails.map(e => 
        e.id === action.payload.emailId ? { ...e, stepAssigned: action.payload.newStep } : e
      );
      return { ...state, emails: updatedEmails };
    }    
    default: return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  getFilteredEmails: () => Email[];
  getSupplierKpis: (id: number) => any;
  getFilteredRfqs: () => Rfq[];
  getSelectedRfqParts: () => any[];
  getSelectedRfqAlarms: () => Alarm[];
}

const AppContext = createContext<AppContextType | null>(null);

function getSavedSettings(): Partial<AppState> {
  try {
    const s = localStorage.getItem('rfq-settings');
    if (s) { const p = JSON.parse(s); return { theme: p.theme || 'dark', fontSize: p.fontSize || 'medium', syncedFolders: new Set(p.syncedFolders || []), hiddenAccounts: new Set(p.hiddenAccounts || []) }; }
  } catch (e) {}
  return {};
}

function saveSettings(state: AppState) {
  try { localStorage.setItem('rfq-settings', JSON.stringify({ theme: state.theme, fontSize: state.fontSize, syncedFolders: Array.from(state.syncedFolders), hiddenAccounts: Array.from(state.hiddenAccounts) })); } catch (e) {}
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState, (init) => ({ ...init, ...getSavedSettings() }));

  useEffect(() => { saveSettings(state); }, [state.theme, state.fontSize, state.syncedFolders, state.hiddenAccounts]);

  // ── NEW: Fetch suppliers from Python backend on startup ──
  useEffect(() => {
    fetch('http://127.0.0.1:8721/db/suppliers')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.suppliers) {
          dispatch({ type: 'SET_SUPPLIERS', payload: data.suppliers });
        }
      })
      .catch(err => console.error('[AppContext] Failed to fetch suppliers:', err));
  }, []);

  // ── FIXED: Memoized RFQ derivation from emails ──
  const getFilteredEmails = () => state.emails;
  
  // ── FIXED: Actually compute KPIs from derived RFQs ──
  const getSupplierKpis = (id: number) => {
    const rfqs = filteredRfqs.filter(r => r.supplierId === id);
    const openRfqs = rfqs.filter(r => r.status === 'Open' || r.status === 'Pending').length;
    return {
      openRfqs,
      avgResponseDays: 0, 
      quoteSuccessRate: 0, 
      pendingAlarms: rfqs.reduce((sum, r) => sum + r.alarmCount, 0),
      lastActivity: 'N/A', 
    };
  };

  const getFilteredRfqs = () => filteredRfqs;
  const getSelectedRfqParts = () => [];
  const getSelectedRfqAlarms = () => state.alarms;

  return (
    <AppContext.Provider value={{ state, dispatch, getFilteredEmails, getSupplierKpis, getFilteredRfqs, getSelectedRfqParts, getSelectedRfqAlarms }}>
      {children}
    </AppContext.Provider>
  );
} // <--- THIS BRACE CLOSES AppProvider

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
} 