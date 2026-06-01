import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'open' | 'pending' | 'approved' | 'closed' | 'base' | 'smart' | 'boost' | 'internal' | 'sent' | 'high' | 'medium' | 'low' | 'default';
  className?: string;
}

const variantStyles: Record<string, string> = {
  open: 'bg-[var(--brand-plum)] text-white',
  pending: 'bg-[var(--amber-alert)] text-black',
  approved: 'bg-[var(--green-success)] text-black',
  closed: 'bg-[var(--text-tertiary)] text-white',
  base: 'bg-[var(--brand-plum)] text-white',
  smart: 'bg-[var(--plum-accent)] text-white',
  boost: 'bg-[var(--amber-alert)] text-black',
  internal: 'bg-[var(--border-light)] text-[var(--text-secondary)]',
  sent: 'bg-[var(--plum-accent)] text-white',
  high: 'bg-[var(--red-urgent)] text-white',
  medium: 'bg-[var(--amber-alert)] text-black',
  low: 'bg-[var(--brand-plum-light)] text-white',
  default: 'bg-[var(--border-light)] text-[var(--text-secondary)]',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center h-5 px-2 rounded-full text-micro font-semibold whitespace-nowrap',
        variantStyles[variant] || variantStyles.default,
        className
      )}
    >
      {children}
    </span>
  );
}
