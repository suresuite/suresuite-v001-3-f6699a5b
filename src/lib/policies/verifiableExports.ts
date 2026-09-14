// Verifiable exports (blueprint G17 / §8.4 / §9.5.1 — W2): the three
// workbooks that make a model version externally checkable — by a reviewer,
// an auditor, or an AI — without access to the app:
//
//   1. Policy snapshot   — the saved version's families + overrides, every
//      cell annotated with provenance (explicitly-divergent vs. equal to the
//      schema default), stamped with the policy_hash.
//   2. Dataset           — the EXACT canonical rows the graph_hash was
//      computed over (dataset_versions.snapshot), one sheet per engine-read
//      table, stamped with the graph_hash.
//   3. Run results       — per-run metadata (the full provenance triple +
//      seed spec + disruption schedule), aggregate KPIs ± CI, one KPI row
//      per seed, and one weeks×seeds sheet per persisted weekly series.
//
// Builders are pure (data in → XLSX.WorkBook out); fetching lives in
// src/hooks/useVerifiableExports.tsx.

import * as XLSX from "xlsx";
import {
  DEFAULT_BUNDLE,
  FIELD_LABELS,
  type PolicyBundle,
  type PolicyFamily,
} from "./schemas";
import type { OverrideRow } from "./resolve";
import type { Replication, SimulationRun } from "@/hooks/useSimulationRun";

