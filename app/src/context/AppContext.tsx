import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';

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
  extracted?: { supplier: string | null; partNumbers: string[] };
  classification?: { step: number; confidence: number };
  supplierName?: string;
}

export type ThemeMode = 'light' | 'dark' | 'midnight';
export type FontSize = 'small' | 'medium' | 'big';
export type AIMode = 'off' | 'suggesting' | 'troubleshoot' | 'boost';
export type Page = 'dashboard' | 'suppliers' | 'analytics' | 'archive' | 'settings';
export type ViewMode = 'kanban' | 'list' | 'timeline' | 'split';

export interface EmailThread {
  id: number;
  rfqId: number;
  supplierName: string;
  subject: string;
  latestDate: string;
  emailCount: number;
  step: number;
  confidence: number;
  risk: 'low' | 'medium' | 'high';
}

export interface ExceptionItem {
  id: number;
  rfqId: number;
  supplierName: string;
  subject: string;
  category: string;
  description: string;
  createdAt: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface AppState {
  theme: ThemeMode;
  fontSize: FontSize;
  page: Page;
  viewMode: ViewMode;
  useRealData: boolean;
  aiMode: AIMode;
  isThunderbirdPanelOpen: boolean;
  isSettingsOpen: boolean;
  syncedFolders: Set<string>;
  syncedFolderPaths: Record<string, string>;
  suppliers: any[];
  selectedSupplierId: number | null;
  rfqs: any[];
  emails: Email[];
  threads: EmailThread[];
  exceptions: ExceptionItem[];
  thunderbirdData: any;
  lastScan: string;
  supplierFilter: string;
  stepFilter: number | null;
  dateFilter: string | null;
  showConflictOnly: boolean;
  showLowConfidence: boolean;
  trainingFilter: string;
  componentStatuses: any[];
  troubleshootChat: any[];
  troubleshootTarget: { level: number; targetId: string } | null;
  hiddenAccounts: Set<string>;
  nlpStats: { pending: number; processing: number; completed: number; failed: number };
}

type Action =
  | { type: 'TOGGLE_DATA_SOURCE' }
  | { type: 'SET_PAGE'; payload: Page }
  | { type: 'TOGGLE_AI_MODE' }
  | { type: 'SET_AI_MODE'; payload: AIMode }
  | { type: 'TOGGLE_THUNDERBIRD_PANEL' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'SET_THEME'; payload: ThemeMode }
  | { type: 'SET_FONT_SIZE'; payload: FontSize }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'SET_SUPPLIER_FILTER'; payload: string }
  | { type: 'SET_STEP_FILTER'; payload: number | null }
  | { type: 'SET_DATE_FILTER'; payload: string | null }
  | { type: 'TOGGLE_CONFLICT_FILTER' }
  | { type: 'TOGGLE_LOW_CONFIDENCE_FILTER' }
  | { type: 'SET_TRAINING_FILTER'; payload: string }
  | { type: 'SELECT_SUPPLIER'; payload: number | null }
  | { type: 'SET_SUPPLIERS'; payload: any[] }
  | { type: 'MARK_RFQ_STEP'; payload: { rfqId: number; step: number } }
  | { type: 'SET_RFQS'; payload: any[] }
  | { type: 'SET_EMAILS'; payload: Email[] }
  | { type: 'SET_THREADS'; payload: EmailThread[] }
  | { type: 'SET_EXCEPTIONS'; payload: ExceptionItem[] }
  | { type: 'SET_LAST_SCAN' }
  | { type: 'SET_COMPONENT_STATUSES'; payload: any[] }
  | { type: 'ADD_TROUBLESHOOT_MESSAGE'; payload: any }
  | { type: 'SET_TROUBLESHOOT_TARGET'; payload: { level: number; targetId: string } | null }
  | { type: 'OPEN_TROUBLESHOOT'; payload: { level: number; targetId: string } }
  | { type: 'TOGGLE_HIDDEN_ACCOUNT'; payload: string }
  | { type: 'UPDATE_NLP_RESULTS'; payload: Record<string, any> }
  | { type: 'SET_NLP_STATS'; payload: { pending: number; processing: number; completed: number; failed: number } }
  | { type: 'SET_THUNDERBIRD_DATA'; payload: any }
  | { type: 'SET_REAL_EMAILS'; payload: Email[] }
  | { type: 'MERGE_REAL_EMAILS'; payload: Email[] }
  | { type: 'TOGGLE_FOLDER_SYNCED'; payload: string }
  | { type: 'SET_SYNCED_FOLDER_PATH'; payload: { syncKey: string; mboxPath: string } };

