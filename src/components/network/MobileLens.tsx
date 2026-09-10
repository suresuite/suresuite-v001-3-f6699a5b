// Mobile-only presentation for the three network lens pages
// (Product-Level, Process-Level, Firm-Level).
//
// Spec: `docs/mobile-skin-spec.md` — every container here is the black-headed
// panel, colour is a 6px dot, and the numbers are one stat grid. The earlier
// structural rules (`docs/mobile-ui-spec.md` §2.3 grids that cannot overflow,
// §2.4 the 44px touch floor, §2.5 min-w-0 / no shrink-0 on text, §3.3 numbers
// never adapt, §6 a disabled control explains itself) still hold and are what
// the composition is built on.
//
// Everything here renders inside each page's `md:hidden` subtree, so none of
// it can reach a desktop viewport - the desktop trees import nothing from this
// file. It exists because the same composition was hand-copied into three
// 1200+ line pages, which is how the three drifted apart in the first place.
//
// Presentational only: no hook that fetches, no state a caller reads. The one
// piece of local state is `Disclosure`'s open/closed, which is the shared
// primitive's own.

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Disclosure } from '@/components/shared';
import {
  M,
  M_LABEL,
  MobileButton,
  MobileChip,
  MobileDot,
  MobileNote,
  MobilePanel,
  MobileRow,
  MobileStatGrid,
  type MobileStat,
} from '@/components/mobile';

/* ── the lens badge ────────────────────────────────────────────────────── */

export type LensTone = 'violet' | 'teal' | 'amber';

/** The three lens colours are the skin's three level colours, and they are
 *  the same three: product violet, process teal, firm amber (§3). */
const LENS_TONE: Record<LensTone, string> = {
  violet: M.product,
  teal: M.process,
  amber: M.firm,
};

export function LensChip({ tone, children }: { tone: LensTone; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <MobileDot tone={LENS_TONE[tone]} />
      <span className={cn(M_LABEL, 'text-[#525252]')}>{children}</span>
    </span>
  );
}

/* ── a section ─────────────────────────────────────────────────────────── */

/**
 * The one container. A lens section is a panel: a black head carrying the
 * section's mono label and at most one counter, and rows inside it.
 *
 * This replaces the kicker-plus-hairline rule the three pages used to draw
 * above each block. That rule was a borderless section, which the skin does
 * not have (§12) — the head of the panel is where a section name lives now.
 */
export function LensSection({
  label,
  counter,
  tone = 'primary',
  children,
}: {
  label: string;
  counter?: React.ReactNode;
  tone?: 'primary' | 'secondary';
  children: React.ReactNode;
}) {
  return (
    <MobilePanel label={label} counter={counter} tone={tone}>
      {children}
    </MobilePanel>
  );
}

/* ── "How to read this" ────────────────────────────────────────────────── */

export interface ColumnDef {
  term: string;
  def: string;
}

/**
 * The definitions live behind a disclosure so they are available *before* the
 * numbers without occupying the screen. Three groups, in order: Scope,
 * Findings, Columns. It is a supporting panel, so it wears the quieter
 * secondary head rather than competing with the findings below it.
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
    <MobilePanel label="How to read this" tone="secondary" bare>
      <div className="px-3 py-2">
        <Disclosure summary="Definitions">
          <div className="flex flex-col gap-3.5">
            <LensNote label="Scope">{scope}</LensNote>
            <LensNote label="Findings">{findings}</LensNote>
            <div className="flex flex-col gap-1.5">
              <span className={cn(M_LABEL, 'text-[#525252]')}>Columns</span>
              <dl className="m-0 flex flex-col gap-1.5">
                {columns.map((c) => (
                  <div key={c.term} className="flex min-w-0 gap-2.5">
                    <dt className="w-[86px] shrink-0 font-medium text-[#18181b]">{c.term}</dt>
                    <dd className="m-0 min-w-0 flex-1 text-[#3f3f46] [text-wrap:pretty]">{c.def}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </Disclosure>
      </div>
    </MobilePanel>
  );
}

function LensNote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={cn(M_LABEL, 'text-[#525252]')}>{label}</span>
      <span className="min-w-0 text-[#3f3f46] [text-wrap:pretty]">{children}</span>
    </div>
  );
}

/* ── the "graph is desktop-only" notice ────────────────────────────────── */

/** §13.6 — the screen's one consequence line, in the one frame the skin has
 *  for one. Two sentences, never more. */
export function LensDesktopOnlyNote({ children }: { children: React.ReactNode }) {
  return <MobileNote mark="·">{children}</MobileNote>;
}

/* ── network structure: the numbers band ───────────────────────────────── */

export interface StructureItem {
  label: string;
  value: string;
  red?: boolean;
}

/**
 * §13.4 — the numbers, as the one stat grid on the screen. It carries no head:
 * a stat grid is its own container (§7), and the figures name themselves.
 *
 * `red` becomes a 6px dot beside the stat label rather than red type. Colour
 * in this skin is a dot, a 2px rule or a chip, and never a figure (§3).
 */
export function LensStructure({ items }: { items: StructureItem[] }) {
  const stats: MobileStat[] = items.map((it) => ({
    label: it.label,
    value: it.value,
    dot: it.red ? M.blocking : undefined,
  }));
  return <MobileStatGrid stats={stats} />;
}

