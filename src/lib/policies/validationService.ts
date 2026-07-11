// Unified validation service — Phase A / G6 / §8.1–8.2.
//
// UI adapter over the ONE grading module shared with the edge pre-dispatch
// gate (supabase/functions/_shared/grading.ts — canonical there because
// Supabase bundles only that tree). Manifest compilation, fallback
// resolution (registry `fallback_spec` → named reducers), and the
// engine-mirroring severity law all live in that module, so the /policies
// verification stage and the sim-command gate grade IDENTICALLY — the
// validation-parity fixtures pin all three surfaces to the engine.
//
// This file only adapts: raw hook rows → GradingDataset, GradedField[] →
// per-row UI findings with stages and hints.

import bridge from "../../../supabase/functions/_shared/engineBridge.json";
import registry from "./registry.generated.json";
import {
  activeEnginePolicies as sharedActivePolicies,
  flattenFindings,
  gradeManifest,
  scenarioCapacityFindings,
  type BridgeTables,
  type GradedField,
  type GradedFinding,
  type GradingDataset,
  type RegistryPayload,
  type Row,
} from "../../../supabase/functions/_shared/grading.ts";
import { baseDataRequirements, policyCatalog } from "./registryAccess";
import type { PolicyBundle } from "./schemas";
import type { StageKey } from "./stages";

export type Severity = "block" | "warn" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  stage: StageKey;
  rowKey?: string;
  field?: string;
  message: string;
  hint?: string;
  /** Catalog ref of the policy demanding the datum ("engine" for base reqs). */
  policy?: string;
  /** Affected entity ids (aggregated findings) — feeds per-row remediation. */
  rows?: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Engine policies the current family configuration activates (shared logic). */
export function activeEnginePolicies(defaults: PolicyBundle, nCustomers: number): string[] {
  return sharedActivePolicies(
    defaults as unknown as Row,
    nCustomers,
    bridge as unknown as BridgeTables,
  );
}

// ── Input: RAW project rows, exactly as the tables/RPCs return them ─────────
// No pre-imputation: display-level imputed values (useStageRows) must never
// mask a gap from the grader — the gate reads raw tables and would disagree.

export interface ManifestInput {
  defaults: PolicyBundle;
  materials?: Row[];
  products?: Row[];
  suppliers?: Row[];
  /** Raw inbound_logistics rows (fetchProjectLanes / useItemMasters). */
  inbound?: Row[];
  /** Raw outbound_logistics rows. */
  outbound?: Row[];
  /** Raw bom_single_level OR bom_multi_level rows — the shared grader
   * normalizes the shape; powers the unsourced-BOM hard block. */
  bom?: Row[];
}

const STAGE_BY_DATASET: Record<string, StageKey> = {
  materials: "supplier",
  suppliers: "supplier",
  inbound_logistics: "supplier",
  products: "plant",
  outbound_logistics: "customer",
};

/**
 * Static view of the manifest for the Data map grid: every requirement any
 * catalog policy (or the engine) declares on a `dataset.column`, regardless
 * of the current policy selection. Conditional demands carry their condition.
 */
export interface FieldDemand {
  policyRef: string; // "engine" or a catalog ref like "P-P.5"
  policyName: string;
  level: "required" | "recommended" | "defaulted";
  condition: string | null;
}

export function requirementsByField(): Map<string, FieldDemand[]> {
  const out = new Map<string, FieldDemand[]>();
  const push = (field: string, d: FieldDemand) => {
    const list = out.get(field) ?? [];
    list.push(d);
    out.set(field, list);
  };
  for (const r of baseDataRequirements()) {
    push(r.field, { policyRef: "engine", policyName: "engine mechanics", level: r.level, condition: r.condition });
  }
  for (const p of policyCatalog()) {
    for (const r of p.data_requirements ?? []) {
      push(r.field, { policyRef: p.catalog_ref, policyName: p.id, level: r.level, condition: r.condition });
    }
  }
  return out;
}

// ── Grading (delegated) + UI flattening ─────────────────────────────────────

const LEVEL_WHEN_MISSING: Record<string, Severity> = {
  required: "block",
  recommended: "warn",
  defaulted: "info",
};

/**
 * Grade the compiled manifest against the raw project dataset. Same findings
 * on all §8.2 surfaces: this one (the /policies verification stage and the
 * project-manager completeness view) and — through the shared module — the
 * sim-command pre-dispatch gate.
 */
export function compileRequiredDataFindings(input: ManifestInput): Finding[] {
  const dataset: GradingDataset = {
    materials: input.materials ?? [],
    products: input.products ?? [],
    suppliers: input.suppliers ?? [],
    inbound: input.inbound ?? [],
    outbound: input.outbound ?? [],
    bom: input.bom ?? [],
  };
  const graded = gradeManifest(
    dataset,
    input.defaults as unknown as Row,
    registry as unknown as RegistryPayload,
    bridge as unknown as BridgeTables,
  );

  const out: Finding[] = [];
  for (const g of graded) {
    if (!g.evaluable) continue;
    out.push(...findingsForField(g));
  }
  return out;
}

