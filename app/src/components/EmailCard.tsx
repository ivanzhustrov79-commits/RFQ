import type { Email } from '@/context/AppContext';
import { Badge } from './Badge';
import { format, parseISO, isValid } from 'date-fns';
import { Cpu, Hash } from 'lucide-react';

// Safe date formatter that handles various date formats
function DateLabel({ sentAt }: { sentAt: string | undefined }) {
  if (!sentAt) return <span>—</span>;
  try {
    let date: Date;
    if (sentAt.includes('T') || sentAt.match(/^\d{4}-\d{2}-\d{2}/)) {
      date = parseISO(sentAt);
    } else {
      date = new Date(sentAt);
    }
    if (!isValid(date)) return <span>—</span>;
    return <span>{format(date, 'MMM d HH:mm')}</span>;
  } catch {
    return <span>—</span>;
  }
}

interface EmailCardProps {
  email: Email;
  onContextMenu?: (e: React.MouseEvent, email: Email) => void;
}

export function EmailCard({ email, onContextMenu }: EmailCardProps) {
  const getBorderStyle = () => {
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

  const hasNlp = email.extracted?.supplier || (email.extracted?.partNumbers && email.extracted.partNumbers.length > 0) || (email.classification?.step && email.classification.step > 0);

  return (
    <div
      className="email-card relative flex flex-col gap-1.5 p-2.5 rounded-md cursor-pointer transition-all duration-150"
      style={{
        backgroundColor: 'var(--card-bg)',
        border: getBorderStyle(),
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        opacity: email.isLowConfidence ? 0.7 : 1,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
      }}
      onContextMenu={(e) => onContextMenu?.(e, email)}
    >
      <div className="drag-handle absolute left-1 top-1/2 -translate-y-1/2" />

      {email.isProvisional && (
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
          <DateLabel sentAt={email.sentAt} />
        </span>
      </div>

      <p className="text-body truncate pl-3" style={{ color: 'var(--text-secondary)' }} title={email.subject}>
        {email.subject}
      </p>

      {/* ── NLP Badges ── */}
      {hasNlp && (
        <div className="flex flex-col gap-1 pl-3">
          {/* Supplier + Step row */}
          <div className="flex items-center gap-1 flex-wrap">
            {email.extracted?.supplier && (
              <Badge variant="smart" className="max-w-[140px] truncate" title={email.extracted.supplier}>
                <Cpu className="w-3 h-3 mr-1 shrink-0" />
                {email.extracted.supplier}
              </Badge>
            )}
            {email.classification?.step && email.classification.step > 0 && (
              <Badge variant={getStepBadgeVariant()} title={`Confidence: ${Math.round((email.classification.confidence || 0) * 100)}%`}>
                Step {email.classification.step}
              </Badge>
            )}
          </div>

          {/* Part number pills */}
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
                <span
                  className="text-micro px-1 py-0.5 rounded"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  +{email.extracted.partNumbers.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 pl-3">
        {email.isInternal && <Badge variant="internal">Internal</Badge>}
        {email.isSentByUser && <Badge variant="sent">Sent</Badge>}
        {email.isLowConfidence && <Badge variant="pending">Low Conf</Badge>}
      </div>
    </div>
  );
}
