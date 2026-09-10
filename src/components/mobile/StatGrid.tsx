// The stat grid — one per screen, sitting between the thing that needs
// attention and the list (spec §13.4).
//
// A cell carries a 10px mono label and the figure. Nothing else: no delta
// line, no confidence line, no unit spelled out twice. Precision that matters
// (±0.03, n = 50) belongs on the detail screen (spec §6).
//
// The grid separates with 1px gap lines rather than borders — a #d4d4d4 fill
// showing through a 1px `gap`, so every internal rule is exactly one pixel at
// every device ratio and the outer frame is the same single border.
//
// Column count is not `auto-fit` by default, and that is the point. `auto-fit`
// with four cells orphans the fourth onto a row of its own at the widths where
// three fit — a real defect caught in review (spec §9.2). Columns are fixed
// from the cell count, and an odd last cell spans the row instead of leaving
// a hole.

import * as React from 'react';
import { cn } from '@/lib/utils';
import { M_LABEL } from './tokens';

export interface MobileStat {
  label: string;
  value: React.ReactNode;
  /** Optional 6px meaning dot beside the label. */
  dot?: string;
}

/** 2 for anything even, 3 for a clean multiple of three, 2 otherwise (the odd
 *  last cell then spans). Never `auto-fit`. */
function columnsFor(n: number): number {
  if (n <= 1) return 1;
  if (n % 2 === 0) return 2;
  if (n % 3 === 0) return 3;
  return 2;
}

export function MobileStatGrid({
  stats,
  columns,
  className,
}: {
  stats: MobileStat[];
  /** Override the derived count. Pass one only where the figures genuinely
   *  read better at another width — the default is right nearly always. */
  columns?: number;
  className?: string;
}) {
  if (stats.length === 0) return null;

  const cols = columns ?? columnsFor(stats.length);
  // 20px at three across, 28px at one or two — both inside the 20–28 band the
  // spec reserves for stat values, picked so the widest figure still fits at
  // 320px without shrinking the label.
  const valueSize = cols >= 3 ? 'text-[20px]' : 'text-[28px]';
  const orphan = stats.length % cols === 1;

  return (
    <div
      className={cn(
        'grid gap-px overflow-hidden rounded-[4px] border border-[#d4d4d4] bg-[#d4d4d4]',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {stats.map((s, i) => (
        <div
          key={`${s.label}-${i}`}
          className="flex min-w-0 flex-col gap-0.5 bg-white px-3 py-3"
          style={
            orphan && i === stats.length - 1 ? { gridColumn: `span ${cols}` } : undefined
          }
        >
          <span className={cn(M_LABEL, 'flex min-w-0 items-center gap-1.5 text-[#525252]')}>
            {s.dot && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: s.dot }}
              />
            )}
            <span className="min-w-0 truncate">{s.label}</span>
          </span>
          <span
            className={cn(
              valueSize,
              'font-semibold leading-[1.05] tracking-[-0.022em] tabular-nums text-[#18181b]',
            )}
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}
