/**
 * The right rail's two lens-owned cards (network-lenses handoff §10): a 2×2
 * Summary grid and a Details card. The Prediction card below them is the existing
 * `MLPrediction`, unchanged.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { LENS, withAlpha } from './tokens';

export interface SummaryCell {
  label: string;
  value: ReactNode;
}

export function LensSummary({ cells }: { cells: SummaryCell[] }) {
  return (
    <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border bg-[var(--hair-border)]', LENS.border)}>
      {cells.map((c) => (
        <div key={c.label} className="bg-white px-3.5 py-2.5">
          <div className={cn('text-[11px]', LENS.muted)}>{c.label}</div>
          <div className={cn('text-[20px] font-semibold leading-[1.1] tracking-[-0.019em] tabular-nums', LENS.ink)}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface DetailRow {
  label: string;
  value: ReactNode;
}

interface LensDetailsProps {
  title: string;
  emptyText: string;
  selected: null | {
    name: string;
    classLabel: string;
    classColor: string;
    rows: DetailRow[];
  };
  focus?: {
    label: string;
    active: boolean;
    onToggle: () => void;
  };
}

export function LensDetails({ title, emptyText, selected, focus }: LensDetailsProps) {
  return (
    <div className={cn('overflow-hidden rounded-[4px] border bg-white', LENS.border)}>
      <div className={cn('flex items-center gap-2 border-b px-4 py-3', LENS.hairline)}>
        <h2 className={cn('text-[13px] font-semibold', LENS.ink)}>{title}</h2>
        {selected && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#14b8c4]" />}
      </div>
      {selected ? (
        <div className="px-4 py-3">
          <div className={cn('break-words text-[14px] font-semibold leading-[1.25]', LENS.ink)}>{selected.name}</div>
          <span
            className="mt-1.5 inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-[4px] px-[7px] text-[11px] font-medium"
            style={{ background: withAlpha(selected.classColor, 0.12), color: selected.classColor }}
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: selected.classColor }} />
            {selected.classLabel}
          </span>
          <div className={cn('my-3 h-px', LENS.hairlineBg)} />
          <dl className="flex flex-col gap-1.5 text-[12.5px]">
            {selected.rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-3">
                <dt className={cn('min-w-0', LENS.muted)}>{r.label}</dt>
                <dd className={cn('min-w-0 break-all text-right font-medium tabular-nums', LENS.ink)}>{r.value}</dd>
              </div>
            ))}
          </dl>
          {focus && (
            <>
              <div className={cn('my-3 h-px', LENS.hairlineBg)} />
              <button
                type="button"
                onClick={focus.onToggle}
                className={cn(
                  'h-11 w-full rounded-[4px] border bg-white text-[12.5px] font-medium md:h-8',
                  LENS.border,
                  LENS.ink,
                  LENS.hoverControl,
                )}
              >
                {focus.active ? 'Show all' : focus.label}
              </button>
            </>
          )}
        </div>
      ) : (
        <p className={cn('px-4 py-7 text-center text-[12.5px]', LENS.muted)}>{emptyText}</p>
      )}
    </div>
  );
}
