// B6 Report Builder golden suite, deterministic tier (ai-agents.md §16.1,
// §7.4 tier 1): each rb-* fixture drives the REAL tool handler / render
// pipeline / apply module with a mocked LLM (the fixture's tool-call args),
// asserting the deterministic machinery — the "spec, never the file" law
// (sections carry ONLY source references), citation-mandatory narrative,
// refusal-when-no-evidence-run NAMING the missing run (per mode), render
// determinism (same spec + same data ⇒ identical XLSX cell values), the
// §16.2 path law + user_files bookkeeping, the §13.3 rights row
// (agent_proposals + reports, NOT agent_apply), the §10 Q25 render quota,
// and the §15 ask-mode allowlist. No LLM, no network, no DB.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeAgentRpcs, makeStubDb, type Row, type RpcHandler, type StubDb } from "./harness/stub_db.ts";
import { executeTool, type ToolContext, type ToolEnvelope } from "../tools.ts";
import {
  buildReportContext,
  buildReportPrompt,
  missingRunRefusal,
  reportToolDeclarations,
} from "../reportTools.ts";
import { AGENT_COMMON } from "../draftTools.ts";
import { runAgentTurn } from "../agentTurn.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import {
  REPORT_TEMPLATE_IDS,
  REPORT_TEMPLATES,
  resolveReportSections,
  type ReportSectionSpec,
} from "../../_shared/reportTemplates.ts";
import {
  AI_COMMENTARY_HEADING,
  buildPdfModel,
  buildWorkbookModel,
  renderDecisionReport,
  safeFilename,
  workspacePath,
  type RenderDeps,
} from "../../report-render/render.ts";
import { applyDecisionReport } from "../../agent-apply/decisionReportApply.ts";
import { ApplyFailure } from "../../agent-apply/itemMasterApply.ts";
import {
  ARTIFACT_BASE_FEATURE,
  ARTIFACT_RIGHTS,
  checkApplyQuota,
  REPORT_DAILY_CAP,
} from "../../agent-apply/index.ts";
import { applyModeToRoute, ASK_MODE_AGENT_ALLOWLIST, modeAllowsAgent } from "../modes.ts";
import { AGENT_PRECEDENCE, AGENT_ROSTER } from "../router.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ORG = "99999999-9999-4999-8999-999999999901";
const RUN_BASELINE = "66666666-6666-4666-8666-666666666601";
const RUN_SCENARIO = "66666666-6666-4666-8666-666666666602";
const RUN_RUNNING = "66666666-6666-4666-8666-666666666603";

interface Fixture {
  id: string;
  description: string;
  project_snapshot: Record<string, Row[]> | { reuse: string; patch?: Record<string, Row[]> };
  mocked_llm?: { tool?: string; args?: Record<string, unknown>; reuse?: string } | null;
  utterance: string;
  // deno-lint-ignore no-explicit-any
  expect: Record<string, any>;
  retired_reason: string | null;
}

