// @ts-nocheck
import { useApp } from '@/context/AppContext';
import { useState, useEffect, useRef, useCallback } from 'react';
import { troubleshootTopics } from '@/lib/mockData';
import { X, MessageCircle, Send, CheckCircle, XCircle, Zap, Wrench } from 'lucide-react';

const aiResponses: Record<string, string> = {
  'Wrong Step Assignment': 'I have analyzed this email. The subject line contains "Re:" and references a quote, which indicates this is a supplier response rather than a new RFQ. The current classification as "RFQ Received" (Step 2) appears correct.\n\nConfidence: 87%',
  'Duplicate Email': 'Checking Message-ID and thread references... This email has a unique Message-ID and is part of an existing thread. It is NOT a duplicate.\n\nConfidence: 92%',
  'Missing Attachment': 'Scanning the email structure... The EML file indicates this was a plain-text response without attachments. The supplier likely replied inline with pricing in the body.\n\nConfidence: 78%',
  'Other Issue': 'I have performed a general analysis of this email. It appears to be properly classified and processed. All standard checks pass.\n\nIf you are experiencing a specific issue, please describe it and I will investigate further.',
  'Wrong Supplier Name': 'Checking supplier records... The email domain is correctly mapped. No discrepancy found.',
  'Domain Mapping Error': 'Domain mapping analysis: The sender email matches the supplier domain exactly. This mapping is correct and verified.\n\nConfidence: 98%',
  'Folder Path Issue': 'Thunderbird folder scan: The profile scanner found the folder at the expected path. Last scan was 60 seconds ago with no errors.\n\nFolder path is correct.',
  'Wrong CI Number': 'CI number analysis: The current CI was manually assigned. No automatic CI extraction was performed. If this CI is incorrect, you can edit it through the RFQ settings.',
  'Rename RFQ': 'I can help you rename this RFQ. The current name was auto-extracted from the email subject. To rename it, simply type the new name you would like to use.',
  'Merge with Another RFQ': 'Merge analysis: This RFQ has multiple emails and is at an active step. To merge with another RFQ, both must belong to the same supplier. Please select the target RFQ.',
  'Split RFQ': 'Split analysis: This RFQ contains multiple emails covering different part numbers. I can split this into separate RFQs based on part numbers or email groups. Which approach would you prefer?',
  'Wrong Price': 'Price analysis: The extracted price came from the supplier email. This appears correct based on the source email.\n\nIf the price should be different, please provide the correct value.',
  'Wrong Part Number': 'Part number extraction: The P/N was extracted from the email subject and confirmed in the body text.\n\nConfidence: 94%',
  'Other': 'I have analyzed the data for this field. The extraction appears to be based on standard pattern matching from the supplier email. If you believe this value is incorrect, please provide the correct information.',
};

function getResponse(topic: string) { return aiResponses[topic] || aiResponses['Other']; }

