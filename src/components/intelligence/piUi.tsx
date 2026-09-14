/**
 * Project Intelligence — shared UI atoms (SuReSuite visual language).
 *
 * Same shape as handoff/admin/adminUi.tsx and handoff/DeveloperApi.tsx:
 * class consts first, then the tiny primitives every panel reuses.
 * Sharp corners (4px), 1px --hair-border rules, --hair-divider row dividers,
 * mono UPPERCASE kickers, black-pill active states — never grey.
 */
import React from "react";
import { cn } from "@/lib/utils";

/* ── shared class consts ─────────────────────────────────────────────── */

export const SURFACE = "rounded-sm border border-[--hair-border] bg-background";
export const KX = "font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground";
export const KX_TIGHT = "font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground";
/**
 * L2 — the column row as an ink block. The panel treatment (mono, 10px,
 * 0.14em) is deliberately kept distinct from the Ledger TH; only the ground
 * and the label colour move. No bottom border: the ink ends at the data.
 */
export const TH =
  "bg-[--brand-ink] px-2.5 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-white border-r border-r-[rgba(255,255,255,0.22)] last:border-r-0";
export const TD = "px-2.5 py-1.5 text-[12.5px] text-foreground border-b border-[--hair-divider]";
export const ROW_HOVER = "hover:bg-[#fcfcfc]";

/**
 * The in-MESSAGE table (MessageParts.TablePart) — NOT the ledger above.
 *
 * A table inside an assistant reply is a quiet block in a card, not a Ledger:
 * a light #fafafa header with mono labels and hairline rules, every cell in
 * mono so figures line up column to column. The ink TH is right for a
 * full-page ledger and far too loud for three rows inside a chat bubble.
 *
 * Mobile value first, `md:` restoring the ledger literal — desktop renders
 * exactly what it rendered before (spec §2.5C).
 *
 * v2 §2 moves the mobile half onto the separation model: the head sits on
 * #fafafa above the outer rule, the body divides on the inner one, and the
 * label rises from the retired #8a8a8a to the ink ladder's #525252. Every
 * `md:` term is untouched.
 */
export const TH_MESSAGE =
  "px-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.14em] whitespace-nowrap " +
  "bg-[#fafafa] py-[7px] text-[#525252] border-b border-b-[#d4d4d4] " +
  "md:border-b-0 md:bg-[--brand-ink] md:py-1.5 md:text-white md:border-r md:border-r-[rgba(255,255,255,0.22)] md:last:border-r-0";

export const TD_MESSAGE =
  "px-2.5 text-[12.5px] text-foreground border-b " +
  "py-[7px] font-mono whitespace-nowrap border-b-[#e8e8ea] " +
  "md:py-1.5 md:font-sans md:whitespace-normal md:border-b-[--hair-divider]";
export const MONO = "font-mono";

/** Layer colors (design system): firm/focal, product, process/material. */
export const LAYER = {
  firm: "#e0930b",
  product: "#7c3aed",
  process: "#14b8c4",
  brand: "#BF2330",
  accent: "#F8D448",
} as const;

/** Agent id → layer color. AGENTS in lib/chat/agents.ts carries tailwind
 * text-* colors for the legacy UI; Project Intelligence uses layer hexes. */
export const AGENT_COLOR: Record<string, string> = {
  "risk-analyst": LAYER.brand,
  "simulation-modeler": LAYER.product,
  "inventory-strategist": LAYER.firm,
  "logistics-planner": LAYER.process,
  general: "#111111",
};

/** Two-letter mono badge per agent (no icons in the tinted square). */
export const AGENT_MONO: Record<string, string> = {
  "risk-analyst": "RA",
  "simulation-modeler": "SM",
  "inventory-strategist": "IS",
  "logistics-planner": "LP",
  general: "GA",
};

export const tint = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
};

/* ── primitives ──────────────────────────────────────────────────────── */

/** Status as a colored dot — active/ok #14b8c4, error/revoked #bf2330. */
export function StatusDot({ ok, pending, className }: { ok?: boolean; pending?: boolean; className?: string }) {
  const color = pending ? LAYER.firm : ok ? LAYER.process : LAYER.brand;
  return (
    <span
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", className)}
      style={{ background: color }}
    />
  );
}

/** Mono chip for tags / env / scopes / kinds. */
export function MonoChip({
  children,
  color,
  className,
}: {
  children: React.ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn("rounded-sm px-1.5 py-px font-mono text-[9px] leading-normal", className)}
      style={
        color
          ? { background: tint(color, 0.1), color }
          : { background: "#eeeef0", color: "var(--hair-quiet)" }
      }
    >
      {children}
    </span>
  );
}

/** Black-pill segmented control — active = bg-foreground text-background. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-sm border border-[--zinc-border] p-[3px]", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            disabled={o.disabled}
            onClick={() => !o.disabled && onChange(o.value)}
            className={cn(
              "rounded-[2px] transition-colors",
              size === "sm" ? "px-[7px] py-[2px] text-[10.5px]" : "px-[15px] py-[7px] text-[12px]",
              o.disabled
                ? "cursor-not-allowed text-[#c9c9c9]"
                : active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Thin switch for boolean settings. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2"
      aria-pressed={checked}
    >
      <span
        className={cn(
          "relative h-[14px] w-[26px] rounded-sm border transition-colors",
          checked ? "border-foreground bg-foreground" : "border-[--zinc-border] bg-background",
        )}
      >
        <span
          className={cn(
            "absolute top-[1px] h-[10px] w-[10px] rounded-[1px] transition-all",
            checked ? "left-[13px] bg-background" : "left-[1px] bg-[#d9d9d9]",
          )}
        />
      </span>
      {label && <span className="text-[12px] text-muted-foreground">{label}</span>}
    </button>
  );
}

/** Section kicker with an optional count badge. */
export function Kicker({
  children,
  count,
  color,
  className,
}: {
  children: React.ReactNode;
  count?: number;
  color?: string;
  className?: string;
}) {
  return (
    <span className={cn(KX_TIGHT, "flex items-center gap-1", className)} style={color ? { color } : undefined}>
      {children}
      {typeof count === "number" && (
        <span className="ml-1 rounded-sm bg-[#f0f0f0] px-[5px] font-sans text-[10px] normal-case tracking-normal text-muted-foreground">
          {count}
        </span>
      )}
    </span>
  );
}

/** Collapsible panel header (chevron + label + count), layer-tinted. */
export function PanelHeader({
  open,
  onToggle,
  label,
  count,
  color,
  right,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  count: number;
  color: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={onToggle} className={cn(KX_TIGHT, "flex items-center gap-1 py-0.5")} style={{ color }}>
        <span
          className="inline-block transition-transform"
          style={{ color: "#c4c4c4", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ›
        </span>
        {label}
        <span className="ml-1 rounded-sm bg-[#f0f0f0] px-[5px] font-sans text-[10px] normal-case tracking-normal text-muted-foreground">
          {count}
        </span>
      </button>
      {open && right}
    </div>
  );
}
