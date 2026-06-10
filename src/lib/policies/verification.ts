import type { PolicyBundle } from "./schemas";
import type { OverrideRow } from "./resolve";
import { effectivePolicy } from "./resolve";
import type { StageKey } from "./stages";
import type { StageRow } from "@/hooks/useStageRows";

export type Severity = "block" | "warn" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  stage: StageKey;
  rowKey?: string;
  field?: string;
  message: string;
  hint?: string;
}

interface VerifyInput {
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  fulfillmentStrategy: string;
  supplierRows: StageRow[];
  plantRows: StageRow[];
  customerRows: StageRow[];
  /** Optional — when omitted, the time-unit check is skipped. */
  timeUnit?: "day" | "week" | "month" | null;
}

export function verifyProjectPolicies(input: VerifyInput): Finding[] {
  const out: Finding[] = [];
  const { defaults, overrides, fulfillmentStrategy, supplierRows, plantRows, customerRows, timeUnit } = input;

  const has = <T,>(v: T | undefined | null): v is T => v !== undefined && v !== null && (v as any) !== "";

  if (timeUnit === null) {
    out.push({
      id: "time-unit-missing",
      severity: "block",
      stage: "run_validate",
      message: "Planning time unit is not set.",
      hint: "Pick day / week / month at the top of the policies page.",
    });
  }

  // ---------- Suppliers ----------
  if (supplierRows.length === 0) {
    out.push({
      id: "no-suppliers",
      severity: "block",
      stage: "supplier",
      message: "No supplier rows for this project.",
      hint: "Upload inbound logistics in Data Manager.",
    });
  }
  // primary checked? exactly one per material
  const primariesByMat = new Map<string, number>();
  // materials whose only "supplier" is the unassigned placeholder
  const materialsMissingSupplier = new Set<string>();
  for (const r of supplierRows) {
    if ((r as any).__needs_supplier || r.supplier_id === "(unassigned supplier)") {
      const mat = String(r.material_id ?? "");
      if (mat) materialsMissingSupplier.add(mat);
      out.push({
        id: `s-nosup-${r.material_id}`,
        severity: "block",
        stage: "supplier",
        rowKey: String(r.key),
        message: `Material "${r.material_id}" has no supplier — assign one.`,
        hint: "Every material must be sourced from at least one supplier.",
      });
      continue;
    }
    const eff = effectivePolicy(defaults, overrides, "node", String(r.key));
    const isPrimary = (eff.sourcing as any).primary_source === true;
    const mat = String(r.material_id ?? "");
    if (isPrimary) primariesByMat.set(mat, (primariesByMat.get(mat) ?? 0) + 1);
    const lt = (eff.transport as any).lead_time_mean_days;
    if (!has(lt) || lt <= 0) {
      out.push({
        id: `s-lt-${r.key}`,
        severity: "warn",
        stage: "supplier",
        rowKey: String(r.key),
        field: "lead_time_mean_days",
        message: `Supplier "${r.supplier_id}" has no positive lead time.`,
      });
    }
    const price = (eff.sourcing as any).material_price ?? 0;
    if (!has(price) || price <= 0) {
      out.push({
        id: `s-price-${r.key}`,
        severity: "warn",
        stage: "supplier",
        rowKey: String(r.key),
        field: "material_price",
        message: `Material "${r.material_id}" has no unit price — cost calculations will be zero.`,
        hint: "Set a material price so the simulation can compute total supply cost.",
      });
    }
    const sigma = (eff.transport as any).lead_time_std_days ?? 0;
    if (has(lt) && lt > 0 && sigma >= lt * 3) {
      out.push({
        id: `s-sigma-${r.key}`,
        severity: "warn",
        stage: "supplier",
        rowKey: String(r.key),
        field: "lead_time_std_days",
        message: `σ (${sigma}) is ≥ 3× the mean lead time — distribution will be near-degenerate.`,
      });
    }
    const moq = (eff.inventory as any).moq ?? 0;
    const cap = (eff.sourcing as any).supplier_capacity_per_day ?? 0;
    if (moq > 0 && cap > 0 && moq > cap * 30) {
      out.push({
        id: `s-moq-${r.key}`,
        severity: "warn",
        stage: "supplier",
        rowKey: String(r.key),
        field: "moq",
        message: `MOQ (${moq}) exceeds 30 days of supplier capacity (${cap}/day).`,
      });
    }
  }
  for (const [mat, count] of primariesByMat) {
    if (count > 1) {
      out.push({
        id: `s-prim-${mat}`,
        severity: "block",
        stage: "supplier",
        message: `Material "${mat}" has ${count} suppliers marked primary — pick exactly one.`,
      });
    }
  }
  // materials with no primary at all → blocker
  const mats = new Set(supplierRows.map((r) => String(r.material_id ?? "")));
  for (const m of mats) {
    if (materialsMissingSupplier.has(m)) continue;
    if (!primariesByMat.has(m) && m !== "(no material data)" && m !== "") {
      out.push({
        id: `s-noprim-${m}`,
        severity: "block",
        stage: "supplier",
        message: `Material "${m}" has no primary supplier — select one.`,
      });
    }
  }

  // ---------- Plant ----------
  const isMTS = fulfillmentStrategy === "make_to_stock" ||
    fulfillmentStrategy === "assemble_to_order" ||
    fulfillmentStrategy === "configure_to_order";
  for (const r of plantRows) {
    const eff = effectivePolicy(defaults, overrides, "node", String(r.key));
    const cap = ((eff.production as any).capacity_machine_per_day ?? 0)
      + ((eff.production as any).capacity_labor_per_day ?? 0);
    if (cap <= 0) {
      out.push({
        id: `p-cap-${r.key}`,
        severity: "warn",
        stage: "plant",
        rowKey: String(r.key),
        field: "capacity_machine_per_day",
        message: `Product "${r.product_id}" has zero machine + labor capacity.`,
      });
    }
    if (isMTS) {
      const inv = (eff.inventory as any);
      if (!has(inv.reorder_point) || inv.reorder_point <= 0) {
        out.push({
          id: `p-rop-${r.key}`,
          severity: "warn",
          stage: "plant",
          rowKey: String(r.key),
          field: "reorder_point",
          message: `MTS strategy but reorder point is 0 for "${r.product_id}".`,
        });
      }
      if (inv.order_up_to <= inv.reorder_point) {
        out.push({
          id: `p-S-${r.key}`,
          severity: "block",
          stage: "plant",
          rowKey: String(r.key),
          field: "order_up_to",
          message: `Order-up-to (${inv.order_up_to}) must be greater than reorder point (${inv.reorder_point}).`,
        });
      }
    }
    const prodLt = (eff.production as any).production_lead_time_mean_days;
    if (!has(prodLt) || prodLt <= 0) {
      out.push({
        id: `p-lt-${r.key}`,
        severity: "warn",
        stage: "plant",
        rowKey: String(r.key),
        field: "production_lead_time_mean_days",
        message: `No production lead time set for "${r.product_id}".`,
      });
    }
  }

  // ---------- Customer ----------
  const primariesByCP = new Map<string, number>();
  const cpSeen = new Set<string>();
  for (const r of customerRows) {
    const eff = effectivePolicy(defaults, overrides, "node", String(r.key));
    const mean = (eff.demand as any).mean_per_day ?? 0;
    if (mean <= 0 && fulfillmentStrategy !== "engineer_to_order") {
      out.push({
        id: `c-mean-${r.key}`,
        severity: "warn",
        stage: "customer",
        rowKey: String(r.key),
        field: "mean_per_day",
        message: `Customer "${r.customer_id}" has zero mean demand.`,
      });
    }
    const price = (eff.fulfillment as any).price ?? 0;
    if (price < 0) {
      out.push({
        id: `c-price-${r.key}`,
        severity: "block",
        stage: "customer",
        rowKey: String(r.key),
        field: "price",
        message: `Negative price for "${r.product_id}".`,
      });
    } else if (price === 0 && mean > 0) {
      out.push({
        id: `c-price-zero-${r.key}`,
        severity: "warn",
        stage: "customer",
        rowKey: String(r.key),
        field: "price",
        message: `Customer "${r.customer_id}" has demand but zero selling price — revenue will be zero.`,
        hint: "Set a unit price so the simulation can compute revenue and profit KPIs.",
      });
    }
    const cp = `${r.customer_id}::${r.product_id}`;
    cpSeen.add(cp);
    if ((eff.fulfillment as any).primary_source === true) {
      primariesByCP.set(cp, (primariesByCP.get(cp) ?? 0) + 1);
    }
  }
  for (const cp of cpSeen) {
    const n = primariesByCP.get(cp) ?? 0;
    if (n !== 1) {
      out.push({
        id: `c-prim-${cp}`,
        severity: "block",
        stage: "customer",
        message:
          n === 0
            ? `Customer/product "${cp}" has no primary sourcing firm — select one.`
            : `Customer/product "${cp}" has ${n} primary firms — pick exactly one.`,
      });
    }
  }

  // ---------- Orphan overrides ----------
  const validKeys = new Set([
    ...supplierRows.map((r) => r.key),
    ...plantRows.map((r) => r.key),
    ...customerRows.map((r) => r.key),
  ]);
  for (const o of overrides) {
    if (!validKeys.has(o.target_key)) {
      out.push({
        id: `orphan-${o.target_key}-${o.family}`,
        severity: "info",
        stage: "supplier",
        rowKey: o.target_key,
        message: `Orphan override on "${o.target_key}" (${o.family}) — row no longer in data.`,
      });
    }
  }

  return out;
}
