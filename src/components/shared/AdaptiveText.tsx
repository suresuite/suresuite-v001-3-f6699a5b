// Adaptive-text primitives (mobile UI spec §3).
//
// Everything here is presentational and stateless except <Disclosure>, whose
// open/closed is purely visual state — permitted by spec §0.1 A.
//
// The design decision that matters: the label swap is done in CSS, with both
// strings in the DOM, NOT with a useIsMobile branch. Two reasons.
//
//   1. It responds to the CONTAINER, not the viewport. A 300px drawer at
//      1280px gets the short label; a viewport branch would give it the long
//      one and overflow.
//   2. It adds no hook call, so it works in any tree and never re-renders on
//      resize. Spec §6 rejects useIsMobile for purely visual differences.
//
// The cost is one extra hidden text node per label. That is cheaper than a
// resize listener and it is what makes the behaviour correct.

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Label } from '@/lib/ui/labels';

/**
 * Renders a label's short form below `sm` and its full form at and above it.
 * Always carries the full form in `title`, so the long name is one hover or
 * long-press away and screen readers get the canonical text.
 *
 * `sm` (640px) is the ONE sanctioned use of a second breakpoint (spec §6) —
 * it is a text-fitting threshold, not a layout breakpoint, and the layout
 * breakpoint remains 768px everywhere.
 */
export function AdaptiveLabel({
  label,
  className,
}: {
  label: Label;
  className?: string;
}) {
  // Identical strings need no swap and no second node.
  if (label.full === label.short) {
    return <span className={className}>{label.full}</span>;
  }
  // The two visual spans are aria-hidden and the canonical form is carried
  // once, in the sr-only node. Without that, a screen reader reads the full
  // label twice at >=sm, and short-then-full below it.
  return (
    <span className={className} title={label.full}>
      <span aria-hidden="true" className="hidden sm:inline">{label.full}</span>
      <span aria-hidden="true" className="sm:hidden">{label.short}</span>
      <span className="sr-only">{label.full}</span>
    </span>
  );
}

/**
 * Rung 2 of the ladder: a single line that truncates, with the full value in
 * `title`. Use for ids, names, filenames, chat titles — anything unbounded
 * that must stay on one line.
 *
 * `min-w-0` is on the element itself because a truncating child of a flex row
 * is exactly the case spec §2.5 exists for: without it the string sets the
 * parent's width and the row overflows the viewport.
 */
export function TruncatedText({
  children,
  className,
  as: Tag = 'span',
}: {
  children: string;
  className?: string;
  as?: 'span' | 'div' | 'h1' | 'h2' | 'p';
}) {
  return (
    <Tag className={cn('block min-w-0 truncate', className)} title={children}>
      {children}
    </Tag>
  );
}

/**
 * Rung 1: prose that wraps rather than truncates. `text-wrap: pretty` avoids
 * the one-word last line that makes a two-line caption look broken.
 *
 * `overflow-wrap: anywhere` is deliberate and only safe here, on prose: it
 * lets an unbroken token (a hash, a long id pasted into a description) break
 * rather than force a horizontal scrollbar.
 */
export function ProseText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'min-w-0 text-[13px] leading-relaxed text-muted-foreground',
        '[text-wrap:pretty] [overflow-wrap:anywhere]',
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Rung 6: a long explanatory block, collapsed behind its summary.
 *
 * Placement rule (spec §3.4): render this ABOVE the data it explains and
 * leave it closed. The numbers stay first on screen, and the explanation is
 * available before you read them rather than after — which is the whole
 * point of moving it out of the flow instead of clamping it.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();

  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-sm border border-[#ebebeb] bg-card',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left
                   hover:bg-[#fcfcfc]"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {summary}
        </span>
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground',
            'transition-transform duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)]',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && (
        <div
          id={id}
          className="border-t border-[#f4f4f4] px-3 py-3 text-[12.5px] leading-relaxed
                     text-muted-foreground [overflow-wrap:anywhere] [text-wrap:pretty]"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A numeric value. Exists so that "never truncate a number" (spec §3.3) is
 * something you reach for rather than something you remember.
 *
 * There is deliberately no `truncate`, no `maxLength`, and no compact
 * formatting. If the value does not fit, the table scrolls (§2.7).
 */
export function NumericValue({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('whitespace-nowrap font-mono tabular-nums', className)}>
      {children}
    </span>
  );
}