function normalize(v: unknown): string | number | boolean | null {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return v as string | number | boolean;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// ── 1. Policy snapshot with per-cell provenance ─────────────────────────────

export interface PolicyVersionMeta {
  id: string;
  label: string | null;
  notes?: string | null;
  author_email?: string | null;
  author_name?: string | null;
  policy_hash: string | null;
  created_at: string;
}

/**
 * One sheet per family. Under every value row sits a `provenance` row grading
 * each cell: `set (differs from schema default)` when the stored value
 * diverges from the schema default, `= schema default` when it equals it
 * (untouched OR deliberately set to the default — storage cannot distinguish
 * the two, and the export says so honestly), and for override rows
 * `override` vs `inherited from defaults`.
 */
export function buildPolicyVersionWorkbook(
  version: PolicyVersionMeta,
  families: PolicyFamily[],
  bundle: PolicyBundle,
  overrides: OverrideRow[],
  fulfillmentStrategy?: string | null,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  for (const family of families) {
    const def = bundle[family] as Record<string, unknown>;
    const schemaDef = DEFAULT_BUNDLE[family] as Record<string, unknown>;
    const fields = Object.keys(def);
    const header = ["scope", "target_key", ...fields.map((f) => FIELD_LABELS[f] ?? f)];

    const rows: (string | number | boolean | null)[][] = [];
    rows.push(["default", "*", ...fields.map((f) => normalize(def[f]))]);
    rows.push([
      "provenance",
      "*",
      ...fields.map((f) =>
        sameValue(def[f], schemaDef[f]) ? "= schema default" : "set (differs from schema default)",
      ),
    ]);

    for (const o of overrides.filter((x) => x.family === family)) {
      rows.push([
        o.scope,
        o.target_key,
        ...fields.map((f) => (o.patch[f] !== undefined ? normalize(o.patch[f]) : normalize(def[f]))),
      ]);
      rows.push([
        "provenance",
        o.target_key,
        ...fields.map((f) => (o.patch[f] !== undefined ? "override" : "inherited from defaults")),
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, family.slice(0, 28));
  }

  const meta: (string | number | null)[][] = [
    ["SuReSuite verifiable export — POLICY SNAPSHOT ONLY"],
    [
      "Scope",
      "This workbook is the saved policy bundle of one model version. It contains NO network/" +
        "economics data and NO simulation results — those are separate exports: the dataset " +
        "export (stamped with its graph_hash) and the per-run results export.",
    ],
    [],
    ["Version id", version.id],
    ["Label", version.label ?? ""],
    ["Notes", version.notes ?? ""],
    ["Author", version.author_name || version.author_email || ""],
    ["Saved at", version.created_at],
    ["policy_hash (SHA-256)", version.policy_hash ?? "(not stored — legacy version)"],
    ["Fulfillment strategy", fulfillmentStrategy ?? ""],
    [],
    ["Provenance legend"],
    ["set (differs from schema default)", "the stored value diverges from the schema default — certainly user/preset-set"],
    [
      "= schema default",
      "the stored value equals the schema default — either untouched or deliberately set to it; " +
        "the snapshot cannot distinguish the two",
    ],
    ["override", "per-node/edge patch value explicitly set for that target"],
    ["inherited from defaults", "cell shown for readability; the override row does not set this field"],
    [],
    ["Generated", new Date().toISOString()],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), "_meta");
  return wb;
}

// ── 2. Dataset (canonical hashed rows) ──────────────────────────────────────

export interface DatasetVersionRow {
  id: string;
  label: string | null;
  graph_hash: string;
  created_at: string;
  snapshot: {
    schema_version?: number;
    suppliers?: Record<string, unknown>[];
    materials?: Record<string, unknown>[];
    products?: Record<string, unknown>[];
    inbound?: Record<string, unknown>[];
    bom?: Record<string, unknown>[];
    outbound?: Record<string, unknown>[];
  };
}

function sheetFromRows(rows: Record<string, unknown>[], columns?: string[]): XLSX.WorkSheet {
  const cols =
    columns ?? Array.from(rows.reduce((s, r) => (Object.keys(r).forEach((k) => s.add(k)), s), new Set<string>()));
  const aoa = [cols, ...rows.map((r) => cols.map((c) => normalize(r[c])))];
  return XLSX.utils.aoa_to_sheet(aoa);
}

/**
 * The six engine-read tables, exactly as canonically snapshotted and hashed
 * by `_build_dataset_snapshot` (dataset_versions.snapshot) — re-hashing the
 * snapshot JSON reproduces graph_hash, so this export is verifiable against
 * any run stamped with the same hash. `bomMulti` (when the project uses a
 * multi-level BOM) is included as an extra sheet: the engine reads it when
 * present, but graph_hash v1 covers bom_single_level only (stated in _meta).
 */
export function buildDatasetWorkbook(
  dataset: DatasetVersionRow,
  projectName: string | null,
  bomMulti?: Record<string, unknown>[],
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const snap = dataset.snapshot ?? {};

  const tables: Array<{ sheet: string; rows: Record<string, unknown>[]; cols: string[] }> = [
    {
      sheet: "suppliers",
      rows: snap.suppliers ?? [],
      cols: ["supplier_id", "capacity_per_week", "reliability_score"],
    },
    {
      sheet: "materials",
      rows: snap.materials ?? [],
      cols: ["material_id", "cost", "holding_cost_pct", "moq", "initial_on_hand", "lead_time_dist", "lead_time_cv"],
    },
    {
      sheet: "products",
      rows: snap.products ?? [],
      cols: [
        "product_id", "sell_price", "production_capacity", "fulfillment_mode",
        "demand_distribution", "demand_mean", "demand_cv",
      ],
    },
    {
      sheet: "inbound_logistics",
      rows: snap.inbound ?? [],
      cols: ["supplier_id", "material_id", "unit_price", "lead_time", "time_unit", "volume"],
    },
    {
      sheet: "bom_single_level",
      rows: snap.bom ?? [],
      cols: ["product_id", "material_id", "consumption_rate"],
    },
    {
      sheet: "outbound_logistics",
      rows: snap.outbound ?? [],
      cols: ["product_id", "customer_id", "unit_price", "volume", "time_unit"],
    },
  ];
  for (const t of tables) {
    XLSX.utils.book_append_sheet(wb, sheetFromRows(t.rows, t.cols), t.sheet);
  }
  if (bomMulti && bomMulti.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      sheetFromRows(bomMulti, ["material_id", "higher_level_component_id", "level", "consumption_rate"]),
      "bom_multi_level",
    );
  }

  const meta: (string | number | null)[][] = [
    ["SuReSuite verifiable export — DATASET (engine-read tables)"],
    [
      "Scope",
      "The canonical source rows of the six tables the simulation engine consumes, exactly as " +
        "snapshotted and hashed (dataset_versions.snapshot). Re-hashing the snapshot JSON " +
        "(SHA-256 over its canonical text) reproduces graph_hash; any run stamped with the same " +
        "graph_hash ran on exactly this data.",
    ],
    [],
    ["Project", projectName ?? ""],
    ["dataset_version_id", dataset.id],
    ["Label", dataset.label ?? ""],
    ["graph_hash (SHA-256)", dataset.graph_hash],
    ["Snapshot taken", dataset.created_at],
    ["Snapshot schema_version", snap.schema_version ?? 1],
    [],
    ...(bomMulti && bomMulti.length > 0
      ? [[
          "Note",
          "bom_multi_level is included because this project carries multi-level BOM rows (the engine " +
            "reads them when present, collapsed to effective product→material arcs); graph_hash v1 " +
            "canonicalizes bom_single_level only.",
        ] as (string | number | null)[]]
      : []),
    ["Generated", new Date().toISOString()],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), "_meta");
  return wb;
}

// ── 3. Run results ──────────────────────────────────────────────────────────

export interface RunScenarioMeta {
  id: string;
  name?: string | null;
  seed?: number | null;
  replications?: number | null;
  crn?: boolean | null;
  horizon_days?: number | null;
  warmup_mode?: string | null;
  warmup_days?: number | null;
  disruption_schedule?: unknown[] | null;
}

