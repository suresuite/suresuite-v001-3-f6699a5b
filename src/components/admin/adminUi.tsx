// Shared SuReSuite "Ledger" treatment for the /admin redesign.
// Lifted from the locked DeveloperApi.tsx reference (SURFACE/KX/TH/TD) and
// extended with the small primitives every admin table needs: status dots,
// mono chips, a black-pill toggle, and a segmented tri-state control.
//
// Import these in each Admin* page port so the whole section stays consistent:
//   import { SURFACE, KX, TH, TD, StatusDot, Toggle, Segmented, MonoChip } from './adminUi';
import { ReactNode, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { MobileSheet } from '@/components/shared/MobileSheet';
import { M, MobilePanel, MobileRow } from '@/components/mobile';

// ── Core treatment ──────────────────────────────────────────────────────────
/** Card/table container: 4px corners, --hair-border rule, white surface. */
export const SURFACE = 'rounded-sm border border-[--hair-border] bg-white';
/** JetBrains-mono kicker: 10px UPPERCASE, wide tracking, muted. */
export const KX = "font-mono text-[10px] uppercase tracking-[0.2em] text-[--ledger-quiet]";
/**
 * L2 — the column row as an ink block. The mono/uppercase/11px/0.04em ledger
 * treatment is unchanged; what changed is the ground (#fafafa washed out
 * against a 92% canvas) and the label colour. No bottom border: the ink block
 * ends where the data begins. Append `text-right` etc. as needed.
 */
export const TH =
  "text-left font-mono text-[11px] uppercase tracking-[0.04em] font-medium text-white bg-[--brand-ink] border-r border-r-[rgba(255,255,255,0.22)] last:border-r-0 px-4 py-2 whitespace-nowrap";
/** Compact ~30px data cell with a hairline divider. */
export const TD = 'px-4 py-[9px] border-b border-[--hair-divider] align-middle';
/** Row hover wash. */
export const ROW_HOVER = 'hover:bg-[#fcfcfc]';
/** Brand-yellow accent action (starter/template downloads only). */
export const TEMPLATE_BTN =
  'bg-[#F8D448] text-foreground border border-[#e6c02f] shadow-sm hover:bg-[#f0c93a] active:bg-[#e9c22f]';

// Layer colors (firm/focal, product, process/material) — for chips when a
// screen needs to distinguish network layers.
export const LAYER = { firm: '#e0930b', product: '#7c3aed', process: '#14b8c4' } as const;

// ── Status dot ───────────────────────────────────────────────────────────────
// active/fresh → teal #14b8c4 · revoked/error → red #bf2330 · neutral → grey.
export type DotTone = 'active' | 'error' | 'neutral';
const DOT: Record<DotTone, { dot: string; text: string }> = {
  active: { dot: '#14b8c4', text: 'text-foreground' },
  error: { dot: '#bf2330', text: 'text-[#bf2330]' },
  neutral: { dot: '#d4d4d4', text: 'text-muted-foreground' },
};
export function StatusDot({ tone, label }: { tone: DotTone; label: string }) {
  const s = DOT[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px]', s.text)}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
      {label}
    </span>
  );
}