async function loadFixture(id: string): Promise<Fixture> {
  const f: Fixture = JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/report-builder/${id}.json`, import.meta.url)),
  );
  if ("reuse" in f.project_snapshot) {
    const spec = f.project_snapshot as { reuse: string; patch?: Record<string, Row[]> };
    const base = await loadFixture(spec.reuse);
    f.project_snapshot = {
      ...(base.project_snapshot as Record<string, Row[]>),
      ...(spec.patch ?? {}),
    };
  }
  if (f.mocked_llm && "reuse" in f.mocked_llm && f.mocked_llm.reuse) {
    const base = await loadFixture(f.mocked_llm.reuse);
    f.mocked_llm = base.mocked_llm;
  }
  return f;
}

interface Harness {
  ctx: ToolContext;
  db: StubDb;
  uploads: Array<{ path: string; bytes: Uint8Array; contentType: string }>;
  removed: string[];
  deps: RenderDeps;
}

function makeCtx(fixture: Fixture, opts?: { mode?: "ask" | "review" }): Harness {
  const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
  if (!tables.user_files) tables.user_files = [];
  const rpcs: Record<string, RpcHandler> = {
    ...makeAgentRpcs(tables),
    // §16.2 create_user_file mirror (SQL original pinned in db_reports_test.ts).
    create_user_file: (args) => {
      const id = String(args.p_id ?? crypto.randomUUID());
      tables.user_files.push({
        id,
        org_id: args.p_org_id ?? null,
        user_id: args.p_user_id,
        project_id: args.p_project_id ?? null,
        proposal_id: args.p_proposal_id ?? null,
        kind: args.p_kind,
        name: args.p_name,
        path: args.p_path,
        size_bytes: args.p_size_bytes,
        retained: false,
        expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        created_at: new Date().toISOString(),
      });
      return id;
    },
  };
  const db = makeStubDb(tables, rpcs);
  const uploads: Harness["uploads"] = [];
  const removed: string[] = [];
  const deps: RenderDeps = {
    writers: {
      // Fake byte writers: length is derived from the (deterministic) model,
      // so path/size bookkeeping is still meaningfully asserted. The REAL
      // SheetJS/pdf-lib writers serialize these same models 1:1 (writers.ts).
      xlsx: (sheets) => new TextEncoder().encode(JSON.stringify(sheets)),
      pdf: (blocks) => new TextEncoder().encode(JSON.stringify(blocks)),
    },
    upload: (path, bytes, contentType) => {
      uploads.push({ path, bytes, contentType });
      return Promise.resolve({ error: null });
    },
    remove: (paths) => {
      removed.push(...paths);
      return Promise.resolve();
    },
  };
  const ctx: ToolContext = {
    projectId: PROJECT,
    userId: USER,
    supabase: db as unknown as ToolContext["supabase"],
    draft: {
      userEmail: "a@example.com",
      threadId: "33333333-3333-4333-8333-333333333333",
      modelCode: "gemini-2.5-flash",
      providerCode: "gemini",
      canProposals: true,
      utterance: fixture.utterance,
      mode: opts?.mode ?? "review",
    },
  };
  return { ctx, db, uploads, removed, deps };
}

function withB6Enabled<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("AGENT_ENABLED_IDS", "report-builder");
  Deno.env.set("FILE_WORKSPACE_ENABLED", "true");
  return fn().finally(() => {
    Deno.env.delete("AGENT_ENABLED_IDS");
    Deno.env.delete("FILE_WORKSPACE_ENABLED");
  });
}

function storedProposal(db: StubDb, env: ToolEnvelope): Row {
  assertEquals(env.kind, "proposal", `expected a proposal envelope, got ${env.kind}: ${env.data}`);
  const id = String((env.data as Record<string, unknown>).proposal_id);
  const row = db.tables.proposals.find((p) => String(p.id) === id);
  if (!row) throw new Error(`proposal ${id} not stored`);
  return row;
}

Deno.test("rb-01: completed run + spreadsheet ask → run-results spec; sections carry ONLY source refs; grounding {}; idempotency", () =>
  withB6Enabled(async () => {
    const fixture = await loadFixture("rb-01-run-results");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, ctx);
    const stored = storedProposal(db, env);
    const payload = stored.payload as Record<string, unknown>;
    const exp = fixture.expect.proposal;
    assertEquals(payload.template_id, exp.template_id);
    assertEquals(payload.format, exp.format);
    const sections = payload.sections as ReportSectionSpec[];
    assertEquals(sections.length, exp.sections);
    assertEquals(payload.evidence_runs, exp.evidence_runs);
    assertEquals(stored.provenance, exp.provenance, "§16.1: template selection + narrative are the LLM's — human must verify");
    assertEquals(stored.grounding, {}, "render-time resolution ⇒ no grounding hashes; TTL bounds the card");

    // THE law: deterministic sections carry no copied data — only source
    // references resolved at render time. The run's KPI values must appear
    // NOWHERE in the stored payload.
    const serialized = JSON.stringify(payload);
    assert(!serialized.includes("0.94") && !serialized.includes("125000.5"),
      "spec payloads never copy data (§16.1 'spec, never the file')");
    assertEquals(sections[0].kind, "kpi_grid");
    assertEquals(
      (sections[0] as { source: { tool: string; args: { run_id: string } } }).source,
      { tool: "get_run_results", args: { run_id: RUN_BASELINE } },
    );

    // Proposal citations: the cited run + the tool_call refs + the ask (§4.3).
    const citations = stored.citations as Array<{ kind: string; ref: string }>;
    assert(citations.some((c) => c.kind === "run" && c.ref === RUN_BASELINE));
    assert(citations.some((c) => c.kind === "tool_call" && c.ref.startsWith("get_run_results#")));
    assert(citations.some((c) => c.kind === "user_message"));

    // §4.5 idempotency: re-phrased free text converges on the same card.
    const second = await executeTool("draft_decision_report", {
      ...fixture.mocked_llm!.args!,
      title: "differently phrased title",
    }, ctx);
    assertEquals(second.meta.note, "duplicate");
    assertEquals(db.tables.proposals.length, fixture.expect.proposal_count);
  }));

Deno.test("rb-02: chained disruption-brief — kpi_grid + comparison + risk table + cited narrative citing the new run_id", () =>
  withB6Enabled(async () => {
    const fixture = await loadFixture("rb-02-disruption-brief");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, ctx);
    const stored = storedProposal(db, env);
    const payload = stored.payload as Record<string, unknown>;
    const exp = fixture.expect.proposal;
    assertEquals(payload.template_id, exp.template_id);
    const sections = payload.sections as ReportSectionSpec[];
    assertEquals(sections.length, exp.sections, "kpi_grid + run_comparison + supplier-risk table + narrative");
    assertEquals(sections.map((s) => s.kind), ["kpi_grid", "run_comparison", "table", "narrative"]);
    const narrative = sections[3] as { kind: "narrative"; title: string; citations: Array<{ kind: string; ref: string }> };
    assertEquals(narrative.title, AI_COMMENTARY_HEADING);
    assert(narrative.citations.length > 0, "§4.3: narrative sections are citation-mandatory");
    assert(narrative.citations.some((c) => c.kind === "run" && c.ref === RUN_SCENARIO),
      "the brief cites the completed evidence run (the chained-flow re-ask)");
    assertEquals(payload.evidence_runs, exp.evidence_runs);
    assertEquals(db.tables.proposals.length, fixture.expect.proposal_count);
  }));

Deno.test("rb-03: citation coverage — uncited narrative refuses not_grounded; a narrative citing an unknown run refuses not_grounded", () =>
  withB6Enabled(async () => {
    const fixture = await loadFixture("rb-03-citation-required");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, ctx);
    assertEquals(env.meta.note, fixture.expect.error_code);
    assertStringIncludes(String(env.data), fixture.expect.error_includes);

    const badRun = await executeTool("draft_decision_report", {
      ...fixture.mocked_llm!.args!,
      citations: [{ kind: "run", ref: fixture.expect.unknown_run_citation }],
    }, ctx);
    assertEquals(badRun.meta.note, "not_grounded");
    assertStringIncludes(String(badRun.data), fixture.expect.unknown_run_citation);
    assertEquals(db.tables.proposals.length, fixture.expect.proposal_count);
  }));

Deno.test("rb-04: refusal-when-no-evidence-run NAMES the missing run; Review offers the experiment path, Ask offers the mode switch", () =>
  withB6Enabled(async () => {
    const fixture = await loadFixture("rb-04-no-evidence-run");

    // Review mode: the refusal names the run and offers the chained flow.
    {
      const { ctx, db } = makeCtx(fixture, { mode: "review" });
      const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, ctx);
      assertEquals(env.meta.note, fixture.expect.error_code);
      assertStringIncludes(String(env.data), fixture.expect.error_includes);
      assertStringIncludes(String(env.data), fixture.expect.error_names_run, "§16.1: the refusal NAMES the missing run");
      assertStringIncludes(String(env.data), fixture.expect.review_remedy_includes);
      assertEquals(db.tables.proposals.length, fixture.expect.proposal_count);
    }

    // Ask mode: same naming, the remedy is the mode switch (§16.1).
    {
      const { ctx } = makeCtx(fixture, { mode: "ask" });
      const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, ctx);
      assertEquals(env.meta.note, fixture.expect.error_code);
      assertStringIncludes(String(env.data), fixture.expect.ask_remedy_includes);
    }

    // The model omitted the run id and the project has NO completed run:
    // still an honest dependency_missing, never invalid_params.
    {
      const { ctx } = makeCtx(fixture, { mode: "review" });
      const { scenario_run_id: _dropped, citations: _c, ...rest } = fixture.mocked_llm!.args!;
      const env = await executeTool("draft_decision_report", {
        ...rest,
        citations: [{ kind: "user_message", ref: "thread:t" }],
      }, ctx);
      assertEquals(env.meta.note, "dependency_missing");
      assertStringIncludes(String(env.data), fixture.expect.no_runs_message_includes);
    }

    // Pure helper pinning both remedies (the §16.1 sentences).
    assertStringIncludes(missingRunRefusal("scenario run for this disruption", RUN_RUNNING, "ask"), "Switch this thread to Review");
    assertStringIncludes(missingRunRefusal("scenario run for this disruption", RUN_RUNNING, "review"), "Experiment Designer");
  }));

Deno.test("rb-05: closed template/format vocabulary — unknown template, unknown format, unknown param, missing mandatory narrative", () =>
  withB6Enabled(async () => {
    const fixture = await loadFixture("rb-05-template-vocabulary");
    const { ctx, db } = makeCtx(fixture);

    const unknownTemplate = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, ctx);
    assertEquals(unknownTemplate.meta.note, fixture.expect.error_code);
    assertStringIncludes(String(unknownTemplate.data), fixture.expect.error_includes);

    const badFormat = await executeTool("draft_decision_report", {
      template_id: "run-results", run_id: RUN_BASELINE, format: "docx",
    }, ctx);
    assertEquals(badFormat.meta.note, "invalid_params");

    const unknownParam = await executeTool("draft_decision_report", {
      template_id: "run-results", run_id: RUN_BASELINE, sneaky: true,
    }, ctx);
    assertEquals(unknownParam.meta.note, "invalid_params");

    const missingNarrative = await executeTool("draft_decision_report", {
      template_id: "disruption-brief", scenario_run_id: RUN_SCENARIO, format: "pdf",
    }, ctx);
    assertEquals(missingNarrative.meta.note, "invalid_params");
    assertStringIncludes(String(missingNarrative.data), "narrative_md");

    assertEquals(db.tables.proposals.length, fixture.expect.proposal_count);
  }));

Deno.test("rb-06: render determinism — same spec + same data ⇒ identical XLSX cell values; PDF carries the 'AI-drafted commentary' heading", () =>
  withB6Enabled(async () => {
    const fixture = await loadFixture("rb-06-render-determinism");
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, ctx);
    const stored = storedProposal(db, env);
    const payload = stored.payload as Record<string, unknown>;
    const sections = payload.sections as ReportSectionSpec[];

    // Resolve the SAME spec twice against the SAME data — the workbook model
    // IS the cell values (writers serialize it 1:1), so deep equality is the
    // §16.1 determinism contract.
    const first = await resolveReportSections(db, { projectId: PROJECT, userId: USER }, sections);
    const second = await resolveReportSections(db, { projectId: PROJECT, userId: USER }, sections);
    const bookArgs = { title: String(payload.title), templateId: String(payload.template_id) };
    const bookA = buildWorkbookModel({ ...bookArgs, sections: first });
    const bookB = buildWorkbookModel({ ...bookArgs, sections: second });
    assertEquals(bookA, bookB, "identical XLSX cell values (rb-06)");

    assertEquals(bookA.length, fixture.expect.workbook_sheets);
    assertEquals(bookA[0].name, fixture.expect.overview_sheet);
    assert(bookA.some((s) => s.name === fixture.expect.narrative_sheet),
      "the narrative sheet renders under the explicit AI-drafted heading");
    // No wall-clock values in cells — determinism by construction.
    const year = String(new Date().getFullYear());
    assert(!JSON.stringify(bookA).includes(year), "rendered documents carry no timestamps");

    // Comparison section: sorted KPI union with deterministic deltas.
    const comparison = first.find((s) => s.kind === "run_comparison")!;
    assertEquals(comparison.columns, fixture.expect.comparison_columns);
    assertEquals(comparison.rows.map((r) => r[0]), ["fill_rate", "on_time_delivery", "total_cost"], "sorted KPI keys");
    assertEquals(comparison.rows[0][3], -0.23, "delta = scenario − baseline, computed deterministically");

    // PDF model: the §16.1 transparency heading.
    const pdf = buildPdfModel({ ...bookArgs, sections: first });
    assertEquals(
      pdf.some((b) => b.type === "heading" && b.text === AI_COMMENTARY_HEADING),
      fixture.expect.pdf_has_ai_heading,
    );
  }));

Deno.test("rb-07: apply — render under the §16.2 path law, user_files rows, applied_result {file_ids, paths}; stale run fails typed; flag off refuses", () =>
  withB6Enabled(async () => {
    const fixture = await loadFixture("rb-07-apply-path");
    const exp = fixture.expect.apply;

    // (a) the happy path: PDF ask ⇒ PDF + XLSX data pack, path law, rows.
    {
      const h = makeCtx(fixture);
      const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, h.ctx);
      const stored = storedProposal(h.db, env);
      stored.status = "approved"; // the card's Approve
      stored.reviewed_by = USER;
      const result = await applyDecisionReport(h.db, h.deps, {
        projectId: PROJECT,
        proposalId: String(stored.id),
        payload: stored.payload as Record<string, unknown>,
        userId: USER,
      });
      assertEquals(result.file_ids.length, exp.files);
      assertEquals(result.files.map((f) => f.kind), exp.kinds, "format 'pdf' still ships the XLSX data pack");
      assertEquals(result.template_id, exp.template_id);
      assertEquals(result.format, exp.format);
      for (const path of result.paths) {
        assert(path.startsWith(exp.path_prefix),
          `§16.2 path law (org/user/project) violated: ${path}`);
      }
      assertEquals(h.uploads.map((u) => u.path), result.paths, "every path was uploaded");
      // user_files rows: row id == the <file_id> embedded in the path.
      assertEquals(h.db.tables.user_files.length, exp.files);
      for (const f of result.files) {
        const row = h.db.tables.user_files.find((r) => String(r.id) === f.id);
        assert(row, `user_files row for ${f.id}`);
        assertEquals(row!.path, f.path);
        assertEquals(row!.org_id, ORG);
        assertEquals(row!.proposal_id, stored.id);
        assertStringIncludes(f.path, `/${f.id}__`);
      }
      // §4.4 idempotency rides the proposal: mark applied, re-approve returns
      // the stored result without re-rendering.
      await h.db.rpc("mark_agent_proposal_applied", { p_proposal_id: stored.id, p_result: result });
      const applied = h.db.tables.proposals.find((p) => String(p.id) === String(stored.id))!;
      assertEquals(applied.status, "applied");
      assertEquals((applied.applied_result as { file_ids: string[] }).file_ids, result.file_ids);
    }

    // (b) format 'xlsx' ⇒ the data pack alone.
    {
      const h = makeCtx(fixture);
      const env = await executeTool("draft_decision_report", {
        ...fixture.mocked_llm!.args!, format: "xlsx",
      }, h.ctx);
      const stored = storedProposal(h.db, env);
      stored.status = "approved";
      const result = await applyDecisionReport(h.db, h.deps, {
        projectId: PROJECT, proposalId: String(stored.id),
        payload: stored.payload as Record<string, unknown>, userId: USER,
      });
      assertEquals(result.files.length, fixture.expect.xlsx_only_format_files);
      assertEquals(result.files[0].kind, "report_xlsx");
    }

    // (c) a cited run vanished between draft and apply ⇒ stale_values, nothing stored.
    {
      const h = makeCtx(fixture);
      const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, h.ctx);
      const stored = storedProposal(h.db, env);
      stored.status = "approved";
      h.db.tables.simulation_runs = h.db.tables.simulation_runs.filter((r) => String(r.id) !== RUN_SCENARIO);
      try {
        await applyDecisionReport(h.db, h.deps, {
          projectId: PROJECT, proposalId: String(stored.id),
          payload: stored.payload as Record<string, unknown>, userId: USER,
        });
        throw new Error("expected ApplyFailure");
      } catch (e) {
        assert(e instanceof ApplyFailure, `expected ApplyFailure, got ${e}`);
        assertEquals((e as ApplyFailure).code, fixture.expect.stale_error_code);
        assertStringIncludes((e as ApplyFailure).message, RUN_SCENARIO, "the failure names the vanished run");
      }
      assertEquals(h.uploads.length, 0, "nothing uploaded");
      assertEquals(h.db.tables.user_files.length, 0, "no rows written");
    }

    // (d) FILE_WORKSPACE_ENABLED off ⇒ typed refusal at apply too.
    {
      const h = makeCtx(fixture);
      const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, h.ctx);
      const stored = storedProposal(h.db, env);
      stored.status = "approved";
      Deno.env.delete("FILE_WORKSPACE_ENABLED");
      try {
        await applyDecisionReport(h.db, h.deps, {
          projectId: PROJECT, proposalId: String(stored.id),
          payload: stored.payload as Record<string, unknown>, userId: USER,
        });
        throw new Error("expected ApplyFailure");
      } catch (e) {
        assert(e instanceof ApplyFailure, `expected ApplyFailure, got ${e}`);
        assertStringIncludes((e as ApplyFailure).message, fixture.expect.flag_off_error_includes);
      } finally {
        Deno.env.set("FILE_WORKSPACE_ENABLED", "true");
      }
      assertEquals(h.uploads.length, 0);
    }
  }));

Deno.test("rb-08: ask mode — report-builder is the ONE routable agent; the §13.3 rights row; the 20/day render quota", () =>
  withB6Enabled(async () => {
    const fixture = await loadFixture("rb-08-ask-mode");

    // §15: the allowlist is exactly {report-builder}; every other agent's
    // artifact route is subtracted in an ask thread.
    assertEquals([...ASK_MODE_AGENT_ALLOWLIST], ["report-builder"]);
    for (const agent of AGENT_PRECEDENCE) {
      assertEquals(modeAllowsAgent("ask", agent), agent === "report-builder");
      assertEquals(modeAllowsAgent("review", agent), true);
    }
    const routed = applyModeToRoute({
      route: "artifact", agent_id: "report-builder", intent: "report.build",
      confidence: 0.95, advisory_part: null, artifact_part: "x",
      needs_run: false, cache_checkable: false, short_circuit: null,
    }, "ask");
    assertEquals(routed.blocked, null, "report-builder survives the ask-mode subtraction");
    const blocked = applyModeToRoute({
      route: "artifact", agent_id: "data-steward", intent: "steward.fill_missing",
      confidence: 0.95, advisory_part: null, artifact_part: "x",
      needs_run: false, cache_checkable: false, short_circuit: null,
    }, "ask");
    assertEquals(blocked.decision.route, "advisory");
    assertEquals(blocked.blocked?.agent_id, "data-steward");

    // An ask-mode thread CAN produce the decision_report proposal.
    const { ctx, db } = makeCtx(fixture, { mode: "ask" });
    const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, ctx);
    const stored = storedProposal(db, env);
    assertEquals((stored.payload as Record<string, unknown>).template_id, fixture.expect.proposal.template_id);
    assertEquals(db.tables.proposals.length, fixture.expect.proposal_count);

    // §13.3: agent_proposals + reports, NOT agent_apply, no data_editing.
    assertEquals(ARTIFACT_RIGHTS.decision_report, {
      features: fixture.expect.rights.features,
      pages: fixture.expect.rights.pages,
    });
    assertEquals(ARTIFACT_BASE_FEATURE.decision_report, fixture.expect.rights.base_feature);
    assertEquals(ARTIFACT_BASE_FEATURE.experiment_spec ?? "agent_apply", "agent_apply",
      "every other artifact still rides agent_apply");

    // §10 Q25 quota: the 21st same-day render is denied, per user across
    // projects; another user is untouched.
    assertEquals(REPORT_DAILY_CAP, fixture.expect.daily_cap);
    const today = new Date().toISOString();
    for (let i = 0; i < REPORT_DAILY_CAP; i++) {
      db.tables.proposals.push({
        id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, "0")}`,
        project_id: i % 2 === 0 ? PROJECT : "11111111-1111-4111-8111-111111111112",
        agent_id: "report-builder",
        artifact_type: "decision_report",
        status: "applied",
        reviewed_by: USER,
        applied_at: today,
        applied_result: { file_ids: [] },
      });
    }
    const violation = await checkApplyQuota(db, {
      artifactType: "decision_report", projectId: PROJECT, userId: USER,
    });
    assert(violation, "the 21st render must be denied");
    assertStringIncludes(violation!, String(REPORT_DAILY_CAP));
    assertStringIncludes(violation!, "0 remaining");
    const otherUser = await checkApplyQuota(db, {
      artifactType: "decision_report", projectId: PROJECT,
      userId: "22222222-2222-4222-8222-222222222299",
    });
    assertEquals(otherUser, null, "the quota binds per user");
  }));

