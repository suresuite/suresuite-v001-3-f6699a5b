import { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  title: string;
  badge?: string;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * The contract card (C4): `rounded-lg border border-border bg-card p-4 shadow-xs`
 * with a `text-sm font-semibold` heading. Lifted from the local `Section` in
 * AdminUserAccess.tsx — the one admin file already on-language.
 */
export function SectionCard({ title, badge, description, className, children }: SectionCardProps) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-4 shadow-xs', className)}>
      <div className={cn('flex items-center gap-2', description ? 'mb-1' : 'mb-3')}>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {badge && (
          <Badge variant="secondary" className="text-[10px] font-medium">
            {badge}
          </Badge>
        )}
      </div>
      {description && <div className="mb-3 text-xs text-muted-foreground">{description}</div>}
      {children}
    </section>
  );
}
