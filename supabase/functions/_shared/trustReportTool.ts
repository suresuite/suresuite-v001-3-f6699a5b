/**
 * A3 — the Trust Report as a REGISTERED READ TOOL. §5.4, WP 6.3.
 *
 * ── WHY IT IS A TOOL AND NOT A RENDERER ───────────────────────────────────
 *
 * `report-render`'s law (ai-agents.md §16.1) is that a decision report is a SPEC,
 * never the file: a deterministic section carries only a registered read tool plus
 * args, and the data is resolved AT RENDER TIME, so a rendered report cannot
 * disagree with the database it cites. A3 has to obey that law rather than work
 * around it — the whole point of a Trust Report is that its numbers are the
 * database's, not a snapshot somebody took.
 *
 * So A3 is this tool plus the `data-trust` template. The report is computed here,
 * server side, from the same three sources the product already uses: the grader
 * behind the pre-run gate, `project_freshness`, and `ingest_runs`.
 *
 * ── AND THAT MAKES THE RENDERED REPORT MORE COMPLETE THAN THE PANEL ────────
 *
 * `TrustReportPanel.tsx` passes `graded: null`, and says why: the /policies surface
 * holds the gate's findings but not the graded manifest behind them, so coverage is
 * DECLARED unavailable rather than rendered as an empty table. This tool has the
 * manifest — it grades the dataset itself — so the rendered report carries the
 * coverage section the panel cannot. That difference is a fact about the two
 * surfaces and it is stated in the report: `complete` in the JSON artifact is
 * false when coverage is empty.
 */
import { registerToolHandler, type ToolContext, type ToolDeclaration, type ToolEnvelope } from "../project-ai-chat/tools.ts";
import { loadGateDataset } from "./validationGate.ts";
import { gradeDataset, loadPolicyDefaults } from "./itemMasterCandidates.ts";
import { flattenFindings } from "./grading.ts";
import { buildTrustReport, type FreshnessPayload, type IngestEvent } from "./trustReport.ts";
import { trustReportSections, type TrustSection } from "./trustReportSections.ts";

/**
 * The client surface this module uses, narrowed rather than `any`.
 *
 * `reportTemplates.ts` and `validationGate.ts` both take `any` here with a
 * `deno-lint-ignore`, which Deno accepts and eslint counts — and an `any` client
 * makes every table name and column list a string nobody checks. These two
 * interfaces cover exactly the calls below: one RPC, one `maybeSingle` read and one
 * ordered list. Passing this where a helper still declares `any` is fine.
 */
interface SbQuery {
  select(cols: string): SbQuery;
  eq(col: string, val: unknown): SbQuery;
  order(col: string, opts: { ascending: boolean }): SbQuery;
  limit(n: number): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
}
export interface TrustDb {
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  from(table: string): SbQuery;
}

export const TRUST_REPORT_SECTION_IDS = [
  "headline", "coverage", "blocking", "substitutions", "freshness", "runs", "ingest", "limits",
] as const;

export const getDataTrustReportDeclaration: ToolDeclaration = {
  name: "get_data_trust_report",
  description:
    "Assemble the Project Data Trust Report (§5.4 A3) and return one section as a table: the verdict, coverage per engine-read field, blocking findings, substituted values, freshness per table, the latest analysis runs, the upload history, or the report's own known limits. Computed from the same grader the pre-run gate uses, plus project_freshness and the ingestion history — never from values a client supplied.",
  parameters: {
    type: "object",
    properties: {
      section: {
        type: "string",
        enum: [...TRUST_REPORT_SECTION_IDS],
        description: "Which section to return. Default 'headline'.",
      },
    },
  },
};

