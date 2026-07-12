// Model-scored eval tier — nightly + before any flag flip (ai-agents.md §7.4
// tier 2, §6.5). Executes the routing golden set and every ENABLED agent's
// fixtures against the default model plus every other enabled model, scores:
//
//   * router targets (per enabled artifact class): precision ≥ 0.90,
//     recall ≥ 0.85; advisory false-artifact rate ≤ 3%; mixed recall ≥ 0.70
//   * draft schema-validity rate ≥ 0.95 (draft tool calls that produced a
//     proposal envelope vs rejected attempts)
//   * gate-violation attempts ≤ 10% (violations are CAUGHT by construction —
//     this measures how often the model attempts one)
//   * fixture outcome pass rate (expected proposal shape / refusal honored)
//
// Results are printed as a report, optionally written to --out=<file>, and —
// when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set — recorded into
// ai_chat_events with thread_id 'eval:<run-id>' (§7.4). Exit code 1 when any
// target is missed, so CI can gate a flag flip on this run.
//
// Usage (from this directory, so eval/deno.json applies):
//   deno run --allow-env --allow-read --allow-write --allow-net run_model_eval.ts \
//     [--models=gemini-2.5-flash,gpt-5] [--agents=data-steward] [--mock] [--out=report.json]
//
// --mock runs fully offline (oracle classifier + the fixtures' mocked args):
// it validates the RUNNER and the deterministic gates, and its report is
// stamped "mode":"mock" — a mock run is NEVER evidence for a flag flip.

import { MODEL_REGISTRY, type ModelSpec } from "../providers.ts";
import {
  AGENT_PRECEDENCE,
  buildClassifierPrompt,
  decideRoute,
  makeClassifier,
  parseClassifierResponse,
  type ClassifierCall,
} from "../router.ts";
import { executeTool, type ToolContext } from "../tools.ts";
import "../draftTools.ts";
import { runDataStewardTurn } from "../agentTurn.ts";
import { makeAgentRpcs, makeStubDb, type Row } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

// §6.5 targets
const TARGETS = {
  precision: 0.90,
  recall: 0.85,
  advisoryFalseArtifact: 0.03,
  mixedRecall: 0.70,
  schemaValidity: 0.95,
  gateViolationAlarm: 0.10,
};

interface GoldenRow {
  id: string;
  utterance: string;
  expect: { route: string; agent_id: string | null; intent: string | null };
  class: string;
}

interface Fixture {
  id: string;
  project_snapshot: Record<string, Row[]> | { reuse: string };
  utterance: string;
  mocked_llm?: { args?: Record<string, unknown>; reuse?: string };
  // deno-lint-ignore no-explicit-any
  expect: Record<string, any>;
}

function parseArgs(): { models: string[] | null; agents: string[]; mock: boolean; out: string | null } {
  let models: string[] | null = null;
  let agents = ["data-steward"];
  let mock = false;
  let out: string | null = null;
  for (const a of Deno.args) {
    if (a.startsWith("--models=")) models = a.slice(9).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--agents=")) agents = a.slice(9).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--mock") mock = true;
    else if (a.startsWith("--out=")) out = a.slice(6);
  }
  return { models, agents, mock, out };
}

function keyFor(provider: ModelSpec["provider"]): string {
  return provider === "gemini" ? "GEMINI_API_KEY" : provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY";
}

