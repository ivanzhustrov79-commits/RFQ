// @ts-nocheck
import { useApp } from '@/context/AppContext';
import type { Email, PartNumber } from '@/types';
import { differenceInDays, format, parseISO, isValid } from 'date-fns';
import { Clock, Hash, Mail, AlertCircle, FileText, DollarSign, Package, BarChart3 } from 'lucide-react';

function safeFormat(dateValue: string | Date | null | undefined, fmt: string = 'MMM d, HH:mm', fallback: string = '—'): string {
  if (!dateValue) return fallback;
  try {
    let date: Date;
    if (dateValue instanceof Date) { date = dateValue; }
    else if (typeof dateValue === 'string' && (dateValue.includes('T') || dateValue.match(/^\d{4}-\d{2}-\d{2}/))) { date = new Date(dateValue); }
    else { date = new Date(dateValue); }
    return isValid(date) ? format(date, fmt) : fallback;
  } catch { return fallback; }
}
function safeParse(dateValue: string | null | undefined): Date | null {
  if (!dateValue) return null;
  try {
    let date: Date;
    if (dateValue.includes('T') || dateValue.match(/^\d{4}-\d{2}-\d{2}/)) { date = parseISO(dateValue); }
    else { date = new Date(dateValue); }
    return isValid(date) ? date : null;
  } catch { return null; }
}
import { useState } from 'react';

type Tab = 'timeline' | 'parts' | 'summary';

export function AnalyticsPanel() {
  const { state, getFilteredEmails, getSelectedRfqParts, getSelectedRfqAlarms } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>('timeline');

  const filteredEmails = getFilteredEmails();
  const selectedRfqParts = getSelectedRfqParts();
  const selectedRfqAlarms = getSelectedRfqAlarms();
  const selectedRfq = state.rfqs.find(r => r.id === state.selectedRfqId);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'timeline', label: 'Timeline', icon: <Clock className="w-3.5 h-3.5" /> },
    { id: 'parts', label: 'Parts', icon: <Package className="w-3.5 h-3.5" /> },
    { id: 'summary', label: 'Summary', icon: <BarChart3 className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      className="w-[260px] shrink-0 flex flex-col overflow-hidden"
      style={{
        backgroundColor: 'var(--analytics-bg)',
        borderLeft: '1px solid var(--border-color)',
      }}
    >
      <div
        className="flex items-center h-9 shrink-0"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 flex items-center justify-center gap-1 h-full text-small font-medium transition-colors relative"
            style={{
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: 'var(--brand-plum)' }} />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
        {activeTab === 'timeline' && <TimelineTab emails={filteredEmails} />}
        {activeTab === 'parts' && <PartsTab parts={selectedRfqParts} />}
        {activeTab === 'summary' && selectedRfq && (
          <SummaryTab rfq={selectedRfq} emailCount={filteredEmails.length} alarmCount={selectedRfqAlarms.length} />
        )}
      </div>
    </div>
  );
}