/** The ingestion history, newest first — the same read the panel makes. */
async function loadIngestHistory(
  sb: TrustDb,
  projectId: string,
): Promise<IngestEvent[] | null> {
  const { data, error } = await sb
    .from("ingest_runs")
    .select("id,source_kind,applied_at,applied_by_user_id,rows_fetched")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(50);
  // NULL means "could not look", [] means "nothing recorded". `knownLimits` turns
  // the second into a declared limit; conflating them would publish a clean bill
  // for a read that failed.
  if (error) return null;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    run_id: String(r.id),
    fact_class: (r.source_kind as string) ?? null,
    landed_at: (r.applied_at as string) ?? null,
    uploaded_by: (r.applied_by_user_id as string) ?? null,
    rows: (r.rows_fetched as number) ?? null,
  }));
}

export async function buildTrustSections(
  sb: TrustDb,
  projectId: string,
): Promise<{ sections: TrustSection[]; coverageComputed: boolean }> {
  const { data: fresh, error: freshErr } = await sb.rpc("project_freshness", { p_project_id: projectId });
  if (freshErr || !fresh) {
    // The panel's rule, server side: if freshness cannot be read, there is no
    // verdict, and saying so is the only honest output. A report assembled
    // without it would be claiming a clean bill it never checked.
    throw new Error(
      `project_freshness could not be read for ${projectId}${freshErr ? `: ${freshErr.message}` : ""} — ` +
      "no verdict can be assembled, and the absence of findings is not evidence that there are none",
    );
  }
  const freshness = (Array.isArray(fresh) ? fresh[0] : fresh) as FreshnessPayload;

  const { data: project } = await sb.from("projects").select("name").eq("id", projectId).maybeSingle();

  // Grade the dataset HERE rather than trusting a client's findings. A graded
  // manifest is what coverage needs, and it is the difference between this report
  // and the panel's.
  let graded = null;
  let findings: ReturnType<typeof flattenFindings> = [];
  try {
    const [dataset, defaults] = await Promise.all([
      loadGateDataset(sb, projectId),
      loadPolicyDefaults(sb, projectId),
    ]);
    graded = gradeDataset(dataset, defaults);
    findings = flattenFindings(graded);
  } catch {
    // A grading failure leaves `graded` null, which `buildTrustReport` turns into
    // a DECLARED limit rather than an empty coverage table (T3). It does not fail
    // the whole report: freshness, runs and upload history are still true.
    graded = null;
  }

  const ingestHistory = await loadIngestHistory(sb, projectId);
  const report = buildTrustReport({
    projectName: String((project as { name?: unknown })?.name ?? projectId),
    freshness,
    graded,
    findings,
    ingestHistory: ingestHistory ?? [],
  });
  return { sections: trustReportSections(report), coverageComputed: (graded ?? []).length > 0 };
}

async function getDataTrustReport(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolEnvelope> {
  const tool = "get_data_trust_report";
  const wanted = (TRUST_REPORT_SECTION_IDS as readonly string[]).includes(String(args.section))
    ? String(args.section)
    : "headline";
  try {
    const { sections } = await buildTrustSections(ctx.supabase as unknown as TrustDb, ctx.projectId);
    const section = sections.find((s) => s.id === wanted);
    if (!section) {
      return { kind: "text", data: `No such trust-report section: ${wanted}`, meta: { tool, row_count: 0, note: "error" } };
    }
    if (section.rows.length === 0) {
      // The empty-state SENTENCE, not an empty grid. A coverage table with no rows
      // reads as "nothing is missing" and a findings table with no rows reads as
      // "nothing is wrong"; only one of those is usually true.
      return {
        kind: "table",
        data: { columns: ["Note"], rows: [[section.emptyNote]] },
        meta: { tool, row_count: 0, note: "empty" },
      };
    }
    return {
      kind: "table",
      data: { columns: section.columns, rows: section.rows },
      meta: { tool, row_count: section.rows.length },
    };
  } catch (e) {
    console.warn("get_data_trust_report failed:", (e as Error).message);
    return {
      kind: "text",
      // The MESSAGE, not a generic failure: "freshness could not be read" is the
      // difference between a report that is missing a section and one that has no
      // verdict at all.
      data: `The data trust report could not be assembled: ${(e as Error).message}`,
      meta: { tool, row_count: 0, note: "error" },
    };
  }
}

registerToolHandler("get_data_trust_report", getDataTrustReport);