async function loadFixture(id: string): Promise<Fixture> {
  const f: Fixture = JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/data-steward/${id}.json`, import.meta.url)),
  );
  if ("reuse" in f.project_snapshot) {
    const base = await loadFixture((f.project_snapshot as { reuse: string }).reuse);
    f.project_snapshot = base.project_snapshot;
    if (f.mocked_llm && "reuse" in f.mocked_llm) f.mocked_llm = base.mocked_llm;
  }
  return f;
}

// ── routing evaluation ────────────────────────────────────────────────────────

interface RouteMetrics {
  model: string;
  n: number;
  perClass: Record<string, { tp: number; fp: number; fn: number; precision: number; recall: number }>;
  advisoryFalseArtifactRate: number;
  mixedRecall: number;
  pass: boolean;
  failures: string[];
}

async function evalRouting(
  rows: GoldenRow[],
  model: ModelSpec,
  enabledAgents: string[],
  mock: boolean,
): Promise<RouteMetrics> {
  Deno.env.set("AGENT_ROUTER_ENABLED", "true");
  const oracle: ClassifierCall = (prompt) => {
    // mock mode: an oracle answering from the golden label embedded in the
    // prompt's USER MESSAGE — validates scoring, never model quality.
    const utterance = prompt.slice(prompt.indexOf("USER MESSAGE:") + 14).trim();
    const row = rows.find((r) => r.utterance === utterance);
    const e = row?.expect ?? { route: "advisory", agent_id: null, intent: null };
    return Promise.resolve(JSON.stringify({
      route: e.route,
      agent_id: e.agent_id,
      intent: e.intent,
      confidence: 0.95,
      advisory_part: e.route === "mixed" ? "question part" : null,
      artifact_part: e.route === "mixed" || e.route === "artifact" ? utterance : null,
    }));
  };
  const classifier = mock ? oracle : makeClassifier(model);
  if (!classifier) throw new Error(`no API key for ${model.provider} (${keyFor(model.provider)})`);

  const perClass: RouteMetrics["perClass"] = {};
  for (const a of enabledAgents) perClass[a] = { tp: 0, fp: 0, fn: 0, precision: 1, recall: 1 };
  let advisoryN = 0, advisoryFalse = 0, mixedN = 0, mixedHit = 0;

  for (const row of rows) {
    const enabledExpected = row.expect.agent_id !== null && enabledAgents.includes(row.expect.agent_id)
      ? row.expect
      : { route: "advisory", agent_id: null, intent: null };
    const decision = await decideRoute(row.utterance, {
      personaId: null,
      hasProject: true,
      enabledAgents,
      modelId: model.id,
    }, classifier);

    // per-enabled-class precision/recall over the routed owner
    for (const a of enabledAgents) {
      const expected = enabledExpected.agent_id === a;
      const got = decision.agent_id === a && (decision.route === "artifact" || decision.route === "mixed");
      if (expected && got) perClass[a].tp++;
      else if (!expected && got) perClass[a].fp++;
      else if (expected && !got) perClass[a].fn++;
    }
    if (enabledExpected.route === "advisory") {
      advisoryN++;
      if (decision.route !== "advisory") advisoryFalse++;
    }
    if (enabledExpected.route === "mixed") {
      mixedN++;
      if (decision.route === "mixed") mixedHit++;
    }
  }

  const failures: string[] = [];
  for (const [a, m] of Object.entries(perClass)) {
    m.precision = m.tp + m.fp === 0 ? 1 : m.tp / (m.tp + m.fp);
    m.recall = m.tp + m.fn === 0 ? 1 : m.tp / (m.tp + m.fn);
    if (m.precision < TARGETS.precision) failures.push(`${a} precision ${m.precision.toFixed(3)} < ${TARGETS.precision}`);
    if (m.recall < TARGETS.recall) failures.push(`${a} recall ${m.recall.toFixed(3)} < ${TARGETS.recall}`);
  }
  const advisoryFalseArtifactRate = advisoryN === 0 ? 0 : advisoryFalse / advisoryN;
  if (advisoryFalseArtifactRate > TARGETS.advisoryFalseArtifact) {
    failures.push(`advisory false-artifact rate ${advisoryFalseArtifactRate.toFixed(3)} > ${TARGETS.advisoryFalseArtifact}`);
  }
  const mixedRecall = mixedN === 0 ? 1 : mixedHit / mixedN;
  if (mixedRecall < TARGETS.mixedRecall) failures.push(`mixed recall ${mixedRecall.toFixed(3)} < ${TARGETS.mixedRecall}`);

  return {
    model: model.id,
    n: rows.length,
    perClass,
    advisoryFalseArtifactRate,
    mixedRecall,
    pass: failures.length === 0,
    failures,
  };
}

// ── B1 fixture evaluation ─────────────────────────────────────────────────────

interface StewardMetrics {
  model: string;
  fixtures: Record<string, { pass: boolean; detail: string }>;
  draftCalls: number;
  validDraftCalls: number;
  schemaValidity: number;
  gateViolationRate: number;
  pass: boolean;
  failures: string[];
}

const STEWARD_FIXTURES = [
  "ds-01-fill-costs", "ds-02-no-source", "ds-03-user-value", "ds-04-enum-guard",
  "ds-05-mixed", "ds-06-scope", "ds-07-idempotent", "ds-08-injection",
];

async function evalSteward(model: ModelSpec, mock: boolean): Promise<StewardMetrics> {
  Deno.env.set("AGENT_ENABLED_IDS", "data-steward");
  const fixtures: StewardMetrics["fixtures"] = {};
  let draftCalls = 0, validDraftCalls = 0;

  for (const id of STEWARD_FIXTURES) {
    const fixture = await loadFixture(id);
    const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
    const db = makeStubDb(tables, makeAgentRpcs(tables));
    const ctx: ToolContext = {
      projectId: PROJECT,
      userId: USER,
      supabase: db as unknown as ToolContext["supabase"],
      draft: {
        userEmail: "eval@example.com",
        threadId: null,
        modelCode: model.id,
        providerCode: model.provider,
        canProposals: true,
        utterance: fixture.utterance,
      },
    };

    if (mock) {
      // offline: exercise the pipeline with the fixture's mocked args. The
      // adversarial fixtures (expected error codes) inject DELIBERATELY bad
      // args to prove the gate catches them — they score the fixture outcome
      // but are excluded from the model-behavior schema-validity metric.
      if (fixture.mocked_llm?.args) {
        const env = await executeTool("draft_item_master_update", fixture.mocked_llm.args, ctx);
        if (fixture.expect.proposal) {
          draftCalls++;
          if (env.kind === "proposal") validDraftCalls++;
        }
      }
    } else {
      const turn = await runDataStewardTurn({ modelId: model.id, utterance: fixture.utterance, ctx });
      for (const call of turn.toolCalls) {
        if (call.name !== "draft_item_master_update") continue;
        draftCalls++;
        if (call.row_count > 0) validDraftCalls++;
      }
    }

    // Outcome scoring against the fixture's expected shape.
    const proposals = tables.proposals ?? [];
    const exp = fixture.expect;
    let pass = true;
    let detail = "ok";
    if (exp.proposal) {
      const p = proposals[0];
      if (!p) {
        pass = false;
        detail = "expected a proposal, none created";
      } else {
        const rows = (p.payload as { rows: Array<Record<string, unknown>> }).rows;
        if (exp.proposal.rows && rows.length !== exp.proposal.rows) {
          pass = false;
          detail = `expected ${exp.proposal.rows} rows, got ${rows.length}`;
        } else if (exp.proposal.provenance && p.provenance !== exp.proposal.provenance) {
          pass = false;
          detail = `expected provenance ${exp.proposal.provenance}, got ${p.provenance}`;
        } else if (exp.proposal.no_zero_values && rows.some((r) => r.value === 0)) {
          pass = false;
          detail = "a zero value leaked into the proposal";
        }
      }
    }
    if (exp.proposal_count !== undefined && proposals.length !== exp.proposal_count) {
      pass = false;
      detail = `expected ${exp.proposal_count} proposals, got ${proposals.length}`;
    }
    fixtures[id] = { pass, detail };
  }

  const schemaValidity = draftCalls === 0 ? 1 : validDraftCalls / draftCalls;
  const gateViolationRate = draftCalls === 0 ? 0 : (draftCalls - validDraftCalls) / draftCalls;
  const failures: string[] = [];
  if (schemaValidity < TARGETS.schemaValidity) {
    failures.push(`schema validity ${schemaValidity.toFixed(3)} < ${TARGETS.schemaValidity}`);
  }
  if (gateViolationRate > TARGETS.gateViolationAlarm) {
    failures.push(`gate-violation attempts ${gateViolationRate.toFixed(3)} > ${TARGETS.gateViolationAlarm}`);
  }
  for (const [id, r] of Object.entries(fixtures)) {
    if (!r.pass) failures.push(`${id}: ${r.detail}`);
  }
  return {
    model: model.id,
    fixtures,
    draftCalls,
    validDraftCalls,
    schemaValidity,
    gateViolationRate,
    pass: failures.length === 0,
    failures,
  };
}

// ── result recording (§7.4: rows land in ai_chat_events, thread 'eval:<id>') ──

async function recordToEvents(runId: string, payload: Record<string, unknown>): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    const res = await fetch(`${url}/rest/v1/ai_chat_events`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ event_kind: "chat.reply", thread_id: `eval:${runId}`, payload }),
    });
    if (!res.ok) console.warn(`[model-eval] event insert failed (${res.status})`);
  } catch (e) {
    console.warn("[model-eval] event insert failed:", e instanceof Error ? e.message : e);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const { models: modelArg, agents, mock, out } = parseArgs();
  const runId = crypto.randomUUID().slice(0, 8);

  const candidates = modelArg ?? Object.keys(MODEL_REGISTRY);
  const models: ModelSpec[] = [];
  for (const id of candidates) {
    const spec = MODEL_REGISTRY[id];
    if (!spec) {
      console.error(`unknown model id: ${id}`);
      Deno.exit(2);
    }
    if (!mock && !Deno.env.get(keyFor(spec.provider))) {
      console.warn(`skipping ${id}: ${keyFor(spec.provider)} not configured`);
      continue;
    }
    models.push(spec);
  }
  if (models.length === 0) {
    console.error(mock ? "no models selected" : "no provider keys configured — nothing to score (use --mock to exercise the runner offline)");
    Deno.exit(2);
  }
  for (const a of agents) {
    if (!(AGENT_PRECEDENCE as readonly string[]).includes(a)) {
      console.error(`unknown agent: ${a}`);
      Deno.exit(2);
    }
  }
  Deno.env.set("AGENT_ENABLED_IDS", agents.join(","));

  const goldenText = await Deno.readTextFile(new URL("./routing.golden.jsonl", import.meta.url));
  const goldenRows: GoldenRow[] = goldenText.trim().split("\n").map((l) => JSON.parse(l));

  // sanity: the verbatim prompt builder and parser round-trip (mock oracle path)
  parseClassifierResponse(JSON.stringify({ route: "advisory", agent_id: null, intent: null, confidence: 1 }));
  buildClassifierPrompt("smoke", agents);

  const report: Record<string, unknown> = {
    run_id: runId,
    mode: mock ? "mock" : "model",
    started_at: new Date().toISOString(),
    enabled_agents: agents,
    models: models.map((m) => m.id),
    routing: [] as unknown[],
    steward: [] as unknown[],
  };

  let allPass = true;
  for (const model of models) {
    console.log(`\n── ${model.id} (${mock ? "MOCK" : "live"}) ──`);
    const routing = await evalRouting(goldenRows, model, agents, mock);
    (report.routing as unknown[]).push(routing);
    console.log(`routing: ${routing.pass ? "PASS" : "FAIL"} — ` +
      Object.entries(routing.perClass).map(([a, m]) =>
        `${a} P=${m.precision.toFixed(3)} R=${m.recall.toFixed(3)}`).join("; ") +
      `; advisory-false-artifact=${routing.advisoryFalseArtifactRate.toFixed(3)}` +
      `; mixed-recall=${routing.mixedRecall.toFixed(3)}`);
    for (const f of routing.failures) console.log(`  ✗ ${f}`);

    let steward: StewardMetrics | null = null;
    if (agents.includes("data-steward")) {
      steward = await evalSteward(model, mock);
      (report.steward as unknown[]).push(steward);
      console.log(`data-steward: ${steward.pass ? "PASS" : "FAIL"} — ` +
        `schema-validity=${steward.schemaValidity.toFixed(3)} ` +
        `gate-violation-attempts=${steward.gateViolationRate.toFixed(3)} ` +
        `fixtures=${Object.values(steward.fixtures).filter((f) => f.pass).length}/${Object.keys(steward.fixtures).length}`);
      for (const f of steward.failures) console.log(`  ✗ ${f}`);
    }

    const modelPass = routing.pass && (steward?.pass ?? true);
    allPass = allPass && modelPass;
    await recordToEvents(runId, {
      eval: "model-scored",
      mode: mock ? "mock" : "model",
      model: model.id,
      routing_pass: routing.pass,
      steward_pass: steward?.pass ?? null,
      advisory_false_artifact: routing.advisoryFalseArtifactRate,
      mixed_recall: routing.mixedRecall,
      schema_validity: steward?.schemaValidity ?? null,
    });
  }

  report.pass = allPass;
  report.finished_at = new Date().toISOString();
  if (out) {
    await Deno.writeTextFile(out, JSON.stringify(report, null, 2));
    console.log(`\nreport written to ${out}`);
  }
  console.log(`\n${mock ? "[MOCK RUN — not flag-flip evidence] " : ""}overall: ${allPass ? "PASS" : "FAIL"}`);
  Deno.exit(allPass ? 0 : 1);
}
