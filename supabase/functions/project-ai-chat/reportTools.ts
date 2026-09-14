// B6 Report Builder draft-tool family — v1.2 Phase 3 (ai-agents.md §16.1,
// §4.5, §9.8 Phase 3).
//
// One new tool, registered into the shared executeTool registry (bridge 2):
//   * draft_decision_report — draft: the proposal is a report SPEC, never the
//     file. The LLM selects a template from the §16.1 registry and drafts
//     narrative; deterministic sections carry ONLY source references
//     (registered read tools / persisted run ids) that the renderer resolves
//     at render time — a report can never disagree with the data it cites.
//     Hard gates at draft time: template + format vocabulary; every run the
//     template cites must exist in-project and be COMPLETED, else the refusal
//     names the missing run (and, per §16.1, offers the experiment path in
//     Review mode / the mode switch in Ask mode); narrative sections are
//     citation-mandatory (§4.3).
//   * Reads are shared tools (§16.1 least-privilege surface): get_run_results
//     (vvTools.ts), get_data_completeness (draftTools.ts), get_supplier_risk /
//     get_material_risk (tools.ts) — declared here, registered by their
//     modules.
//
// §15: report-builder is the ONE agent routable in BOTH Ask and Review modes
// — rendering a file mutates no project state (§13.3: apply requires
// agent_proposals + reports, NOT agent_apply).
//
// Flags: AGENT_ENABLED_IDS must include report-builder AND the server flag
// FILE_WORKSPACE_ENABLED must be set (§16.2 surfaces); either off ⇒ the tool
// refuses agent_disabled and Phase 2 behavior is untouched (§9).

import {
  registerToolHandler,
  toolDeclarations,
  type ToolContext,
  type ToolDeclaration,
  type ToolEnvelope,
} from "./tools.ts";
import { canonicalJson, sha256Hex } from "./telemetry.ts";
import { deploymentEnabledAgents } from "./router.ts";
import {
  AGENT_COMMON,
  failureEnvelope,
  getDataCompletenessDeclaration,
  MAX_CITATIONS,
  MAX_PAYLOAD_BYTES,
  proposalEnvelope,
} from "./draftTools.ts";
import { getRunResultsDeclaration } from "./vvTools.ts";
import {
  loadCompletedRun,
  REPORT_FORMATS,
  REPORT_TEMPLATE_IDS,
  REPORT_TEMPLATES,
  templateCatalogLines,
  type ReportCitation,
  type ReportFormat,
  type ReportSectionSpec,
  type ReportTemplateId,
} from "../_shared/reportTemplates.ts";
import {
  getProjectMemoryDeclaration,
  loadActiveMemories,
  loadStaleContext,
  memoryContextBlock,
  memoryEnabled,
} from "./memory.ts";

export const REPORT_AGENT_ID = "report-builder";
export const REPORT_ARTIFACT_TYPE = "decision_report";
/** §10 Q10: prompt versioning — bumped on any §16.1 template change. */
export const REPORT_PROMPT_VERSION = 1;

/** §16.1 narrative budget (the §4.5 markdown limit). */
export const REPORT_NARRATIVE_MAX_CHARS = 8000;

/** §16.1 grounding-context budgets (DEFAULT): recent runs ≤ 24 KB inside a
 * 48 KB total context budget. */
export const REPORT_RUNS_BUDGET = 24 * 1024;
export const REPORT_CONTEXT_BUDGET = 48 * 1024;

/** §16.2 server flag — gates every file-workspace surface, including the
 * draft tool (a spec that could never render is a broken promise). */