// ── Mono chip (tags / env / scopes / BOM) ────────────────────────────────────
export function MonoChip({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'solid' }) {
  return (
    <span
      className={cn(
        'rounded-sm px-1.5 py-px font-mono text-[10px]',
        tone === 'solid'
          ? 'bg-[#f0f0f0] text-[#525252]'
          : 'border border-[--zinc-border] text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

// ── Black-pill toggle (active = bg-foreground) ───────────────────────────────
export function Toggle({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        // Spec 2.4. The pill is 34x18, below the 44px touch floor. Below md the
        // button itself becomes a 60x44 target and hands the space straight back
        // with a negative margin; the pill is redrawn at its exact size as a
        // ::before, and the knob is offset to the end it belongs to. The element
        // count is unchanged, so at md every class below is the literal this
        // replaced and the desktop box tree is identical.
        'relative grid -m-[13px] h-11 w-[60px] place-items-center rounded-none bg-transparent p-0',
        "before:absolute before:h-[18px] before:w-[34px] before:rounded-full before:content-['']",
        // The skin's toggle-off track is the outer rule weight (#d4d4d4); the
        // `md:` half below keeps the literal desktop has always drawn.
        checked ? 'before:bg-foreground' : 'before:bg-[#d4d4d4]',
        'md:static md:m-0 md:inline-flex md:h-[18px] md:w-[34px] md:items-center md:rounded-full md:p-[2px] md:transition-colors md:before:hidden',
        checked ? 'md:justify-end md:bg-foreground' : 'md:justify-start md:bg-[#e4e4e4]',
        disabled && 'opacity-55',
      )}
    >
      <span
        className={cn(
          'relative z-[1] block h-[14px] w-[14px] rounded-full bg-white md:static md:z-auto md:transform-none',
          checked ? 'translate-x-[8px]' : '-translate-x-[8px]',
        )}
      />
    </button>
  );
}

// ── Segmented tri-state (Inherit / Allow / Deny) ─────────────────────────────
export type Tri = 'inherit' | 'allow' | 'deny';
export function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange?: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-sm border border-[--zinc-border]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange?.(o.value)}
            className={cn(
              // Spec 2.4 touch floor below md; md: restores the audit's py-1.
              'min-h-11 px-2.5 py-1 text-[11px] transition-colors md:min-h-0',
              on ? 'bg-foreground text-background' : 'bg-white text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Empty / loading table rows ───────────────────────────────────────────────
export function EmptyRow({ colSpan, message, action }: { colSpan: number; message: string; action?: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
          <div className="text-[13px] text-muted-foreground">{message}</div>
          {action}
        </div>
      </td>
    </tr>
  );
}

export function LoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[--zinc-border] border-t-foreground" />
      </td>
    </tr>
  );
}

// ── Column sorting ────────────────────────────────────────────────────────
// Click a header to sort asc → desc → unsorted, with a ▲/▼ marker. Attach the
// same getters map used elsewhere for filtering.
export function useTableSort<T>(rows: T[], getters: Record<string, (row: T) => string | number>) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    if (!sort || !getters[sort.key]) return rows;
    const fn = getters[sort.key];
    return [...rows].sort((a, b) => {
      const av = fn(a), bv = fn(b);
      if (av < bv) return -sort.dir;
      if (av > bv) return sort.dir;
      return 0;
    });
  }, [rows, sort, getters]);

  function SortTH({ sortKey, children, align }: { sortKey: string; children: ReactNode; align?: 'right' }) {
    const active = sort?.key === sortKey;
    return (
      <th
        onClick={() => setSort((s) => (s?.key === sortKey ? (s.dir === 1 ? { key: sortKey, dir: -1 } : null) : { key: sortKey, dir: 1 }))}
        className={cn(
          TH,
          align === 'right' && 'text-right',
          // Spec 2.4: this th is a control. TH's own py-2 is ~28px, so pad to the
          // touch floor below md and hand the literal back at md:.
          'cursor-pointer select-none py-[15px] md:py-2',
        )}
      >
        {children}{active ? (sort!.dir === 1 ? ' \u25b2' : ' \u25bc') : ''}
      </th>
    );
  }

  return { sorted, SortTH };
}

// ── Per-column quick filter ──────────────────────────────────────────────
// A text input under each header; rows must match every non-empty filter.
export function useColumnFilters<T>(rows: T[], getters: Record<string, (row: T) => string>) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim());
    if (!active.length) return rows;
    return rows.filter((r) => active.every(([k, v]) => String(getters[k]?.(r) ?? '').toLowerCase().includes(v.trim().toLowerCase())));
  }, [rows, filters, getters]);

  function FilterTH({ filterKey, align }: { filterKey: string; align?: 'right' }) {
    return (
      // The quick-filter row is a second header row, but it stays on white —
      // input chrome on ink reads as a defect.
      <th className="border-b border-[--hair-border] bg-white px-2.5 py-1">
        <input
          value={filters[filterKey] || ''}
          onChange={(e) => setFilters((f) => ({ ...f, [filterKey]: e.target.value }))}
          placeholder="Filter…"
          className={cn('h-[22px] w-full rounded-sm border border-[--zinc-border] bg-white px-1.5 text-[11px]', align === 'right' && 'text-right')}
        />
      </th>
    );
  }

  return { filtered, FilterTH };
}

