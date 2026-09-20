// B1 Data Steward deterministic surface — Phase B / §12 / AI agents
// (design: docs/design/ai-agents.md §5.1 hard gates, §4.4 item_master_diff).
//
// The ONE candidate/recomputation module consumed by BOTH agent surfaces:
//   * the draft tool handlers (project-ai-chat/draftTools.ts) — draft-time
//     reducer verification (`not_grounded` on mismatch)
//   * the apply function (agent-apply/index.ts) — apply-time re-verification
//     (`stale_values` on mismatch)
// so a value can never reach `bulk_upsert_*` unless the named reducer still
// derives it from the project's own data, within REDUCER_TOLERANCE.
//
// Like grading.ts (which it wraps), it is dependency-free pure TypeScript over
// injected rows: no `Deno.*`, no supabase client — the deterministic eval tier
// runs it byte-identically offline.

import registry from "./registry.generated.json" with { type: "json" };
import bridge from "./engineBridge.json" with { type: "json" };
import {
  gradeManifest,
  num,
  type BridgeTables,
  type GradedField,
  type GradingDataset,
  type RegistryPayload,
  type Row,
  type Severity,
} from "./grading.ts";

/** §4.4 / §5.1: reducer recomputation tolerance (DEFAULT). */
export const REDUCER_TOLERANCE = 1e-9;

export type ItemTable = "materials" | "products" | "suppliers";

/** The §5.1 draft-field vocabulary and which item-master table owns each
 * field — the closed set `draft_item_master_update` accepts. */
export const DRAFT_FIELDS: Record<string, ItemTable> = {
  cost: "materials",
  holding_cost_pct: "materials",
  moq: "materials",
  initial_on_hand: "materials",
  lead_time_dist: "materials",
  lead_time_cv: "materials",
  sell_price: "products",
  production_capacity: "products",
  fulfillment_mode: "products",
  demand_distribution: "products",
  demand_mean: "products",
  demand_cv: "products",
  capacity_per_week: "suppliers",
  reliability_score: "suppliers",
};

/** Enum vocabularies mirroring the write-RPC CHECKs verbatim
 * (20260702000001_item_master_write_rpcs.sql — the engine's accepted values). */
export const ITEM_MASTER_ENUMS: Record<string, readonly string[]> = {
  lead_time_dist: ["deterministic", "lognormal", "gamma"],
  fulfillment_mode: ["mto", "mts"],
  demand_distribution: ["triangular", "deterministic", "poisson", "negbin"],
};

/** The RPCs' own exception texts, restated at draft time (ds-04 pins the
 * fulfillment_mode wording). */
export const ENUM_ERROR_TEXT: Record<string, (v: string) => string> = {
  lead_time_dist: (v) =>
    `invalid lead_time_dist "${v}" — engine accepts: deterministic, lognormal, gamma`,
  fulfillment_mode: (v) =>
    `invalid fulfillment_mode "${v}" — engine accepts: mto, mts (ato is not yet runnable)`,
  demand_distribution: (v) =>
    `invalid demand_distribution "${v}" — engine accepts: triangular, deterministic, poisson, negbin`,
};

/** Fields whose values are numbers (everything outside the enum vocabulary). */
export const NUMERIC_DRAFT_FIELDS = new Set(
  Object.keys(DRAFT_FIELDS).filter((f) => !(f in ITEM_MASTER_ENUMS)),
);

/** Reducer → the project table its derivation reads (citation targets). */
export const REDUCER_SOURCE_TABLE: Record<string, string> = {
  volume_weighted_inbound_price: "inbound_logistics",
  cheapest_inbound_price: "inbound_logistics",
  demand_weighted_outbound_price: "outbound_logistics",
  weekly_outbound_volume: "outbound_logistics",
  production_policy_capacity: "policy_defaults",
  twice_demand_floor_1000: "outbound_logistics",
};

