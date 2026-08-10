import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Card treatment for data tables (C4/C8). */
export function TableShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-sm border border-[--hair-border] bg-card shadow-xs overflow-hidden', className)}>
      {children}
    </div>
  );
}

interface TableNameProps {
  /** The table's name. Sentence case — it is a label, not a heading. */
  name: string;
  /** Row count, rendered as the outlined chip beside the name. */
  count?: number | string;
  /** Normal-weight meta that used to sit in the in-card title bar. */
  meta?: ReactNode;
  /** Actions that used to sit in the in-card title bar; right-aligned. */
  actions?: ReactNode;
}

/**
 * L1 — the table's name, on the canvas above the shell.
 *
 * The three table levels have to read as three things: the name (canvas), the
 * column row (ink) and the content (white). Keeping the name in an in-card
 * title bar collapsed it into the header at a 92% canvas, so it moves out.
 * Use via `TableBlock`, or render directly when a page needs the row itself.
 */
export function TableName({ name, count, meta, actions }: TableNameProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] font-semibold text-foreground">{name}</span>
      {count !== undefined && (
        <span className="whitespace-nowrap rounded-sm border border-[--zinc-border] bg-white px-1.5 py-px font-mono text-[9px] text-[--zinc-quiet]">
          {count}
        </span>
      )}
      {meta && <span className="text-[11.5px] text-[--zinc-quiet]">{meta}</span>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** `TableName` + `TableShell` in the L1 stack: name row, then the card. */
export function TableBlock({
  name,
  count,
  meta,
  actions,
  className,
  children,
}: TableNameProps & { className?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <TableName name={name} count={count} meta={meta} actions={actions} />
      <TableShell className={className}>{children}</TableShell>
    </div>
  );
}