const initialState: AppState = {
  theme: 'midnight',
  fontSize: 'medium',
  page: 'dashboard',
  viewMode: 'kanban',
  useRealData: false,
  aiMode: 'off',
  isThunderbirdPanelOpen: false,
  isSettingsOpen: false,
  syncedFolders: new Set(),
  syncedFolderPaths: {},
  suppliers: [],
  selectedSupplierId: null,
  rfqs: [],
  emails: [],
  threads: [],
  exceptions: [],
  thunderbirdData: null,
  lastScan: new Date().toISOString(),
  supplierFilter: '',
  stepFilter: null,
  dateFilter: null,
  showConflictOnly: false,
  showLowConfidence: false,
  trainingFilter: '',
  componentStatuses: [],
  troubleshootChat: [],
  troubleshootTarget: null,
  hiddenAccounts: new Set(),
  nlpStats: { pending: 0, processing: 0, completed: 0, failed: 0 },
};

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'TOGGLE_DATA_SOURCE': return { ...state, useRealData: !state.useRealData };
    case 'SET_PAGE': return { ...state, page: action.payload };
    case 'TOGGLE_AI_MODE': return { ...state, aiMode: state.aiMode === 'off' ? 'suggesting' : 'off' };
    case 'SET_AI_MODE': return { ...state, aiMode: action.payload };
    case 'TOGGLE_THUNDERBIRD_PANEL': return { ...state, isThunderbirdPanelOpen: !state.isThunderbirdPanelOpen };
    case 'TOGGLE_SETTINGS': return { ...state, isSettingsOpen: !state.isSettingsOpen };
    case 'SET_THEME': return { ...state, theme: action.payload };
    case 'SET_FONT_SIZE': return { ...state, fontSize: action.payload };
    case 'SET_VIEW_MODE': return { ...state, viewMode: action.payload };
    case 'SET_SUPPLIER_FILTER': return { ...state, supplierFilter: action.payload };
    case 'SET_STEP_FILTER': return { ...state, stepFilter: action.payload };
    case 'SET_DATE_FILTER': return { ...state, dateFilter: action.payload };
    case 'TOGGLE_CONFLICT_FILTER': return { ...state, showConflictOnly: !state.showConflictOnly };
    case 'TOGGLE_LOW_CONFIDENCE_FILTER': return { ...state, showLowConfidence: !state.showLowConfidence };
    case 'SET_TRAINING_FILTER': return { ...state, trainingFilter: action.payload };
    case 'SELECT_SUPPLIER': return { ...state, selectedSupplierId: action.payload };
    case 'SET_SUPPLIERS': return { ...state, suppliers: action.payload };
    case 'SET_RFQS': return { ...state, rfqs: action.payload };
    case 'SET_EMAILS': return { ...state, emails: action.payload };
    case 'SET_THREADS': return { ...state, threads: action.payload };
    case 'SET_EXCEPTIONS': return { ...state, exceptions: action.payload };
    case 'SET_LAST_SCAN': return { ...state, lastScan: new Date().toISOString() };
    case 'SET_COMPONENT_STATUSES': return { ...state, componentStatuses: action.payload };
    case 'ADD_TROUBLESHOOT_MESSAGE': return { ...state, troubleshootChat: [...state.troubleshootChat, action.payload] };
    case 'SET_TROUBLESHOOT_TARGET': return { ...state, troubleshootTarget: action.payload };
    case 'OPEN_TROUBLESHOOT': return { ...state, troubleshootTarget: action.payload };
    case 'TOGGLE_HIDDEN_ACCOUNT': {
      const h = new Set(state.hiddenAccounts);
      if (h.has(action.payload)) h.delete(action.payload);
      else h.add(action.payload);
      return { ...state, hiddenAccounts: h };
    }
    case 'UPDATE_NLP_RESULTS': {
      const results = action.payload;
      const updatedEmails = state.emails.map(e => {
        const result = results[e.messageId];
        if (!result) return e;
        return {
          ...e,
          extracted: { supplier: result.supplier_name || null, partNumbers: result.part_numbers || [] },
          classification: { step: result.step || 0, confidence: result.confidence || 0 },
          stepAssigned: result.step || e.stepAssigned,
        };
      });
      return { ...state, emails: updatedEmails };
    }
    case 'SET_NLP_STATS': return { ...state, nlpStats: action.payload };
    case 'SET_THUNDERBIRD_DATA': return { ...state, thunderbirdData: action.payload };
    case 'SET_REAL_EMAILS': return { ...state, emails: action.payload, useRealData: true };
    case 'MERGE_REAL_EMAILS': {
      const existingIds = new Set(state.emails.map(e => e.messageId));
      const newEmails = action.payload.filter((e: Email) => !existingIds.has(e.messageId));
      return { ...state, emails: [...state.emails, ...newEmails], useRealData: true };
    }
    case 'TOGGLE_FOLDER_SYNCED': {
      const n = new Set(state.syncedFolders);
      const paths = { ...state.syncedFolderPaths };
      if (n.has(action.payload)) {
        n.delete(action.payload);
        delete paths[action.payload];
      } else {
        n.add(action.payload);
      }
      return { ...state, syncedFolders: n, syncedFolderPaths: paths };
    }
    case 'SET_SYNCED_FOLDER_PATH': {
      return { ...state, syncedFolderPaths: { ...state.syncedFolderPaths, [action.payload.syncKey]: action.payload.mboxPath } };
    }
    default: return state;
  }
}

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
      };
    }
  } catch { /* ignore */ }
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
    }));
  } catch { /* ignore */ }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  getFilteredEmails: () => Email[];
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState, (init) => ({ ...init, ...getSavedSettings() }));

  useEffect(() => { saveSettings(state); }, [state.theme, state.fontSize, state.syncedFolders, state.syncedFolderPaths, state.hiddenAccounts]);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;

    if (api.nlp) {
      api.nlp.onResults((results: any) => { dispatch({ type: 'UPDATE_NLP_RESULTS', payload: results }); });
      api.nlp.onStats((stats: any) => { dispatch({ type: 'SET_NLP_STATS', payload: stats }); });
    }

    if (api.thunderbird?.onAutoSync) {
      api.thunderbird.onAutoSync((data: any) => {
        if (data.profiles) { dispatch({ type: 'SET_THUNDERBIRD_DATA', payload: { profiles: data.profiles } }); }
        if (data.missingFolders && data.missingFolders.length > 0) {
          for (const syncKey of data.missingFolders) { dispatch({ type: 'TOGGLE_FOLDER_SYNCED', payload: syncKey }); }
        }
      });
    }

    if (api.thunderbird?.onFolderUpdate) {
      api.thunderbird.onFolderUpdate((data: any) => {
        if (data.emails && data.emails.length > 0) { dispatch({ type: 'MERGE_REAL_EMAILS', payload: data.emails }); }
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

  const getFilteredEmails = () => {
    let emails = state.emails;
    if (state.selectedSupplierId !== null) {
      emails = emails.filter(e => e.supplierId === state.selectedSupplierId);
    }
    return emails;
  };

  return (
    <AppContext.Provider value={{ state, dispatch, getFilteredEmails }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}