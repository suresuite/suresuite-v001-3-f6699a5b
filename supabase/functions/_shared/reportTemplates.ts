// Decision-report template registry — B6 Report Builder, v1.2 Phase 3
// (ai-agents.md §16.1, decision §10 Q24).
//
// THE law this module encodes: a decision_report proposal is a SPEC, never
// the file. Deterministic sections (kpi_grid / table / run_comparison) carry
// ONLY source references — a registered read tool + args, or persisted run
// ids — and their data is resolved AT RENDER TIME by resolveReportSections,
// so a rendered report can never disagree with the database it cites. The
// LLM selects a template and drafts narrative; it never computes a number.
//
// Shared by both sides of the fabric (the Q21a seam discipline):
//   * draft side — project-ai-chat/reportTools.ts builds/validates the
//     section list a card displays;
//   * render side — report-render/render.ts (via agent-apply) resolves the
//     approved spec against live data and writes XLSX/PDF.

import { executeTool, type ToolContext } from "../project-ai-chat/tools.ts";
// Importing draftTools registers get_data_completeness into the shared
// executeTool registry (bridge 2) — the data-readiness template resolves
// through it, the same grader the pre-run gate uses.
import "../project-ai-chat/draftTools.ts";

export const REPORT_TEMPLATE_IDS = [
  "risk-posture",
  "run-results",
  "run-comparison",
  "disruption-brief",
  "data-readiness",
] as const;

export type ReportTemplateId = (typeof REPORT_TEMPLATE_IDS)[number];

