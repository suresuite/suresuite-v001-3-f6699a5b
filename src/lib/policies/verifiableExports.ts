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
import { recordRows, type ReproducibilityRecord } from "@/lib/trust/reproducibilityRecord";
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

type SnapshotTables = {
  suppliers?: Record<string, unknown>[];
  materials?: Record<string, unknown>[];
  products?: Record<string, unknown>[];
  customers?: Record<string, unknown>[];
  inbound?: Record<string, unknown>[];
  bom?: Record<string, unknown>[];
  bom_multi_level?: Record<string, unknown>[];
  outbound?: Record<string, unknown>[];
};

type SnapshotNetwork = {
  tier2_suppliers?: Record<string, unknown>[];
  tier3_suppliers?: Record<string, unknown>[];
  multi_tier?: Record<string, unknown>[];
};

export interface DatasetVersionRow {
  id: string;
  label: string | null;
  graph_hash: string;
  /** NULL on every version frozen before WP 4.1; not backfillable. */
  hash_inputs?: string | null;
  hash_network?: string | null;
  created_at: string;
  /**
   * TWO SHAPES LIVE HERE AT ONCE, and that is not a transition to be tidied
   * away later. v1 (`20260703000001`) put the six tables at the top level; v2
   * (WP 4.1, `20260917000002`) puts them under `inputs` and adds `network`.
   * A frozen version is IMMUTABLE — nothing rewrites one, which is what lets a
   * run resolve the dataset it actually ran against — so every v1 row in this
   * table will hold the v1 shape forever. A reader that handles only the new
   * one silently exports empty sheets for every historical version.
   */
  snapshot: ({ schema_version?: number; inputs?: SnapshotTables; network?: SnapshotNetwork }
             & SnapshotTables);
}

/** The tables, from whichever shape this version happens to be. */
function snapshotTables(snap: DatasetVersionRow["snapshot"]): SnapshotTables {
  return (snap?.inputs ?? snap ?? {}) as SnapshotTables;
}

function sheetFromRows(rows: Record<string, unknown>[], columns?: string[]): XLSX.WorkSheet {
  const cols =
    columns ?? Array.from(rows.reduce((s, r) => (Object.keys(r).forEach((k) => s.add(k)), s), new Set<string>()));
  const aoa = [cols, ...rows.map((r) => cols.map((c) => normalize(r[c])))];
  return XLSX.utils.aoa_to_sheet(aoa);
}

/**
 * The canonical rows, exactly as snapshotted and hashed by
 * `_build_dataset_snapshot` — so re-hashing the snapshot JSON reproduces
 * `graph_hash` and this export is verifiable against any run stamped with it.
 *
 * WP 4.1 changed what is in there and the workbook says which version it is
 * looking at, per sheet, because the two are genuinely different documents:
 *
 *   v1 — six tables at the top level. `bom_multi_level` was NOT hashed, so on a
 *        multi-level project the export carried a sheet the hash did not cover
 *        and said so in `_meta`. That is D11 and every v1 version still has it.
 *   v2 — `inputs` (eight tables, including the deep BOM the engine PREFERS) and
 *        `network` (the three deep-tier tables). `bom_multi_level` comes out of
 *        the snapshot itself and the caveat is gone with it.
 *
 * A frozen version is never rewritten, so both shapes are live forever and
 * `_meta` states which one this file is. `bomMulti` is still accepted for a v1
 * version, where it is the only way to get those rows into the sheet at all.
 */
/**
 * One row of `ingest_row_provenance` — §5.4's acceptance test, export side.
 *
 * Read LIVE, deliberately and with the consequence stated in the sheet: the
 * snapshot is frozen and provenance is not in it, because `graph_hash` hashes the
 * snapshot and a re-upload that changed no VALUE would move the hash if the run id
 * were inside (§4 D67, D88). So provenance travels BESIDE the frozen rows, and
 * `promoted_at` beside the version's own `created_at` lets a reader see a
 * disagreement rather than be told a filename that is subtly wrong.
 */
export interface RowProvenance {
  table: string;
  natural_key: Record<string, unknown>;
  has_provenance: boolean;
  source_row_number: number | null;
  original_filename: string | null;
  content_sha256: string | null;
  uploaded_by_email: string | null;
  received_at: string | null;
  promoted_by_email: string | null;
  promoted_at: string | null;
}

/**
 * The `_provenance` sheet. §5.4's acceptance test in one place:
 *
 *   "With no help and no app access beyond the export, they trace it to a row in a
 *    named file uploaded by a named person on a named date — or find the named rule
 *    that produced it in the absence of data."
 *
 * A4 already carried the second half (the substitution rules are in the policy
 * sheets). This is the first, and the rule it obeys is that EVERY ROW IS LISTED,
 * including the ones that cannot be traced: a sheet holding only the traced rows
 * reads as a complete lineage, and a reader has no way to discover which rows are
 * missing from it. `traced` is therefore a column, and the header states the count.
 */
