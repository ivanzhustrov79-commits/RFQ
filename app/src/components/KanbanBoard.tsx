// @ts-nocheck
import { useApp } from '@/context/AppContext';
import type { Email } from '@/types';
import { EmailCard } from './EmailCard';
import { EmailDetailPanel } from './EmailDetailPanel';
import { workflowSteps } from '@/lib/mockData';
import { useState, useCallback } from 'react';

export function KanbanBoard() {
  const { state, dispatch, getFilteredEmails } = useApp();
  const filteredEmails = getFilteredEmails();
  const selectedSupplier = state.suppliers.find(s => s.id === state.selectedSupplierId);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    email: Email | null;
  } | null>(null);

  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [overrideLoading, setOverrideLoading] = useState<string | null>(null); // messageId being overridden

  const handleCardClick = useCallback((email: Email) => {
    setSelectedEmail(prev => prev?.id === email.id ? null : email);
  }, []);

  const handleClosePanel = useCallback(() => setSelectedEmail(null), []);

  const handleContextMenu = useCallback((e: React.MouseEvent, email: Email) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, email });
  }, []);

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  const handleStepOverride = useCallback(async (targetStep: number) => {
    const email = contextMenu?.email;
    if (!email) return;
    setContextMenu(null);

    const previousStep = email.stepAssigned ?? 0;
    if (previousStep === targetStep) return; // no-op

    setOverrideLoading(email.messageId);

    // Optimistic update — move card immediately
    dispatch({
      type: 'OVERRIDE_EMAIL_STEP',
      payload: { messageId: email.messageId, newStep: targetStep },
    });

    // Also update selectedEmail panel if it's showing this email
    setSelectedEmail(prev =>
      prev?.messageId === email.messageId
        ? { ...prev, stepAssigned: targetStep, isLowConfidence: false, hasConflict: false }
        : prev
    );

    try {
      const res = await fetch('http://127.0.0.1:8721/db/email/step', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: email.messageId,
          new_step: targetStep,
          previous_step: previousStep,
        }),
      });
      if (!res.ok) {
        console.warn('[OVERRIDE] Failed:', await res.text());
        // Roll back optimistic update
        dispatch({
          type: 'OVERRIDE_EMAIL_STEP',
          payload: { messageId: email.messageId, newStep: previousStep },
        });
      }
    } catch (err) {
      console.warn('[OVERRIDE] Network error:', err);
      dispatch({
        type: 'OVERRIDE_EMAIL_STEP',
        payload: { messageId: email.messageId, newStep: previousStep },
      });
    } finally {
      setOverrideLoading(null);
    }
  }, [contextMenu, dispatch]);

  const emailsByStep = workflowSteps.map(step => ({
    step,
    emails: filteredEmails.filter(e => e.stepAssigned === step.id),
  }));

  const currentStep = contextMenu?.email?.stepAssigned ?? -1;

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
        </span>
        {state.selectedSupplierId && selectedSupplier && (
          <span className="text-small ml-2 px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--brand-plum)', color: 'white' }}>
            {selectedSupplier.name}
          </span>
        )}
        {state.selectedSupplierId && (
          <button
            onClick={() => {
              dispatch({ type: 'SELECT_SUPPLIER', payload: null });
              dispatch({ type: 'SELECT_RFQ', payload: null });
            }}
            className="ml-2 text-micro underline hover:no-underline"
            style={{ color: 'var(--plum-accent)' }}
          >
            Clear filter
          </button>
        )}
      </div>

      <div key={`board-${state.selectedSupplierId ?? 'all'}`} className="flex-1 flex overflow-x-auto overflow-y-hidden custom-scrollbar px-2 pb-2 gap-2">
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
                  <EmailCard
                    key={email.messageId || email.id}
                    email={email}
                    isSelected={selectedEmail?.id === email.id}
                    isOverriding={overrideLoading === email.messageId}
                    onCardClick={handleCardClick}
                    onContextMenu={handleContextMenu}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Detail panel ── */}
      <EmailDetailPanel email={selectedEmail} onClose={handleClosePanel} />

      {/* ── Step override context menu ── */}
      {contextMenu && contextMenu.email && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={handleCloseContextMenu} />
          <div
            className="fixed z-[70] w-52 rounded-md overflow-hidden py-1"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 220),
              top: Math.min(contextMenu.y, window.innerHeight - 220),
              backgroundColor: 'var(--dark-bg)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
          >
            <div className="px-3 py-1.5" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <p className="text-micro uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                Move to step
              </p>
              <p className="text-micro truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {contextMenu.email.subject || '(no subject)'}
              </p>
            </div>
            {workflowSteps.map((step) => {
              const isCurrent = step.id === currentStep;
              return (
                <button
                  key={step.id}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors"
                  style={{
                    color: isCurrent ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                    backgroundColor: isCurrent ? 'rgba(128,128,128,0.08)' : 'transparent',
                    cursor: isCurrent ? 'default' : 'pointer',
                  }}
                  disabled={isCurrent}
                  onClick={() => !isCurrent && handleStepOverride(step.id)}
                  onMouseEnter={(e) => {
                    if (!isCurrent) e.currentTarget.style.backgroundColor = 'rgba(73,40,96,0.3)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrent) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <span
                    className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-micro font-bold"
                    style={{
                      backgroundColor: isCurrent ? 'var(--text-tertiary)' : 'var(--brand-plum)',
                      color: 'white',
                    }}
                  >
                    {step.id}
                  </span>
                  <span className="text-body">{step.stepName}</span>
                  {isCurrent && (
                    <span className="ml-auto text-micro" style={{ color: 'var(--text-tertiary)' }}>current</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