// ── Gate mirror (Lab pre-run panel) ─────────────────────────────────────────

export type { GradedFinding };

/**
 * The EXACT findings the sim-command pre-dispatch gate would return for this
 * dataset + policy configuration + scenario: manifest grading via the shared
 * module, flattened to the gate's aggregated per-field shape, plus the
 * scenario-conditional capacity check. The Lab renders these before dispatch
 * (and re-renders the server's own copy after a 422) — same vocabulary, same
 * grader, no second validation surface.
 */
export function compileGateFindings(
  input: ManifestInput,
  disruptionSchedule: Row[] = [],
): GradedFinding[] {
  const dataset: GradingDataset = {
    materials: input.materials ?? [],
    products: input.products ?? [],
    suppliers: input.suppliers ?? [],
    inbound: input.inbound ?? [],
    outbound: input.outbound ?? [],
    bom: input.bom ?? [],
  };
  const graded = gradeManifest(
    dataset,
    input.defaults as unknown as Row,
    registry as unknown as RegistryPayload,
    bridge as unknown as BridgeTables,
  );
  return [
    ...flattenFindings(graded),
    ...scenarioCapacityFindings(dataset.suppliers, disruptionSchedule),
  ];
}

/**
 * Adapt gate-shaped findings (ours pre-dispatch, or the server's from a 422
 * response body) to the UI `Finding` vocabulary the shared findings list
 * renders — one row per field with the affected-row count in the message.
 */
export function gateFindingsToFindings(
  gate: Array<Pick<GradedFinding, "severity" | "field" | "policy" | "rows" | "message"> & { reason?: string }>,
): Finding[] {
  return gate.map((g, i) => {
    const dataset = g.field.split(".")[0];
    return {
      id: `gate-${g.field}-${g.severity}-${i}`,
      severity: (g.severity as Severity) ?? "info",
      stage: STAGE_BY_DATASET[dataset] ?? "run_validate",
      field: g.field,
      policy: g.policy,
      rows: g.rows,
      message: g.message,
      hint: g.rows?.length
        ? `Affected: ${g.rows.slice(0, 6).join(", ")}${g.rows.length > 6 ? ", …" : ""}`
        : undefined,
    };
  });
}

function findingsForField(g: GradedField): Finding[] {
  const dataset = g.field.split(".")[0];
  const stage = STAGE_BY_DATASET[dataset] ?? "run_validate";
  const demandedBy = g.policyRef === "engine"
    ? "the engine"
    : `${g.policyName} (${g.policyRef})`;
  const out: Finding[] = [];

  // Nothing resolves — severity from the manifest level (required → block).
  if (g.missing.length > 0) {
    const severity = LEVEL_WHEN_MISSING[g.level] ?? "info";
    if (severity === "info") {
      out.push({
        id: `req-${g.field}`,
        severity,
        stage,
        field: g.field,
        policy: g.policyRef,
        message: `${g.field} is empty for ${g.missing.length} row(s) — the engine default applies (${g.fallbackProse ?? "engine default"}).`,
        hint: g.reason,
      });
    } else {
      for (const id of g.missing.slice(0, 25)) {
        out.push({
          id: `req-${g.field}-${id}`,
          severity,
          stage,
          rowKey: id,
          field: g.field,
          policy: g.policyRef,
          message: `"${id}" has no ${g.field} — required by ${demandedBy}.`,
          hint: g.reason,
        });
      }
      if (g.missing.length > 25) {
        out.push({
          id: `req-${g.field}-more`,
          severity,
          stage,
          field: g.field,
          policy: g.policyRef,
          message: `…and ${g.missing.length - 25} more row(s) missing ${g.field}.`,
        });
      }
    }
  }

  // Neutral-constant fallbacks — the engine's WARN class (ack-able pre-run).
  const warns = g.resolved.filter((r) => r.grade === "warn");
  if (warns.length > 0) {
    const example = warns[0];
    out.push({
      id: `req-warn-${g.field}`,
      severity: "warn",
      stage,
      field: g.field,
      policy: g.policyRef,
      rowKey: warns.length === 1 ? warns[0].id : undefined,
      message:
        `${g.field} is unset for ${warns.length} row(s) — the engine will apply its ` +
        `neutral default (${example.value !== undefined ? `≈${round2(example.value)}` : example.via}). ` +
        `Acknowledge to run anyway, or fill the data to make the affected KPIs meaningful.`,
      hint: g.reason,
    });
  }

  // Data-derived fallbacks — provenance notes (§8.3 effective economics).
  for (const fb of g.resolved.filter((r) => r.grade === "info").slice(0, 25)) {
    out.push({
      id: `req-fb-${g.field}-${fb.id}`,
      severity: "info",
      stage,
      rowKey: fb.id,
      field: g.field,
      policy: g.policyRef,
      message: `"${fb.id}" has no master ${g.field} — the engine resolves it via ${g.fallbackProse ?? fb.via}${fb.value !== undefined ? ` (≈${round2(fb.value)})` : ""}.`,
      hint: "Set the master value only to override the derived one.",
    });
  }

  return out;
}
