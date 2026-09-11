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
import { useLocation } from "react-router-dom";
import { ChevronLeft, X } from "lucide-react";
import { MOBILE_TABBAR_BORDER, MOBILE_TABBAR_H, isMobileRootRoute } from "@/components/MobileNav";
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
  /** A pinned `[ secondary ][ primary flex ]` footer at 46px (SC Intelligences
   *  handoff §3) — attach/sources need one, the five chat sheets don't, so
   *  this is optional rather than every sheet growing an empty bar. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function MobileSheet({ open, title, sub, onClose, onBack, footer, children }: MobileSheetProps) {
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const { pathname } = useLocation();
  // The bar is only there to stop above on a root route (D3-a: shown unless
  // the screen was pushed onto a stack) — on a pushed view it isn't rendered
  // at all, and reserving its height anyway leaves 59px of dead space
  // between the sheet and the bottom edge.
  const tabBarOffset = isMobileRootRoute(pathname) ? MOBILE_TABBAR_H + MOBILE_TABBAR_BORDER : 0;

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
        // §7: 16px top corners, and the one shadow the skin has — the one
        // under a bottom sheet. Borders separate everywhere else.
        className="flex max-h-[76%] shrink-0 flex-col rounded-t-[16px] bg-white
                   landscape:max-h-full landscape:rounded-none"
        style={{
          boxShadow: "0 -8px 28px rgba(0,0,0,.14)",
          transform: dragY ? "translateY(" + dragY + "px)" : undefined,
          transition: dragY ? "none" : "transform 0.2s cubic-bezier(0.2,0,0,1)",
          marginBottom: "calc(" + tabBarOffset + "px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div
          onTouchStart={dragStart}
          onTouchMove={dragMove}
          onTouchEnd={dragEnd}
          className="relative flex shrink-0 items-center gap-2 border-b border-[#d4d4d4] px-3 py-3.5 [touch-action:none]"
        >
          <span className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-[#d4d4d4]" />
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              title="Back"
              className="-ml-1.5 grid h-11 w-11 shrink-0 place-items-center text-[#18181b]"
            >
              <ChevronLeft className="h-[20px] w-[20px]" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[19px] font-semibold leading-tight tracking-[-0.019em] text-[#18181b]">
              {title}
            </h2>
            {/* The sheet is a screen of its own, so its one explanatory line
                stays where §4 removes a page subtitle — a sheet has no tab bar
                or action bar competing for the band. */}
            {sub && (
              <p className="mt-1 text-[12px] leading-snug text-[#525252] [text-wrap:pretty]">{sub}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="-mr-1.5 grid h-11 w-11 shrink-0 place-items-center text-[#525252]"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && (
          <div className="flex shrink-0 gap-2 border-t border-[#ebebeb] px-3 py-2.5">{footer}</div>
        )}
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
        "flex w-full min-h-11 items-center gap-2.5 border-b border-[#e8e8ea] bg-white px-3 py-[var(--m-row-y)] text-left last:border-b-0",
        disabled ? "cursor-not-allowed opacity-60" : "active:bg-[#fafafa]",
      )}
    >
      {mono && (
        // The skin's mono chip: a filled 3px tag, which is the largest a
        // colour fill is allowed to be (§3, §7).
        <span
          className="shrink-0 rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white"
          style={{ background: monoColor ?? "#18181b" }}
        >
          {mono}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "truncate text-[13.5px] font-medium leading-tight",
            disabled ? "text-[#525252]" : !danger && "text-[#18181b]",
          )}
          style={!disabled && danger ? { color: DESTRUCTIVE } : undefined}
        >
          {title}
        </span>
        {meta && (
          <span className="font-mono text-[10.5px] leading-[1.45] tracking-[0.04em] text-[#525252] [text-wrap:pretty]">
            {meta}
          </span>
        )}
      </span>
      {tag && (
        <span
          // 10px is the floor for a mono micro-label in this skin — #8a8a8a
          // at 9.5px is exactly the pair §2 retires for daylight.
          className="shrink-0 whitespace-nowrap rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]"
          style={
            tagTone === "warn"
              ? { borderColor: "#e0930b", background: "#e0930b1f", color: "#6b4405" }
              : { borderColor: "#d4d4d4", color: "#525252" }
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
