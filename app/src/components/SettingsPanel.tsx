// @ts-nocheck
import { useApp } from '@/context/AppContext';
import { useState } from 'react';
import { X, Cpu, Globe, Database, Shield, Key, Sun, Moon } from 'lucide-react';

export function SettingsPanel() {
  const { state, dispatch } = useApp();
  const [visible, setVisible] = useState(false);

  if (state.isSettingsOpen && !visible) setTimeout(() => setVisible(true), 10);
  if (!state.isSettingsOpen && visible) setTimeout(() => setVisible(false), 0);
  if (!state.isSettingsOpen && !visible) return null;

  const handleClose = () => { setVisible(false); setTimeout(() => dispatch({ type: 'TOGGLE_SETTINGS' }), 200); };

  return (
    <>
      <div className="fixed inset-0 z-[80] transition-opacity duration-200" style={{ backgroundColor: 'black', opacity: visible ? 0.6 : 0 }} onClick={handleClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-h-[85vh] z-[90] flex flex-col rounded-lg overflow-hidden transition-all duration-200 ease-out" style={{ backgroundColor: 'var(--dark-bg)', border: '1px solid var(--border-color)', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', opacity: visible ? 1 : 0, transform: visible ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(0.95)' }}>
        <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>Settings</h2>
          <button onClick={handleClose} className="p-1 rounded-md transition-colors hover:bg-white/10"><X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} /></button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
          {/* APPEARANCE */}
          <SettingSection title="Appearance" icon={state.theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}>
            <div className="flex items-center justify-between py-2">
              <span className="text-body" style={{ color: 'var(--text-secondary)' }}>Theme</span>
              <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
                {(['dark', 'light'] as const).map(t => (
                  <button key={t} onClick={() => dispatch({ type: 'SET_THEME', payload: t })} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-small font-medium transition-all" style={{ backgroundColor: state.theme === t ? 'var(--brand-plum)' : 'transparent', color: state.theme === t ? '#fff' : 'var(--text-secondary)' }}>
                    {t === 'dark' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}{t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-body" style={{ color: 'var(--text-secondary)' }}>Text Size</span>
              <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
                {[{ k: 'small' as const, l: 'Small' }, { k: 'medium' as const, l: 'Medium' }, { k: 'big' as const, l: 'Big' }].map(({ k, l }) => (
                  <button key={k} onClick={() => dispatch({ type: 'SET_FONT_SIZE', payload: k })} className="flex flex-col items-center px-3 py-1 rounded-md text-micro font-medium transition-all min-w-[60px]" style={{ backgroundColor: state.fontSize === k ? 'var(--brand-plum)' : 'transparent', color: state.fontSize === k ? '#fff' : 'var(--text-secondary)' }}>
                    <span style={{ fontSize: k === 'small' ? 10 : k === 'medium' ? 13 : 16, fontWeight: 700 }}>A</span><span>{l}</span>
                  </button>
                ))}
              </div>
            </div>
          </SettingSection>

          {/* AI MODE */}
          <SettingSection title="AI Mode" icon={<Cpu className="w-4 h-4" />}>
            <div className="grid grid-cols-3 gap-2">
              {(['BASE', 'SMART', 'BOOST'] as const).map(mode => (
                <button key={mode} onClick={() => dispatch({ type: 'SET_AI_MODE', payload: mode })} className="flex items-center justify-center gap-1.5 py-2 rounded-md text-small font-medium transition-all" style={{ backgroundColor: state.aiMode === mode ? 'var(--brand-plum)' : 'var(--card-bg)', color: state.aiMode === mode ? '#fff' : 'var(--text-secondary)', border: `1px solid ${state.aiMode === mode ? 'var(--brand-plum)' : 'var(--border-color)'}` }}>{mode}</button>
              ))}
            </div>
            <p className="text-micro mt-2" style={{ color: 'var(--text-tertiary)' }}>
              {state.aiMode === 'BASE' && 'Uses learned rules only. No LLM calls. Fastest mode.'}
              {state.aiMode === 'SMART' && 'Uses Ollama with qwen3:7b. Local AI with reasoning.'}
              {state.aiMode === 'BOOST' && 'Uses Moonshot AI API. Most capable, requires API key.'}
            </p>
          </SettingSection>

          {/* BOOST API KEY */}
          {state.aiMode === 'BOOST' && (
            <SettingSection title="API Key" icon={<Key className="w-4 h-4" />}>
              <div className="flex items-center gap-2">
                <input type="password" placeholder="Enter Moonshot API key..." defaultValue="msk-************4242" className="flex-1 px-3 py-2 rounded-md outline-none text-small" style={{ backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
                <button className="px-3 py-2 rounded-md text-small font-medium" style={{ backgroundColor: 'var(--brand-plum)', color: '#fff' }}>Save</button>
              </div>
              <p className="text-micro mt-1" style={{ color: 'var(--text-tertiary)' }}>Stored in Windows Credential Manager. Never saved to database.</p>
            </SettingSection>
          )}

          {/* LANGUAGE */}
          <SettingSection title="Language" icon={<Globe className="w-4 h-4" />}>
            <div className="flex items-center justify-between py-2"><span className="text-small" style={{ color: 'var(--text-secondary)' }}>Primary language</span><span className="text-small font-medium" style={{ color: 'var(--text-primary)' }}>Russian (ru)</span></div>
            <div className="flex items-center justify-between py-2"><span className="text-small" style={{ color: 'var(--text-secondary)' }}>UI language</span><span className="text-small font-medium" style={{ color: 'var(--text-primary)' }}>English (en)</span></div>
          </SettingSection>

          {/* DATABASE */}
          <SettingSection title="Database" icon={<Database className="w-4 h-4" />}>
            <div className="flex items-center justify-between py-2"><span className="text-small" style={{ color: 'var(--text-secondary)' }}>Schema version</span><span className="text-small font-medium" style={{ color: 'var(--text-primary)' }}>v4.3.2 (001)</span></div>
            <div className="flex items-center justify-between py-2"><span className="text-small" style={{ color: 'var(--text-secondary)' }}>Total RFQs</span><span className="text-small font-medium" style={{ color: 'var(--text-primary)' }}>16</span></div>
            <div className="flex items-center justify-between py-2"><span className="text-small" style={{ color: 'var(--text-secondary)' }}>Total emails</span><span className="text-small font-medium" style={{ color: 'var(--text-primary)' }}>25</span></div>
            <div className="flex items-center justify-between py-2"><span className="text-small" style={{ color: 'var(--text-secondary)' }}>Agent memory rules</span><span className="text-small font-medium" style={{ color: 'var(--text-primary)' }}>47</span></div>
          </SettingSection>

          {/* SECURITY */}
          <SettingSection title="Security" icon={<Shield className="w-4 h-4" />}>
            <div className="flex items-center justify-between py-2"><span className="text-small" style={{ color: 'var(--text-secondary)' }}>Database encryption</span><span className="text-small font-medium" style={{ color: 'var(--amber-alert)' }}>Disabled</span></div>
            <div className="flex items-center justify-between py-2"><span className="text-small" style={{ color: 'var(--text-secondary)' }}>API key storage</span><span className="text-small font-medium" style={{ color: 'var(--green-success)' }}>Windows Credential Manager</span></div>
            <div className="flex items-center justify-between py-2"><span className="text-small" style={{ color: 'var(--text-secondary)' }}>Local HTTP bind</span><span className="text-small font-medium" style={{ color: 'var(--green-success)' }}>127.0.0.1 only</span></div>
          </SettingSection>

          {/* TOKEN BUDGET */}
          <SettingSection title="Token Budget" icon={<Cpu className="w-4 h-4" />}>
            {[{ l: 'Daily limit (BOOST)', u: '12,450', v: '50,000' }, { l: 'Monthly limit (BOOST)', u: '342,100', v: '1,000,000' }, { l: 'Max per RFQ (BOOST)', u: '2 avg', v: '5' }, { l: 'SMART CPU budget', u: '45%', v: '80%' }, { l: 'SMART RAM budget', u: '5.2 GB', v: '8 GB' }].map(i => (
              <div key={i.l} className="flex items-center justify-between py-1"><span className="text-small" style={{ color: 'var(--text-secondary)' }}>{i.l}</span><div className="flex items-center gap-2"><span className="text-micro" style={{ color: 'var(--text-tertiary)' }}>{i.u} /</span><span className="text-small font-medium" style={{ color: 'var(--text-primary)' }}>{i.v}</span></div></div>
            ))}
          </SettingSection>
        </div>
      </div>
    </>
  );
}

function SettingSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="p-3 rounded-md" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
      <div className="flex items-center gap-2 mb-3"><span style={{ color: 'var(--plum-accent)' }}>{icon}</span><h3 className="text-h2 font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3></div>
      {children}
    </div>
  );
}
