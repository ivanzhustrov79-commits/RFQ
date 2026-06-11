// @ts-nocheck
import { useApp } from '@/context/AppContext';
import { Cpu, Mail } from 'lucide-react';

function getSupplierColor(id: number): string {
  const colors = [
    'linear-gradient(to bottom, #492860, #6B3D8B)',
    'linear-gradient(to bottom, #2980B9, #3498DB)',
    'linear-gradient(to bottom, #27AE60, #2ECC71)',
    'linear-gradient(to bottom, #E67E22, #F5A623)',
    'linear-gradient(to bottom, #C0392B, #E74C3C)',
  ];
  return colors[(id - 1) % colors.length];
}

export function SupplierPane() {
  const { state, dispatch } = useApp();

  const handleSelect = (id: number) => {
    const isAlreadySelected = state.selectedSupplierId === id;
    if (isAlreadySelected) {
      // Deselect — clear both supplier and RFQ filter
      dispatch({ type: 'SELECT_SUPPLIER', payload: null });
      dispatch({ type: 'SELECT_RFQ', payload: null });
    } else {
      // Select new supplier — clear RFQ selection to avoid stale state
      dispatch({ type: 'SELECT_SUPPLIER', payload: id });
      dispatch({ type: 'SELECT_RFQ', payload: null });
    }
  };

  return (
    <div className="w-[220px] shrink-0 flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--deep-plum-bg)' }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <h2 className="text-h1 font-semibold" style={{ color: 'var(--text-primary)' }}>Suppliers</h2>
        <span className="text-micro font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--brand-plum)', color: 'white' }}>
          {state.suppliers.length}
        </span>
      </div>

      <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(107,61,139,0.1)' }}>
        <div className="flex flex-col">
          <span className="text-micro" style={{ color: 'var(--text-tertiary)' }}>RFQs</span>
          <span className="text-h2 font-bold" style={{ color: 'var(--text-primary)' }}>{state.suppliers.length}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-micro" style={{ color: 'var(--text-tertiary)' }}>Emails</span>
          <span className="text-h2 font-bold" style={{ color: 'var(--text-primary)' }}>{state.emails.length}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {state.suppliers.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Cpu className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }} />
            <span className="text-micro" style={{ color: 'var(--text-tertiary)' }}>No suppliers yet</span>
            <p className="text-micro mt-1" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }}>Sync a folder to create suppliers</p>
          </div>
        ) : (
          state.suppliers.map((supplier: any) => {
            const isSelected = state.selectedSupplierId === supplier.id;
            return (
              <button
                key={supplier.id}
                onClick={() => handleSelect(supplier.id)}
                className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                style={{
                  borderLeft: isSelected ? '3px solid var(--plum-accent)' : '3px solid transparent',
                  backgroundColor: isSelected ? 'rgba(107,61,139,0.2)' : 'transparent',
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: getSupplierColor(supplier.id) }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-small font-medium truncate block" style={{ color: 'var(--text-primary)' }}>{supplier.name}</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Mail className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                      <span className="text-micro" style={{ color: 'var(--text-tertiary)' }}>{supplier.total_emails || 0} emails</span>
                      {supplier.enriched_emails > 0 && (
                        <span className="text-micro" style={{ color: 'var(--green-success)' }}>({supplier.enriched_emails} AI)</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