/**
 * One workbook per run: `run_meta` (identity: run id, policy_version_id +
 * policy_hash, dataset_version_id + graph_hash, scenario id + FULL disruption
 * schedule, root seed, code_version), `aggregate_kpis` (mean ± CI half-width),
 * `replication_kpis` (one row per seed_used), and one `series_<metric>` sheet
 * per persisted weekly series (weeks × seeds).
 */
export function buildRunResultsWorkbook(
  run: SimulationRun,
  scenario: RunScenarioMeta | null,
  reps: Replication[],
  policyVersionLabel?: string | null,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const done = reps
    .filter((r) => r.status === "done" && r.kpis)
    .sort((a, b) => a.rep_index - b.rep_index);

  // run_meta — the identity a reviewer checks against the other two exports.
  const meta: (string | number | null)[][] = [
    ["SuReSuite verifiable export — RUN RESULTS"],
    [
      "Scope",
      "One simulation run: its full provenance (policy_hash ↔ policy export; graph_hash ↔ dataset " +
        "export; scenario + seed spec), aggregate KPIs ± CI half-widths, one KPI row per seed, and " +
        "the persisted weekly series per seed. All values are engine output persisted by the worker.",
    ],
    [],
    ["run_id", run.id],
    ["status", run.status],
    ["created_at", run.created_at],
    ["ended_at", run.ended_at ?? ""],
    ["code_version (engine)", run.code_version ?? ""],
    [],
    ["policy_version_id", run.policy_version_id ?? ""],
    ["policy_version_label", policyVersionLabel ?? ""],
    ["policy_hash (SHA-256)", run.policy_hash ?? ""],
    ["dataset_version_id", (run as unknown as { dataset_version_id?: string }).dataset_version_id ?? ""],
    ["graph_hash (SHA-256)", (run as unknown as { graph_hash?: string }).graph_hash ?? ""],
    ["scenario_hash (baseline fingerprint)", run.scenario_hash ?? ""],
    ["model_validation_id", run.model_validation_id ?? ""],
    [],
    ["scenario_id", scenario?.id ?? run.scenario_id],
    ["scenario_name", scenario?.name ?? ""],
    ["root seed", scenario?.seed ?? ""],
    ["replications (target)", run.rep_count_target ?? scenario?.replications ?? ""],
    ["replications (done)", run.rep_count_done ?? ""],
    ["CRN (common random numbers)", scenario?.crn == null ? "" : String(scenario.crn)],
    ["horizon_days", scenario?.horizon_days ?? ""],
    ["warmup_mode", scenario?.warmup_mode ?? ""],
    ["warmup_days (manual)", scenario?.warmup_days ?? ""],
    ["warmup_detected_at (weeks, engine)", run.warmup_detected_at ?? ""],
    [
      "disruption_schedule (full JSON; empty = baseline)",
      JSON.stringify(scenario?.disruption_schedule ?? []),
    ],
    [],
    ["Generated", new Date().toISOString()],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), "run_meta");

  // aggregate_kpis — mean + CI half-width per KPI key.
  const agg = run.aggregate_kpis ?? {};
  const ci = run.ci_half_widths ?? {};
  const aggKeys = Object.keys(agg).filter((k) => k !== "_meta");
  const aggRows: (string | number | null)[][] = [
    ["kpi", "mean", "ci_halfwidth"],
    ...aggKeys.sort().map((k) => [
      k,
      normalize(agg[k]) as number | string | null,
      normalize(ci[k]) as number | string | null,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aggRows), "aggregate_kpis");

  // replication_kpis — one row per seed_used, columns = union of KPI keys.
  const kpiKeys = Array.from(
    done.reduce((s, r) => (Object.keys(r.kpis ?? {}).forEach((k) => s.add(k)), s), new Set<string>()),
  ).sort();
  const repRows: (string | number | boolean | null)[][] = [
    ["rep_index", "seed_used", ...kpiKeys],
    ...done.map((r) => [
      r.rep_index,
      r.seed_used,
      ...kpiKeys.map((k) => normalize(r.kpis?.[k])),
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(repRows), "replication_kpis");

  // series_<metric> — weeks × seeds for every persisted weekly series.
  const seriesKeys = Array.from(
    done.reduce(
      (s, r) => (Object.keys(r.time_series ?? {}).forEach((k) => s.add(k)), s),
      new Set<string>(),
    ),
  ).sort();
  for (const key of seriesKeys) {
    const withSeries = done.filter((r) => Array.isArray(r.time_series?.[key]));
    if (withSeries.length === 0) continue;
    const weeks = Math.max(...withSeries.map((r) => r.time_series[key].length));
    const rows: (string | number | boolean | null)[][] = [
      ["week", ...withSeries.map((r) => `seed_${r.seed_used}`)],
    ];
    for (let w = 0; w < weeks; w++) {
      rows.push([w, ...withSeries.map((r) => normalize(r.time_series[key][w]))]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `series_${key}`.slice(0, 31));
  }

  return wb;
}