export function provenanceSheet(
  rows: RowProvenance[],
  datasetCreatedAt: string | null,
): XLSX.WorkSheet {
  const traced = rows.filter((r) => r.has_provenance).length;
  const header: Array<Array<string | number | null>> = [
    ["§5.4 acceptance test — where each row came from"],
    [
      "Read LIVE at export time. The dataset snapshot is frozen and does NOT contain " +
      "provenance, because graph_hash hashes the snapshot and a re-upload that changed " +
      "no value would move the hash if the run id were inside it. Compare `promoted at` " +
      "with the dataset version's own timestamp below: a later promotion means this row " +
      "was re-uploaded after the version was frozen, and the file named here is the " +
      "NEWER one.",
    ],
    ["Dataset version frozen at", datasetCreatedAt ?? "unknown"],
    [`Rows listed: ${rows.length} · traceable to a file: ${traced} · not traceable: ${rows.length - traced}`],
    [
      "A row that is not traceable was written before the ingestion path existed, or by " +
      "another route. Its provenance is UNKNOWN — not absent. Nothing can say which " +
      "file produced it, and inventing one would be worse than this blank.",
    ],
    [null],
    [
      "table", "row key", "traced", "file", "line", "file sha256",
      "uploaded by", "uploaded at", "promoted by", "promoted at",
    ],
  ];
  const body = rows.map((r): Array<string | number | null> => [
    r.table,
    // The key as the index defines it, joined so a reader can match it to the
    // table sheets without knowing which columns form the key.
    Object.entries(r.natural_key)
      .filter(([k]) => k !== "project_id")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" · "),
    r.has_provenance ? "yes" : "no",
    r.original_filename,
    r.source_row_number,
    r.content_sha256,
    r.uploaded_by_email,
    r.received_at,
    r.promoted_by_email,
    r.promoted_at,
  ]);
  return XLSX.utils.aoa_to_sheet([...header, ...body]);
}

