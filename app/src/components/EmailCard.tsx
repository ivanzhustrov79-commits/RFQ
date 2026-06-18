import type { Email } from '@/context/AppContext';
import { Badge } from './Badge';
import { Cpu, Hash } from 'lucide-react';
import { format, parseISO, isValid } from 'date-fns';

// Inline safe date formatter - prevents "Invalid time value" crashes
function safeFormat(dateValue: string | Date | null | undefined, fmt: string = 'MMM d HH:mm', fallback: string = '—'): string {
  if (!dateValue) return fallback;
  try {
    let date: Date;
    if (dateValue instanceof Date) {
      date = dateValue;
    } else if (dateValue.includes('T') || dateValue.match(/^\d{4}-\d{2}-\d{2}/)) {
      date = parseISO(dateValue);
    } else {
      date = new Date(dateValue);
    }
    return isValid(date) ? format(date, fmt) : fallback;
  } catch {
    return fallback;
  }
}

interface EmailCardProps {
  email: Email;
  isSelected?: boolean;
  isOverriding?: boolean;
  onCardClick?: (email: Email) => void;
  onContextMenu?: (e: React.MouseEvent, email: Email) => void;
}

export function EmailCard({ email, isSelected, isOverriding, onCardClick, onContextMenu }: EmailCardProps) {
  const getBorderStyle = () => {
    if (isSelected) return '2px solid var(--brand-plum)';
    if (email.isVerified) return '2px solid var(--green-success)';
    if (email.hasConflict) return '2px solid var(--amber-alert)';
    if (email.isLowConfidence) return '1px dashed var(--amber-alert)';
    return '1px solid var(--border-color)';
  };

  // Determine step badge color based on confidence
  const getStepBadgeVariant = () => {
    const conf = email.classification?.confidence || 0;
    if (conf >= 0.8) return 'approved' as const;
    if (conf >= 0.5) return 'pending' as const;
    return 'low' as const;
  };

  return (
    <div
      className="email-card relative flex flex-col gap-1.5 p-2.5 rounded-md cursor-pointer transition-all duration-150"
      style={{
        backgroundColor: 'var(--card-bg)',
        border: getBorderStyle(),
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        opacity: email.isLowConfidence ? 0.7 : (isOverriding ? 0.5 : 1),
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
      }}
      onClick={() => onCardClick?.(email)}
      onContextMenu={(e) => onContextMenu?.(e, email)}
    >
      <div className="drag-handle absolute left-1 top-1/2 -translate-y-1/2" />

      {email.isVerified && (
        <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--green-success)' }} title="AI verified" />
      )}

      {!email.isVerified && email.isProvisional && (
        <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full pulse-provisional" style={{ backgroundColor: 'var(--amber-alert)' }} />
      )}

      {email.hasConflict && (
        <div
          className="absolute top-0 right-8 text-micro font-semibold px-1 py-0.5 rounded"
          style={{ backgroundColor: 'var(--amber-alert)', color: 'black' }}
          title={`BASE: Step ${email.baseSuggestedStep} vs SMART: Step ${email.smartConfirmedStep}`}
        >
          Conflict
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pl-3">
        <span className="text-small font-medium truncate" style={{ color: 'var(--text-primary)' }}>{email.senderName || 'Unknown'}</span>
        <span className="text-micro shrink-0" style={{ color: 'var(--text-secondary)' }}>
          {safeFormat(email.sentAt, 'MMM d HH:mm')}
        </span>
      </div>

      <p className="text-body truncate pl-3" style={{ color: 'var(--text-secondary)' }} title={email.subject}>
        {email.subject}
      </p>

      {/* ── Supplier + Step Badges (ALWAYS show if available) ── */}
      <div className="flex flex-col gap-1 pl-3">
        {/* Supplier name from cross-mailbox matching */}
        {(email.supplierName || email.extracted?.supplier) && (
          <div className="flex items-center gap-1 flex-wrap">
            <Badge variant="smart" className="max-w-[180px] truncate" title={email.supplierName || email.extracted?.supplier || ''}>
              <Cpu className="w-3 h-3 mr-1 shrink-0" />
              {email.supplierName || email.extracted?.supplier}
            </Badge>
            {/* Step badge: from stepAssigned (BASE) or classification.step (SMART) */}
            {(email.stepAssigned || email.classification?.step) ? (
              <Badge variant={getStepBadgeVariant()} title={`Step ${email.stepAssigned || email.classification?.step}`}>
                Step {email.stepAssigned || email.classification?.step}
              </Badge>
            ) : null}
          </div>
        )}

        {/* Part number pills from NLP enrichment */}
        {email.extracted?.partNumbers && email.extracted.partNumbers.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {email.extracted.partNumbers.slice(0, 3).map((part, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-micro font-medium"
                style={{
                  backgroundColor: 'rgba(107, 61, 139, 0.3)',
                  color: 'var(--plum-accent)',
                  border: '1px solid rgba(107, 61, 139, 0.5)',
                }}
                title="Extracted part number"
              >
                <Hash className="w-2.5 h-2.5" />
                {part}
              </span>
            ))}
            {email.extracted.partNumbers.length > 3 && (
              <span className="text-micro px-1 py-0.5 rounded" style={{ color: 'var(--text-tertiary)' }}>
                +{email.extracted.partNumbers.length - 3} more
              </span>
            )}
          </div>
        )}

        {/* NLP enrichment indicator */}
        {email.classification?.confidence && email.classification.confidence > 0 && (
          <span className="text-micro" style={{ color: 'var(--text-tertiary)' }}>
            Confidence: {Math.round(email.classification.confidence * 100)}%
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 pl-3">
        {email.isInternal && <Badge variant="internal">Internal</Badge>}
        {email.isSentByUser && <Badge variant="sent">Sent</Badge>}
        {email.isLowConfidence && <Badge variant="pending">Low Conf</Badge>}
      </div>
    </div>
  );
}
