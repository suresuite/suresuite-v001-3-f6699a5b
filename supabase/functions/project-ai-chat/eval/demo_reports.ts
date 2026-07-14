// v1.2 Phase 3 — B6 Report Builder + file workspace: end-to-end demo
// transcript (ai-agents.md §9.8 Phase 3 acceptance): drives the REAL
// machinery offline and prints the acceptance scenarios:
//   (a) the CHAINED disruption-brief flow: "write up the outage experiment
//       for my team as a PDF" WITHOUT an evidence run → the refusal NAMES
//       the missing run and offers the experiment path → the Experiment
//       Designer's spec card → Approve → run dispatched → run completes →
//       the re-ask produces the decision_report citing the NEW run_id;
//   (b) the report card → Approve → render: PDF + XLSX under the §16.2
//       org/<org>/user/<user>/<project> path law, user_files rows,
//       applied_result {file_ids, paths}, and the explicit "AI-drafted
//       commentary" heading in the PDF model;
//   (c) §13.3 rights: decision_report apply demands agent_proposals +
//       reports — NOT agent_apply, no data_editing; §10 Q25 quota: the 21st
//       same-day render is denied naming the remaining allowance;
//   (d) §15 ask mode: the report ask IS routable (the one permitted
//       ask-mode artifact) while a data-steward mutation ask is subtracted.
//   (Retention — sweep deletes row AND object, Keep survives, the 500 MB
//    cap fails typed — is SQL law, pinned verbatim in db_reports_test.ts.)
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read demo_reports.ts

import { decideRoute, type ClassifierCall } from "../router.ts";
import { applyModeToRoute } from "../modes.ts";
import { executeTool, type ToolContext } from "../tools.ts";
// Importing agentTurn registers every staged draft tool (B1–B4 + B6).
import "../agentTurn.ts";
import {
  buildPdfModel,
  buildWorkbookModel,
  AI_COMMENTARY_HEADING,
  type RenderDeps,
} from "../../report-render/render.ts";
import { resolveReportSections, type ReportSectionSpec } from "../../_shared/reportTemplates.ts";
import { applyDecisionReport } from "../../agent-apply/decisionReportApply.ts";
import { applyExperimentSpec } from "../../agent-apply/experimentSpecApply.ts";
import {
  ARTIFACT_BASE_FEATURE,
  ARTIFACT_RIGHTS,
  checkApplyQuota,
  REPORT_DAILY_CAP,
} from "../../agent-apply/index.ts";
import { makeAgentRpcs, makeStubDb, type Row, type RpcHandler } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ORG = "99999999-9999-4999-8999-999999999901";
const VER = "44444444-4444-4444-8444-444444444401";

Deno.env.set("AGENT_ROUTER_ENABLED", "true");
Deno.env.set("AGENT_ENABLED_IDS", "experiment-designer,report-builder");
Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
Deno.env.set("CHAT_MODES_ENABLED", "true");
Deno.env.set("FILE_WORKSPACE_ENABLED", "true");

const say = (s: string) => console.log(s);
const h = (s: string) => say(`\n\x1b[1m── ${s} ──\x1b[0m`);

async function loadSnapshot(): Promise<Record<string, Row[]>> {
  const f = JSON.parse(await Deno.readTextFile(
    new URL("./fixtures/report-builder/rb-01-run-results.json", import.meta.url),
  ));
  const tables = structuredClone(f.project_snapshot) as Record<string, Row[]>;
  // The chained flow starts WITHOUT any completed evidence run.
  tables.simulation_runs = [];
  // Dispatch-path substrate (the same rows the ed fixtures seed).
  tables.dataset_versions = [{
    id: "77777777-7777-4777-8777-777777777701",
    project_id: PROJECT, graph_hash: "graph-hash-1", created_at: 5,
  }];
  tables.model_validations = [];
  tables.user_files = [];
  return tables;
}

