// @ts-nocheck
import { useApp } from '@/context/AppContext';
import type { Email } from '@/types';
import { EmailCard } from './EmailCard';
import { workflowSteps } from '@/lib/mockData';
import { useState, useCallback } from 'react';

export function KanbanBoard() {
  const { state, dispatch, getFilteredEmails } = useApp();
  const filteredEmails = getFilteredEmails();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    email: Email | null;
  } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, email: Email) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, email });
  }, []);

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  const handleTroubleshoot = useCallback((_level: 1 | 2 | 3 | 4) => {
    if (contextMenu?.email) {
      dispatch({
        type: 'OPEN_TROUBLESHOOT',
        payload: { level: 1, targetId: contextMenu.email.id },
      });
    }
    setContextMenu(null);
  }, [contextMenu, dispatch]);

  const emailsByStep = workflowSteps.map(step => ({
    step,
    emails: filteredEmails.filter(e => e.stepAssigned === step.id),
  }));

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden relative"
      style={{ backgroundColor: 'var(--dark-bg)' }}
    >
      <div
        className="h-10 flex items-center px-4 shrink-0"
        style={{
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--header-bg)',
        }}
      >
        <h2 className="text-h2 font-semibold" style={{ color: 'var(--text-primary)' }}>Kanban Board</h2>
        <span className="text-small ml-2" style={{ color: 'var(--text-secondary)' }}>
          {filteredEmails.length} emails
          {state.selectedSupplierId && ' (filtered)'}
        </span>
      </div>

      <div className="flex-1 flex overflow-x-auto overflow-y-hidden custom-scrollbar px-2 pb-2 gap-2">
        {emailsByStep.map(({ step, emails }) => (
          <div
            key={step.id}
            className="w-[240px] shrink-0 flex flex-col rounded-md overflow-hidden"
            style={{ backgroundColor: 'var(--column-bg)' }}
          >
            <div
              className={`flex items-center justify-between px-3 py-2 column-header-gradient-${step.id}`}
              style={{
                backgroundColor: 'var(--card-bg)',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-h2 font-semibold" style={{ color: 'var(--text-primary)' }}>{step.stepName}</span>
                <span
                  className="text-micro font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--brand-plum)', color: 'white' }}
                >
                  {emails.length}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
              {emails.length === 0 ? (
                <div
                  className="h-20 flex items-center justify-center rounded-md border border-dashed"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <span className="text-small" style={{ color: 'var(--text-tertiary)' }}>Empty</span>
                </div>
              ) : (
                emails.map(email => (
                  <EmailCard key={email.id} email={email} onContextMenu={handleContextMenu} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {contextMenu && contextMenu.email && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={handleCloseContextMenu} />
          <div
            className="fixed z-[70] w-44 rounded-md overflow-hidden py-1"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              backgroundColor: 'var(--dark-bg)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
          >
            <div className="px-3 py-1 text-micro uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Email Level 1
            </div>
            {['Wrong Step', 'Duplicate', 'Missing Attachment', 'Other Issue'].map((item) => (
              <button
                key={item}
                className="w-full text-left px-3 py-1.5 text-body transition-colors hover:bg-[var(--brand-plum)] hover:text-white"
                style={{ color: 'var(--text-secondary)' }}
                onClick={() => handleTroubleshoot(1)}
              >
                {item}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