/** Full column sets of the item-master write RPCs (full-row upserts: a NULL
 * clears, so apply must merge diffs onto these columns — §4.4 step 3). */
export const TABLE_COLUMNS: Record<ItemTable, { id: string; columns: string[] }> = {
  materials: {
    id: "material_id",
    columns: ["material_id", "name", "cost", "holding_cost_pct", "moq",
      "initial_on_hand", "lead_time_dist", "lead_time_cv"],
  },
  products: {
    id: "product_id",
    columns: ["product_id", "name", "sell_price", "production_capacity",
      "fulfillment_mode", "demand_distribution", "demand_mean", "demand_cv"],
  },
  suppliers: {
    id: "supplier_id",
    columns: ["supplier_id", "name", "capacity_per_week", "reliability_score"],
  },
};

const LEVEL_WHEN_MISSING: Record<string, Severity> = {
  required: "block",
  recommended: "warn",
  defaulted: "info",
};

/** One per-entity completeness row — the `get_data_completeness` vocabulary
 * (§5.1: [severity, field, policy, entity_ids, candidate_value,
 * candidate_source, message]). candidate_* is set ONLY when a named reducer
 * (never a neutral constant) derives the value from project data — constants
 * are the engine's warn-class defaults and are not proposable (ds-02). */
export interface CompletenessRow {
  severity: Severity;
  field: string; // qualified, e.g. "materials.cost"
  policy: string;
  entity_id: string;
  candidate_value: number | null;
  candidate_source: string | null; // reducer name
  message: string;
}

/** Grade the manifest with the shipped registry snapshot + bridge tables —
 * byte-identical to the /policies verification and the pre-dispatch gate. */
export function gradeDataset(dataset: GradingDataset, defaults: Row): GradedField[] {
  return gradeManifest(
    dataset,
    defaults,
    registry as unknown as RegistryPayload,
    bridge as unknown as BridgeTables,
  );
}

const isReducerVia = (via: string) => !via.startsWith("constant:");

export function completenessRows(graded: GradedField[]): CompletenessRow[] {
  const out: CompletenessRow[] = [];
  for (const g of graded) {
    if (!g.evaluable) continue;
    const demandedBy = g.policyRef === "engine" ? "the engine" : g.policyRef;
    for (const id of g.missing) {
      out.push({
        severity: LEVEL_WHEN_MISSING[g.level] ?? "info",
        field: g.field,
        policy: g.policyRef,
        entity_id: id,
        candidate_value: null,
        candidate_source: null,
        message:
          `${g.field} is missing for ${id} (required by ${demandedBy}): ${g.reason}` +
          (g.fallbackProse ? ` Fallback: ${g.fallbackProse}.` : ""),
      });
    }
    for (const r of g.resolved) {
      if (isReducerVia(r.via) && r.value !== undefined) {
        out.push({
          severity: r.grade,
          field: g.field,
          policy: g.policyRef,
          entity_id: r.id,
          candidate_value: r.value,
          candidate_source: r.via,
          message:
            `${g.field} is unset for ${r.id} — candidate ${r.value} derived ` +
            `deterministically via ${r.via}. ${g.reason}`,
        });
      } else {
        out.push({
          severity: r.grade,
          field: g.field,
          policy: g.policyRef,
          entity_id: r.id,
          candidate_value: null,
          candidate_source: null,
          message:
            `${g.field} is unset for ${r.id} — the engine will apply its ` +
            `neutral default (${r.via.replace(/^constant:/, "")}). ${g.reason}`,
        });
      }
    }
  }
  const rank: Record<Severity, number> = { block: 0, warn: 1, info: 2 };
  return out.sort((a, b) =>
    rank[a.severity] - rank[b.severity] ||
    a.field.localeCompare(b.field) ||
    a.entity_id.localeCompare(b.entity_id)
  );
}

export const candidateKey = (table: ItemTable, field: string, id: string) =>
  `${table}.${field}|${id}`;

