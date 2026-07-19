import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Inline code chip — the repeated `rounded-md border bg-muted/50` fragment. */
export function InlineCode({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        'rounded-md border border-border bg-muted/50 px-3 py-1.5 font-mono text-[11px]',
        className,
      )}
    >
      {children}
    </code>
  );
}