/* ── structural risk: label / value rows ───────────────────────────────── */

export interface RiskRow {
  label: string;
  value: string;
}

export function LensRisk({ rows, alert }: { rows: RiskRow[]; alert?: React.ReactNode }) {
  return (
    <>
      {rows.map((r) => (
        <MobileRow key={r.label} chevron={false} label={r.label} value={r.value} />
      ))}
      {alert && (
        // A blocking finding is a dot and prose, not a red panel — §3 caps a
        // meaning colour at a dot, a rule or a chip, and the amber frame means
        // caveat, not blocked. So it is the last row of the risk panel.
        <div className="flex gap-2.5 bg-white px-3 py-[13px]">
          <MobileDot tone={M.blocking} className="mt-[7px]" />
          <p className="m-0 min-w-0 text-[12.5px] leading-[1.5] text-[#3f3f46] [text-wrap:pretty]">
            {alert}
          </p>
        </div>
      )}
    </>
  );
}

/* ── the ranked list ───────────────────────────────────────────────────── */

export interface LensColumn {
  key: string;
  label: string;
  /** Kept because the call sites declare it and it still describes the
   *  desktop table's intent. The row form has one value slot and one
   *  sub-line, so nothing here is aligned by column any more. */
  align?: 'left' | 'right';
}

export interface LensCell {
  text: string;
  /** Meaning, as the row's 6px dot. */
  tone?: 'blocking' | 'warn' | 'notable';
  /** The ranked figure — the row's right-hand value. Defaults to the first cell. */
  primary?: boolean;
}

export interface LensRow {
  key: string;
  /** The identifying value — the row's label. */
  id: string;
  cells: LensCell[];
}

const CELL_DOT: Record<NonNullable<LensCell['tone']>, string> = {
  blocking: M.blocking,
  warn: M.firm,
  notable: M.ink,
};

/**
 * The ranked list, as rows.
 *
 * It used to be a five-column table that scrolled sideways with its
 * identifying column frozen. §9.5 allows horizontal scroll only inside a
 * deliberate full-table sheet or a code block, and §10 asks a dense table to
 * summarise. So each row now carries its identity as the label, the ranked
 * figure as the value, and every remaining column — labelled — on the mono
 * sub-line. No column is dropped and no figure is shortened; the ledger is
 * re-laid-out, not truncated, and nothing scrolls sideways.
 *
 * Renders rows only: the caller wraps it in a <LensSection>, which is the
 * panel.
 */
export function LensTable({
  columns,
  rows,
  empty,
  loading = false,
  caption,
  action,
}: {
  columns: LensColumn[];
  rows: LensRow[];
  empty: string;
  loading?: boolean;
  caption?: string;
  action?: React.ReactNode;
}) {
  if (loading || rows.length === 0) {
    return (
      <p className="bg-white px-3 py-8 text-center text-[13px] leading-relaxed text-[#525252] [text-wrap:pretty]">
        {loading ? 'Loading…' : empty}
      </p>
    );
  }

  return (
    <>
      {rows.map((r) => {
        const primaryIdx = Math.max(0, r.cells.findIndex((c) => c.primary));
        const primary = r.cells[primaryIdx];
        const dot = r.cells.find((c) => c.tone)?.tone;
        const sub = r.cells
          .map((c, i) => (i === primaryIdx ? null : `${columns[i + 1]?.label ?? ''} ${c.text}`.trim()))
          .filter(Boolean)
          .join(' · ');
        return (
          <MobileRow
            key={r.key}
            chevron={false}
            dot={dot ? CELL_DOT[dot] : undefined}
            label={r.id}
            sub={sub || undefined}
            value={primary?.text}
          />
        );
      })}
      {(caption || action) && (
        <div className="flex min-w-0 items-center gap-3 bg-white px-3 py-[11px]">
          {caption && (
            <span className="min-w-0 flex-1 text-[12px] leading-snug text-[#525252] [text-wrap:pretty]">
              {caption}
            </span>
          )}
          {action}
        </div>
      )}
    </>
  );
}

/* ── an action for the mobile body ─────────────────────────────────────── */

export function LensAction({
  onClick,
  disabled,
  disabledReason,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  /** §8: a disabled control is shown and explains itself, never hidden. */
  disabledReason?: string;
  children: React.ReactNode;
}) {
  return (
    <MobileButton
      weight="secondary"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className="h-11 gap-1.5 px-3 text-[12.5px]"
    >
      {children}
    </MobileButton>
  );
}

/** The lens chip's legacy export surface — a section rule with a mono label —
 *  kept only for the Prediction block, whose body (`MLPrediction`) is a shared
 *  desktop component and has not been converted yet. Everything else is a
 *  <LensSection>. */
export function LensRule({
  children,
  trailing,
}: {
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 pb-2">
      <span className={cn(M_LABEL, 'whitespace-nowrap text-[#525252]')}>{children}</span>
      <span className="h-px min-w-0 flex-1 bg-[#d4d4d4]" />
      {trailing && (
        <span className="whitespace-nowrap font-mono text-[10px] text-[#525252]">{trailing}</span>
      )}
    </div>
  );
}