export function fileWorkspaceEnabled(): boolean {
  return (Deno.env.get("FILE_WORKSPACE_ENABLED") ?? "").trim().toLowerCase() === "true";
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** §4.3 citation-kind vocabulary (narrative citations validate against it). */
const CITATION_KINDS = new Set([
  "tool_call", "table_rows", "registry", "run", "validation_card", "document", "user_message",
]);

// ---------- declarations (§16.1 schema, provider-safe subset) ----------

export const draftDecisionReportDeclaration: ToolDeclaration = {
  name: "draft_decision_report",
  description:
    "File ONE reviewable decision-report SPEC (never the file itself). Pick exactly one template; supply the run ids it requires from CONTEXT (never invented). Deterministic sections are resolved from the database at render time — you never copy numbers into the spec. narrative_md is your commentary and MUST carry citations to the runs/tool results it draws on. Call this once per ask.",
  parameters: {
    type: "object",
    properties: {
      template_id: {
        type: "string",
        enum: [...REPORT_TEMPLATE_IDS],
        description: "The report template (see CONTEXT for what each needs).",
      },
      title: { type: "string", description: "Document title (max 140 chars)." },
      format: {
        type: "string",
        enum: [...REPORT_FORMATS],
        description: "Requested document format. 'pdf' and 'both' also ship the XLSX data pack backing the numbers.",
      },
      run_id: { type: "string", description: "run-results: the completed run to report." },
      baseline_run_id: {
        type: "string",
        description: "run-comparison (required) / disruption-brief (optional): the completed baseline run.",
      },
      scenario_run_id: {
        type: "string",
        description: "run-comparison / disruption-brief: the completed scenario run.",
      },
      top_n: { type: "number", description: "risk-posture / disruption-brief: rows per risk table (1-50)." },
      narrative_md: {
        type: "string",
        description:
          "AI-drafted commentary (max 8000 chars). Required for disruption-brief. Renders under an explicit 'AI-drafted commentary' heading.",
      },
      citations: {
        type: "array",
        description:
          "Citations for narrative_md — MANDATORY when narrative_md is present. Each: {kind: 'run'|'tool_call'|'table_rows'|'user_message'|…, ref: string}.",
        items: {
          type: "object",
          properties: {
            kind: { type: "string" },
            ref: { type: "string" },
            quote: { type: "string" },
          },
          required: ["kind", "ref"],
        },
      },
    },
    required: ["template_id"],
  },
};

/** The Report Builder's complete least-privilege tool surface (§16.1):
 * nothing else is declared to the model. get_project_memory joins when M2
 * is on (§14.4). */
export function reportToolDeclarations(): ReadonlyArray<ToolDeclaration> {
  return [
    getRunResultsDeclaration,
    getDataCompletenessDeclaration,
    toolDeclarations[1], // get_supplier_risk (existing read tool)
    toolDeclarations[3], // get_material_risk (existing read tool)
    ...(memoryEnabled() ? [getProjectMemoryDeclaration] : []),
    draftDecisionReportDeclaration,
  ];
}

// ---------- §16.1 system-prompt template (verbatim) ----------

export function buildReportPrompt(args: {
  projectId: string;
  utterance: string;
  mode: "ask" | "review";
  runsJson: string;
  templateCatalog: string;
  memoryBlock?: string;
}): string {
  const memory = args.memoryBlock ? `\n${args.memoryBlock}` : "";
  const refusalTail = args.mode === "ask"
    ? `say exactly which run is missing and that the user should switch this
  thread to Review and ask you to set the experiment up — once it completes
  you can build the report.`
    : `say exactly which run is missing and offer the experiment path: the
  user can ask you to run the experiment first (the Experiment Designer
  drafts it for approval), then re-ask for the report once it completes.`;
  return `You are the Report Builder, the SuReSuite agent that turns persisted project
data and completed simulation runs into a reviewable decision-report spec.

CONTEXT
- Project: ${args.projectId}
- Interaction mode: ${args.mode}
- Recent runs (only status "done" counts as completed evidence): ${args.runsJson}
- Report templates (choose exactly ONE):
${args.templateCatalog}${memory}

TASK
- The user asked: "${args.utterance}"
- Choose the one template that answers the ask and call draft_decision_report
  ONCE: the template's required run ids come from CONTEXT or tool results
  (never invented), the format is what the user asked for (xlsx | pdf | both),
  and narrative_md is 2-6 sentences of commentary WITH citations to the runs
  and tool results it draws on. You never compute, project, or restate
  numbers — every figure in the document is resolved from the database at
  render time by the platform.
- If the template needs a completed run that does not exist, do NOT draft:
  ${refusalTail}
- If the ask names a report the template catalog does not contain, do NOT
  draft and do NOT fall back to the closest template: say which report was
  asked for, that it is not a template this platform ships, and list the
  template names that ARE available.
- If the template is citation-mandatory, every run id you cite must come
  from CONTEXT or a tool result this turn. If you cannot cite a real run,
  do NOT draft and do NOT invent or guess a run id: say which citation is
  missing.
- After the tool returns, reply in 2-4 sentences: which template, what the
  document will contain, and that approving the card renders the files into
  the user's workspace.

${AGENT_COMMON}`;
}

// ---------- grounding-context builder (bridge 3, §16.1) ----------

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

function clampJson(value: unknown, budget: number): string {
  const s = JSON.stringify(value ?? null);
  return s.length <= budget ? s : s.slice(0, budget) + "…";
}

/** Deterministic grounding-context builder (§16.1): recent runs ≤ 24 KB +
 * the template catalog + the thread's interaction mode. Project artifacts
 * only — never chat history (statelessness law §3.4-5). */
export async function buildReportContext(
  ctx: ToolContext,
  args: { utterance: string },
): Promise<string> {
  const db = ctx.supabase as unknown as Db;

  let runsJson = "[]";
  try {
    const { data } = await db
      .from("simulation_runs")
      .select("*")
      .eq("project_id", ctx.projectId)
      .order("created_at", { ascending: false })
      .limit(10);
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id,
      status: r.status,
      reps_done: r.rep_count_done ?? 0,
      scenario_id: r.scenario_id ?? null,
      policy_version_id: r.policy_version_id ?? null,
      kpis: Object.keys((r.aggregate_kpis ?? {}) as Record<string, unknown>).sort(),
    }));
    runsJson = clampJson(rows, REPORT_RUNS_BUDGET);
  } catch { /* shown as empty */ }

  let memoryBlock = "";
  if (memoryEnabled()) {
    try {
      const [rows, stale] = await Promise.all([
        loadActiveMemories(db, ctx.projectId),
        loadStaleContext(db, ctx.projectId),
      ]);
      memoryBlock = memoryContextBlock(rows, stale).block;
    } catch { /* memory is context, not a gate */ }
  }

  const prompt = buildReportPrompt({
    projectId: ctx.projectId,
    utterance: args.utterance.slice(0, 4000),
    mode: ctx.draft?.mode === "ask" ? "ask" : "review",
    runsJson,
    templateCatalog: templateCatalogLines(),
    memoryBlock,
  });
  return prompt.length <= REPORT_CONTEXT_BUDGET ? prompt : prompt.slice(0, REPORT_CONTEXT_BUDGET);
}