function TimelineTab({ emails }: { emails: Email[] }) {
  if (emails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <Mail className="w-8 h-8 mb-2" style={{ color: 'var(--text-tertiary)' }} />
        <p className="text-small" style={{ color: 'var(--text-tertiary)' }}>No emails</p>
      </div>
    );
  }

  const sortedEmails = [...emails].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());

  return (
    <div className="space-y-2">
      {sortedEmails.map(email => (
        <div
          key={email.id}
          className="flex flex-col gap-1 p-2 rounded-md"
          style={{ backgroundColor: 'var(--card-bg)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-micro" style={{ color: 'var(--text-secondary)' }}>
              {safeFormat(email.sentAt, 'MMM d, HH:mm')}
            </span>
            <div className="flex items-center gap-1">
              {email.isInternal && (
                <span className="text-micro px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--border-light)', color: 'var(--text-secondary)' }}>
                  Internal
                </span>
              )}
              {email.isSentByUser && (
                <span className="text-micro px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--plum-accent)', color: 'white' }}>
                  Sent
                </span>
              )}
            </div>
          </div>
          <p className="text-small truncate" style={{ color: 'var(--text-primary)' }} title={email.subject}>
            {email.subject}
          </p>
          <p className="text-micro" style={{ color: 'var(--text-tertiary)' }}>{email.senderName}</p>
        </div>
      ))}
    </div>
  );
}

function PartsTab({ parts }: { parts: PartNumber[] }) {
  if (parts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <Package className="w-8 h-8 mb-2" style={{ color: 'var(--text-tertiary)' }} />
        <p className="text-small" style={{ color: 'var(--text-tertiary)' }}>No parts extracted</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {parts.map(part => (
        <div
          key={part.id}
          className="flex flex-col gap-1 p-2 rounded-md"
          style={{
            backgroundColor: part.isBestPrice ? 'rgba(46,204,113,0.08)' : 'var(--card-bg)',
            border: part.isBestPrice ? '1px solid rgba(46,204,113,0.2)' : '1px solid transparent',
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-small font-mono font-medium" style={{ color: 'var(--text-primary)' }}>{part.partNumber}</span>
            {part.isBestPrice && (
              <span className="text-micro font-semibold" style={{ color: 'var(--green-success)' }}>Best Price</span>
            )}
          </div>
          <p className="text-micro truncate" style={{ color: 'var(--text-secondary)' }} title={part.description}>
            {part.description}
          </p>
          <div className="flex items-center justify-between mt-0.5">
            <div className="flex items-center gap-1">
              <DollarSign className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
              <span className="text-small font-medium" style={{ color: 'var(--text-primary)' }}>
                {part.price.toLocaleString()} {part.currency}
              </span>
            </div>
            <span className="text-micro" style={{ color: 'var(--text-secondary)' }}>Qty: {part.quantity}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SummaryTab({
  rfq,
  emailCount,
  alarmCount,
}: {
  rfq: { id: number; rfqName: string; ciNumber: string | null; createdAt: string; status: string };
  emailCount: number;
  alarmCount: number;
}) {
  const createdDate = safeParse(rfq.createdAt);
  const daysOpen = createdDate ? differenceInDays(new Date(), createdDate) : 0;

  return (
    <div className="space-y-3">
      <SummaryCard icon={<Clock className="w-4 h-4" />} iconColor="var(--plum-accent)" label="Days Open" value={daysOpen.toString()} isKpi />
      <SummaryCard icon={<Hash className="w-4 h-4" />} iconColor="var(--blue-ci)" label="CI Number" value={rfq.ciNumber || 'Pending'} />
      <SummaryCard icon={<Mail className="w-4 h-4" />} iconColor="var(--plum-accent)" label="Total Emails" value={emailCount.toString()} isKpi />
      <SummaryCard
        icon={<AlertCircle className="w-4 h-4" />}
        iconColor={alarmCount > 0 ? 'var(--red-urgent)' : 'var(--green-success)'}
        label="Active Alarms"
        value={alarmCount.toString()}
        isKpi
        valueColor={alarmCount > 0 ? 'var(--red-urgent)' : 'var(--green-success)'}
      />
      <SummaryCard
        icon={<FileText className="w-4 h-4" />}
        iconColor="var(--text-secondary)"
        label="Risk Assessment"
        value={alarmCount > 2 ? 'High Risk' : alarmCount > 0 ? 'Medium Risk' : 'Low Risk'}
        valueColor={alarmCount > 2 ? 'var(--red-urgent)' : alarmCount > 0 ? 'var(--amber-alert)' : 'var(--green-success)'}
      />
    </div>
  );
}

function SummaryCard({
  icon,
  iconColor,
  label,
  value,
  isKpi,
  valueColor,
}: {
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  value: string;
  isKpi?: boolean;
  valueColor?: string;
}) {
  return (
    <div className="p-3 rounded-md" style={{ backgroundColor: 'var(--card-bg)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: iconColor }}>{icon}</span>
        <span className="text-small" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      </div>
      {isKpi ? (
        <span className="text-kpi font-bold" style={{ color: valueColor || 'var(--text-primary)' }}>{value}</span>
      ) : (
        <span className="text-body font-medium" style={{ color: valueColor || 'var(--text-primary)' }}>{value}</span>
      )}
    </div>
  );
}