export const REPORT_FORMATS = ["xlsx", "pdf", "both"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** The §4.3 citation shape (narrative sections are citation-mandatory). */
export interface ReportCitation {
  kind: string;
  ref: string;
  rows?: string[];
  quote?: string;
}

/** §16.1 payload sections — deterministic sections carry NO copied data,
 * only source references resolved at render time. */
export type ReportSectionSpec =
  | { kind: "kpi_grid"; title: string; source: { tool: "get_run_results"; args: { run_id: string } } }
  | { kind: "table"; title: string; source: { tool: string; args: Record<string, unknown> } }
  | { kind: "run_comparison"; title: string; source: { baseline_run_id: string; scenario_run_id: string } }
  | { kind: "narrative"; title: string; narrative_md: string; citations: ReportCitation[] };

/** The read tools a stored spec may name — the render path refuses anything
 * outside this closed set (a forged payload cannot reach arbitrary tools). */
export const REPORT_SOURCE_TOOLS: readonly string[] = [
  "get_run_results",
  "get_supplier_risk",
  "get_material_risk",
  "get_procurement_spend",
  "get_data_completeness",
];

/** A run id the template demands, with the role name refusals use
 * ("no completed <role> exists…" — the §16.1 refusal names the missing run). */
export interface RequiredRun {
  role: string;
  arg: string;
  run_id: string;
}

export interface ReportTemplateSpec {
  id: ReportTemplateId;
  label: string;
  /** One-line description for the agent prompt's template list. */
  summary: string;
  /** Args the LLM must supply (beyond template_id/title/format/narrative). */
  requiredArgs: string[];
  optionalArgs: string[];
  /** true ⇒ the template is incomplete without an AI-drafted narrative
   * (disruption-brief: what-if narrative + experiment evidence). */
  narrativeRequired: boolean;
  /** Run ids the template cites — each must exist in-project and be
   * completed, or the draft refuses dependency_missing naming it. */
  requiredRuns(args: Record<string, unknown>): RequiredRun[];
  /** Deterministic section list (source refs only — never data). */
  build(args: Record<string, unknown>): ReportSectionSpec[];
}

const clampTopN = (v: unknown, fallback = 10): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(50, Math.floor(n)));
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const REPORT_TEMPLATES: Record<ReportTemplateId, ReportTemplateSpec> = {
  "risk-posture": {
    id: "risk-posture",
    label: "Risk posture",
    summary: "supplier/material exposure ranking from the project's logistics data (no run required)",
    requiredArgs: [],
    optionalArgs: ["top_n"],
    narrativeRequired: false,
    requiredRuns: () => [],
    build: (args) => [
      {
        kind: "table",
        title: "Supplier risk ranking",
        source: { tool: "get_supplier_risk", args: { top_n: clampTopN(args.top_n) } },
      },
      {
        kind: "table",
        title: "Material risk ranking",
        source: { tool: "get_material_risk", args: { top_n: clampTopN(args.top_n, 15) } },
      },
    ],
  },
  "run-results": {
    id: "run-results",
    label: "Run results",
    summary: "one completed run's KPI pack (requires run_id)",
    requiredArgs: ["run_id"],
    optionalArgs: [],
    narrativeRequired: false,
    requiredRuns: (args) => [{ role: "evidence run", arg: "run_id", run_id: str(args.run_id) }],
    build: (args) => [
      {
        kind: "kpi_grid",
        title: "Run KPI results",
        source: { tool: "get_run_results", args: { run_id: str(args.run_id) } },
      },
    ],
  },
  "run-comparison": {
    id: "run-comparison",
    label: "Run comparison",
    summary: "baseline vs scenario KPI deltas (requires baseline_run_id + scenario_run_id)",
    requiredArgs: ["baseline_run_id", "scenario_run_id"],
    optionalArgs: [],
    narrativeRequired: false,
    requiredRuns: (args) => [
      { role: "baseline run", arg: "baseline_run_id", run_id: str(args.baseline_run_id) },
      { role: "scenario run", arg: "scenario_run_id", run_id: str(args.scenario_run_id) },
    ],
    build: (args) => [
      {
        kind: "run_comparison",
        title: "Baseline vs scenario",
        source: {
          baseline_run_id: str(args.baseline_run_id),
          scenario_run_id: str(args.scenario_run_id),
        },
      },
      {
        kind: "kpi_grid",
        title: "Baseline run detail",
        source: { tool: "get_run_results", args: { run_id: str(args.baseline_run_id) } },
      },
      {
        kind: "kpi_grid",
        title: "Scenario run detail",
        source: { tool: "get_run_results", args: { run_id: str(args.scenario_run_id) } },
      },
    ],
  },
  "disruption-brief": {
    id: "disruption-brief",
    label: "Disruption brief",
    summary: "what-if narrative + experiment evidence (requires the completed scenario_run_id; baseline_run_id adds the comparison)",
    requiredArgs: ["scenario_run_id"],
    optionalArgs: ["baseline_run_id", "top_n"],
    narrativeRequired: true,
    requiredRuns: (args) => [
      { role: "scenario run for this disruption", arg: "scenario_run_id", run_id: str(args.scenario_run_id) },
      ...(args.baseline_run_id
        ? [{ role: "baseline run", arg: "baseline_run_id", run_id: str(args.baseline_run_id) }]
        : []),
    ],
    build: (args) => [
      {
        kind: "kpi_grid",
        title: "Disruption scenario results",
        source: { tool: "get_run_results", args: { run_id: str(args.scenario_run_id) } },
      },
      ...(args.baseline_run_id
        ? [{
          kind: "run_comparison" as const,
          title: "Impact vs baseline",
          source: {
            baseline_run_id: str(args.baseline_run_id),
            scenario_run_id: str(args.scenario_run_id),
          },
        }]
        : []),
      {
        kind: "table",
        title: "Supplier risk exposure",
        source: { tool: "get_supplier_risk", args: { top_n: clampTopN(args.top_n) } },
      },
    ],
  },
  "data-readiness": {
    id: "data-readiness",
    label: "Data readiness",
    summary: "required-data manifest status from the platform grader (no run required)",
    requiredArgs: [],
    optionalArgs: [],
    narrativeRequired: false,
    requiredRuns: () => [],
    build: () => [
      {
        kind: "table",
        title: "Data-completeness findings",
        source: { tool: "get_data_completeness", args: {} },
      },
    ],
  },
};