// ---------- draft_decision_report handler ----------

/** §4.5 idempotency core: the substantive spec (template ∪ format ∪
 * deterministic sections) minus free text (title, narrative) — re-phrasings
 * of the same report converge on one card. */
export async function reportIdempotencyKey(core: {
  template_id: string;
  format: string;
  sections: ReportSectionSpec[];
}): Promise<string> {
  const deterministic = core.sections.filter((s) => s.kind !== "narrative");
  return await sha256Hex(
    `${REPORT_AGENT_ID} ${REPORT_ARTIFACT_TYPE} ${canonicalJson({
      schema_version: 1,
      template_id: core.template_id,
      format: core.format,
      sections: deterministic,
    })}`,
  );
}

/** §16.1 refusal (rb-04): the missing evidence run is NAMED, and the remedy
 * matches the thread's mode — Ask offers the mode switch, Review offers the
 * experiment path (the chained disruption-brief flow). */
export function missingRunRefusal(role: string, runId: string | null, mode: "ask" | "review"): string {
  const named = runId
    ? `No completed ${role} exists for this report — run ${runId} is not a completed run in this project.`
    : `No completed ${role} exists for this report — this project has no completed run to cite.`;
  const remedy = mode === "ask"
    ? `Switch this thread to Review and ask me to set up the experiment; once the run completes I can build the report.`
    : `Ask me to run the experiment first — the Experiment Designer drafts the run spec for your approval — then re-ask for the report once it completes.`;
  return `${named} ${remedy}`;
}

