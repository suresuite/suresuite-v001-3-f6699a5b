// The mobile skin's controls: action bar, segmented control, toggle, stepper,
// and the two button weights.
//
// Everything here is 200ms for colour and nothing else. Press is a value step
// or a 1px nudge, never a colour flip (spec §11).

import * as React from 'react';
import { cn } from '@/lib/utils';
import { M_FADE } from './tokens';

// ── Buttons ──────────────────────────────────────────────────────────────
// Three weights and no more. `primary` is the one black-filled action a
// screen gets; `secondary` is the white/black-outlined one that may sit
// beside it; `begin` is the #F8D448 "begin here" fill, reserved for the
// template download and the walkthrough and used nowhere else.

type ButtonWeight = 'primary' | 'secondary' | 'begin';

const WEIGHT: Record<ButtonWeight, string> = {
  primary: 'border-0 bg-[#18181b] text-white active:bg-[#27272a]',
  secondary: 'border border-[#18181b] bg-white text-[#18181b] active:bg-[#fafafa]',
  begin: 'border border-[#e6c02f] bg-[#F8D448] text-[#18181b] active:bg-[#f0c93c]',
};

interface MobileButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  weight?: ButtonWeight;
  /** Fill the remaining width rather than hugging the label. */
  block?: boolean;
}

export function MobileButton({
  weight = 'primary',
  block = false,
  className,
  ...rest
}: MobileButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex h-[46px] items-center justify-center rounded-md px-4',
        'text-[13.5px] font-semibold leading-none',
        'disabled:cursor-not-allowed disabled:opacity-45',
        block ? 'w-full min-w-0 flex-1' : 'shrink-0',
        WEIGHT[weight],
        M_FADE,
        className,
      )}
    />
  );
}

/** A row of buttons that wraps rather than squeezing below the touch minimum:
 *  `flex-wrap` with `flex: 1 1 140px` on each child (spec §9.3). */
export function MobileButtonRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-2 [&>*]:min-w-0 [&>*]:flex-[1_1_140px]', className)}>
      {children}
    </div>
  );
}

// ── Action bar ───────────────────────────────────────────────────────────

interface ActionSpec {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  weight?: ButtonWeight;
  loading?: boolean;
}

/**
 * The pinned bottom action bar: one primary action, at most one secondary to
 * its left (spec §8). It sits directly on the chrome boundary PageLayout
 * publishes as `--pi-chrome` — the top edge of the tab bar — so it tracks the
 * bar however the device inset resolves.
 *
 * The spacer is not decoration. The bar is `fixed`, so it is out of flow and
 * would sit on top of the last rows of the page; the spacer reserves exactly
 * the band it occupies. PageLayout's own `paddingBottom` covers the chrome
 * beneath it and nothing more.
 *
 * `note` is where an unavailable action explains itself. A control that cannot
 * be used is shown, disabled and explained in one 12px line — never hidden.
 */
export function MobileActionBar({
  primary,
  secondary,
  note,
}: {
  primary: ActionSpec;
  secondary?: ActionSpec;
  note?: React.ReactNode;
}) {
  return (
    <>
      <div aria-hidden className="h-16" />
      <div
        className="fixed inset-x-0 z-40 border-t border-[#e4e4e4] bg-white px-4 pb-2.5 pt-2"
        style={{ bottom: 'var(--pi-chrome, 0px)' }}
      >
        {note != null && (
          <p className="mb-1.5 text-[12px] leading-[1.4] text-[#525252] [text-wrap:pretty]">
            {note}
          </p>
        )}
        <div className="flex gap-2">
          {secondary && (
            <MobileButton
              weight={secondary.weight ?? 'secondary'}
              onClick={secondary.onClick}
              disabled={secondary.disabled}
            >
              {secondary.label}
            </MobileButton>
          )}
          <MobileButton
            block
            weight={primary.weight ?? 'primary'}
            onClick={primary.onClick}
            disabled={primary.disabled || primary.loading}
          >
            {primary.label}
          </MobileButton>
        </div>
      </div>
    </>
  );
}

// ── Segmented control ────────────────────────────────────────────────────

export interface SegmentedItem<T extends string> {
  value: T;
  label: string;
  /** Shown after the label as a mono count. Never truncates. */
  count?: React.ReactNode;
}

/** Two or three peer views, and only where the screen genuinely has them
 *  (spec §4). 5px track, 2px inset, 34px minimum item height. */
export function MobileSegmented<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: readonly SegmentedItem<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex gap-0.5 rounded-[5px] bg-[#e4e4e7] p-0.5', className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'flex min-h-[34px] min-w-0 flex-1 items-center justify-center gap-1.5',
              'rounded-[4px] px-1 text-[11.5px] font-semibold',
              active ? 'bg-[#18181b] text-white' : 'bg-transparent text-[#3f3f46]',
              M_FADE,
            )}
          >
            <span className="min-w-0 truncate">{item.label}</span>
            {item.count != null && (
              <span
                className={cn(
                  'shrink-0 whitespace-nowrap font-mono text-[10px] tabular-nums',
                  active ? 'text-white/70' : 'text-[#525252]',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Toggle ───────────────────────────────────────────────────────────────

/** 34×18 track, 14px knob, #18181b on / #d4d4d4 off (spec, Controls).
 *  The visible pill is below the touch floor by design, so the button carries
 *  a transparent 44px hit area around it rather than growing. */
export function MobileToggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Required: the pill carries no text of its own. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative flex h-[18px] w-[34px] shrink-0 items-center rounded-full p-0.5',
        'after:absolute after:-inset-x-1.5 after:-inset-y-[13px] after:content-[""]',
        'disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'justify-end bg-[#18181b]' : 'justify-start bg-[#d4d4d4]',
        M_FADE,
      )}
    >
      <span aria-hidden className="block h-3.5 w-3.5 rounded-full bg-white" />
    </button>
  );
}

// ── Stepper ──────────────────────────────────────────────────────────────

/** 32px squares either side of a mono 15px/700 tabular value, 46px minimum
 *  wide so the value never shifts the buttons as it changes width. Same
 *  transparent hit expansion as the toggle. */
export function MobileStepper({
  value,
  onStep,
  label,
  min,
  max,
  step = 1,
  display,
}: {
  value: number;
  /** Called with the next value, already clamped to `min`/`max`. */
  onStep: (next: number) => void;
  /** Names the quantity for assistive tech: "Cover, days". */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** Rendered value — pass a formatted string where a unit belongs ("14 d"). */
  display?: React.ReactNode;
}) {
  const clamp = (n: number) =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));
  const atMin = min != null && value <= min;
  const atMax = max != null && value >= max;

  const square =
    'relative grid h-8 w-8 shrink-0 place-items-center rounded-[5px] border border-[#d4d4d4] ' +
    'bg-white text-[16px] leading-none text-[#3f3f46] ' +
    'after:absolute after:-inset-1.5 after:content-[""] ' +
    'disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <span className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        className={square}
        onClick={() => onStep(clamp(value - step))}
        disabled={atMin}
        aria-label={`Decrease ${label}`}
        title={`Decrease ${label}`}
      >
        −
      </button>
      <span className="min-w-[46px] text-center font-mono text-[15px] font-bold tabular-nums text-[#18181b]">
        {display ?? value}
      </span>
      <button
        type="button"
        className={square}
        onClick={() => onStep(clamp(value + step))}
        disabled={atMax}
        aria-label={`Increase ${label}`}
        title={`Increase ${label}`}
      >
        +
      </button>
    </span>
  );
}