/** Reducer-resolved candidates keyed by `${table}.${field}|${entity_id}` —
 * the recomputation basis for every `source:"reducer"` draft row. */
export function reducerCandidates(
  graded: GradedField[],
): Map<string, { value: number; reducer: string }> {
  const out = new Map<string, { value: number; reducer: string }>();
  for (const g of graded) {
    if (!g.evaluable) continue;
    for (const r of g.resolved) {
      if (isReducerVia(r.via) && r.value !== undefined) {
        out.set(`${g.field}|${r.id}`, { value: r.value, reducer: r.via });
      }
    }
  }
  return out;
}

/** Current master value of one draft field, read from the gate dataset rows
 * (used for idempotent convergence: a row already applied re-verifies). */
export function masterValue(
  dataset: GradingDataset,
  table: ItemTable,
  field: string,
  entityId: string,
): number | null {
  const idCol = TABLE_COLUMNS[table].id;
  const rows = dataset[table] as Row[];
  const row = rows.find((r) => String(r[idCol] ?? "") === entityId);
  if (!row || row[field] == null) return null;
  return num(row[field]);
}

/** Entity-id sets per table, for the §4.5 `project_scope_violation` gate. */
export function entityIdSets(dataset: GradingDataset): Record<ItemTable, Set<string>> {
  const collect = (rows: Row[], col: string) =>
    new Set(rows.map((r) => String(r[col] ?? "")).filter(Boolean));
  return {
    materials: collect(dataset.materials, "material_id"),
    products: collect(dataset.products, "product_id"),
    suppliers: collect(dataset.suppliers, "supplier_id"),
  };
}

export interface DraftRow {
  table: ItemTable;
  entity_id: string;
  field: string;
  value: number | string | null;
  source: "reducer" | "user_supplied";
  reducer?: string;
  why?: string;
}

export interface RowVerification {
  ok: boolean;
  /** §4.5 code the failure maps to at DRAFT time (`not_grounded`); the apply
   * path reports the same failures as `stale_values` (§4.4). */
  reason?: string;
  /** The chain reducer that actually derives the value (handler stores which). */
  reducer?: string;
}

/**
 * Verify one `source:"reducer"` row against the recomputed candidates.
 * Accepts when (a) the named-reducer chain derives the same value within
 * REDUCER_TOLERANCE, or (b) the master value already equals the proposed
 * value (the row was applied before — keeps retry/apply idempotent).
 */
export function verifyReducerRow(
  row: DraftRow,
  candidates: Map<string, { value: number; reducer: string }>,
  dataset: GradingDataset,
): RowVerification {
  if (typeof row.value !== "number" || !Number.isFinite(row.value)) {
    return { ok: false, reason: `${row.field} for ${row.entity_id}: reducer rows need a finite numeric value` };
  }
  const master = masterValue(dataset, row.table, row.field, row.entity_id);
  if (master != null && Math.abs(master - row.value) <= REDUCER_TOLERANCE) {
    return { ok: true, reducer: row.reducer };
  }
  const cand = candidates.get(candidateKey(row.table, row.field, row.entity_id));
  if (!cand) {
    return {
      ok: false,
      reason: `no deterministic candidate exists for ${row.table}.${row.field} on ${row.entity_id}`,
    };
  }
  if (Math.abs(cand.value - row.value) > REDUCER_TOLERANCE) {
    return {
      ok: false,
      reason:
        `${row.table}.${row.field} for ${row.entity_id}: proposed ${row.value} does not match ` +
        `the recomputed ${cand.reducer} value ${cand.value}`,
    };
  }
  return { ok: true, reducer: cand.reducer };
}

/** Live policy_defaults row (7 family JSONBs) — the manifest compiles against
 * the CURRENT configuration, exactly like the /policies verification stage. */
// deno-lint-ignore no-explicit-any
export async function loadPolicyDefaults(sb: any, projectId: string): Promise<Row> {
  const { data } = await sb
    .from("policy_defaults")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  return (data ?? {}) as Row;
}
