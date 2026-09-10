// The panel — the only container in the mobile skin.
//
// Tables, lists, forms, stat groups, alerts and agent output are all this
// panel at different row heights. There is no second container style: if a
// screen needs something this cannot express, the answer is a different
// arrangement of panels, not a new container (spec §1).
//
// `tone="secondary"` is the panel — the default, and what nearly every panel
// on a screen is:
//
//   1px #d4d4d4 frame, 4px radius, overflow hidden
//   ├─ head:  #fafafa fill, 1px #d4d4d4 bottom rule, 8px 12px
//   │         left  — mono 10px uppercase 0.14em, #525252  (the label)
//   │         right — mono 10px #525252                    (one counter)
//   └─ body:  #fff, rows divided by 1px #e8e8ea
//
// `tone="primary"` swaps the frame and head to #18181b with white on them.
// It is rationed to ONE panel per screen — the thing that changed or the
// thing that blocks the user (spec §13, band 3). That ration is the whole
// point of v2: four black bars on a screen is four priorities, which is no
// priority at all. The default flipped to secondary so that asking for the
// ink head is a deliberate act.
//
// The separation is carried by value and by two rule weights, not by a frame:
// the 93% canvas, the #fafafa head, the #fff body; #d4d4d4 outside, #e8e8ea
// inside. `accent` adds the one accent a panel gets — a 2px left rule in a
// layer or agent hex.

import * as React from 'react';
import { cn } from '@/lib/utils';
import { M, M_LABEL, M_MICRO, M_ROW } from './tokens';

interface MobilePanelProps {
  /** The mono micro-label in the head. Sentence case in, uppercased by CSS. */
  label: string;
  /** At most one counter, right-aligned in the head. Short and fixed — it
   *  never truncates, the label does. */
  counter?: React.ReactNode;
  /** `secondary` is the default and the norm. `primary` is the ink head, and
   *  a screen gets at most one (spec §13.3). */
  tone?: 'primary' | 'secondary';
  /** A 2px left rule in a layer (`M.firm` / `M.product` / `M.process`) or an
   *  agent hex. The only accent a panel gets — never a fill, never a second
   *  edge (v2 §2). */
  accent?: string;
  /** Drop the white body fill and the row dividers — for a panel whose body
   *  is a single custom block (a chart, a code sample, a stat strip). */
  bare?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

export function MobilePanel({
  label,
  counter,
  tone = 'secondary',
  accent,
  bare = false,
  className,
  bodyClassName,
  children,
}: MobilePanelProps) {
  const secondary = tone === 'secondary';

  return (
    <section
      className={cn(
        'overflow-hidden rounded-[4px] border',
        secondary ? 'border-[#d4d4d4] bg-white' : 'border-[#18181b]',
        className,
      )}
      // The accent is a border, not a pseudo-element or an inset shadow: it
      // has to survive `overflow-hidden` and the 4px radius, and it must not
      // move the body's left edge relative to the head's.
      style={accent ? { borderLeft: `2px solid ${accent}` } : undefined}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-3 py-2',
          secondary
            ? 'border-b border-[#d4d4d4] bg-[#fafafa]'
            : 'bg-[#18181b]',
        )}
      >
        {/* min-w-0 + truncate on the label, nowrap on the counter: the pair
            that keeps a long label from pushing the count off-screen (§9.1). */}
        <span
          className={cn(M_LABEL, 'min-w-0 truncate', secondary ? 'text-[#525252]' : 'text-white')}
        >
          {label}
        </span>
        {counter != null && (
          <span
            className={cn(
              'shrink-0 whitespace-nowrap font-mono text-[10px] tabular-nums',
              secondary ? 'text-[#525252]' : 'text-white',
            )}
          >
            {counter}
          </span>
        )}
      </div>

