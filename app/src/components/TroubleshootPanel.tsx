import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Wrench, X, MessageCircle, CheckCircle2, CircleX, Zap, Send } from 'lucide-react';

// Mock AI responses for troubleshooting
const AI_RESPONSES: Record<string, string> = {
  "Wrong Step Assignment": `I have analyzed this email. The subject line contains "Re:" and references a quote, which indicates this is a supplier response rather than a new RFQ. The current classification as "RFQ Received" (Step 2) appears correct.\nConfidence: 87%`,
  "Duplicate Email": `Checking Message-ID and thread references... This email has a unique Message-ID and is part of an existing thread. It is NOT a duplicate.\nConfidence: 92%`,
  "Missing Attachment": `Scanning the email structure... The EML file indicates this was a plain-text response without attachments. The supplier likely replied inline with pricing in the body.\nConfidence: 78%`,
  "Other Issue": `I have performed a general analysis of this email. It appears to be properly classified and processed. All standard checks pass.\nIf you are experiencing a specific issue, please describe it and I will investigate further.`,
};

export function TroubleshootPanel() {
  const { state, dispatch } = useApp();
  const [, setTarget] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // ✅ FIXED: useEffect is now safely at the top level
useEffect(() => {
  scrollToBottom();
}, [state.troubleshootChat, scrollToBottom]);

useEffect(() => {
  if (state.isTroubleshootOpen && !isVisible) {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }
  if (!state.isTroubleshootOpen && isVisible) {
    const timer = setTimeout(() => setIsVisible(false), 0);
    return () => clearTimeout(timer);
  }
}, [state.isTroubleshootOpen, isVisible]);

if (!state.isTroubleshootOpen && !isVisible) return null;

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => dispatch({ type: 'TOGGLE_TROUBLESHOOT' }), 250);
  };

  const handleIssueClick = (issue: string) => {
    setTarget(issue);
    dispatch({ 
      type: 'ADD_CHAT_MESSAGE', 
      payload: { id: `u-${Date.now()}`, role: 'user', text: `Issue: ${issue}` } 
    });
    
    // Simulate AI streaming
    dispatch({ type: 'SET_AI_MODE', payload: 'auto' }); // Just to trigger re-render if needed
    
    const response = AI_RESPONSES[issue] || AI_RESPONSES["Other Issue"];
    const aiId = `ai-${Date.now()}`;
    
    // Simulate typing delay
    setTimeout(() => {
      dispatch({ 
        type: 'ADD_CHAT_MESSAGE', 
        payload: { id: aiId, role: 'ai', text: response } 
      });
    }, 800);
  };

  const handleSendMessage = () => {
    if (!input.trim()) return;
    
    dispatch({ 
      type: 'ADD_CHAT_MESSAGE', 
      payload: { id: `u-${Date.now()}`, role: 'user', text: input } 
    });
    setInput("");
    
    setTimeout(() => {
      dispatch({ 
        type: 'ADD_CHAT_MESSAGE', 
        payload: { 
          id: `ai-${Date.now()}`, 
          role: 'ai', 
          text: `Thank you for the additional details. I have logged your input and will incorporate it into the analysis.\nIs your issue now resolved?` 
        } 
      });
    }, 1000);
  };

  const handleResolve = () => {
    handleClose();
    setTarget(null);
    setInput("");
  };

  if (!state.isTroubleshootOpen && !isVisible) return null;

  const issues = ["Wrong Step Assignment", "Duplicate Email", "Missing Attachment", "Other Issue"];

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-[100] transition-opacity duration-200"
        style={{ backgroundColor: 'black', opacity: isVisible ? 0.4 : 0 }}
        onClick={handleClose}
      />

      {/* Panel */}
      <div 
        className="fixed right-0 top-0 bottom-0 w-[480px] z-[110] flex flex-col transition-transform duration-250 ease-out"
        style={{ 
          backgroundColor: 'var(--deep-plum-bg)', 
          borderLeft: '1px solid var(--border-color)', 
          boxShadow: '-4px 0 24px rgba(0,0,0,0.6)',
          transform: isVisible ? 'translateX(0)' : 'translateX(100%)'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5" style={{ color: 'var(--plum-accent)' }} />
            <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>Troubleshoot</h2>
            <span className="text-micro font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--brand-plum)', color: 'white' }}>
              Level {state.troubleshootTarget?.level || 1}
            </span>
          </div>
          <button onClick={handleClose} className="p-1 rounded-md transition-colors hover:bg-white/10">
            <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
          {state.troubleshootChat.length === 0 ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-4">
                <MessageCircle className="w-5 h-5" style={{ color: 'var(--plum-accent)' }} />
                <p className="text-body" style={{ color: 'var(--text-secondary)' }}>Select an issue to diagnose:</p>
              </div>
              {issues.map(issue => (
                <button
                  key={issue}
                  onClick={() => handleIssueClick(issue)}
                  className="w-full text-left px-4 py-3 rounded-md text-body transition-all hover:translate-x-1"
                  style={{ 
                    backgroundColor: 'var(--card-bg)', 
                    border: '1px solid var(--border-color)', 
                    color: 'var(--text-secondary)' 
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--brand-plum)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  {issue}
                </button>
              ))}
            </div>
          ) : (
            <>
              {state.troubleshootChat.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'ai' ? 'justify-start' : 'justify-end'}`}>
                  <div 
                    className="max-w-[85%] px-3 py-2 rounded-xl text-body leading-relaxed whitespace-pre-line"
                    style={{ 
                      backgroundColor: msg.role === 'ai' ? 'rgba(73,40,96,0.2)' : 'var(--border-light)', 
                      color: 'var(--text-primary)',
                      borderRadius: msg.role === 'ai' ? '12px 12px 12px 2px' : '12px 12px 2px 12px'
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={scrollRef} />
            </>
          )}
        </div>

        {/* Input Area */}
        {state.troubleshootChat.length > 0 && (
          <>
            <div className="px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Type your message..."
                  className="flex-1 px-3 py-2 rounded-md outline-none text-body placeholder:text-[var(--text-tertiary)]"
                  style={{ 
                    backgroundColor: 'var(--card-bg)', 
                    color: 'var(--text-primary)', 
                    border: '1px solid var(--border-color)' 
                  }}
                />
                <button 
                  onClick={handleSendMessage} 
                  disabled={!input.trim()} 
                  className="p-2 rounded-md transition-colors disabled:opacity-30"
                  style={{ backgroundColor: 'var(--brand-plum)' }}
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 px-4 pb-3 shrink-0">
              <button
                onClick={handleResolve}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-small font-medium"
                style={{ backgroundColor: 'var(--green-success)', color: 'black' }}
              >
                <CheckCircle2 className="w-4 h-4" /> Resolved
              </button>
              <button
                onClick={handleResolve}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-small font-medium"
                style={{ backgroundColor: 'var(--red-urgent)', color: 'white' }}
              >
                <CircleX className="w-4 h-4" /> Not Resolved
              </button>
              <button
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-small font-medium"
                style={{ backgroundColor: 'var(--amber-alert)', color: 'black' }}
              >
                <Zap className="w-4 h-4" /> BOOST
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}