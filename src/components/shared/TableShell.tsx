import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Card treatment for data tables (C4/C8). */
export function TableShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-lg border border-border bg-card shadow-xs overflow-hidden', className)}>
      {children}
    </div>
  );
}
