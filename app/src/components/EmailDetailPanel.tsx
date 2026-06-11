// @ts-nocheck
import { useEffect, useRef } from 'react';
import { X, Cpu, Hash, AlertTriangle, CheckCircle, Clock, Mail, Send } from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';
import type { Email } from '@/context/AppContext';
import { Badge } from './Badge';
import { workflowSteps } from '@/lib/mockData';

function safeFormat(dateValue: string | Date | null | undefined, fmt = 'dd MMM yyyy, HH:mm', fallback = '—'): string {
  if (!dateValue) return fallback;
  try {
    let date: Date;
    if (dateValue instanceof Date) {
      date = dateValue;
    } else if (typeof dateValue === 'string' && (dateValue.includes('T') || dateValue.match(/^\d{4}-\d{2}-\d{2}/))) {
      date = parseISO(dateValue);
    } else {
      date = new Date(dateValue as string);
    }
    return isValid(date) ? format(date, fmt) : fallback;
  } catch {
    return fallback;
  }
}

interface EmailDetailPanelProps {
  email: Email | null;
  onClose: () => void;
}

export function EmailDetailPanel({ email, onClose }: EmailDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const isOpen = !!email;

  const stepInfo = email
    ? workflowSteps.find(s => s.id === (email.stepAssigned || email.classification?.step || 0))
    : null;

  const confidence = email?.classification?.confidence ?? 0;
  const confPercent = Math.round(confidence * 100);
  const confColor = confidence >= 0.8
    ? 'var(--green-success)'
    : confidence >= 0.5
    ? 'var(--amber-alert)'
    : 'var(--red-urgent)';

  return (
    <>
      {/* Backdrop — only dims, doesn't block Kanban interaction */}
      <div
        className="fixed inset-0 z-[40] transition-opacity duration-200"
        style={{
          backgroundColor: 'rgba(0,0,0,0.3)',
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed top-0 right-0 h-full z-[50] flex flex-col overflow-hidden"
        style={{
          width: '420px',
          backgroundColor: 'var(--dark-bg)',
          borderLeft: '1px solid var(--border-color)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {email && (
          <>
            {/* ── Header ── */}
            <div
              className="shrink-0 px-4 py-3 flex items-start gap-3"
              style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--header-bg)' }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-body font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={email.subject}>
                  {email.subject || '(no subject)'}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-small" style={{ color: 'var(--text-secondary)' }}>
                    {email.senderName || email.senderEmail || 'Unknown'}
                  </span>
                  <span className="text-micro" style={{ color: 'var(--text-tertiary)' }}>
                    {safeFormat(email.sentAt)}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="shrink-0 p-1 rounded transition-colors hover:opacity-70"
                style={{ color: 'var(--text-tertiary)' }}
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">

              {/* ── Metadata row ── */}
              <div
                className="px-4 py-2 flex flex-wrap gap-x-4 gap-y-1"
                style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--card-bg)' }}
              >
                <MetaItem label="From" value={email.senderEmail || '—'} />
                <MetaItem label="Date" value={safeFormat(email.sentAt, 'dd MMM yyyy HH:mm')} />
                {email.isSentByUser && (
                  <span className="inline-flex items-center gap-1 text-micro" style={{ color: 'var(--green-success)' }}>
                    <Send className="w-3 h-3" /> Sent by you
                  </span>
                )}
                {email.isInternal && (
                  <span className="inline-flex items-center gap-1 text-micro" style={{ color: 'var(--plum-accent)' }}>
                    <Mail className="w-3 h-3" /> Internal
                  </span>
                )}
              </div>

              {/* ── NLP Classification card ── */}
              <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
                <p className="text-micro uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                  AI Classification
                </p>

                <div className="flex items-center gap-3 flex-wrap">
                  {/* Step badge */}
                  {stepInfo ? (
                    <div
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                      style={{ backgroundColor: 'rgba(73,40,96,0.25)', border: '1px solid var(--brand-plum)' }}
                    >
                      <span className="text-small font-semibold" style={{ color: 'var(--brand-plum)' }}>
                        Step {stepInfo.id}
                      </span>
                      <span className="text-small" style={{ color: 'var(--text-secondary)' }}>
                        {stepInfo.stepName}
                      </span>
                    </div>
                  ) : (
                    <span className="text-small italic" style={{ color: 'var(--text-tertiary)' }}>Not classified</span>
                  )}

                  {/* Confidence pill */}
                  {confPercent > 0 && (
                    <div className="flex items-center gap-1">
                      {confidence >= 0.8
                        ? <CheckCircle className="w-3.5 h-3.5" style={{ color: confColor }} />
                        : confidence >= 0.5
                        ? <Clock className="w-3.5 h-3.5" style={{ color: confColor }} />
                        : <AlertTriangle className="w-3.5 h-3.5" style={{ color: confColor }} />
                      }
                      <span className="text-small font-medium" style={{ color: confColor }}>
                        {confPercent}% confidence
                      </span>
                    </div>
                  )}

                  {/* Conflict flag */}
                  {email.hasConflict && (
                    <span
                      className="text-micro font-semibold px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--amber-alert)', color: 'black' }}
                    >
                      Conflict: BASE {email.baseSuggestedStep} vs SMART {email.smartConfirmedStep}
                    </span>
                  )}
                </div>

                {/* Supplier extracted */}
                {(email.supplierName || email.extracted?.supplier) && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <Cpu className="w-3 h-3 shrink-0" style={{ color: 'var(--plum-accent)' }} />
                    <span className="text-small" style={{ color: 'var(--text-secondary)' }}>
                      Supplier:
                    </span>
                    <span className="text-small font-medium" style={{ color: 'var(--text-primary)' }}>
                      {email.supplierName || email.extracted?.supplier}
                    </span>
                  </div>
                )}

                {/* Part numbers */}
                {email.extracted?.partNumbers && email.extracted.partNumbers.length > 0 && (
                  <div className="mt-2">
                    <p className="text-micro mb-1" style={{ color: 'var(--text-tertiary)' }}>
                      Extracted part numbers:
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {email.extracted.partNumbers.map((part, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-micro font-medium"
                          style={{
                            backgroundColor: 'rgba(107,61,139,0.3)',
                            color: 'var(--plum-accent)',
                            border: '1px solid rgba(107,61,139,0.5)',
                          }}
                        >
                          <Hash className="w-2.5 h-2.5" />{part}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Email body ── */}
              <div className="px-4 py-3">
                <p className="text-micro uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                  Message
                </p>
                {email.body ? (
                  <pre
                    className="text-small whitespace-pre-wrap break-words rounded-md p-3"
                    style={{
                      color: 'var(--text-secondary)',
                      backgroundColor: 'var(--card-bg)',
                      border: '1px solid var(--border-color)',
                      fontFamily: 'inherit',
                      lineHeight: '1.6',
                      maxHeight: '480px',
                      overflowY: 'auto',
                    }}
                  >
                    {email.body}
                  </pre>
                ) : (
                  <div
                    className="flex items-center justify-center py-8 rounded-md"
                    style={{ backgroundColor: 'var(--card-bg)', border: '1px dashed var(--border-color)' }}
                  >
                    <span className="text-small italic" style={{ color: 'var(--text-tertiary)' }}>
                      No body content available
                    </span>
                  </div>
                )}
              </div>

            </div>
          </>
        )}
      </div>
    </>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-micro shrink-0" style={{ color: 'var(--text-tertiary)' }}>{label}:</span>
      <span className="text-micro truncate" style={{ color: 'var(--text-secondary)' }} title={value}>{value}</span>
    </div>
  );
}