// ── The admin section's mobile primitives (v2 §4B) ──────────────────────────
//
// Every admin page had a hand-rolled mobile card list: a SURFACE wrapper, one
// `border-b p-3` block per record, an ad-hoc chip strip, and the record's
// actions behind a `…` menu. That is a second container style (§12) and a
// hidden control (§8). These two fold the lot into the panel, so the six
// pages say the same thing the same way.

/** One record: the identity, the columns that did not fit on the mono
 *  sub-line, the ranked figure as the value, a status dot, and — when the
 *  record has actions — the row that opens them. */
export function AdminMobileRow({
  label,
  sub,
  dot,
  value,
  onOpen,
  actions,
  actionsTitle,
}: {
  label: ReactNode;
  sub?: ReactNode;
  /** A hex from `M`, or one of the DotTone colours. */
  dot?: string;
  value?: ReactNode;
  /** Tapping the row itself — a drill-down, where the page has one. */
  onOpen?: () => void;
  /** The record's actions, each a named row in a sheet rather than an item in
   *  a `…` menu (§8). */
  actions?: AdminAction[];
  actionsTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasActions = Boolean(actions?.length);

  return (
    <>
      <MobileRow
        label={label}
        sub={sub}
        dot={dot}
        value={value}
        onClick={onOpen ?? (hasActions ? () => setOpen(true) : undefined)}
      />
      {hasActions && onOpen && (
        <MobileRow
          label="Actions"
          sub={actions!.map((a) => a.label).join(' · ')}
          value={String(actions!.length)}
          onClick={() => setOpen(true)}
        />
      )}
      {hasActions && (
        <MobileSheet
          open={open}
          title={actionsTitle ?? (typeof label === 'string' ? label : 'Actions')}
          sub="Everything you can do to this record."
          onClose={() => setOpen(false)}
        >
          <div className="flex flex-col">
            {actions!.map((a) => (
              <MobileRow
                key={a.label}
                label={a.label}
                sub={a.sub}
                dot={a.tone === 'danger' ? M.blocking : undefined}
                disabled={a.disabled}
                note={a.disabled ? a.disabledReason : undefined}
                chevron={!a.disabled}
                onClick={
                  a.disabled
                    ? undefined
                    : () => {
                        setOpen(false);
                        a.onClick();
                      }
                }
              />
            ))}
          </div>
        </MobileSheet>
      )}
    </>
  );
}

export interface AdminAction {
  label: string;
  sub?: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** §8: a control that cannot be used is shown, disabled and explained. */
  disabledReason?: string;
}

/** The list itself. `empty` and `loading` are states of the panel, not of a
 *  card that appears in its place — the skin has one container. */
export function AdminMobileList({
  label,
  counter,
  loading,
  empty,
  emptyAction,
  tone = 'secondary',
  children,
}: {
  label: string;
  counter?: ReactNode;
  loading?: boolean;
  empty?: string;
  emptyAction?: ReactNode;
  tone?: 'primary' | 'secondary';
  children: ReactNode;
}) {
  return (
    <MobilePanel label={label} counter={counter} tone={tone}>
      {loading ? (
        <p className="px-3 py-8 text-center text-[13px] text-[#525252]">Loading…</p>
      ) : empty ? (
        <div className="flex flex-col items-center gap-3 px-6 py-9 text-center">
          <span className="max-w-[250px] text-[13px] leading-relaxed text-[#525252] [text-wrap:pretty]">
            {empty}
          </span>
          {emptyAction}
        </div>
      ) : (
        children
      )}
    </MobilePanel>
  );
}