/** One line per template for the §16.1 agent prompt. */
export function templateCatalogLines(): string {
  return REPORT_TEMPLATE_IDS
    .map((id) => {
      const t = REPORT_TEMPLATES[id];
      const req = t.requiredArgs.length > 0 ? ` — needs ${t.requiredArgs.join(", ")}` : "";
      const narrative = t.narrativeRequired ? "; narrative_md required" : "";
      return `- "${id}": ${t.summary}${req}${narrative}`;
    })
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Render-time resolution — registered read tools / persisted runs ONLY.
// ─────────────────────────────────────────────────────────────────────────────

/** Typed resolution failure: `stale_values` when a cited run no longer
 * resolves (§4.2 approved→applied grounding law), `rpc_error` otherwise. */
export class ReportResolveError extends Error {
  constructor(public code: "stale_values" | "rpc_error", message: string) {
    super(message);
    this.name = "ReportResolveError";
  }
}

/** One resolved section — the workbook/PDF builders consume exactly this. */
export interface ResolvedReportSection {
  kind: ReportSectionSpec["kind"];
  title: string;
  provenance: "deterministic" | "llm_drafted";
  /** kind-specific locator printed in the document's source notes. */
  source_ref: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  narrative_md?: string;
  citations?: ReportCitation[];
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

interface RunRow {
  id: string;
  project_id: string;
  status: string;
  rep_count_done?: number | null;
  aggregate_kpis?: Record<string, unknown> | null;
  scenario_id?: string | null;
  policy_version_id?: string | null;
}

/** Completed-run statuses: the worker marks finished runs 'done'
 * (sim-worker single-writer law, asset A11). */
export const COMPLETED_RUN_STATUSES: readonly string[] = ["done"];

export async function loadCompletedRun(
  db: Db,
  projectId: string,
  runId: string,
): Promise<RunRow | null> {
  const { data } = await db
    .from("simulation_runs")
    .select("*")
    .eq("id", runId)
    .eq("project_id", projectId)
    .maybeSingle();
  const run = (data as RunRow) ?? null;
  if (!run || !COMPLETED_RUN_STATUSES.includes(String(run.status))) return null;
  return run;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Deterministic KPI ordering — the render-determinism contract (rb-06):
 * same spec + same data ⇒ identical cell values, so map iteration order
 * must never leak into the document. */
function sortedKpis(kpis: Record<string, unknown> | null | undefined): Array<[string, string | number | null]> {
  const out: Array<[string, string | number | null]> = [];
  for (const key of Object.keys(kpis ?? {}).sort()) {
    const v = (kpis ?? {})[key];
    if (typeof v === "number" && Number.isFinite(v)) out.push([key, round6(v)]);
    else if (v == null) out.push([key, null]);
    else out.push([key, String(v)]);
  }
  return out;
}

async function resolveKpiGrid(
  db: Db,
  projectId: string,
  runId: string,
  title: string,
): Promise<ResolvedReportSection> {
  const run = await loadCompletedRun(db, projectId, runId);
  if (!run) {
    throw new ReportResolveError(
      "stale_values",
      `the cited run ${runId} no longer exists as a completed run in this project — ask for a fresh report draft`,
    );
  }
  const rows: Array<Array<string | number | null>> = [
    ["run_id", run.id],
    ["status", String(run.status)],
    ["replications_done", Number(run.rep_count_done ?? 0)],
    ...sortedKpis(run.aggregate_kpis),
  ];
  return {
    kind: "kpi_grid",
    title,
    provenance: "deterministic",
    source_ref: `run:${run.id}`,
    columns: ["Metric", "Value"],
    rows,
  };
}

async function resolveRunComparison(
  db: Db,
  projectId: string,
  baselineId: string,
  scenarioId: string,
  title: string,
): Promise<ResolvedReportSection> {
  const [baseline, scenario] = await Promise.all([
    loadCompletedRun(db, projectId, baselineId),
    loadCompletedRun(db, projectId, scenarioId),
  ]);
  if (!baseline) {
    throw new ReportResolveError(
      "stale_values",
      `the cited baseline run ${baselineId} no longer exists as a completed run in this project — ask for a fresh report draft`,
    );
  }
  if (!scenario) {
    throw new ReportResolveError(
      "stale_values",
      `the cited scenario run ${scenarioId} no longer exists as a completed run in this project — ask for a fresh report draft`,
    );
  }
  const keys = [...new Set([
    ...Object.keys(baseline.aggregate_kpis ?? {}),
    ...Object.keys(scenario.aggregate_kpis ?? {}),
  ])].sort();
  const rows: Array<Array<string | number | null>> = keys.map((k) => {
    const b = (baseline.aggregate_kpis ?? {})[k];
    const s = (scenario.aggregate_kpis ?? {})[k];
    const bn = typeof b === "number" && Number.isFinite(b) ? b : null;
    const sn = typeof s === "number" && Number.isFinite(s) ? s : null;
    const delta = bn != null && sn != null ? round6(sn - bn) : null;
    const deltaPct = bn != null && sn != null && bn !== 0 ? round6(((sn - bn) / Math.abs(bn)) * 100) : null;
    return [
      k,
      bn ?? (b == null ? null : String(b)),
      sn ?? (s == null ? null : String(s)),
      delta,
      deltaPct,
    ];
  });
  return {
    kind: "run_comparison",
    title,
    provenance: "deterministic",
    source_ref: `run:${baseline.id} vs run:${scenario.id}`,
    columns: ["KPI", "Baseline", "Scenario", "Delta", "Delta %"],
    rows,
  };
}

async function resolveToolTable(
  db: Db,
  ctx: { projectId: string; userId: string },
  tool: string,
  args: Record<string, unknown>,
  title: string,
): Promise<ResolvedReportSection> {
  if (!REPORT_SOURCE_TOOLS.includes(tool)) {
    throw new ReportResolveError("rpc_error", `"${tool}" is not a registered report source tool`);
  }
  const toolCtx: ToolContext = {
    projectId: ctx.projectId,
    userId: ctx.userId,
    supabase: db as unknown as ToolContext["supabase"],
  };
  const env = await executeTool(tool, args, toolCtx);
  if (env.meta.note === "error") {
    throw new ReportResolveError("rpc_error", `report source ${tool} failed to resolve`);
  }
  if (env.kind === "table" && env.data && typeof env.data === "object") {
    const d = env.data as { columns?: unknown[]; rows?: unknown[][] };
    return {
      kind: "table",
      title,
      provenance: "deterministic",
      source_ref: `tool:${tool}`,
      columns: (d.columns ?? []).map(String),
      rows: (d.rows ?? []).map((r) =>
        (r ?? []).map((c) => (typeof c === "number" && Number.isFinite(c) ? round6(c) : c == null ? null : String(c)))
      ),
    };
  }
  // An empty/prose result still renders honestly — one note row.
  return {
    kind: "table",
    title,
    provenance: "deterministic",
    source_ref: `tool:${tool}`,
    columns: ["Note"],
    rows: [[String(env.data ?? "no data")]],
  };
}

/**
 * Resolve every section of an approved spec against LIVE data — the render
 * path's single entry point (report-render/render.ts) and the determinism
 * fixture's subject (rb-06: same spec + same data ⇒ identical cell values).
 * Throws ReportResolveError('stale_values') when a cited run vanished.
 */
export async function resolveReportSections(
  db: Db,
  ctx: { projectId: string; userId: string },
  sections: ReportSectionSpec[],
): Promise<ResolvedReportSection[]> {
  const out: ResolvedReportSection[] = [];
  for (const s of sections) {
    if (s.kind === "narrative") {
      out.push({
        kind: "narrative",
        title: s.title,
        provenance: "llm_drafted",
        source_ref: "ai-drafted",
        columns: [],
        rows: [],
        narrative_md: s.narrative_md,
        citations: s.citations ?? [],
      });
    } else if (s.kind === "kpi_grid") {
      out.push(await resolveKpiGrid(db, ctx.projectId, String(s.source.args.run_id ?? ""), s.title));
    } else if (s.kind === "run_comparison") {
      out.push(await resolveRunComparison(
        db, ctx.projectId,
        String(s.source.baseline_run_id ?? ""), String(s.source.scenario_run_id ?? ""),
        s.title,
      ));
    } else if (s.kind === "table") {
      out.push(await resolveToolTable(db, ctx, String(s.source.tool ?? ""), s.source.args ?? {}, s.title));
    } else {
      throw new ReportResolveError("rpc_error", `unknown section kind "${(s as { kind?: string }).kind}"`);
    }
  }
  return out;
}