function makeHarness(tables: Record<string, Row[]>) {
  const rpcs: Record<string, RpcHandler> = {
    ...makeAgentRpcs(tables),
    create_user_file: (args) => {
      const id = String(args.p_id ?? crypto.randomUUID());
      tables.user_files.push({
        id, org_id: args.p_org_id ?? null, user_id: args.p_user_id,
        project_id: args.p_project_id ?? null, proposal_id: args.p_proposal_id ?? null,
        kind: args.p_kind, name: args.p_name, path: args.p_path,
        size_bytes: args.p_size_bytes, retained: false,
        expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        created_at: new Date().toISOString(),
      });
      return id;
    },
  };
  const db = makeStubDb(tables, rpcs);
  const uploads: Array<{ path: string; bytes: Uint8Array }> = [];
  const deps: RenderDeps = {
    writers: {
      xlsx: (sheets) => new TextEncoder().encode(JSON.stringify(sheets)),
      pdf: (blocks) => new TextEncoder().encode(JSON.stringify(blocks)),
    },
    upload: (path, bytes) => { uploads.push({ path, bytes }); return Promise.resolve({ error: null }); },
  };
  const ctx = (mode: "ask" | "review"): ToolContext => ({
    projectId: PROJECT,
    userId: USER,
    supabase: db as unknown as ToolContext["supabase"],
    draft: {
      userEmail: "a@example.com", threadId: "33333333-3333-4333-8333-333333333333",
      modelCode: "gemini-2.5-flash", providerCode: "gemini",
      canProposals: true, utterance: UTTERANCE, mode,
    },
  });
  return { db, tables, uploads, deps, ctx };
}

const UTTERANCE = "Write up the outage experiment for my team as a PDF";

const classifier: ClassifierCall = (prompt) => {
  const utterance = prompt.slice(prompt.indexOf("USER MESSAGE:") + 14).trim();
  const isReport = /write up|report|pdf/i.test(utterance);
  return Promise.resolve(JSON.stringify({
    route: "artifact",
    agent_id: isReport ? "report-builder" : "data-steward",
    intent: isReport ? "report.build" : "steward.fill_missing",
    confidence: 0.96, advisory_part: null, artifact_part: utterance,
  }));
};

const tables = await loadSnapshot();
const H = makeHarness(tables);

h("(a) the chained disruption-brief flow — no evidence run yet");
const routed = await decideRoute(UTTERANCE, {
  personaId: null, hasProject: true,
  enabledAgents: ["experiment-designer", "report-builder"], modelId: "gemini-2.5-flash",
}, classifier);
say(`router: route=${routed.route} agent=${routed.agent_id} intent=${routed.intent}`);

const refusal = await executeTool("draft_decision_report", {
  template_id: "disruption-brief",
  format: "pdf",
  narrative_md: "The outage analysis will follow the run.",
  citations: [{ kind: "user_message", ref: "thread:demo" }],
}, H.ctx("review"));
say(`refusal [${refusal.meta.note}]: ${refusal.data}`);

say("\n→ the user takes the offered experiment path (B4, Phase 1 machinery):");
const specEnv = await executeTool("draft_experiment_spec", {
  new_scenario: {
    name: "S1 outage — 6 weeks", horizon_days: 182,
    disruption_schedule: [{ target: "S1", target_type: "node", start_day: 7, duration_days: 42, magnitude_pct: 100 }],
  },
  policy_version_id: VER, replications: 30,
  title: "S1 outage — 6 weeks × baseline (30 reps)",
}, H.ctx("review"));
const specProposal = tables.proposals.find((p) =>
  String(p.id) === String((specEnv.data as Record<string, unknown>).proposal_id))!;
say(`experiment card: "${specProposal.title}" [${specProposal.status}]`);
specProposal.status = "approved"; // the card's Approve
const dispatched = await applyExperimentSpec(H.db, {
  upstash: () => Promise.resolve("ok"),
}, {
  projectId: PROJECT,
  payload: specProposal.payload as Record<string, unknown>,
  grounding: specProposal.grounding as Record<string, unknown>,
  userId: USER,
});
say(`run dispatched: ${dispatched.run_id} (queued, policy ${dispatched.policy_hash})`);

// The worker completes the run (single-writer law — asset A11).
const run = tables.simulation_runs.find((r) => String(r.id) === dispatched.run_id)!;
run.status = "done";
run.rep_count_done = 30;
run.aggregate_kpis = { fill_rate: 0.71, on_time_delivery: 0.62, total_cost: 168400.25 };
say(`run completed: ${run.id} → ${JSON.stringify(run.aggregate_kpis)}`);

say("\n→ the re-ask now drafts the brief citing the NEW run:");
const reportEnv = await executeTool("draft_decision_report", {
  template_id: "disruption-brief",
  scenario_run_id: dispatched.run_id,
  format: "pdf",
  title: "Supplier S1 outage — impact & response options",
  narrative_md:
    "During the simulated 6-week outage, service KPIs drop materially; the network recovers within the horizon. Recommend qualifying a second source before the risk window.",
  citations: [{ kind: "run", ref: dispatched.run_id }],
}, H.ctx("review"));
const reportProposal = tables.proposals.find((p) =>
  String(p.id) === String((reportEnv.data as Record<string, unknown>).proposal_id))!;
