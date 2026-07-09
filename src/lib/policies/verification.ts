import type { PolicyBundle } from "./schemas";
import type { OverrideRow } from "./resolve";
import { effectivePolicy } from "./resolve";
import type { StageKey } from "./stages";
import type { StageRow } from "@/hooks/useStageRows";
import type { MaterialRow, ProductRow, SupplierRow } from "@/hooks/useItemMasters";
import { compileRequiredDataFindings, type Finding, type Severity } from "./validationService";

export type { Finding, Severity };

/** Discriminated result: grading is only meaningful once the inputs exist. */
export type VerifyResult =
  | { status: "ready"; findings: Finding[] }
  | { status: "loading"; findings: [] };

interface VerifyInput {
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  fulfillmentStrategy: string;
  supplierRows: StageRow[];
  plantRows: StageRow[];
  customerRows: StageRow[];
  /** Optional — when omitted, the time-unit check is skipped. */
  timeUnit?: "day" | "week" | "month" | null;
  /** Item-master rows the engine actually reads (Phase A / G4 / §8.3). */
  materials?: MaterialRow[];
  products?: ProductRow[];
  suppliers?: SupplierRow[];
  /**
   * RAW logistics/BOM rows for the shared grader (useItemMasters.lanes) —
   * the same tables the sim-command gate reads, never imputed.
   */
  inbound?: Record<string, unknown>[];
  outbound?: Record<string, unknown>[];
  bom?: Record<string, unknown>[];
  /**
   * False while the hooks are still fetching masters/lanes. Grading with
   * partial data used to be skipped SILENTLY, letting a run dispatch into a
   * server-side gate rejection the user never saw coming — now the caller
   * gets an explicit "loading" status and keeps Run disabled.
   */
  dataReady: boolean;
}

/**
 * Pre-run validation for the /policies "Run & Validate" stage (§8.2).
 *
 * Two kinds of check:
 *   1. Structural/topology checks on the sourcing graph (a material must have
 *      a supplier, exactly one primary, etc.) — these mirror hard errors the
 *      mapper raises.
 *   2. The required-data manifest (§8.1) — compiled by validationService.ts
 *      from the engine registry's data_requirements: every entity field the
 *      always-on mechanics and the currently-activated policies read, graded
 *      against the engine's real fallback chains. The same registry payload
 *      AND the same grading module drive the sim-command pre-dispatch gate,
 *      so passing here means the run will dispatch.
 */
export function verifyProjectPolicies(input: VerifyInput): VerifyResult {
  // Grading partial data produces false confidence (this surface once passed
  // while the server gate blocked) — report loading instead of guessing.
  if (!input.dataReady) return { status: "loading", findings: [] };

  const out: Finding[] = [];
  const {
    defaults, overrides,
    supplierRows, plantRows, customerRows, timeUnit,
    materials, products, suppliers, inbound, outbound, bom,
  } = input;

  if (timeUnit === null) {
    out.push({
      id: "time-unit-missing",
      severity: "block",
      stage: "run_validate",
      message: "Planning time unit is not set.",
      hint: "Pick day / week / month at the top of the policies page.",
    });
  }

  // ---------- Suppliers: sourcing topology ----------
  if (supplierRows.length === 0) {
    out.push({
      id: "no-suppliers",
      severity: "block",
      stage: "supplier",
      message: "No supplier rows for this project.",
      hint: "Upload inbound logistics in Data Manager.",
    });
  }
  // Exactly one primary supplier per material; every material sourced.
  const primariesByMat = new Map<string, number>();
  const materialsMissingSupplier = new Set<string>();
  for (const r of supplierRows) {
    const mat = String(r.material_id ?? "");
    if ((r as Record<string, unknown>).__needs_supplier || r.supplier_id === "(unassigned supplier)") {
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
    if ((eff.sourcing as Record<string, unknown>).primary_source === true) {
      primariesByMat.set(mat, (primariesByMat.get(mat) ?? 0) + 1);
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

  // ---------- Customers: fulfillment topology ----------
  const primariesByCP = new Map<string, number>();
  const cpSeen = new Set<string>();
  for (const r of customerRows) {
    const eff = effectivePolicy(defaults, overrides, "node", String(r.key));
    const cp = `${r.customer_id}::${r.product_id}`;
    cpSeen.add(cp);
    if ((eff.fulfillment as Record<string, unknown>).primary_source === true) {
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

  // ---------- Required-data manifest (§8.1) ----------
  // Registry-driven: the fields the engine reads for this policy selection,
  // graded from RAW rows by the module shared with the sim-command gate.
  out.push(
    ...compileRequiredDataFindings({
      defaults,
      materials: materials as unknown as Record<string, unknown>[] | undefined,
      products: products as unknown as Record<string, unknown>[] | undefined,
      suppliers: suppliers as unknown as Record<string, unknown>[] | undefined,
      inbound,
      outbound,
      // Multi-level BOM lanes carry higher_level_component_id instead of
      // product_id; grade them through the single-level manifest shape the
      // same way the sim-command gate does, so both §8.1 surfaces agree.
      bom: (bom ?? []).map((r) =>
        r.product_id == null && r.higher_level_component_id != null
          ? { ...r, product_id: r.higher_level_component_id }
          : r,
      ),
    }),
  );

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

  return { status: "ready", findings: out };
}
