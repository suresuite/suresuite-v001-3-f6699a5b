// Shared SuReSuite "Ledger" treatment for the /admin redesign.
// Lifted from the locked DeveloperApi.tsx reference (SURFACE/KX/TH/TD) and
// extended with the small primitives every admin table needs: status dots,
// mono chips, a black-pill toggle, and a segmented tri-state control.
//
// Import these in each Admin* page port so the whole section stays consistent:
//   import { SURFACE, KX, TH, TD, StatusDot, Toggle, Segmented, MonoChip } from './adminUi';
import { ReactNode, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

// ── Core treatment ──────────────────────────────────────────────────────────
/** Card/table container: sharp corners, thin #ebebeb border, white surface. */
export const SURFACE = 'rounded-sm border border-[#ebebeb] bg-white';
/** JetBrains-mono kicker: 10px UPPERCASE, wide tracking, muted. */
export const KX = "font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a8a]";
/** Mono UPPERCASE table header on #fafafa. Append `text-right` etc. as needed. */
export const TH =
  "text-left font-mono text-[11px] uppercase tracking-[0.04em] font-medium text-[#8a8a8a] bg-[#fafafa] border-b border-[#ebebeb] px-4 py-2 whitespace-nowrap";
/** Compact ~30px data cell with a hairline divider. */
export const TD = 'px-4 py-[9px] border-b border-[#f4f4f4] align-middle';
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
        'rounded-[3px] px-1.5 py-px font-mono text-[10px]',
        tone === 'solid'
          ? 'bg-[#f0f0f0] text-[#525252]'
          : 'border border-[#e4e4e4] text-muted-foreground',
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
        'inline-flex h-[18px] w-[34px] items-center rounded-full p-[2px] transition-colors',
        checked ? 'justify-end bg-foreground' : 'justify-start bg-[#e4e4e4]',
        disabled && 'opacity-55',
      )}
    >
      <span className="block h-[14px] w-[14px] rounded-full bg-white" />
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
    <div className="inline-flex overflow-hidden rounded-[5px] border border-[#e4e4e4]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange?.(o.value)}
            className={cn(
              'px-2.5 py-1 text-[11px] transition-colors',
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
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#e4e4e4] border-t-foreground" />
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
        className={cn(TH, align === 'right' && 'text-right', 'cursor-pointer select-none')}
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
      <th className="border-b border-[#ebebeb] bg-[#fafafa] px-2.5 py-1">
        <input
          value={filters[filterKey] || ''}
          onChange={(e) => setFilters((f) => ({ ...f, [filterKey]: e.target.value }))}
          placeholder="Filter…"
          className={cn('h-[22px] w-full rounded-[3px] border border-[#e4e4e4] bg-white px-1.5 text-[11px]', align === 'right' && 'text-right')}
        />
      </th>
    );
  }

  return { filtered, FilterTH };
}
