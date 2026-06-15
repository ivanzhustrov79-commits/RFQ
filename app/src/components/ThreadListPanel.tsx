// ThreadListPanel.tsx
// Replace RFQSummaryColumn - shows grouped RFQ threads

import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { ChevronRight, Mail, DollarSign, CheckCircle, Clock } from 'lucide-react';

interface Thread {
  id: number;
  supplier_id: number;
  subject_prefix: string;
  email_count: number;
  step_count: number;
  earliest_step: number;
  latest_step: number;
  last_email_at: string;
  enriched_count: number;
}

export function ThreadListPanel() {
  const { state } = useApp();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedSupplier = state.selectedSupplierId
    ? state.suppliers.find(s => s.id === state.selectedSupplierId)
    : null;

  useEffect(() => {
    if (!selectedSupplier) {
      setThreads([]);
      return;
    }

    setLoading(true);
    fetch(`http://127.0.0.1:8721/db/supplier/${selectedSupplier.id}/threads`)
      .then(r => r.json())
      .then(d => setThreads(d.threads || []))
      .catch(err => {
        console.error('[THREADS] Failed to load:', err);
        setThreads([]);
      })
      .finally(() => setLoading(false));
  }, [selectedSupplier]);

  if (!selectedSupplier) {
    return (
      <div className="p-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
        <p className="text-small">Select a supplier to view RFQ threads</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-h3 font-semibold" style={{ color: 'var(--text-primary)' }}>
          {selectedSupplier.name} Threads
        </h3>
        <span className="text-small" style={{ color: 'var(--text-secondary)' }}>
          {threads.length}
        </span>
      </div>

      {loading ? (
        <p className="text-small italic" style={{ color: 'var(--text-tertiary)' }}>Loading threads...</p>
      ) : threads.length === 0 ? (
        <p className="text-small italic" style={{ color: 'var(--text-tertiary)' }}>No RFQ threads found</p>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
          {threads.map(thread => (
            <ThreadCard key={thread.id} thread={thread} supplierId={selectedSupplier.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadCard({ thread, supplierId }: { thread: Thread; supplierId: number }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  const handleExpand = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    try {
      const res = await fetch(`http://127.0.0.1:8721/db/thread/${thread.id}`);
      const data = await res.json();
      setDetail(data);
      setExpanded(true);
    } catch (err) {
      console.error('[THREAD] Failed to load detail:', err);
    }
  };

  const enrichPercent = thread.email_count > 0
    ? Math.round((thread.enriched_count / thread.email_count) * 100)
    : 0;

  return (
    <div
      className="rounded-md border cursor-pointer transition-colors hover:opacity-90"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--card-bg)' }}
      onClick={handleExpand}
    >
      <div className="p-2 flex items-start gap-2">
        <ChevronRight
          className="w-4 h-4 shrink-0 mt-0.5 transition-transform"
          style={{
            color: 'var(--text-secondary)',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
          }}
        />

        <div className="flex-1 min-w-0">
          <p className="text-small font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {thread.subject_prefix}
          </p>

          <div className="flex items-center gap-2 mt-1 flex-wrap text-micro">
            <span style={{ color: 'var(--text-secondary)' }}>
              <Mail className="w-3 h-3 inline mr-0.5" />
              {thread.email_count} emails
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Step {thread.earliest_step}→{thread.latest_step}
            </span>
            <span style={{ color: 'var(--plum-accent)' }}>
              {enrichPercent}% enriched
            </span>
          </div>
        </div>
      </div>

      {expanded && detail && (
        <div className="px-2 pb-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
          {detail.stats?.part_numbers?.length > 0 && (
            <div className="mt-2">
              <p className="text-micro font-semibold mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Parts:
              </p>
              <div className="flex flex-wrap gap-1">
                {detail.stats.part_numbers.slice(0, 5).map((part: string, i: number) => (
                  <span key={i} className="text-micro px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(107,61,139,0.2)', color: 'var(--plum-accent)' }}>
                    {part}
                  </span>
                ))}
                {detail.stats.part_numbers.length > 5 && (
                  <span className="text-micro px-1.5 py-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    +{detail.stats.part_numbers.length - 5}
                  </span>
                )}
              </div>
            </div>
          )}

          <p className="text-micro mt-2" style={{ color: 'var(--text-tertiary)' }}>
            {detail.emails?.length} emails in thread
          </p>
        </div>
      )}
    </div>
  );
}
