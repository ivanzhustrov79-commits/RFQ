import type { Email } from '@/types';
import { Badge } from './Badge';
import { format, parseISO } from 'date-fns';

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
          {email.sentAt ? format(parseISO(email.sentAt), 'MMM d HH:mm') : '—'}
        </span>
      </div>

      <p className="text-body truncate pl-3" style={{ color: 'var(--text-secondary)' }} title={email.subject}>
        {email.subject}
      </p>

      <div className="flex items-center gap-1 pl-3">
        {email.isInternal && <Badge variant="internal">Internal</Badge>}
        {email.isSentByUser && <Badge variant="sent">Sent</Badge>}
        {email.isLowConfidence && <Badge variant="pending">Low Conf</Badge>}
      </div>
    </div>
  );
}