export function buildDatasetWorkbook(
  dataset: DatasetVersionRow,
  projectName: string | null,
  bomMulti?: Record<string, unknown>[],
  /**
   * §5.4's acceptance test (WP 6.3). `undefined` means the read was not attempted
   * or failed; `[]` means it returned nothing. The sheet distinguishes them,
   * because "we could not look" and "there is nothing" are different facts and a
   * missing sheet asserts neither.
   */
  provenance?: RowProvenance[],
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const raw = dataset.snapshot ?? {};
  const version = Number(raw.schema_version ?? 1);
  const snap = snapshotTables(raw);
  const net = (raw.network ?? {}) as SnapshotNetwork;
  // A v1 version has no deep BOM in its snapshot; the caller may pass the live
  // rows, which is what v1's `_meta` note was about. From v2 the snapshot has
  // them and the live rows would be a DIFFERENT dataset in a hashed workbook.
  const deepBom = version >= 2 ? (snap.bom_multi_level ?? []) : (bomMulti ?? []);

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
        "demand_distribution", "demand_mean", "demand_cv", "demand_min", "demand_max",
      ],
    },
    {
      sheet: "inbound_logistics",
      rows: snap.inbound ?? [],
      // `lead_time_unit` is what the lead time is QUOTED IN. v1 hashed the
      // number without it, so 14 days and 14 weeks were the same dataset (D67).
      cols: ["plant_name", "supplier_id", "material_id", "unit_price", "lead_time",
             "lead_time_unit", "time_unit", "volume"],
    },
    {
      sheet: "bom_single_level",
      rows: snap.bom ?? [],
      cols: ["plant_name", "product_id", "material_id", "consumption_rate"],
    },
    {
      sheet: "outbound_logistics",
      rows: snap.outbound ?? [],
      cols: ["plant_name", "product_id", "customer_id", "unit_price", "volume",
             "time_unit", "expected_lead_time"],
    },
    {
      sheet: "customers",
      rows: snap.customers ?? [],
      cols: ["customer_id", "segment", "priority_weight", "sla_fill_floor_pct"],
    },
  ];
  for (const t of tables) {
    XLSX.utils.book_append_sheet(wb, sheetFromRows(t.rows, t.cols), t.sheet);
  }
  if (deepBom.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      sheetFromRows(deepBom, ["plant_name", "material_id", "higher_level_component_id",
                              "level", "consumption_rate"]),
      "bom_multi_level",
    );
  }
  // §5.4's acceptance test — WP 6.3. The sheet is added whenever the read was
  // ATTEMPTED, including when it came back empty: an empty sheet says "no row in
  // this project can be traced to a file", which is true of most projects today
  // (§4 D88) and is exactly what a stakeholder needs to be told. Omitting it would
  // leave the workbook silent on the question the acceptance test asks.
  if (provenance) {
    XLSX.utils.book_append_sheet(
      wb,
      provenanceSheet(provenance, dataset.created_at ?? null),
      "_provenance",
    );
  }
  // The network domain, from v2 on. It is empty on every project in production
  // today (§15), so these sheets exist and hold nothing — which is the honest
  // rendering of "no deep-tier data", and different from the sheet being absent
  // because the export does not know about it.
  if (version >= 2) {
    for (const [sheet, rows, cols] of [
      ["tier2_suppliers", net.tier2_suppliers ?? [],
       ["plant_name", "supplier_id", "upstream_supplier_id", "material_id",
        "relationship_type", "volume", "unit_price", "lead_time", "time_unit"]],
      ["tier3_suppliers", net.tier3_suppliers ?? [],
       ["plant_name", "supplier_id", "upstream_supplier_id", "material_id",
        "relationship_type", "volume", "unit_price", "lead_time", "time_unit"]],
      ["multi_tier_supply_chain", net.multi_tier ?? [],
       ["plant_name", "from_firm_id", "to_firm_id", "to_firm_tier", "to_firm_relationship"]],
    ] as Array<[string, Record<string, unknown>[], string[]]>) {
      XLSX.utils.book_append_sheet(wb, sheetFromRows(rows, cols), sheet);
    }
  }

  const meta: (string | number | null)[][] = [
    ["SuReSuite verifiable export — DATASET (engine-read tables)"],
    [
      "Scope",
      version >= 2
        ? "The canonical source rows of every tier-2 input table, exactly as snapshotted and " +
          "hashed (dataset_versions.snapshot), in two domains: inputs (what a simulation reads) " +
          "and network (what the multi-tier analyses read). graph_hash is SHA-256 over " +
          "{schema_version, hash_inputs, hash_network}; any run stamped with the same graph_hash " +
          "ran on exactly this data."
        : "The canonical source rows of the six tables the simulation engine consumed under " +
          "snapshot v1. Re-hashing the snapshot JSON reproduces this version's graph_hash.",
    ],
    [],
    ["Project", projectName ?? ""],
    ["dataset_version_id", dataset.id],
    ["Label", dataset.label ?? ""],
    ["graph_hash (SHA-256)", dataset.graph_hash],
    ["Snapshot taken", dataset.created_at],
    ["Snapshot schema_version", version],
    ["hash_inputs (SHA-256)", dataset.hash_inputs ?? "not recorded — frozen before WP 4.1"],
    ["hash_network (SHA-256)", dataset.hash_network ?? "not recorded — frozen before WP 4.1"],
    [],
    // §5 T3 — an export states the limits of its OWN computation. For a v1
    // version that limit is real and permanent: the deep BOM sheet below was
    // read live and is NOT part of what this version's graph_hash covers, so
    // the rows can have changed since the freeze. Nothing can repair that after
    // the fact; saying so is the whole of the commitment.
    ...(version < 2
      ? [
          [
            "Known limit",
            "This version was frozen under snapshot v1, which canonicalized bom_single_level only. " +
              "graph_hash does NOT cover bom_multi_level, lead_time_unit, demand_min/demand_max, " +
              "customers or the deep-tier network tables (PLAN.md §4 D11, D67). Two datasets " +
              "differing only in those produce the same hash for this version.",
          ] as (string | number | null)[],
          ...(deepBom.length > 0
            ? [[
                "Known limit",
                "The bom_multi_level sheet was read LIVE, not from the snapshot — v1 does not " +
                  "contain it. Those rows may have changed since this version was frozen.",
              ] as (string | number | null)[]]
            : []),
        ]
      : [
          [
            "Known limit",
            "graph_hash covers every tier-2 input table. It does NOT cover the four derived " +
              "network tables (node_list, network_nodes, network_edges, network_summary): those " +
              "are analysis OUTPUTS, and WP 4.2 binds them to their own input hash.",
          ] as (string | number | null)[],
        ]),
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
  /**
   * A5 — the Reproducibility Record (§5.4), appended as its own sheet.
   *
   * A4 already binds four of I8's five for a simulation run, and it binds them for
   * THIS RUN. A5 adds the two things a reader in two years also needs and this
   * workbook could not supply: the ANALYSIS runs behind the network figures, which
   * come from `analysis_runs` and not from a simulation at all, and the DECLARED
   * LIMITS of the whole record.
   *
   * OPTIONAL, AND ITS ABSENCE IS A SHEET RATHER THAN A MISSING ONE. A caller that
   * cannot assemble the record still gets a `reproducibility` sheet saying so —
   * because a workbook silently lacking the sheet is indistinguishable from one
   * whose record was complete, which is the over-claim T1 forbids and the exact
   * shape §4 D103 was.
   */
  record?: ReproducibilityRecord | null,
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

  // A5 · the reproducibility record, or the stated reason there is none.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(
      record
        ? recordRows(record)
        : [
            ["SuReSuite — REPRODUCIBILITY RECORD (A5)"],
            [
              "NOT SUPPLIED",
              "The surface that produced this workbook did not assemble a " +
                "reproducibility record, so this sheet is empty. That is NOT evidence " +
                "the run is reproducible: the bindings above cover the simulation " +
                "inputs, and the analysis runs behind any network figure — and the " +
                "known limits of all of it — are unrecorded here.",
            ],
          ],
    ),
    "reproducibility",
  );

  return wb;
}