async function draftDecisionReport(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolEnvelope> {
  const tool = "draft_decision_report";

  // §13.2 checkpoints 2-3: deployment kill switches + agent_proposals capability.
  if (!deploymentEnabledAgents().includes(REPORT_AGENT_ID)) {
    return failureEnvelope(tool, "agent_disabled", "The Report Builder agent is not enabled in this deployment.");
  }
  if (!fileWorkspaceEnabled()) {
    return failureEnvelope(
      tool,
      "agent_disabled",
      "The file workspace is not enabled in this deployment (FILE_WORKSPACE_ENABLED) — reports cannot be stored.",
    );
  }
  if (!ctx.draft || !ctx.draft.canProposals) {
    return failureEnvelope(tool, "agent_disabled", "Proposal drafting is not enabled for this account (agent_proposals).");
  }
  const mode: "ask" | "review" = ctx.draft.mode === "ask" ? "ask" : "review";

  // §16.1 output contract, enforced deterministically.
  for (const k of Object.keys(args)) {
    if (![
      "template_id", "title", "format", "run_id", "baseline_run_id",
      "scenario_run_id", "top_n", "narrative_md", "citations",
    ].includes(k)) {
      return failureEnvelope(tool, "invalid_params", `unknown parameter "${k}"`);
    }
  }
  const templateId = String(args.template_id ?? "");
  if (!(REPORT_TEMPLATE_IDS as readonly string[]).includes(templateId)) {
    return failureEnvelope(
      tool,
      "invalid_params",
      `unknown template_id "${templateId}" — one of: ${REPORT_TEMPLATE_IDS.join(", ")}`,
    );
  }
  const template = REPORT_TEMPLATES[templateId as ReportTemplateId];
  const format: ReportFormat = args.format === undefined || args.format === null
    ? "pdf"
    : (REPORT_FORMATS as readonly string[]).includes(String(args.format))
    ? String(args.format) as ReportFormat
    : "invalid" as ReportFormat;
  if ((format as string) === "invalid") {
    return failureEnvelope(tool, "invalid_params", `format must be one of: ${REPORT_FORMATS.join(", ")}`);
  }

  const db = ctx.supabase as unknown as Db;

  // Required args + run-shaped args validate as uuids.
  for (const arg of ["run_id", "baseline_run_id", "scenario_run_id"]) {
    const v = args[arg];
    if (v !== undefined && v !== null && v !== "" && (typeof v !== "string" || !uuidRe.test(v))) {
      return failureEnvelope(tool, "invalid_params", `${arg} must be a simulation run uuid from CONTEXT`);
    }
  }
  for (const arg of template.requiredArgs) {
    const v = args[arg];
    if (v === undefined || v === null || v === "") {
      if (["run_id", "baseline_run_id", "scenario_run_id"].includes(arg)) {
        // The model left the evidence slot empty — check whether ANY
        // completed run exists so the refusal is honest (§16.1).
        let anyDone = false;
        try {
          const { data } = await db
            .from("simulation_runs")
            .select("id,status")
            .eq("project_id", ctx.projectId)
            .eq("status", "done")
            .limit(1);
          anyDone = Array.isArray(data) && data.length > 0;
        } catch { /* fall through to the refusal */ }
        if (!anyDone) {
          const role = template.requiredRuns({ ...args, [arg]: "" }).find((r) => r.arg === arg)?.role ?? "evidence run";
          return failureEnvelope(tool, "dependency_missing", missingRunRefusal(role, null, mode));
        }
        return failureEnvelope(tool, "invalid_params", `template "${templateId}" requires ${arg} — pick a completed run from CONTEXT`);
      }
      return failureEnvelope(tool, "invalid_params", `template "${templateId}" requires ${arg}`);
    }
  }

  // §16.1 hard gate: every run the template cites must exist in THIS project
  // and be completed — else the refusal NAMES the missing run (rb-04).
  const requiredRuns = template.requiredRuns(args);
  for (const req of requiredRuns) {
    if (!req.run_id) continue;
    const run = await loadCompletedRun(db, ctx.projectId, req.run_id);
    if (!run) {
      return failureEnvelope(tool, "dependency_missing", missingRunRefusal(req.role, req.run_id, mode));
    }
  }

  // Narrative (§4.3): citation-mandatory; disruption-brief demands it.
  const narrative = typeof args.narrative_md === "string" ? args.narrative_md.trim() : "";
  if (template.narrativeRequired && !narrative) {
    return failureEnvelope(
      tool,
      "invalid_params",
      `template "${templateId}" requires narrative_md — the what-if commentary is the brief's point`,
    );
  }
  if (narrative.length > REPORT_NARRATIVE_MAX_CHARS) {
    return failureEnvelope(tool, "too_large", `narrative_md exceeds ${REPORT_NARRATIVE_MAX_CHARS} chars — tighten the commentary`);
  }
  const narrativeCitations: ReportCitation[] = [];
  if (narrative) {
    const raw = args.citations;
    if (!Array.isArray(raw) || raw.length === 0) {
      return failureEnvelope(
        tool,
        "not_grounded",
        "narrative sections are citation-mandatory — cite the runs/tool results the commentary draws on",
      );
    }
    if (raw.length > MAX_CITATIONS) {
      return failureEnvelope(tool, "too_large", `citations exceed the ${MAX_CITATIONS}-entry limit`);
    }
    for (const c of raw) {
      if (!c || typeof c !== "object" || Array.isArray(c)) {
        return failureEnvelope(tool, "invalid_params", "each citation must be an object {kind, ref}");
      }
      const cit = c as Record<string, unknown>;
      const kind = String(cit.kind ?? "");
      const ref = String(cit.ref ?? "");
      if (!CITATION_KINDS.has(kind)) {
        return failureEnvelope(tool, "invalid_params", `unknown citation kind "${kind}"`);
      }
      if (!ref || ref.length > 300) {
        return failureEnvelope(tool, "invalid_params", "citation ref must be a non-empty string (max 300 chars)");
      }
      if (kind === "run") {
        const run = await loadCompletedRun(db, ctx.projectId, ref);
        if (!run) {
          return failureEnvelope(tool, "not_grounded", `narrative cites run ${ref}, which is not a completed run in this project`);
        }
      }
      narrativeCitations.push({
        kind,
        ref,
        ...(typeof cit.quote === "string" && cit.quote ? { quote: cit.quote.slice(0, 500) } : {}),
      });
    }
  }

  // Deterministic sections from the registry (source refs only, never data);
  // the narrative section joins them for render order.
  const sections: ReportSectionSpec[] = template.build(args);
  if (narrative) {
    sections.push({
      kind: "narrative",
      title: "AI-drafted commentary",
      narrative_md: narrative,
      citations: narrativeCitations,
    });
  }

  const title = (typeof args.title === "string" && args.title.trim()
    ? args.title.trim()
    : `${template.label} report`)
    .slice(0, 140);

  const payload: Record<string, unknown> = {
    schema_version: 1,
    prompt_version: REPORT_PROMPT_VERSION,
    template_id: templateId,
    template_label: template.label,
    title,
    format,
    sections,
    // card display (deterministic, computed here — never by the model):
    evidence_runs: requiredRuns.map((r) => r.run_id).filter(Boolean),
  };
  if (canonicalJson(payload).length > MAX_PAYLOAD_BYTES) {
    return failureEnvelope(tool, "too_large", "The report spec exceeds the 256 KB payload limit — narrow the ask.");
  }

  // Proposal citations (§4.3): a run ref per cited run, a tool_call ref per
  // deterministic source, the narrative's own citations, the user's ask.
  const citations: Array<Record<string, unknown>> = [];
  const seenRefs = new Set<string>();
  const push = (c: Record<string, unknown>) => {
    const key = `${c.kind}|${c.ref}`;
    if (seenRefs.has(key)) return;
    seenRefs.add(key);
    citations.push(c);
  };
  for (const id of requiredRuns.map((r) => r.run_id).filter(Boolean)) {
    push({ kind: "run", ref: id });
  }
  for (const s of sections) {
    if (s.kind === "table" || s.kind === "kpi_grid") {
      const sha = (await sha256Hex(canonicalJson(s.source.args ?? {}))).slice(0, 12);
      push({ kind: "tool_call", ref: `${s.source.tool}#${sha}` });
    }
  }
  for (const c of narrativeCitations) push(c as unknown as Record<string, unknown>);
  push({
    kind: "user_message",
    ref: `thread:${ctx.draft.threadId ?? "current"}`,
    quote: ctx.draft.utterance.slice(0, 500),
  });
  if (citations.length > MAX_CITATIONS) citations.length = MAX_CITATIONS;

  const deterministicCount = sections.filter((s) => s.kind !== "narrative").length;
  const runsNote = requiredRuns.length > 0
    ? ` · cites run(s) ${requiredRuns.map((r) => r.run_id.slice(0, 8)).join(", ")}`
    : "";
  const summary =
    `template ${templateId} · ${format} · ${sections.length} section(s) ` +
    `(${deterministicCount} deterministic${narrative ? " + AI-drafted commentary" : ""})${runsNote}`;

  const idemKey = await reportIdempotencyKey({ template_id: templateId, format, sections });

  // §4.2: an identical live ask converges on the existing card.
  try {
    const { data: existing } = await ctx.supabase
      .from("proposals")
      .select("id,status,title")
      .eq("project_id", ctx.projectId)
      .eq("idempotency_key", idemKey)
      .in("status", ["draft", "proposed", "approved"])
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      return proposalEnvelope(tool, {
        proposal_id: String(existing.id),
        status: String(existing.status ?? "proposed"),
        title: String(existing.title ?? title),
        artifact_type: REPORT_ARTIFACT_TYPE,
        summary,
        provenance: "llm_drafted",
        duplicate: true,
      });
    }
  } catch { /* the RPC's own idempotency check still converges below */ }

  const { data: proposalId, error } = await ctx.supabase.rpc("create_agent_proposal", {
    p_project_id: ctx.projectId,
    p_agent_id: REPORT_AGENT_ID,
    p_artifact_type: REPORT_ARTIFACT_TYPE,
    p_title: title,
    p_payload: payload,
    p_citations: citations,
    // §16.1: template selection and narrative are the LLM's — human must
    // verify. Every number is resolved deterministically at render time.
    p_provenance: "llm_drafted",
    // Grounding hashes are deliberately empty: the spec stores no data, and
    // render-time resolution means data drift cannot make the document lie —
    // the TTL still bounds the card (§4.2). A vanished cited run fails apply
    // with stale_values.
    p_grounding: {},
    p_idempotency_key: idemKey,
    p_thread_id: ctx.draft.threadId,
    p_model_code: ctx.draft.modelCode,
    p_provider_code: ctx.draft.providerCode,
    p_user_id: ctx.userId,
    p_user_email: ctx.draft.userEmail,
    p_status: "proposed",
  });
  if (error) {
    const msg = String(error.message ?? "proposal creation failed");
    if (msg.includes("too_large")) return failureEnvelope(tool, "too_large", msg);
    console.error("create_agent_proposal failed:", msg);
    return { kind: "text", data: "Filing the proposal failed — try again.", meta: { tool, row_count: 0, note: "error" } };
  }

  return proposalEnvelope(tool, {
    proposal_id: String(proposalId),
    status: "proposed",
    title,
    artifact_type: REPORT_ARTIFACT_TYPE,
    summary,
    provenance: "llm_drafted",
  });
}

// Register into the shared executeTool registry (bridge 2). The read tools of
// the §16.1 surface are registered by tools.ts / draftTools.ts / vvTools.ts.
registerToolHandler("draft_decision_report", draftDecisionReport);