Deno.test("flags off ⇒ clean regression: no FILE_WORKSPACE_ENABLED refuses agent_disabled; no roster entry refuses agent_disabled", async () => {
  const fixture = await loadFixture("rb-01-run-results");
  Deno.env.set("AGENT_ENABLED_IDS", "report-builder");
  Deno.env.delete("FILE_WORKSPACE_ENABLED");
  try {
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, ctx);
    assertEquals(env.meta.note, "agent_disabled");
    assertStringIncludes(String(env.data), "FILE_WORKSPACE_ENABLED");
    assertEquals(db.tables.proposals.length, 0);
  } finally {
    Deno.env.delete("AGENT_ENABLED_IDS");
  }
  Deno.env.set("FILE_WORKSPACE_ENABLED", "true");
  Deno.env.delete("AGENT_ENABLED_IDS");
  try {
    const { ctx, db } = makeCtx(fixture);
    const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, ctx);
    assertEquals(env.meta.note, "agent_disabled");
    assertEquals(db.tables.proposals.length, 0);
  } finally {
    Deno.env.delete("FILE_WORKSPACE_ENABLED");
  }
});

Deno.test("agent turn (bridge 1): scripted provider drives the §16.1 loop to a proposal part; least-privilege surface", () =>
  withB6Enabled(async () => {
    const fixture = await loadFixture("rb-01-run-results");
    const { ctx } = makeCtx(fixture);
    Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
    const mock = installFetchMock([
      {
        json: {
          candidates: [{
            content: {
              parts: [{ functionCall: { name: "draft_decision_report", args: fixture.mocked_llm!.args } }],
            },
          }],
        },
      },
      {
        json: {
          candidates: [{
            content: {
              parts: [{ text: "Report spec drafted — approve the card to render the files into your workspace." }],
            },
          }],
        },
      },
    ]);
    try {
      const result = await runAgentTurn({
        agentId: "report-builder",
        modelId: "gemini-2.5-flash",
        utterance: fixture.utterance,
        ctx,
      });
      assert(result.ok, `agent turn failed: ${result.error}`);
      assert(result.proposalPart, "proposal part collected from the tool envelope");
      assertEquals(result.proposalPart!.data.artifact_type, "decision_report");

      const firstCall = mock.calls[0].body as {
        systemInstruction: { parts: Array<{ text: string }> };
        tools: Array<{ functionDeclarations: Array<{ name: string }> }>;
      };
      const system = firstCall.systemInstruction.parts[0].text;
      assertStringIncludes(system, "You are the Report Builder");
      assertStringIncludes(system, "RULES THAT OVERRIDE EVERYTHING ELSE");
      assert(!system.includes("CONVERSATION SUMMARY"), "agent turns never receive the rolling summary");
      assertEquals(
        firstCall.tools[0].functionDeclarations.map((d) => d.name),
        ["get_run_results", "get_data_completeness", "get_supplier_risk", "get_material_risk", "draft_decision_report"],
        "least-privilege tool subset (§16.1)",
      );
    } finally {
      mock.restore();
    }
  }));

