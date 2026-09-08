// Mobile-only presentation for the three network lens pages
// (Product-Level, Process-Level, Firm-Level).
//
// Spec: docs/mobile-ui-spec.md §2.3 (grids that cannot overflow), §2.4 (44px
// touch floor), §2.5 (min-w-0 / no shrink-0 on text), §2.7 (tables scroll and
// freeze their identifying column), §3.1 (the adaptive-text ladder), §3.3
// (numbers never adapt), §3.4 (the disclosure card).
//
// Everything here renders inside each page's `md:hidden` subtree, so none of
// it can reach a desktop viewport - the desktop trees import nothing from this
// file. It exists because the same composition was hand-copied into three
// 1200+ line pages, which is how the three drifted apart in the first place.
//
// Presentational only: no hook that fetches, no state a caller reads. The one
// piece of local state is `Disclosure`'s open/closed, which is the shared
// primitive's own and is sanctioned by spec §0.1 A.

import * as React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Disclosure } from '@/components/shared';

/* ── the lens badge ────────────────────────────────────────────────────── */

export type LensTone = 'violet' | 'teal' | 'amber';

const LENS_TONE: Record<LensTone, string> = {
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};

export function LensChip({ tone, children }: { tone: LensTone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-0.5',
        'font-mono text-[10px] font-semibold uppercase tracking-widest',
        LENS_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/* ── section rule ──────────────────────────────────────────────────────── */

/**
 * The mono kicker + hairline that separates the lens sections, with an
 * optional trailing note. The kicker is `shrink-0` because it is fixed
 * chrome; the rule takes the slack (spec §2.5 rule 2 covers text, not this).
 */
export function LensRule({
  children,
  trailing,
}: {
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 pb-2">
      {/* `whitespace-nowrap` rather than `shrink-0`: these are short fixed
          labels, but spec 2.5 rule 2 keeps `shrink-0` off anything textual so
          a long one can never push the row past the viewport. The rule between
          them is the flex child that takes the slack. */}
      <span className="whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {children}
      </span>
      <span className="h-px min-w-0 flex-1 bg-border" />
      {trailing && (
        <span className="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
          {trailing}
        </span>
      )}
    </div>
  );
}

/* ── "How to read this" ────────────────────────────────────────────────── */

export interface ColumnDef {
  term: string;
  def: string;
}

/**
 * Spec §3.4 / demo entry 08: the definitions live behind a disclosure so they
 * are available *before* the numbers without occupying the screen. Three
 * groups, in the demo's order: Scope, Findings, Columns.
 */
export function LensHowToRead({
  scope,
  findings,
  columns,
}: {
  scope: string;
  findings: string;
  columns: ColumnDef[];
}) {
  return (
    <Disclosure summary="How to read this">
      <div className="flex flex-col gap-3.5">
        <LensNote label="Scope">{scope}</LensNote>
        <LensNote label="Findings">{findings}</LensNote>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Columns
          </span>
          <dl className="m-0 flex flex-col gap-1.5">
            {columns.map((c) => (
              <div key={c.term} className="flex min-w-0 gap-2.5">
                <dt className="w-[86px] shrink-0 font-medium text-foreground">{c.term}</dt>
                <dd className="m-0 min-w-0 flex-1 [text-wrap:pretty]">{c.def}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Disclosure>
  );
}

function LensNote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 [text-wrap:pretty]">{children}</span>
    </div>
  );
}

/* ── the "graph is desktop-only" notice ────────────────────────────────── */

export function LensDesktopOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-sm border border-border bg-muted/40 px-3 py-2">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <p className="min-w-0 text-[12px] leading-relaxed text-muted-foreground [text-wrap:pretty]">
        {children}
      </p>
    </div>
  );
}

/* ── network structure: the 2-up stat grid ─────────────────────────────── */

export interface StructureItem {
  label: string;
  value: string;
  red?: boolean;
}

/**
 * Fixed 2-up. `minmax(0,1fr)` + `min-w-0` per spec §2.3 - a bare `1fr` floors
 * at its widest child, which is what makes a "responsive" grid scroll
 * sideways at 320. Labels wrap rather than truncate (spec §4.5).
 */
export function LensStructure({ items }: { items: StructureItem[] }) {
  return (
    <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 [&>*]:min-w-0">
      {items.map((it) => (
        <div key={it.label} className="min-w-0 rounded-sm border border-border p-3">
          <p
            className={cn(
              'text-[length:var(--fs-stat)] font-semibold leading-none tabular-nums tracking-[-0.02em]',
              it.red && 'text-destructive',
            )}
          >
            {it.value}
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground [text-wrap:pretty]">
            {it.label}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ── structural risk: label / value rows ───────────────────────────────── */

export interface RiskRow {
  label: string;
  value: string;
}

export function LensRisk({ rows, alert }: { rows: RiskRow[]; alert?: React.ReactNode }) {
  return (
    <>
      <div className="divide-y divide-border rounded-sm border border-border">
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1 text-[13px] leading-snug text-muted-foreground [text-wrap:pretty]">
              {r.label}
            </span>
            {/* spec §3.3 - a figure is never truncated, abbreviated or wrapped */}
            <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold tabular-nums">
              {r.value}
            </span>
          </div>
        ))}
      </div>
      {alert && (
        <div className="mt-2 flex min-w-0 items-start gap-2 rounded-sm border border-destructive/40 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <p className="min-w-0 text-[12px] leading-relaxed text-destructive [text-wrap:pretty]">
            {alert}
          </p>
        </div>
      )}
    </>
  );
}

/* ── centrality table ──────────────────────────────────────────────────── */

export interface LensColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

export interface LensCell {
  text: string;
  className?: string;
}

export interface LensRow {
  key: string;
  /** The identifying value. Frozen in the first column and carried in `title`. */
  id: string;
  cells: LensCell[];
}

/**
 * Spec §2.7: the column set IS the information, so the table keeps every
 * column, scrolls sideways, and freezes the identifying column so a row never
 * loses its name mid-swipe. The frozen cells carry an opaque background of
 * their own - a sticky cell without one lets the columns underneath show
 * through as it passes.
 *
 * No `md:` releases here: the whole subtree is inside the page's `md:hidden`,
 * so it has no desktop rendering to protect.
 */
export function LensTable({
  columns,
  rows,
  minWidth,
  empty,
  loading = false,
  caption,
  action,
}: {
  columns: LensColumn[];
  rows: LensRow[];
  minWidth: number;
  empty: string;
  loading?: boolean;
  caption?: string;
  action?: React.ReactNode;
}) {
  const span = columns.length;
  const hasRows = !loading && rows.length > 0;
  return (
    <div className="min-w-0 overflow-hidden rounded-sm border border-border bg-card">
      <div className="overflow-x-auto overscroll-x-contain">
        {/* The min-width is what forces the sideways scroll that keeps every
            column (spec 2.7) - but only when there are rows to scroll. An
            empty or loading table stays inside the viewport so its message
            can wrap instead of running off the edge. */}
        <table
          className="w-full border-collapse whitespace-nowrap text-[13px]"
          style={hasRows ? { minWidth: `${minWidth}px` } : undefined}
        >
          <thead className={hasRows ? undefined : 'sr-only'}>
            <tr className="border-b border-border bg-muted">
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    'bg-muted px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground',
                    c.align === 'right' ? 'text-right' : 'text-left',
                    i === 0 && 'sticky left-0 z-[2]',
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={span} className="whitespace-normal px-3 py-4 text-center text-[12px] text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={span} className="whitespace-normal px-3 py-4 text-center text-[12px] leading-relaxed text-muted-foreground [text-wrap:pretty]">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key}>
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] max-w-[128px] bg-card px-3 py-2 text-left font-medium"
                  >
                    {/* rung 2 of the ladder: the ellipsis needs a block box of
                        its own - `truncate` on a <td>/<th> is ignored by the
                        table layout algorithm and clips without a marker. */}
                    <span className="block max-w-[104px] truncate" title={r.id}>
                      {r.id}
                    </span>
                  </th>
                  {r.cells.map((c, i) => (
                    <td
                      key={columns[i + 1]?.key ?? i}
                      className={cn(
                        'px-3 py-2',
                        columns[i + 1]?.align === 'right' && 'text-right tabular-nums',
                        c.className,
                      )}
                    >
                      {c.text}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {(caption || action) && (
        <div className="flex min-w-0 items-center gap-3 border-t border-border px-3 py-2">
          {caption && (
            <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-muted-foreground [text-wrap:pretty]">
              {caption}
            </span>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

/**
 * The §2.7 affordance line. Rendered under a table that scrolls, in words -
 * the "swipe →" in the section rule is the glyph, this is the sentence.
 */
export const LENS_SWIPE_HINT = 'swipe the table sideways for the remaining columns';

/* ── a 44px action button for the mobile body ──────────────────────────── */

export function LensAction({
  onClick,
  disabled,
  disabledReason,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  /** Spec §6: a disabled control is shown and explains itself, never hidden. */
  disabledReason?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={cn(
        'flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap',
        'rounded-md border border-border bg-card px-3 text-[12.5px] font-medium text-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {children}
    </button>
  );
}