say(`report card: "${reportProposal.title}" [${reportProposal.status}]`);
say(`  summary: ${(reportEnv.data as Record<string, unknown>).summary}`);
const sections = (reportProposal.payload as Record<string, unknown>).sections as ReportSectionSpec[];
for (const s of sections) {
  const ref = s.kind === "narrative"
    ? `AI-drafted, ${s.citations.length} citation(s)`
    : JSON.stringify((s as { source: unknown }).source);
  say(`  section ${s.kind}: ${s.title} ← ${ref}`);
}

h("(b) Approve → render: path law, user_files, the AI-drafted heading");
reportProposal.status = "approved";
reportProposal.reviewed_by = USER;
const result = await applyDecisionReport(H.db, H.deps, {
  projectId: PROJECT, proposalId: String(reportProposal.id),
  payload: reportProposal.payload as Record<string, unknown>, userId: USER,
});
say(`applied_result: ${JSON.stringify({ file_ids: result.file_ids, format: result.format })}`);
for (const f of result.files) say(`  ${f.kind}: ${f.path} (${f.size_bytes} bytes)`);
say(`  path law prefix ok: ${result.paths.every((p) => p.startsWith(`org/${ORG}/user/${USER}/${PROJECT}/`))}`);
say(`  user_files rows: ${tables.user_files.length} (ids == path file ids: ${
  result.files.every((f) => tables.user_files.some((r) => r.id === f.id && r.path === f.path))})`);
const resolved = await resolveReportSections(H.db, { projectId: PROJECT, userId: USER }, sections);
const pdfModel = buildPdfModel({ title: String(reportProposal.title), templateId: "disruption-brief", sections: resolved });
say(`  PDF carries the "${AI_COMMENTARY_HEADING}" heading: ${
  pdfModel.some((b) => b.type === "heading" && b.text === AI_COMMENTARY_HEADING)}`);
const book1 = buildWorkbookModel({ title: "t", templateId: "disruption-brief", sections: resolved });
const book2 = buildWorkbookModel({
  title: "t", templateId: "disruption-brief",
  sections: await resolveReportSections(H.db, { projectId: PROJECT, userId: USER }, sections),
});
say(`  render determinism (identical XLSX cell values on re-render): ${JSON.stringify(book1) === JSON.stringify(book2)}`);

h("(c) §13.3 rights row + §10 Q25 render quota");
say(`decision_report rights: base=${ARTIFACT_BASE_FEATURE.decision_report} + ${JSON.stringify(ARTIFACT_RIGHTS.decision_report)}`);
say(`  (NOT agent_apply, no data_editing — rendering mutates no project state)`);
const today = new Date().toISOString();
for (let i = tables.proposals.filter((p) => p.artifact_type === "decision_report" && p.status === "applied").length; i < REPORT_DAILY_CAP; i++) {
  tables.proposals.push({
    id: crypto.randomUUID(), project_id: PROJECT, agent_id: "report-builder",
    artifact_type: "decision_report", status: "applied", reviewed_by: USER, applied_at: today,
  });
}
await H.db.rpc("mark_agent_proposal_applied", { p_proposal_id: reportProposal.id, p_result: result });
const violation = await checkApplyQuota(H.db, { artifactType: "decision_report", projectId: PROJECT, userId: USER });
say(`21st same-day render: ${violation}`);

h("(d) §15 ask mode — the ONE permitted ask-mode artifact");
const askReport = applyModeToRoute(routed, "ask");
say(`report ask in ask mode: route=${askReport.decision.route} agent=${askReport.decision.agent_id} blocked=${JSON.stringify(askReport.blocked)}`);
const stewardRouted = await decideRoute("Fill in the missing material costs for me", {
  personaId: null, hasProject: true,
  enabledAgents: ["experiment-designer", "report-builder", "data-steward"], modelId: "gemini-2.5-flash",
}, classifier);
const askSteward = applyModeToRoute(stewardRouted, "ask");
say(`steward ask in ask mode: route=${askSteward.decision.route} blocked=${JSON.stringify(askSteward.blocked)}`);
const askDraft = await executeTool("draft_decision_report", {
  template_id: "run-results", run_id: dispatched.run_id, format: "both",
}, H.ctx("ask"));
say(`ask-mode draft: ${askDraft.kind === "proposal" ? `proposal ${(askDraft.data as Record<string, unknown>).proposal_id}` : askDraft.data}`);

say("\ndone — retention law (sweep deletes row AND object; Keep survives; the 500 MB cap fails typed) is pinned in db_reports_test.ts against the verbatim migration.");
