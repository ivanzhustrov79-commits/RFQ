// @ts-nocheck
import { useApp } from '@/context/AppContext';
import { useState } from 'react';
import { X, Bell, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';

export function AlarmBoard() {
  const { state, dispatch } = useApp();
  const [visible, setVisible] = useState(false);
  const activeAlarms = state.alarms.filter(a => a.isActive);
  const dismissedAlarms = state.alarms.filter(a => !a.isActive);

  if (state.isAlarmBoardOpen && !visible) setTimeout(() => setVisible(true), 10);
  if (!state.isAlarmBoardOpen && visible) setTimeout(() => setVisible(false), 0);
  if (!state.isAlarmBoardOpen && !visible) return null;

  const handleClose = () => { setVisible(false); setTimeout(() => dispatch({ type: 'TOGGLE_ALARM_BOARD' }), 250); };

  return (
    <>
      <div className="fixed inset-0 z-[80] transition-opacity duration-200" style={{ backgroundColor: 'black', opacity: visible ? 0.6 : 0 }} onClick={handleClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[400px] z-[90] flex flex-col transition-transform duration-250 ease-out" style={{ backgroundColor: 'var(--deep-plum-bg)', borderLeft: '1px solid var(--border-color)', boxShadow: '-4px 0 24px rgba(0,0,0,0.6)', transform: visible ? 'translateX(0)' : 'translateX(100%)' }}>
        <div className="flex items-center justify-between px-4 h-12 shrink-0" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5" style={{ color: 'var(--amber-alert)' }} />
            <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>Alarm Board</h2>
            <span className="text-micro font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--red-urgent)', color: 'white' }}>{activeAlarms.length}</span>
          </div>
          <button onClick={handleClose} className="p-1 rounded-md transition-colors hover:bg-white/10"><X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} /></button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
          {activeAlarms.length === 0 && dismissedAlarms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12"><Bell className="w-10 h-10 mb-3" style={{ color: 'var(--text-tertiary)' }} /><p className="text-body" style={{ color: 'var(--text-secondary)' }}>No alarms</p></div>
          ) : (
            <>
              {activeAlarms.map(alarm => <AlarmItem key={alarm.id} alarm={alarm} isActive />)}
              {dismissedAlarms.length > 0 && <div className="pt-2 pb-1"><span className="text-micro uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Dismissed (24h)</span></div>}
              {dismissedAlarms.map(alarm => <AlarmItem key={alarm.id} alarm={alarm} isActive={false} />)}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function AlarmItem({ alarm, isActive }: { alarm: { id: number; rfqId: number; alarmType: string; urgency: string; reason: string; isActive: boolean; dismissedUntil: string | null; createdAt: string }; isActive: boolean }) {
  const { state, dispatch } = useApp();
  const urgencyColor = alarm.urgency === 'High' ? 'var(--red-urgent)' : alarm.urgency === 'Medium' ? 'var(--amber-alert)' : 'var(--brand-plum-light)';
  const rfq = state.rfqs.find(r => r.id === alarm.rfqId);
  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-md transition-opacity" style={{ backgroundColor: 'var(--card-bg)', borderLeft: `4px solid ${urgencyColor}`, opacity: isActive ? 1 : 0.4 }}>
      <div className="flex items-center justify-between">
        <span className="text-body font-semibold" style={{ color: 'var(--text-primary)' }}>{alarm.alarmType}</span>
        <span className="text-micro font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: urgencyColor, color: alarm.urgency === 'Medium' ? 'black' : 'white' }}>{alarm.urgency}</span>
      </div>
      <p className="text-small" style={{ color: 'var(--text-secondary)' }}>{alarm.reason}</p>
      {rfq && <p className="text-micro truncate" style={{ color: 'var(--plum-accent)' }}>{rfq.rfqName}</p>}
      <div className="flex items-center justify-between mt-0.5">
        <div className="flex items-center gap-1 text-micro" style={{ color: 'var(--text-tertiary)' }}><Clock className="w-3 h-3" />{format(parseISO(alarm.createdAt), 'MMM d, HH:mm')}</div>
        {isActive && <button onClick={() => dispatch({ type: 'DISMISS_ALARM', payload: alarm.id })} className="text-micro px-2 py-0.5 rounded transition-colors hover:bg-white/10" style={{ color: 'var(--text-secondary)' }}>Dismiss</button>}
      </div>
    </div>
  );
}
