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
  const orphan = stats.length % cols === 1;

  // A figure is never clipped and never rounded off to look tidier (§6, §12),
  // so when the longest one will not fit the cell at 28px, the TYPE steps down
  // inside the 20-28 band the spec reserves for stat values — the number does
  // not change.
  //
  // The ladder is calibrated at 320px, the narrowest width the skin holds. A
  // 2-up cell is (320 - 32 gutter - 1 gap)/2 - 24 padding = 118px of inner
  // width, and Inter's tabular digit runs about 0.62em — so eight characters
  // need ~24px and an 8-digit seed at 28px overflowed its cell by 18px. 3-up
  // starts at 20px because the cell is 71px wide before anything else.
  const longest = stats.reduce(
    (n, s) => Math.max(n, String(s.value).length),
    0,
  );
  const valueSize =
    cols >= 3 || longest > 9 ? 'text-[20px]' : longest > 6 ? 'text-[22px]' : 'text-[28px]';

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
            {/* The label is the one thing in a stat cell allowed to ellipse —
                the figure never is — so it carries its full text in `title`. */}
            <span className="min-w-0 truncate" title={s.label}>
              {s.label}
            </span>
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
