// @ts-nocheck
import { useApp } from '@/context/AppContext';
import type { Supplier } from '@/types';

function getSupplierColor(id: number): string {
  const colors = [
    'linear-gradient(to bottom, #492860, #6B3D8B)',
    'linear-gradient(to bottom, #2980B9, #3498DB)',
    'linear-gradient(to bottom, #27AE60, #2ECC71)',
    'linear-gradient(to bottom, #E67E22, #F5A623)',
    'linear-gradient(to bottom, #C0392B, #E74C3C)',
    'linear-gradient(to bottom, #8E44AD, #9B59B6)',
  ];
  return colors[(id - 1) % colors.length];
}

export function SupplierPane() {
  const { state, dispatch, getSupplierKpis } = useApp();

  const handleSelect = (id: number) => {
    dispatch({ type: 'SELECT_SUPPLIER', payload: state.selectedSupplierId === id ? null : id });
  };

  const selectedKpis = state.selectedSupplierId ? getSupplierKpis(state.selectedSupplierId) : null;

  return (
    <div
      className="w-[220px] shrink-0 flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--deep-plum-bg)' }}
    >
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>Suppliers</h2>
        <span
          className="text-micro font-semibold px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: 'var(--brand-plum)', color: 'white' }}
        >
          {state.suppliers.length}
        </span>
      </div>

      {selectedKpis && (
        <div
          className="px-3 py-3 grid grid-cols-5 gap-1 text-center"
          style={{
            backgroundColor: 'var(--kpi-strip-bg)',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <KpiItem label="Open" value={selectedKpis.openRfqs} />
          <KpiItem label="Avg Days" value={selectedKpis.avgResponseDays} />
          <KpiItem label="Success %" value={selectedKpis.quoteSuccessRate} />
          <KpiItem label="Alarms" value={selectedKpis.pendingAlarms} isAlarm />
          <KpiItem label="Last" value={selectedKpis.lastActivity} isDate />
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {state.suppliers.map((supplier) => (
          <SupplierItem
            key={supplier.id}
            supplier={supplier}
            isSelected={state.selectedSupplierId === supplier.id}
            onClick={() => handleSelect(supplier.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SupplierItem({
  supplier,
  isSelected,
  onClick,
}: {
  supplier: Supplier;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 group"
      style={{
        backgroundColor: isSelected ? 'var(--brand-plum)' : 'transparent',
        borderLeft: isSelected ? 'none' : '3px solid transparent',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(128,128,128,0.08)';
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <div
        className="w-1 h-8 rounded-full shrink-0"
        style={{ background: getSupplierColor(supplier.id) }}
      />
      <div className="flex-1 min-w-0">
        <div
          className="text-body font-medium truncate"
          style={{ color: isSelected ? 'white' : 'var(--text-secondary)' }}
        >
          {supplier.name}
        </div>
      </div>
      {supplier.openRfqCount > 0 && (
        <span
          className="text-micro font-semibold px-1.5 py-0.5 rounded-full shrink-0"
          style={{
            backgroundColor: isSelected ? 'rgba(255,255,255,0.2)' : 'var(--brand-plum)',
            color: 'white',
          }}
        >
          {supplier.openRfqCount}
        </span>
      )}
    </button>
  );
}

function KpiItem({
  label,
  value,
  isAlarm,
  isDate,
}: {
  label: string;
  value: number | string;
  isAlarm?: boolean;
  isDate?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-micro uppercase tracking-wider leading-tight" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span
        className="text-small font-bold leading-tight"
        style={{
          color: isAlarm && typeof value === 'number' && value > 0 ? 'var(--red-urgent)' : 'var(--text-primary)',
          fontSize: isDate ? '9px' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}