      <div
        className={cn(
          !bare && 'divide-y divide-[#e8e8ea] bg-white',
          bare && 'bg-white',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

type RowElement = 'div' | 'button';

interface MobileRowProps {
  /** The 13.5px workhorse label. */
  label: React.ReactNode;
  /** Optional 10.5px mono sub-line beneath it — ids, timestamps, counts. */
  sub?: React.ReactNode;
  /** Optional leading 6px meaning dot. Pass a hex from `M`. */
  dot?: string;
  /** Optional leading element (a badge, an icon) placed before the label. */
  leading?: React.ReactNode;
  /** The right-hand value. Numbers arrive tabular and in the heavier weight. */
  value?: React.ReactNode;
  /** A trailing control — a toggle, a stepper, a chip. Takes the value slot. */
  trailing?: React.ReactNode;
  /** Show the `›` chevron. Implied by `onClick` unless explicitly false. */
  chevron?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  /** One 12px line under the row explaining why it is unavailable. A control
   *  that cannot be used is shown, disabled and explained — never hidden. */
  note?: React.ReactNode;
  className?: string;
}

export function MobileRow({
  label,
  sub,
  dot,
  leading,
  value,
  trailing,
  chevron,
  onClick,
  disabled,
  note,
  className,
}: MobileRowProps) {
  const interactive = Boolean(onClick);
  const showChevron = chevron ?? interactive;
  const Tag: RowElement = interactive ? 'button' : 'div';

  return (
    <div className={cn('bg-white', disabled && 'opacity-60')}>
      <Tag
        {...(interactive ? { type: 'button' as const, onClick, disabled } : {})}
        className={cn(
          // 11-14px of padding by viewport, never letting the row fall
          // below the 44px touch floor `min-h-11` holds (v2 §5.3).
          'flex min-h-11 w-full items-center gap-2.5 px-3 py-[var(--m-row-y)] text-left',
          interactive && 'active:bg-[#fafafa]',
          className,
        )}
      >
        {dot && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: dot }}
          />
        )}
        {leading}

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn(M_ROW, 'truncate')}>{label}</span>
          {sub != null && <span className={cn(M_MICRO, 'truncate')}>{sub}</span>}
        </span>

        {value != null && (
          <span className="shrink-0 whitespace-nowrap font-mono text-[13px] font-semibold tabular-nums text-[#171717]">
            {value}
          </span>
        )}
        {trailing}
        {showChevron && (
          <span aria-hidden className="shrink-0 text-[15px] leading-none text-[#6b6b6b]">
            ›
          </span>
        )}
      </Tag>
      {note != null && (
        <p className="px-3 pb-3 text-[12px] leading-[1.45] text-[#525252] [text-wrap:pretty]">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * The consequence line. Never more than two sentences, and never more than
 * one per screen (spec §13.6).
 *
 * Two weights, because the amber wash was being spent on both jobs and a
 * screen that warns about everything warns about nothing (v2 §3.4):
 *
 *   `blocking` — the amber frame and wash. Something the user cannot get
 *                past, or a consequence that lands after they act.
 *   `caveat`   — the panel's own geometry with a 2px amber left rule and
 *                body ink. Something worth knowing and nothing more.
 *
 * `caveat` is the panel treatment rather than a `<MobilePanel>` because it
 * carries no label: a head with a micro-label above one sentence is a
 * description line under a title, which §12 rules out.
 */
export function MobileNote({
  mark = '⚠',
  tone = 'blocking',
  children,
  className,
}: {
  mark?: string;
  tone?: 'blocking' | 'caveat';
  children: React.ReactNode;
  className?: string;
}) {
  const caveat = tone === 'caveat';

  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-[4px] border px-3 py-[11px]',
        caveat ? 'border-[#d4d4d4] bg-white' : 'border-[#e0930b] bg-[#e0930b1f]',
        className,
      )}
      style={caveat ? { borderLeft: `2px solid ${M.firm}` } : undefined}
    >
      <span
        aria-hidden
        className={cn(
          'shrink-0 font-mono text-[12px] leading-[1.3]',
          caveat ? 'text-[#e0930b]' : 'text-[#6b4405]',
        )}
      >
        {mark}
      </span>
      <p
        className={cn(
          'm-0 text-[12.5px] leading-[1.5] [text-wrap:pretty]',
          caveat ? 'text-[#3f3f46]' : 'text-[#6b4405]',
        )}
      >
        {children}
      </p>
    </div>
  );
}

/** A 3px mono chip — a version tag, a state, a count. The largest a colour
 *  fill is ever allowed to get. */
export function MobileChip({
  children,
  fill,
  ink = '#18181b',
  className,
}: {
  children: React.ReactNode;
  fill?: string;
  ink?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums',
        !fill && 'border border-[#d4d4d4]',
        className,
      )}
      style={fill ? { background: fill, color: ink } : { color: ink }}
    >
      {children}
    </span>
  );
}

/** The 6px meaning dot. `pulse` is the one ambient animation in the skin, and
 *  it belongs to a running job and nothing else (spec §11). */
export function MobileDot({
  tone,
  pulse = false,
  className,
}: {
  tone: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        pulse && 'animate-pulse motion-reduce:animate-none',
        className,
      )}
      style={{ background: tone }}
    />
  );
}
