// Ledger tables on mobile.
//
// The ledger treatment (§3.9) is 4-6 columns at px-4 py-[9px]. That cannot fit
// 390px, and horizontal scroll inside a vertically-scrolling page is a poor
// trade on touch.
//
// Below md, render the same rows as a card list: primary identifier + status on
// one line, the mono sub-line beneath, and the numeric columns as labelled chips.
// The chips reuse the ledger's own MonoChip vocabulary, so it still reads as a
// ledger rather than a different component.

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { SURFACE } from '@/components/admin/adminUi';

export type LedgerColumn<T> = {
  key: string;
  header: string;
  align?: 'left' | 'right';
  mono?: boolean;
  /** Mobile role: how this column appears in the card. */
  mobile?: 'title' | 'status' | 'sub' | 'metric' | 'hide';
  render: (row: T) => React.ReactNode;
};

// The repo addresses these tokens as Tailwind arbitrary values referencing the CSS
// var directly - `border-[--hair-border]`, as in adminUi.tsx's SURFACE. Use that
// form, never a raw hex.
const TH =
  'text-left font-mono text-[11px] uppercase tracking-[0.04em] font-medium ' +
  'text-[--hair-quiet] bg-[#fafafa] border-b border-[--hair-border] px-4 py-2 whitespace-nowrap';
const TD = 'px-4 py-[9px] border-b border-[--hair-divider] align-middle';

export function ResponsiveLedger<T>({
  columns,
  rows,
  rowKey,
  empty = 'Nothing to show yet.',
}: {
  columns: LedgerColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
}) {
  const isMobile = useIsMobile();

  if (rows.length === 0) {
    return (
      <div className="rounded-sm border border-[#ebebeb] bg-white px-4 py-14 text-center">
        <p className="mx-auto max-w-sm text-[13px] text-muted-foreground">{empty}</p>
      </div>
    );
  }

  if (!isMobile) {
    return (
      <div className={cn(SURFACE, 'overflow-x-auto shadow-xs')}>
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(TH, c.align === 'right' && 'text-right')}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-[#fcfcfc]" /* --surface-raised */>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      TD,
                      c.align === 'right' && 'text-right',
                      c.mono && 'font-mono tabular-nums',
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const col = (role: LedgerColumn<T>['mobile']) =>
    columns.filter((c) => c.mobile === role);
  const [title] = col('title');
  const [status] = col('status');
  const subs = col('sub');
  const metrics = col('metric');

  return (
    <div className={cn(SURFACE, 'overflow-hidden shadow-xs')}>
      {rows.map((row) => (
        <div key={rowKey(row)} className="border-b border-[--hair-divider] p-3 last:border-b-0">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
              {title?.render(row)}
            </span>
            {status && <span className="shrink-0">{status.render(row)}</span>}
          </div>

          {subs.length > 0 && (
            <div className="mt-1.5 break-words font-mono text-[11px] text-muted-foreground">
              {subs.map((c, i) => (
                <React.Fragment key={c.key}>
                  {i > 0 && ' · '}
                  {c.render(row)}
                </React.Fragment>
              ))}
            </div>
          )}

          {metrics.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {metrics.map((c) => (
                <span
                  key={c.key}
                  className="inline-flex items-baseline gap-1.5 whitespace-nowrap
                             rounded-[3px] border border-[--zinc-border] px-1.5 py-px"
                >
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em]
                                   text-muted-foreground">
                    {c.header}
                  </span>
                  <span className="font-mono text-[11.5px] tabular-nums text-foreground">
                    {c.render(row)}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Notes ───────────────────────────────────────────────────────────────────
//
// * Row height on desktop still varies by page: py-[11px] Developer API,
//   py-[9px] admin, py-1.5 sim/PI, py-[5px] sim parameter cards. Pass the class
//   through if you generalise this further.
// * Simulation tables divide on --sim-divider (#ececee), not #f4f4f4. Match
//   whatever the neighbouring panels use.
// * Sorting (asc → desc → unsorted, ▲/▼ appended to the header) has no place in
//   the card view. Expose it as a sort control above the list instead of dropping
//   the capability.
// * Numerics keep tabular-nums in both views.
