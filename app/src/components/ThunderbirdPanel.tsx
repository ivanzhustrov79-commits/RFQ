// @ts-nocheck
import { useApp } from '@/context/AppContext';
import { useState, useEffect } from 'react';
import { X, Mail, RefreshCw, AlertCircle, FolderOpen, ChevronDown, ChevronRight, Inbox, Check, Eye, EyeOff } from 'lucide-react';

interface MboxFile {
  name: string;
  path: string;
  size: number;
  emailCount: number;
}

interface FolderNode {
  name: string;
  path: string;
  grey: boolean;
  children: FolderNode[];
  mboxes: MboxFile[];
  mboxCount: number;
}

interface AccountTree {
  name: string;
  type: string;
  children: FolderNode[];
  totalEmails: number;
}

interface ProfileData {
  name: string;
  path: string;
  trees: AccountTree[];
  totalEmails: number;
}

export function ThunderbirdPanel() {
  const { state, dispatch } = useApp();
  const [scanning, setScanning] = useState(!state.thunderbirdData);
  const [error, setError] = useState<string | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [loadingMbox, setLoadingMbox] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  // ── Send synced folder paths to main process for health checks ──
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.thunderbird?.setSyncedPaths) {
      api.thunderbird.setSyncedPaths(state.syncedFolderPaths);
    }
  }, [state.syncedFolderPaths, state.syncedFolders]);

  // ── Listen for auto-sync events from main process ──
  // Sync errors only - auto-sync and folder updates handled in AppContext
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.thunderbird?.onSyncError) return;
    api.thunderbird.onSyncError((err: string) => {
      setScanning(false);
      setError(err);
    });
  }, []);

  const handleClose = () => { dispatch({ type: 'TOGGLE_THUNDERBIRD_PANEL' }); };
  const handleHideAccount = (accountName: string) => { dispatch({ type: 'TOGGLE_HIDDEN_ACCOUNT', payload: accountName }); };

  const handleReadMbox = async (mboxPath: string, syncKey: string) => {
    setLoadingMbox(mboxPath);
    setError(null);
    try {
      const folderName = mboxPath.split(/[\\/]/).pop()?.replace(/\.sbd$/i, '') || '';
      const result = await window.electronAPI.thunderbird.readMbox(mboxPath, 10000, folderName);
      if (result.success && result.emails) {
        dispatch({ type: 'SET_REAL_EMAILS', payload: result.emails });
        dispatch({ type: 'TOGGLE_FOLDER_SYNCED', payload: syncKey });
        dispatch({ type: 'SET_SYNCED_FOLDER_PATH', payload: { syncKey, mboxPath } });
        if (!state.useRealData) dispatch({ type: 'TOGGLE_DATA_SOURCE' });
      } else {
        setError(result.error || 'Failed to read MBOX');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read');
    } finally {
      setLoadingMbox(null);
    }
  };

  const handleToggleSync = (syncKey: string, mboxPath?: string) => {
    const isCurrentlySynced = state.syncedFolders.has(syncKey);
    if (isCurrentlySynced) {
      dispatch({ type: 'TOGGLE_FOLDER_SYNCED', payload: syncKey });
      return;
    }
    if (mboxPath) {
      handleReadMbox(mboxPath, syncKey);
    } else {
      dispatch({ type: 'TOGGLE_FOLDER_SYNCED', payload: syncKey });
    }
  };

  const toggleAccount = (key: string) => {
    setExpandedAccounts(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  const toggleFolder = (key: string) => {
    setExpandedFolders(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  if (!state.isThunderbirdPanelOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[80]" style={{ backgroundColor: 'black', opacity: 0.6 }} onClick={handleClose} />
      <div className="fixed left-0 top-0 bottom-0 w-[420px] z-[90] flex flex-col"
        style={{ backgroundColor: 'var(--deep-plum-bg)', borderRight: '1px solid var(--border-color)', boxShadow: '4px 0 24px rgba(0,0,0,0.6)' }}>

        <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5" style={{ color: 'var(--plum-accent)' }} />
            <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>Thunderbird</h2>
          </div>
          <div className="flex items-center gap-1">
            {scanning && (
              <RefreshCw className="w-4 h-4 animate-spin" style={{ color: 'var(--plum-accent)' }} />
            )}
            <button onClick={handleClose} className="p-1.5 rounded-md hover:bg-white/10" title="Close">
              <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar py-2">
          {scanning && !state.thunderbirdData && (
            <div className="flex flex-col items-center justify-center py-16">
              <RefreshCw className="w-8 h-8 animate-spin mb-3" style={{ color: 'var(--plum-accent)' }} />
              <p className="text-body" style={{ color: 'var(--text-secondary)' }}>Syncing with Thunderbird...</p>
              <p className="text-micro mt-1" style={{ color: 'var(--text-tertiary)' }}>Auto-syncs every 5 minutes</p>
            </div>
          )}

          {error && (
            <div className="mx-3 p-3 rounded-md mb-2 flex items-start gap-2" style={{ backgroundColor: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)' }}>
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--red-urgent)' }} />
              <p className="text-small" style={{ color: 'var(--red-urgent)' }}>{error}</p>
            </div>
          )}

          {loadingMbox && (
            <div className="mx-3 p-2 rounded-md mb-2 flex items-center gap-2" style={{ backgroundColor: 'rgba(107,61,139,0.2)', border: '1px solid rgba(107,61,139,0.4)' }}>
              <RefreshCw className="w-3 h-3 animate-spin" style={{ color: 'var(--plum-accent)' }} />
              <p className="text-small" style={{ color: 'var(--plum-accent)' }}>Loading emails...</p>
            </div>
          )}

          {state.thunderbirdData && Array.isArray(state.thunderbirdData.profiles) && state.thunderbirdData.profiles.map((profile: ProfileData, pIdx: number) => (
            <div key={pIdx} className="mb-2">
              <div className="px-3 py-1 text-micro font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                {profile.name}
              </div>
              {Array.isArray(profile.trees) && profile.trees
                .filter((tree: AccountTree) => showHidden || !state.hiddenAccounts.has(tree.name || ''))
                .map((tree: AccountTree, aIdx: number) => {
                  const key = `a-${pIdx}-${aIdx}`;
                  const isExpanded = expandedAccounts.has(key);
                  const accountName = tree.name || 'Unknown';
                  const isHidden = state.hiddenAccounts.has(accountName);
                  return (
                    <div key={key}>
                      <button onClick={() => toggleAccount(key)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 group">
                        {isExpanded
                          ? <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                          : <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
                        <FolderOpen className="w-4 h-4 shrink-0" style={{ color: isHidden ? 'var(--text-tertiary)' : 'var(--plum-accent)' }} />
                        <span className="text-small flex-1 truncate" style={{ color: isHidden ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>{accountName}</span>
                        <span className="text-micro" style={{ color: isHidden ? 'var(--text-tertiary)' : 'var(--text-tertiary)' }}>
                          {tree.totalEmails > 999 ? (tree.totalEmails/1000).toFixed(1) + 'k' : tree.totalEmails}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleHideAccount(accountName); }}
                          className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/10"
                          title={isHidden ? 'Unhide account' : 'Hide account'}
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {isHidden ? <Eye className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        </button>
                      </button>
                    {isExpanded && Array.isArray(tree.children) && tree.children.map((folder: FolderNode, fIdx: number) => (
                      <FolderNodeComp
                        key={`${key}-f${fIdx}`}
                        folder={folder}
                        depth={0}
                        syncKeyPrefix={`${profile.name}/${accountName}`}
                        expandedFolders={expandedFolders}
                        syncedFolders={state.syncedFolders}
                        onToggle={toggleFolder}
                        onReadMbox={handleReadMbox}
                        onToggleSync={handleToggleSync}
                        loadingMbox={loadingMbox}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}

          {state.thunderbirdData && state.hiddenAccounts.size > 0 && (
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 border-t"
              style={{ borderColor: 'var(--border-color)' }}
            >
              {showHidden
                ? <EyeOff className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                : <Eye className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
              <span className="text-small" style={{ color: 'var(--text-tertiary)' }}>
                {showHidden ? 'Hide hidden accounts' : `Show ${state.hiddenAccounts.size} hidden account(s)`}
              </span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function FolderNodeComp({
  folder,
  depth,
  syncKeyPrefix,
  expandedFolders,
  syncedFolders,
  onToggle,
  onReadMbox,
  onToggleSync,
  loadingMbox,
}: {
  folder: FolderNode;
  depth: number;
  syncKeyPrefix: string;
  expandedFolders: Set<string>;
  syncedFolders: Set<string>;
  onToggle: (k: string) => void;
  onReadMbox: (p: string, k: string) => void;
  onToggleSync: (sk: string, mp?: string) => void;
  loadingMbox: string | null;
}) {
  if (!folder || typeof folder !== 'object') return null;

  const key = (folder.path || 'nopath') + '/' + folder.name;
  const syncKey = syncKeyPrefix + '/' + key;
  const isExpanded = expandedFolders.has(key);
  const isSynced = syncedFolders.has(syncKey);
  const children = Array.isArray(folder.children) ? folder.children : [];
  const hasChildren = children.length > 0;
  const mboxes = Array.isArray(folder.mboxes) ? folder.mboxes : [];
  const hasMboxes = mboxes.length > 0;
  const isGrey = !!folder.grey;
  const name = folder.name || '?';
  const count = folder.mboxCount || 0;
  const isLoading = loadingMbox && mboxes.some(m => m.path === loadingMbox);

  const handleExpandToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) onToggle(key);
  };

  const handleFolderClick = () => {
    if (isGrey) return;
    if (isSynced) {
      onToggleSync(syncKey);
    } else if (hasChildren) {
      onToggleSync(syncKey, hasMboxes && mboxes[0] ? mboxes[0].path : undefined);
    } else if (hasMboxes && mboxes[0]) {
      onReadMbox(mboxes[0].path, syncKey);
    }
  };

  return (
    <div>
      <button
        onClick={handleFolderClick}
        className="w-full flex items-center gap-1.5 text-left hover:bg-white/5"
        style={{
          paddingLeft: `${12 + depth * 16}px`,
          paddingRight: '12px',
          paddingTop: '2px',
          paddingBottom: '2px',
          opacity: isGrey ? 0.35 : 1,
          cursor: isGrey ? 'default' : 'pointer',
        }}
      >
        {hasChildren ? (
          isExpanded
            ? <ChevronDown className="w-3 h-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} onClick={handleExpandToggle} />
            : <ChevronRight className="w-3 h-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} onClick={handleExpandToggle} />
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {isGrey ? (
          <Mail className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
        ) : isSynced ? (
          <Check className="w-3.5 h-3.5 shrink-0" style={{ color: '#2ecc71' }} />
        ) : isLoading ? (
          <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" style={{ color: 'var(--plum-accent)' }} />
        ) : (
          <Inbox className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--plum-accent)' }} />
        )}

        <span className="text-small flex-1 truncate" style={{ color: isGrey ? 'var(--text-tertiary)' : isSynced ? '#2ecc71' : 'var(--text-secondary)' }}>
          {name}
        </span>

        {!isGrey && count > 0 && (
          <span className="text-micro" style={{ color: isSynced ? '#2ecc71' : 'var(--text-tertiary)' }}>
            {count > 999 ? (count / 1000).toFixed(1) + 'k' : count}
          </span>
        )}
      </button>

      {isExpanded && hasChildren && children.map((child: FolderNode, i: number) => (
        <FolderNodeComp
          key={`${key}-c${i}`}
          folder={child}
          depth={depth + 1}
          syncKeyPrefix={syncKeyPrefix}
          expandedFolders={expandedFolders}
          syncedFolders={syncedFolders}
          onToggle={onToggle}
          onReadMbox={onReadMbox}
          onToggleSync={onToggleSync}
          loadingMbox={loadingMbox}
        />
      ))}
    </div>
  );
}
