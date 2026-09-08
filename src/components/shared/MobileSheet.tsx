/**
 * MobileSheet — the one bottom-sheet shell (mobile-ui-spec §2.6 / §4.4).
 *
 * Mobile-only by construction: nothing here renders above `md` because every
 * caller mounts it inside a `useIsMobile()` branch. Desktop keeps its dialogs
 * and side panels untouched.
 *
 * Behaviour the spec fixes and this owns so five sheets cannot drift apart:
 *  - the header IS the drag handle; a downward drag past DISMISS_PX closes,
 *    anything shorter springs back,
 *  - portrait caps at 76% height, landscape goes full-height (76% of a 402px
 *    landscape viewport leaves no usable content area),
 *  - the panel stops above the bottom tab bar rather than covering it, so the
 *    "you are here" signal and the one-tap route out both survive — the same
 *    rule the More panel follows,
 *  - `onBack` renders the drill-down affordance the nested sheets need
 *    (This chat → Model), so a sub-sheet is never a dead end.
 */
import React, { useRef, useState } from "react";
import { ChevronLeft, X } from "lucide-react";
import { MOBILE_TABBAR_BORDER, MOBILE_TABBAR_H } from "@/components/MobileNav";
import { cn } from "@/lib/utils";

/** Drag distance that dismisses instead of springing back (spec §4.4). */
const DISMISS_PX = 90;

/** Design-system brand red — the destructive row (Delete chat) and nothing else. */
const DESTRUCTIVE = "#bf2330";

interface MobileSheetProps {
  open: boolean;
  title: string;
  /** One-line explanation under the title. Omitted where the rows explain themselves. */
  sub?: string;
  onClose: () => void;
  /** Present on a drilled-into sheet; renders the back chevron. */
  onBack?: () => void;
  children: React.ReactNode;
}

export function MobileSheet({ open, title, sub, onClose, onBack, children }: MobileSheetProps) {
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  if (!open) return null;

  const dragStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  };
  const dragMove = (e: React.TouchEvent) => {
    if (startY.current == null) return;
    // Downward only — an upward drag on the header must not lift the panel
    // off the bottom edge.
    setDragY(Math.max(0, e.touches[0].clientY - startY.current));
  };
  const dragEnd = () => {
    const travelled = dragY;
    startY.current = null;
    setDragY(0);
    if (travelled > DISMISS_PX) onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-foreground/30 md:hidden" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" onClick={onClose} className="min-h-11 flex-1" />
      <div
        className="flex max-h-[76%] shrink-0 flex-col rounded-t-xl border-t border-border bg-background
                   landscape:max-h-full landscape:rounded-none"
        style={{
          transform: dragY ? "translateY(" + dragY + "px)" : undefined,
          transition: dragY ? "none" : "transform 0.2s cubic-bezier(0.2,0,0,1)",
          marginBottom:
            "calc(" + (MOBILE_TABBAR_H + MOBILE_TABBAR_BORDER) + "px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div
          onTouchStart={dragStart}
          onTouchMove={dragMove}
          onTouchEnd={dragEnd}
          className="relative flex shrink-0 items-start gap-2.5 border-b border-border px-3.5 py-4 [touch-action:none]"
        >
          <span className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-border" />
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              title="Back"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border bg-card"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold text-foreground">{title}</h2>
            {sub && <p className="mt-1 text-[12px] leading-snug text-muted-foreground [text-wrap:pretty]">{sub}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border bg-card"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

/**
 * The list row every sheet in the catalogue uses — mono badge, title, meta,
 * tag, tick. Rendering these ad hoc per sheet is how five sheets end up with
 * five row heights.
 */
export function MobileSheetRow({
  mono,
  monoColor,
  title,
  meta,
  tag,
  tagTone = "neutral",
  checked,
  danger,
  disabled,
  hint,
  onClick,
}: {
  mono?: string;
  monoColor?: string;
  title: string;
  meta?: string;
  tag?: string;
  tagTone?: "neutral" | "warn";
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Native tooltip — carries a suggestion's `reason`, or Auto's unlock rule. */
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-disabled={disabled || undefined}
      className={cn(
        "flex w-full min-h-11 items-center gap-2.5 border-b border-[--hair-divider] px-3.5 py-2.5 text-left last:border-b-0",
        disabled ? "cursor-not-allowed" : "active:bg-[#f4f4f5]",
      )}
    >
      {mono && (
        <span
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-sm font-mono text-[11px] font-semibold"
          style={monoColor ? { background: monoColor + "1f", color: monoColor } : undefined}
        >
          {mono}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span
          className={cn(
            "truncate text-[15px] font-semibold",
            disabled && "text-muted-foreground",
            !disabled && !danger && "text-foreground",
          )}
          style={!disabled && danger ? { color: DESTRUCTIVE } : undefined}
        >
          {title}
        </span>
        {meta && <span className="text-[11.5px] leading-[1.45] text-muted-foreground [text-wrap:pretty]">{meta}</span>}
      </span>
      {tag && (
        <span
          className="shrink-0 whitespace-nowrap rounded-[3px] border px-[5px] py-px font-mono text-[9.5px] uppercase tracking-[0.08em]"
          style={
            tagTone === "warn"
              ? { borderColor: "rgba(224,147,11,0.35)", background: "rgba(224,147,11,0.1)", color: "#b45309" }
              : { borderColor: "#e4e4e4", color: "#8a8a8a" }
          }
        >
          {tag}
        </span>
      )}
      {checked && (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-foreground"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}
