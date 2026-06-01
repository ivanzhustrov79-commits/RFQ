import { useApp } from '@/context/AppContext';
import { Bell, Mail, Settings, Search, Wrench, AlertTriangle, Moon, Sun, Type } from 'lucide-react';

export function HeaderBar() {
  const { state, dispatch } = useApp();

  const toggleTheme = () => {
    dispatch({ type: 'SET_THEME', payload: state.theme === 'dark' ? 'light' : 'dark' });
  };

  const cycleFont = () => {
    const sizes: Array<'small' | 'medium' | 'big'> = ['small', 'medium', 'big'];
    const idx = sizes.indexOf(state.fontSize);
    const next = sizes[(idx + 1) % sizes.length];
    dispatch({ type: 'SET_FONT_SIZE', payload: next });
  };

  return (
    <header
      className="h-12 flex items-center justify-between px-4 shrink-0"
      style={{ backgroundColor: 'var(--midnight-plum)', borderBottom: '1px solid var(--border-color)' }}
    >
      {/* Left: Brand + Nav */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--brand-plum)' }}>
            <Mail className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-h1 font-bold" style={{ color: 'var(--text-primary)' }}>RFQ Flow</h1>
        </div>

        <div className="h-6 w-px" style={{ backgroundColor: 'var(--border-color)' }} />

        <nav className="flex items-center gap-1">
          <button className="nav-btn nav-btn-active" style={{ color: 'var(--text-primary)', backgroundColor: 'rgba(107,61,139,0.15)' }}>Dashboard</button>
          <button className="nav-btn" style={{ color: 'var(--text-tertiary)' }}>Suppliers</button>
          <button className="nav-btn" style={{ color: 'var(--text-tertiary)' }}>Analytics</button>
          <button className="nav-btn" style={{ color: 'var(--text-tertiary)' }}>Archive</button>
        </nav>
      </div>

      {/* Right: Toggles + Actions */}
      <div className="flex items-center gap-2">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-white/10 text-micro"
          style={{ color: 'var(--text-secondary)' }}
          title={state.theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
        >
          {state.theme === 'dark' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          <span className="capitalize">{state.theme}</span>
        </button>

        {/* Font Size Toggle */}
        <button
          onClick={cycleFont}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-white/10 text-micro"
          style={{ color: 'var(--text-secondary)' }}
          title="Font size"
        >
          <Type className="w-3.5 h-3.5" />
          <span className="capitalize">{state.fontSize}</span>
        </button>

        <div className="h-6 w-px" style={{ backgroundColor: 'var(--border-color)' }} />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            placeholder="Search..."
            className="h-8 w-48 rounded-md pl-9 pr-3 text-small outline-none"
            style={{ backgroundColor: 'rgba(45,31,63,0.4)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
          />
        </div>

        {/* Action Buttons */}
        <button
          onClick={() => dispatch({ type: 'TOGGLE_THUNDERBIRD_PANEL' })}
          className="p-2 rounded-md hover:bg-white/10 relative"
          title="Thunderbird Mail"
        >
          <Mail className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
          {state.syncedFolders.size > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ backgroundColor: '#2ecc71' }} />
          )}
        </button>

        <button
          onClick={() => dispatch({ type: 'TOGGLE_ALARM_BOARD' })}
          className="p-2 rounded-md hover:bg-white/10 relative"
          title="Alarms"
        >
          <Bell className="w-4 h-4" style={{ color: 'var(--amber-alert)' }} />
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-micro font-bold" style={{ backgroundColor: 'var(--amber-alert)', color: 'var(--deep-plum-bg)' }}>3</span>
        </button>

        <button
          onClick={() => dispatch({ type: 'TOGGLE_EXCEPTION_QUEUE' })}
          className="p-2 rounded-md hover:bg-white/10 relative"
          title="Exceptions"
        >
          <AlertTriangle className="w-4 h-4" style={{ color: 'var(--red-urgent)' }} />
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-micro font-bold" style={{ backgroundColor: 'var(--red-urgent)', color: 'var(--deep-plum-bg)' }}>7</span>
        </button>

        <button
          onClick={() => dispatch({ type: 'TOGGLE_TROUBLESHOOT' })}
          className="p-2 rounded-md hover:bg-white/10"
          title="Troubleshoot"
        >
          <Wrench className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
        </button>

        <button
          onClick={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
          className="p-2 rounded-md hover:bg-white/10"
          title="Settings"
        >
          <Settings className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>
    </header>
  );
}
