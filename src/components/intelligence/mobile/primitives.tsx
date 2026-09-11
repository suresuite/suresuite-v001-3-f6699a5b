/**
 * SC Intelligences — shared mobile primitives (handoff §1, §6.5, §4).
 *
 * Everything else in the flow (root, thread, roster, proposal) consumes these
 * three rather than hand-rolling a badge or a status chip per screen (T2).
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { getIntel, STATUS, type CredibilityStatus } from "./intel";

/** Two-letter mono badge — never an icon or avatar (§1). 22px in lists and
 *  message headers, 24px on the roster and an intelligence's own screen. */
export function IntelBadge({
  id,
  size = 22,
  className,
}: {
  id: string;
  size?: 22 | 24;
  className?: string;
}) {
  const intel = getIntel(id);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[3px] font-mono font-semibold",
        size === 24 ? "text-[10px]" : "text-[9.5px]",
        className,
      )}
      style={{ width: size, height: size, background: intel.bg, color: intel.fg }}
      aria-hidden
    >
      {intel.badge}
    </span>
  );
}

/** The status recipe as a chip — validated / stale / rejected / neutral
 *  (§4). Used for a source row's credibility and the read strip. */
export function CredibilityChip({
  status,
  children,
  dot,
  dotColor,
  className,
}: {
  status: CredibilityStatus;
  children: React.ReactNode;
  /** A leading meaning dot — the read strip's "healthy artefact" mark
   *  (§6.5), which is teal rather than the chip's own text colour. */
  dot?: boolean;
  dotColor?: string;
  className?: string;
}) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] px-1.5 py-0.5 font-mono text-[10.5px]",
        s.border && "border",
        className,
      )}
      style={{
        background: s.bg,
        borderColor: s.border ?? undefined,
        color: s.text,
      }}
    >
      {dot && (
        <span
          aria-hidden
          className="h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ background: dotColor ?? s.text }}
        />
      )}
      {children}
    </span>
  );
}

/** The teal dot for a healthy read-strip artefact (§6.5) — not a status. */
const READ_HEALTHY_DOT = "#14b8c4";

/** The answer's read strip (§6.5): mono `read` label, then one chip per
 *  artefact — teal-dot neutral for healthy, amber status chip for stale. */
export function ReadStrip({
  items,
  className,
}: {
  items: Array<{ label: string; stale?: boolean }>;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("mt-3 flex flex-wrap items-center gap-1.5", className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a8a8a]">read</span>
      {items.map((it, i) => (
        <CredibilityChip
          key={i}
          status={it.stale ? "stale" : "neutral"}
          dot={!it.stale}
          dotColor={READ_HEALTHY_DOT}
        >
          {it.label}
        </CredibilityChip>
      ))}
    </div>
  );
}