Deno.test("prompt template carries the verbatim §16.1 + AGENT_COMMON blocks; the template registry is the five v1 templates; path law helpers", () => {
  const prompt = buildReportPrompt({
    projectId: PROJECT,
    utterance: "write it up",
    mode: "review",
    runsJson: "[]",
    templateCatalog: "- x",
  });
  assertStringIncludes(prompt, "You are the Report Builder, the SuReSuite agent that turns persisted project");
  assertStringIncludes(prompt, "never compute, project, or restate\n  numbers");
  assertStringIncludes(prompt, "call draft_decision_report\n  ONCE");
  assertStringIncludes(prompt, AGENT_COMMON);
  const askPrompt = buildReportPrompt({
    projectId: PROJECT, utterance: "u", mode: "ask", runsJson: "[]", templateCatalog: "- x",
  });
  assertStringIncludes(askPrompt, "switch this\n  thread to Review");

  // §16.1 registry (DEFAULT v1 set) — templates only ever resolve through
  // registered read tools / persisted runs.
  assertEquals([...REPORT_TEMPLATE_IDS], [
    "risk-posture", "run-results", "run-comparison", "disruption-brief", "data-readiness",
  ]);
  assertEquals(REPORT_TEMPLATES["disruption-brief"].narrativeRequired, true);
  assertEquals(REPORT_TEMPLATES["risk-posture"].requiredRuns({}), []);

  // §16.2 path law helpers.
  assertEquals(safeFilename("Supplier S3 — 10-week outage!.pdf"), "Supplier_S3_10-week_outage_.pdf");
  assertEquals(
    workspacePath({ orgId: ORG, userId: USER, projectId: PROJECT, fileId: "f-1", filename: "brief.pdf" }),
    `org/${ORG}/user/${USER}/${PROJECT}/f-1__brief.pdf`,
  );
  assertEquals(
    workspacePath({ orgId: null, userId: USER, projectId: null, fileId: "f-2", filename: "x.xlsx" }),
    `org/none/user/${USER}/shared/f-2__x.xlsx`,
  );

  Deno.env.set("AGENT_ENABLED_IDS", "report-builder");
  Deno.env.set("FILE_WORKSPACE_ENABLED", "true");
  try {
    assertEquals(reportToolDeclarations().length, 5, "no tool beyond the §16.1 surface is declared");
  } finally {
    Deno.env.delete("AGENT_ENABLED_IDS");
    Deno.env.delete("FILE_WORKSPACE_ENABLED");
  }
});

