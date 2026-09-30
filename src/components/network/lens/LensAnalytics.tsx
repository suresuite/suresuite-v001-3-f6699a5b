/**
 * The analytics section below the workspace (network-lenses handoff §11): a
 * section header and the horizontal bar card the three lenses share.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { LENS } from './tokens';

export function LensAnalyticsHeader({ subtitle, meta }: { subtitle: string; meta?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-[var(--hair-border)] pb-2.5">
      <div className="min-w-0">
        <h2 className={cn('text-[13px] font-semibold', LENS.ink)}>Analytics</h2>
        <p className={cn('text-[12px]', LENS.muted)}>{subtitle}</p>
      </div>
      {meta != null && <div className={cn('text-right font-mono text-[10px]', LENS.muted)}>{meta}</div>}
    </div>
  );
}

/** A white card with the lens header (13px title, 12px muted subtitle). */
export function LensCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-[4px] border bg-white', LENS.border, className)}>
      <div className={cn('border-b px-4 py-3', LENS.hairline)}>
        <h3 className={cn('text-[13px] font-semibold', LENS.ink)}>{title}</h3>
        {subtitle && <p className={cn('text-[12px]', LENS.muted)}>{subtitle}</p>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  display: string;
  color: string;
}

/** Rows of label · bar · value, the bar scaled to `max` (default: the largest value). */
export function BarRows({ rows, max, empty }: { rows: BarRow[]; max?: number; empty?: string }) {
  if (rows.length === 0) {
    return <p className={cn('py-4 text-center text-[12px]', LENS.muted)}>{empty ?? 'Nothing to show.'}</p>;
  }
  const top = max ?? Math.max(...rows.map((r) => r.value), 0);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <span className={cn('w-[132px] flex-none truncate text-[12px]', LENS.muted)} title={r.label}>
            {r.label}
          </span>
          <div className={cn('h-3.5 min-w-0 flex-1 overflow-hidden rounded-[2px]', LENS.track)}>
            <div
              className="h-full rounded-[2px]"
              style={{ width: `${top > 0 ? Math.max(0, (r.value / top) * 100) : 0}%`, background: r.color }}
            />
          </div>
          <span className={cn('w-16 flex-none text-right font-mono text-[11px] tabular-nums', LENS.body)}>{r.display}</span>
        </div>
      ))}
    </div>
  );
}

export function BarCard({
  title,
  subtitle,
  rows,
  max,
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  rows: BarRow[];
  max?: number;
  empty?: string;
  children?: ReactNode;
}) {
  return (
    <LensCard title={title} subtitle={subtitle}>
      {children}
      <BarRows rows={rows} max={max} empty={empty} />
    </LensCard>
  );
}
