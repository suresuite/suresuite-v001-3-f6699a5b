// The project-level settings each stage shows ON ONE LINE above its grid
// (`ProjectRuleBar`). Authored once here, read by the desktop bar, the phone's
// read-only summary and the /policies → Data map column check, so the three
// cannot list different fields.
//
// Each is a key the engine reads at the PROJECT default only — no row carries
// it — which is why it is not a grid column:
// - P-C.2 `fulfillment.allocation`, applied only between two or more customers;
// (P-C.1's backorder is per row, WP 14.3 — not a project line.)
//
// P-P.4's FG safety buffer is NOT here, by owner decision (§24 WP 14.8): it was
// a second way to say "keep more FG" beside the row's own S. How much FG to keep
// is said once, on the Plant row. A buffer an older policy version SAVED is
// still read by the engine, so it shows as a removable notice
// (`legacyFgBufferShown`) until someone clears it — never as a control.
import type { PolicyFamily } from "./schemas";

export interface RuleField {
  field: string;
  /** The words before the control. */
  label: string;
  /** The unit after a number. */
  unit?: string;
  /** Option labels for an enum, when the token is not the words. */
  optionLabel?: (token: string) => string;
  /** Shown only when this returns true for the current draft. */
  when?: (draft: Record<string, unknown>) => boolean;
  /** Width of a number input, px. */
  w?: number;
}

export interface ProjectRule {
  family: PolicyFamily;
  title: string;
  hint: string;
  fields: RuleField[];
}

const ALLOCATION_LABEL: Record<string, string> = {
  priority: "priority (row weights)",
  fair_share: "fair share",
  proportional: "proportional to demand",
  revenue_max: "revenue max (row price)",
  sla_tier: "SLA tier (row targets)",
};

/** P-C.2 — the one rule that shares short stock between customers. */
export const ALLOCATION_FIELD: RuleField = {
  field: "allocation",
  label: "When stock is short, share it between customers by",
  optionLabel: (t) => ALLOCATION_LABEL[t] ?? t,
};

/**
 * The Customer stage's ONE project setting: the allocation rule. Backorder is
 * not here — it is a column on every row (WP 14.3), and an empty row cell shows
 * the value it inherits (owner decision, §24 WP 14.8: a project line of
 * "defaults for empty cells" read as a second backorder setting).
 */
export const CUSTOMER_RULE: ProjectRule = {
  family: "fulfillment",
  title: "Allocation",
  hint:
    "Project-wide (P-C.2): how the engine shares a product's short stock between its customers. " +
    "Applied only when two or more customers want the same product.",
  fields: [ALLOCATION_FIELD],
};

/** The line's fields for a grid naming `customerCount` customers: the engine
 *  applies the rule only between two or more, so with one there is no line. */
export function customerRuleFields(customerCount: number): RuleField[] {
  return customerCount >= 2 ? CUSTOMER_RULE.fields : [];
}

const FG_SIZING_LABEL: Record<string, string> = {
  none: "none",
  service_level: "service level",
  fixed_days: "fixed days of demand",
};

/** Whether the legacy FG-buffer notice shows: a saved, non-`none` sizing that
 *  the engine applies to at least one line (an MTS base-stock product whose S
 *  is empty — `fgBufferAppliesToRow`). */
export function legacyFgBufferShown(inventory: Record<string, unknown> | undefined, rows: number): boolean {
  const sizing = String(inventory?.fg_safety_stock ?? "none");
  return sizing !== "none" && rows > 0;
}

/** The notice's sentence: what the saved buffer is, and to how many lines. */
export function legacyFgBufferNote(inventory: Record<string, unknown>, rows: number): string {
  const sizing = String(inventory.fg_safety_stock);
  const how =
    sizing === "service_level"
      ? `service level ${String(inventory.fg_service_level_target ?? 0.95)}`
      : sizing === "fixed_days"
        ? `${String(inventory.fg_safety_stock_days ?? 2)} days of demand`
        : sizing;
  const what = rows === 1 ? "1 product" : `${rows} products`;
  return `This policy version still adds an FG safety buffer (${how}) on top of the derived S of ${what} whose S is empty. Set S on the row instead.`;
}

export const FG_BUFFER_RULE: ProjectRule = {
  family: "inventory",
  title: "FG safety buffer",
  hint:
    "P-P.4, saved by an older policy version: a buffer added to a DERIVED FG target S. No control on /policies — " +
    "how much FG to keep is set on the Plant row (S, s,S or days of cover).",
  fields: [
    { field: "fg_safety_stock", label: "Size it by", optionLabel: (t) => FG_SIZING_LABEL[t] ?? t },
    {
      field: "fg_service_level_target",
      label: "target",
      unit: "0–1",
      when: (d) => d.fg_safety_stock === "service_level",
    },
    {
      field: "fg_safety_stock_days",
      label: "cover",
      unit: "days",
      when: (d) => d.fg_safety_stock === "fixed_days",
    },
  ],
};