Deno.test("router roster: report-builder sits LAST in precedence (reports consume what every agent produces) with the report intents", () => {
  assertEquals(AGENT_PRECEDENCE[AGENT_PRECEDENCE.length - 1], "report-builder");
  assertEquals(AGENT_ROSTER["report-builder"].intents, ["report.build", "report.export"]);
});

Deno.test("renderDecisionReport (module): upload failure cleans up already-uploaded objects and fails typed", () =>
  withB6Enabled(async () => {
    const fixture = await loadFixture("rb-07-apply-path");
    const h = makeCtx(fixture);
    const env = await executeTool("draft_decision_report", fixture.mocked_llm!.args!, h.ctx);
    const stored = storedProposal(h.db, env);
    let calls = 0;
    const failingDeps: RenderDeps = {
      ...h.deps,
      upload: (path, bytes, contentType) => {
        calls += 1;
        if (calls === 2) return Promise.resolve({ error: { message: "boom" } });
        h.uploads.push({ path, bytes, contentType });
        return Promise.resolve({ error: null });
      },
    };
    try {
      await renderDecisionReport(h.db, failingDeps, {
        projectId: PROJECT, userId: USER, orgId: ORG,
        proposalId: String(stored.id),
        payload: stored.payload as Record<string, unknown>,
      });
      throw new Error("expected RenderFailure");
    } catch (e) {
      assertStringIncludes(String((e as Error).message), "workspace upload failed");
    }
    assertEquals(h.removed, h.uploads.map((u) => u.path), "the orphaned first object was removed");
  }));