export function TroubleshootPanel() {
  const { state, dispatch } = useApp();
  const [, setSelectedTopic] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [visible, setVisible] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), []);

  useEffect(() => scrollToBottom(), [state.troubleshootChat, scrollToBottom]);

  if (state.isTroubleshootOpen && !visible) setTimeout(() => setVisible(true), 10);
  if (!state.isTroubleshootOpen && visible) setTimeout(() => setVisible(false), 0);
  if (!state.isTroubleshootOpen && !visible) return null;

  const handleClose = () => { setVisible(false); setTimeout(() => dispatch({ type: 'CLOSE_TROUBLESHOOT' }), 250); };

  const handleTopicSelect = (topic: string) => {
    setSelectedTopic(topic);
    dispatch({ type: 'ADD_CHAT_MESSAGE', payload: { id: `u-${Date.now()}`, role: 'user', content: `Issue: ${topic}` } });
    dispatch({ type: 'SET_CHAT_STREAMING', payload: true });
    const responseText = getResponse(topic);
    const aid = `ai-${Date.now()}`;
    dispatch({ type: 'ADD_CHAT_MESSAGE', payload: { id: aid, role: 'ai', content: '', isStreaming: true } });
    let ci = 0;
    const iv = setInterval(() => { ci++; if (ci >= responseText.length) { clearInterval(iv); dispatch({ type: 'SET_CHAT_STREAMING', payload: false }); dispatch({ type: 'ADD_CHAT_MESSAGE', payload: { id: `${aid}-f`, role: 'ai', content: responseText } }); } }, 15);
  };

  const handleSend = () => {
    if (!inputText.trim()) return;
    dispatch({ type: 'ADD_CHAT_MESSAGE', payload: { id: `u-${Date.now()}`, role: 'user', content: inputText } });
    setInputText('');
    dispatch({ type: 'SET_CHAT_STREAMING', payload: true });
    setTimeout(() => { dispatch({ type: 'ADD_CHAT_MESSAGE', payload: { id: `ai-${Date.now()}`, role: 'ai', content: 'Thank you for the additional details. I have logged your input and will incorporate it into the analysis.\n\nIs your issue now resolved?' } }); dispatch({ type: 'SET_CHAT_STREAMING', payload: false }); }, 1000);
  };

  const handleFeedback = () => { handleClose(); setSelectedTopic(null); setInputText(''); };
  const topics = troubleshootTopics[state.troubleshootLevel] || [];

  return (
    <>
      <div className="fixed inset-0 z-[100] transition-opacity duration-200" style={{ backgroundColor: 'black', opacity: visible ? 0.4 : 0 }} onClick={handleClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[480px] z-[110] flex flex-col transition-transform duration-250 ease-out" style={{ backgroundColor: 'var(--deep-plum-bg)', borderLeft: '1px solid var(--border-color)', boxShadow: '-4px 0 24px rgba(0,0,0,0.6)', transform: visible ? 'translateX(0)' : 'translateX(100%)' }}>
        <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5" style={{ color: 'var(--plum-accent)' }} />
            <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>Troubleshoot</h2>
            <span className="text-micro font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--brand-plum)', color: 'white' }}>Level {state.troubleshootLevel}</span>
          </div>
          <button onClick={handleClose} className="p-1 rounded-md transition-colors hover:bg-white/10"><X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} /></button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
          {state.troubleshootChat.length === 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-4"><MessageCircle className="w-5 h-5" style={{ color: 'var(--plum-accent)' }} /><p className="text-body" style={{ color: 'var(--text-secondary)' }}>Select an issue to diagnose:</p></div>
              {topics.map(t => (
                <button key={t} onClick={() => handleTopicSelect(t)} className="w-full text-left px-4 py-3 rounded-md text-body transition-all hover:translate-x-1" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }} onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand-plum)'; e.currentTarget.style.color = 'var(--text-primary)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>{t}</button>
              ))}
            </div>
          ) : (
            <>
              {state.troubleshootChat.map(m => (
                <div key={m.id} className={`flex ${m.role === 'ai' ? 'justify-start' : 'justify-end'}`}>
                  <div className="max-w-[85%] px-3 py-2 rounded-xl text-body leading-relaxed whitespace-pre-line" style={{ backgroundColor: m.role === 'ai' ? 'rgba(73,40,96,0.2)' : 'var(--border-light)', color: 'var(--text-primary)', borderRadius: m.role === 'ai' ? '12px 12px 12px 2px' : '12px 12px 2px 12px' }}>{m.content}</div>
                </div>
              ))}
              {state.isChatStreaming && state.troubleshootChat[state.troubleshootChat.length - 1]?.isStreaming && (
                <div className="flex justify-start"><div className="px-3 py-2 rounded-xl flex items-center gap-1" style={{ backgroundColor: 'rgba(73,40,96,0.2)', borderRadius: '12px 12px 12px 2px' }}><span className="typing-dot w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--plum-accent)' }} /><span className="typing-dot w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--plum-accent)' }} /><span className="typing-dot w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--plum-accent)' }} /></div></div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {state.troubleshootChat.length > 0 && (
          <>
            <div className="px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2">
                <input type="text" value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} placeholder="Type your message..." className="flex-1 px-3 py-2 rounded-md outline-none text-body placeholder:text-[var(--text-tertiary)]" style={{ backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }} />
                <button onClick={handleSend} disabled={!inputText.trim()} className="p-2 rounded-md transition-colors disabled:opacity-30" style={{ backgroundColor: 'var(--brand-plum)' }}><Send className="w-4 h-4 text-white" /></button>
              </div>
            </div>
            {!state.isChatStreaming && (
              <div className="flex items-center gap-2 px-4 pb-3 shrink-0">
                <button onClick={handleFeedback} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-small font-medium" style={{ backgroundColor: 'var(--green-success)', color: 'black' }}><CheckCircle className="w-4 h-4" />Resolved</button>
                <button onClick={handleFeedback} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-small font-medium" style={{ backgroundColor: 'var(--red-urgent)', color: 'white' }}><XCircle className="w-4 h-4" />Not Resolved</button>
                <button className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-small font-medium" style={{ backgroundColor: 'var(--amber-alert)', color: 'black' }}><Zap className="w-4 h-4" />BOOST</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
