// The project-level settings each stage shows ON ONE LINE above its grid
// (`ProjectRuleBar`). Authored once here, read by the desktop bar, the phone's
// read-only summary and the /policies → Data map column check, so the three
// cannot list different fields.
//
// Each is a key the engine reads at the PROJECT default only — no row carries
// it — which is why it is not a grid column:
// - P-C.2 `fulfillment.allocation`, applied only between two or more customers;
// - P-C.1's backorder trio, which an EMPTY Customer-row cell inherits (a row's
//   own cell wins, WP 14.3);
// - P-P.4's FG buffer, read only for a product that holds FG stock.
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

const backorders = (d: Record<string, unknown>) => d.backorder_allowed === true;

/** P-C.2 — the one rule that shares short stock between customers. */
export const ALLOCATION_FIELD: RuleField = {
  field: "allocation",
  label: "When stock is short, allocate by",
  optionLabel: (t) => ALLOCATION_LABEL[t] ?? t,
};

/** P-C.1 — what an empty Customer-row backorder cell inherits. */
export const BACKORDER_DEFAULT_FIELDS: RuleField[] = [
  { field: "backorder_allowed", label: "Empty backorder cells: backorder" },
  { field: "max_backorder_days", label: "up to", unit: "days", when: backorders, w: 52 },
  { field: "backorder_cost_per_day", label: "at", unit: "€ / unit / day", when: backorders, w: 56 },
];

export const CUSTOMER_RULE: ProjectRule = {
  family: "fulfillment",
  title: "Customer rules",
  hint:
    "Project-wide: the allocation rule the engine applies between customers (P-C.2), and the backorder " +
    "settings a Customer row inherits while its own backorder cells are empty (P-C.1).",
  fields: [ALLOCATION_FIELD, ...BACKORDER_DEFAULT_FIELDS],
};

/** The Customer bar's fields for a grid naming `customerCount` customers: the
 *  engine applies the allocation rule only between two or more. */
export function customerRuleFields(customerCount: number): RuleField[] {
  return customerCount >= 2 ? CUSTOMER_RULE.fields : BACKORDER_DEFAULT_FIELDS;
}

const FG_SIZING_LABEL: Record<string, string> = {
  none: "none",
  service_level: "service level",
  fixed_days: "fixed days of demand",
};

export const FG_BUFFER_RULE: ProjectRule = {
  family: "inventory",
  title: "FG safety buffer",
  hint:
    "Project-wide (P-P.4): a buffer added to a DERIVED FG target S for every product that holds FG stock. " +
    "A level typed in the grid is the target as typed — nothing is added on top of it.",
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
