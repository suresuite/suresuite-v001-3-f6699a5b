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

import { MODEL_REGISTRY, resolveModel, runChat, type ModelSpec } from "../providers.ts";
import {
  AGENT_PRECEDENCE,
  buildClassifierPrompt,
  decideRoute,
  makeClassifier,
  parseClassifierResponse,
  type ClassifierCall,
} from "../router.ts";
import { executeTool, type ToolContext, type ToolEnvelope } from "../tools.ts";
// Importing agentTurn.ts registers every staged draft tool (B1-B4 + memory).
import { runAgentTurn, runDataStewardTurn } from "../agentTurn.ts";
import { applyModeToRoute } from "../modes.ts";
import { personaToolDeclarations } from "../personaTools.ts";
import {
  assembleCitations,
  verifyReply,
  type RecordedToolCall,
} from "../verifier.ts";
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
  /** §15 ask-mode fixtures: classified normally, then the mode subtracts at
   * checkpoint 2 — the expected route is post-mode (always advisory). */
  mode?: string;
  expect: { route: string; agent_id: string | null; intent: string | null; blocked_intent?: string | null };
  class: string;
}

interface Fixture {
  id: string;
  project_snapshot: Record<string, Row[]> | { reuse: string; patch?: Record<string, Row[]> };
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

async function loadFixtureFrom(dir: string, id: string): Promise<Fixture> {
  const f: Fixture = JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/${dir}/${id}.json`, import.meta.url)),
  );
  if ("reuse" in f.project_snapshot) {
    const spec = f.project_snapshot as { reuse: string; patch?: Record<string, Row[]> };
    const base = await loadFixtureFrom(dir, spec.reuse);
    f.project_snapshot = {
      ...(base.project_snapshot as Record<string, Row[]>),
      ...(spec.patch ?? {}),
    };
    if (f.mocked_llm && "reuse" in f.mocked_llm) f.mocked_llm = base.mocked_llm;
  }
  return f;
}

const loadFixture = (id: string) => loadFixtureFrom("data-steward", id);

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
    // prompt's USER MESSAGE — validates scoring, never model quality. Ask-mode
    // rows answer with the PRE-mode classification (blocked_intent): the mode
    // filter below is what must turn them advisory.
    const utterance = prompt.slice(prompt.indexOf("USER MESSAGE:") + 14).trim();
    const row = rows.find((r) => r.utterance === utterance);
    if (row?.mode === "ask" && row.expect.blocked_intent) {
      const intent = row.expect.blocked_intent;
      const agent = AGENT_PRECEDENCE.find((a) =>
        intent.startsWith(a === "data-steward" ? "steward" : a === "policy-configurator" ? "policy" : a === "vv-analyst" ? "vv" : a === "experiment-designer" ? "exp" : "explain")
      ) ?? null;
      return Promise.resolve(JSON.stringify({
        route: "artifact", agent_id: agent, intent, confidence: 0.95,
        advisory_part: null, artifact_part: utterance,
      }));
    }
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
    const rawDecision = await decideRoute(row.utterance, {
      personaId: null,
      hasProject: true,
      enabledAgents,
      modelId: model.id,
    }, classifier);
    // §15 ask-mode fixtures: the mode subtracts after classification, exactly
    // as index.ts applies it at checkpoint 2 — the same code path is scored.
    const decision = row.mode === "ask"
      ? applyModeToRoute(rawDecision, "ask").decision
      : rawDecision;

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

// ── B2/B3 fixture evaluation (generic draft-agent runner, §9.3/§9.4) ─────────

interface AgentEvalConfig {
  agentId: "policy-configurator" | "vv-analyst" | "experiment-designer" | "report-builder";
  fixtureDir: string;
  draftTool: string;
  artifactType: string;
  /** Draft-time fixtures only — the apply-path fixtures (pc-08/pc-09/vv-08/
   * ed-07/ed-08) exercise deterministic machinery and stay in the CI tier. */
  fixtures: string[];
}

const AGENT_EVAL: Record<string, AgentEvalConfig> = {
  "policy-configurator": {
    agentId: "policy-configurator",
    fixtureDir: "policy-configurator",
    draftTool: "draft_policy_bundle",
    artifactType: "policy_bundle_diff",
    fixtures: [
      "pc-01-simple-param", "pc-02-family-default", "pc-03-unknown-field",
      "pc-04-planned-policy", "pc-05-data-demand", "pc-06-run-ready",
      "pc-07-no-kpi-claims",
    ],
  },
  "vv-analyst": {
    agentId: "vv-analyst",
    fixtureDir: "vv-analyst",
    draftTool: "draft_model_card_narrative",
    artifactType: "model_card_draft",
    fixtures: [
      "vv-02-adopt-pass", "vv-03-adopt-fail-tests", "vv-04-no-run",
      "vv-05-gate-skipped", "vv-07-adequacy-quote",
    ],
  },
  "experiment-designer": {
    agentId: "experiment-designer",
    fixtureDir: "experiment-designer",
    draftTool: "draft_experiment_spec",
    artifactType: "experiment_spec",
    fixtures: [
      "ed-01-simple-run", "ed-02-new-scenario", "ed-03-no-version",
      "ed-04-doe-honest", "ed-05-ack-forced-false", "ed-06-brief-grounded",
    ],
  },
  "report-builder": {
    agentId: "report-builder",
    fixtureDir: "report-builder",
    draftTool: "draft_decision_report",
    artifactType: "decision_report",
    fixtures: [
      "rb-01-run-results", "rb-02-disruption-brief", "rb-03-citation-required",
      "rb-04-no-evidence-run", "rb-05-template-vocabulary",
    ],
  },
};

// deno-lint-ignore no-explicit-any
function scoreAgentOutcome(cfg: AgentEvalConfig, proposals: Row[], exp: Record<string, any>): { pass: boolean; detail: string } {
  if (exp.error_code || exp.proposal_count === 0) {
    return proposals.length === 0
      ? { pass: true, detail: "ok" }
      : { pass: false, detail: `expected a refusal (${exp.error_code ?? "no proposal"}), got ${proposals.length} proposal(s)` };
  }
  if (!exp.proposal) return { pass: true, detail: "ok" };
  const p = proposals[0];
  if (!p) return { pass: false, detail: "expected a proposal, none created" };
  const payload = p.payload as Record<string, unknown>;
  if (cfg.agentId === "policy-configurator") {
    const diff = (payload.diff ?? {}) as { defaults?: Record<string, unknown>; overrides?: unknown[] };
    if (exp.proposal.overrides !== undefined && (diff.overrides ?? []).length !== exp.proposal.overrides) {
      return { pass: false, detail: `expected ${exp.proposal.overrides} overrides, got ${(diff.overrides ?? []).length}` };
    }
    if (exp.proposal.defaults_families &&
        JSON.stringify(Object.keys(diff.defaults ?? {}).sort()) !== JSON.stringify([...exp.proposal.defaults_families].sort())) {
      return { pass: false, detail: `defaults families mismatch: ${Object.keys(diff.defaults ?? {})}` };
    }
    if (exp.proposal.newly_required_includes &&
        !((payload.newly_required as string[]) ?? []).includes(exp.proposal.newly_required_includes)) {
      return { pass: false, detail: `newly_required missing ${exp.proposal.newly_required_includes}` };
    }
  } else if (cfg.agentId === "report-builder") {
    if (exp.proposal.template_id && payload.template_id !== exp.proposal.template_id) {
      return { pass: false, detail: `expected template ${exp.proposal.template_id}, got ${payload.template_id}` };
    }
    if (exp.proposal.format && payload.format !== exp.proposal.format) {
      return { pass: false, detail: `expected format ${exp.proposal.format}, got ${payload.format}` };
    }
    if (exp.proposal.sections !== undefined &&
        ((payload.sections as unknown[]) ?? []).length !== exp.proposal.sections) {
      return { pass: false, detail: `expected ${exp.proposal.sections} sections, got ${((payload.sections as unknown[]) ?? []).length}` };
    }
    if (exp.proposal.narrative_cited) {
      const narrative = ((payload.sections as Array<{ kind: string; citations?: unknown[] }>) ?? [])
        .find((s) => s.kind === "narrative");
      if (!narrative || !Array.isArray(narrative.citations) || narrative.citations.length === 0) {
        return { pass: false, detail: "narrative section missing or uncited (§4.3 citation-mandatory)" };
      }
    }
  } else if (cfg.agentId === "experiment-designer") {
    if (exp.proposal.replications !== undefined && payload.replications !== exp.proposal.replications) {
      return { pass: false, detail: `expected ${exp.proposal.replications} replications, got ${payload.replications}` };
    }
    if (exp.proposal.acknowledge_warnings !== undefined &&
        payload.acknowledge_warnings !== exp.proposal.acknowledge_warnings) {
      return { pass: false, detail: `acknowledge_warnings must be ${exp.proposal.acknowledge_warnings} (§5.4 forced-false rule)` };
    }
    if (exp.proposal.scenario_id && payload.scenario_id !== exp.proposal.scenario_id) {
      return { pass: false, detail: `expected scenario ${exp.proposal.scenario_id}, got ${payload.scenario_id}` };
    }
    if (exp.proposal.new_scenario_name &&
        (payload.new_scenario as { name?: string } | undefined)?.name !== exp.proposal.new_scenario_name) {
      return { pass: false, detail: `expected new scenario "${exp.proposal.new_scenario_name}"` };
    }
    if (exp.proposal.grounding_policy_hash &&
        (p.grounding as Record<string, unknown> | null)?.policy_hash !== exp.proposal.grounding_policy_hash) {
      return { pass: false, detail: `grounding.policy_hash must bind the version's hash` };
    }
  } else {
    if (exp.proposal.verdict && payload.verdict !== exp.proposal.verdict) {
      return { pass: false, detail: `expected verdict ${exp.proposal.verdict}, got ${payload.verdict}` };
    }
    if (exp.proposal.basis && payload.basis !== exp.proposal.basis) {
      return { pass: false, detail: `expected basis ${exp.proposal.basis}, got ${payload.basis}` };
    }
  }
  if (exp.proposal.provenance && p.provenance !== exp.proposal.provenance) {
    return { pass: false, detail: `expected provenance ${exp.proposal.provenance}, got ${p.provenance}` };
  }
  return { pass: true, detail: "ok" };
}

async function evalAgent(cfg: AgentEvalConfig, model: ModelSpec, mock: boolean): Promise<StewardMetrics> {
  Deno.env.set("AGENT_ENABLED_IDS", cfg.agentId);
  // §9.5: the single-run subset rides its own flag beside the roster switch.
  if (cfg.agentId === "experiment-designer") Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
  // §16.2: B6 requires the workspace flag beside the roster switch.
  if (cfg.agentId === "report-builder") Deno.env.set("FILE_WORKSPACE_ENABLED", "true");
  const fixtures: StewardMetrics["fixtures"] = {};
  let draftCalls = 0, validDraftCalls = 0;

  for (const id of cfg.fixtures) {
    const fixture = await loadFixtureFrom(cfg.fixtureDir, id);
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

    let reply = "";
    if (mock) {
      // offline: exercise the pipeline with the fixture's mocked args (the
      // adversarial fixtures inject deliberately bad args to prove the gate
      // catches them; they score the outcome, not model schema validity).
      if (fixture.mocked_llm?.args) {
        const env = await executeTool(cfg.draftTool, fixture.mocked_llm.args, ctx);
        if (fixture.expect.proposal) {
          draftCalls++;
          if (env.kind === "proposal") validDraftCalls++;
        }
      }
    } else {
      const turn = await runAgentTurn({ agentId: cfg.agentId, modelId: model.id, utterance: fixture.utterance, ctx });
      reply = turn.reply;
      for (const call of turn.toolCalls) {
        if (call.name !== cfg.draftTool) continue;
        draftCalls++;
        if (call.row_count > 0) validDraftCalls++;
      }
    }

    const outcome = scoreAgentOutcome(cfg, tables.proposals ?? [], fixture.expect);
    let { pass, detail } = outcome;
    // Reply-level assertions (e.g. pc-07's no-KPI-prediction regex) apply only
    // to real model output.
    if (!mock && pass && Array.isArray(fixture.expect.reply_assertions)) {
      for (const re of fixture.expect.reply_assertions as string[]) {
        if (!new RegExp(re, "is").test(reply)) {
          pass = false;
          detail = `reply failed assertion ${re}`;
          break;
        }
      }
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

// ── coverage battery + fabrication metric (§7.7-1, §19.7; Phase H1) ──────────
//
// Runs the §19.2 battery per model with COVERAGE_TOOLS_ENABLED +
// VERIFIER_ENABLED (the H1 configuration): a real persona turn over the
// fixture's stub project, then the SAME verifier module the runtime uses is
// applied to the RAW reply. Fabrications (layer-1 entity/number violations)
// target 0 — a single fabrication fails the run and blocks any flag flip.
// The nightly judge (§7.7) scores prose faithfulness on the same replies —
// scoring only, NEVER a gate (§12.2 posture).

const COVERAGE_BATTERY = [
  "cov-01-supplier-materials",
  "cov-02-material-suppliers",
  "cov-03-bom-both-directions",
  "cov-04-disambiguation",
  "cov-05-count-not-list",
  "cov-06-policy-read",
  "cov-07-readiness",
  "cov-08-run-results",
  "cov-09-no-data-honesty",
];

// The §7.7 nightly-judge prompt (verbatim). Executed with the deployment's
// DEFAULT model at temperature 0, structured output; malformed output is
// recorded judge_error and never counted as faithful.
const JUDGE_PROMPT = `You are a verification judge for a supply-chain assistant. You will be given
TOOL RESULTS (the only facts available) and a REPLY. Judge ONLY whether the
reply is faithful to the tool results. Rules:
- A claim is UNSUPPORTED if it states an entity, number, relationship, cause,
  or outcome that the tool results do not contain. Paraphrase is fine;
  extrapolation is not.
- Honest refusals and offers of nearest grounded actions are FAITHFUL.
- Ignore style. Do not judge helpfulness. Do not use outside knowledge.
Reply with ONLY this JSON:
{"faithful": true|false,
 "unsupported_claims": ["<verbatim quote from the reply>", ...],
 "hedged_correctly": true|false,
 "notes": "<= 200 chars"}

TOOL RESULTS:
{{tool_results_json}}

REPLY:
{{reply_text}}`;

interface JudgeVerdict {
  faithful: boolean;
  unsupported_claims: string[];
  hedged_correctly: boolean;
  notes: string;
}

async function judgeReply(
  toolResultsJson: string,
  replyText: string,
): Promise<JudgeVerdict | "judge_error" | "judge_unavailable"> {
  const judge = resolveModel(null); // the deployment default model
  const key = Deno.env.get(keyFor(judge.provider));
  if (!key || judge.provider !== "gemini") return "judge_unavailable";
  const prompt = JUDGE_PROMPT
    .replace("{{tool_results_json}}", toolResultsJson.slice(0, 48_000))
    .replace("{{reply_text}}", replyText.slice(0, 8_000));
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${judge.apiModel}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );
    if (!res.ok) return "judge_error";
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    const parsed = JSON.parse(text);
    if (typeof parsed?.faithful !== "boolean" || !Array.isArray(parsed?.unsupported_claims)) return "judge_error";
    return parsed as JudgeVerdict;
  } catch {
    return "judge_error";
  }
}

interface CoverageMetrics {
  model: string;
  battery: Record<string, { pass: boolean; detail: string; fabrications: number }>;
  fabrications: number;
  layer2Violations: number;
  judgedFaithful: number;
  judged: number;
  judgeErrors: number;
  judgeDisagreements: string[];
  pass: boolean;
  failures: string[];
}

async function evalCoverage(model: ModelSpec, mock: boolean): Promise<CoverageMetrics> {
  Deno.env.set("COVERAGE_TOOLS_ENABLED", "true");
  Deno.env.set("VERIFIER_ENABLED", "true");
  const battery: CoverageMetrics["battery"] = {};
  let fabrications = 0;
  let layer2Violations = 0;
  let judgedFaithful = 0, judged = 0, judgeErrors = 0;
  const judgeDisagreements: string[] = [];

  try {
    for (const id of COVERAGE_BATTERY) {
      const fixture = await loadFixtureFrom("coverage", id);
      const tables = structuredClone(fixture.project_snapshot) as Record<string, Row[]>;
      const db = makeStubDb(tables, makeAgentRpcs(tables));
      const ctx: ToolContext = {
        projectId: PROJECT,
        userId: USER,
        supabase: db as unknown as ToolContext["supabase"],
      };
      // deno-lint-ignore no-explicit-any
      const exp = fixture.expect as Record<string, any>;

      if (mock) {
        // Offline runner validation: the fixture's mocked tool args exercise
        // the real handlers; planted replies must be caught by the verifier,
        // clean replies must pass. Never flag-flip evidence.
        let pass = true;
        let detail = "ok";
        if (fixture.mocked_llm?.args && exp.tool) {
          const env = await executeTool(exp.tool, fixture.mocked_llm.args, ctx);
          const calls: RecordedToolCall[] = [{ name: exp.tool, args: fixture.mocked_llm.args, envelope: env }];
          const { citations, toolCallRefs } = await assembleCitations(calls);
          if (exp.planted_reply) {
            const caught = await verifyReply({
              reply: exp.planted_reply, calls, citations,
              userMessage: fixture.utterance, projectId: PROJECT, db, toolCallRefs,
            });
            if (caught.ok) { pass = false; detail = "planted reply escaped the verifier"; }
          }
          if (pass && (exp.clean_reply || exp.bounded_refusal_reply || exp.honest_reply)) {
            const clean = await verifyReply({
              reply: exp.clean_reply ?? exp.bounded_refusal_reply ?? exp.honest_reply,
              calls, citations,
              userMessage: fixture.utterance, projectId: PROJECT, db, toolCallRefs,
            });
            if (!clean.ok) { pass = false; detail = `clean reply flagged: ${JSON.stringify(clean.violations)}`; }
          }
        }
        battery[id] = { pass, detail, fabrications: 0 };
        continue;
      }

      // Live: one real persona turn over the stub project with the H1 tool
      // surface, then the runtime verifier module on the RAW reply.
      const calls: RecordedToolCall[] = [];
      let pass = true;
      let detail = "ok";
      let fixtureFabrications = 0;
      try {
        const result = await runChat(model.id, fixture.utterance, [], ctx, null, {
          tools: personaToolDeclarations(),
          onToolResult: (name: string, args: Record<string, unknown>, envelope: ToolEnvelope) => {
            calls.push({ name, args, envelope });
          },
        });
        const { citations, toolCallRefs } = await assembleCitations(calls);
        const verdict = await verifyReply({
          reply: result.reply ?? "", calls, citations,
          userMessage: fixture.utterance, projectId: PROJECT, db, toolCallRefs,
        });
        fixtureFabrications = verdict.violations.filter((v) => v.class === "entity" || v.class === "number").length;
        fabrications += fixtureFabrications;
        layer2Violations += verdict.violations.length - fixtureFabrications;
        if (fixtureFabrications > 0) {
          pass = false;
          detail = `fabricated: ${verdict.violations.filter((v) => v.class === "entity" || v.class === "number").map((v) => v.token).join(", ")}`;
        }
        // Fixture-level reply assertions (§7.7-1: forbidden = any id absent
        // from that turn's tool results — the pinned patterns say it twice).
        if (pass && Array.isArray(exp.forbidden_reply_patterns)) {
          const returned = JSON.stringify(calls.map((c) => c.envelope.data));
          for (const bad of exp.forbidden_reply_patterns as string[]) {
            if ((result.reply ?? "").includes(bad) && !returned.includes(bad)) {
              pass = false;
              detail = `forbidden id in reply: ${bad}`;
              break;
            }
          }
        }
        if (pass && Array.isArray(exp.reply_assertions)) {
          for (const re of exp.reply_assertions as string[]) {
            if (!new RegExp(re, "is").test(result.reply ?? "")) {
              pass = false;
              detail = `reply failed assertion ${re}`;
              break;
            }
          }
        }
        // Nightly judge (scoring only — never a gate).
        const j = await judgeReply(JSON.stringify(calls.map((c) => c.envelope)), result.reply ?? "");
        if (j === "judge_error") judgeErrors++;
        else if (j !== "judge_unavailable") {
          judged++;
          if (j.faithful) judgedFaithful++;
          if (j.faithful && fixtureFabrications > 0) {
            judgeDisagreements.push(`${id}: judge faithful=true but verifier found ${fixtureFabrications} fabrication(s)`);
          }
        }
      } catch (e) {
        pass = false;
        detail = `turn failed: ${e instanceof Error ? e.message : e}`;
      }
      battery[id] = { pass, detail, fabrications: fixtureFabrications };
    }
  } finally {
    Deno.env.delete("COVERAGE_TOOLS_ENABLED");
    Deno.env.delete("VERIFIER_ENABLED");
  }

  const failures: string[] = [];
  if (fabrications > 0) failures.push(`entity-fabrication count ${fabrications} > 0 (target 0 — a single fabrication fails the run)`);
  for (const [id, r] of Object.entries(battery)) {
    if (!r.pass) failures.push(`${id}: ${r.detail}`);
  }
  return {
    model: model.id,
    battery,
    fabrications,
    layer2Violations,
    judgedFaithful,
    judged,
    judgeErrors,
    judgeDisagreements,
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
  if (agents.includes("experiment-designer")) Deno.env.set("AGENT_EXPERIMENT_TYPES", "single");
  if (agents.includes("report-builder")) Deno.env.set("FILE_WORKSPACE_ENABLED", "true");

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
    agents: [] as unknown[],
    coverage: [] as unknown[],
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

    // Stage 2/3 agents (§9.3/§9.4): score every enabled agent's suite.
    const agentResults: Record<string, boolean> = {};
    for (const agentId of agents) {
      const cfg = AGENT_EVAL[agentId];
      if (!cfg) continue;
      const metrics = await evalAgent(cfg, model, mock);
      (report.agents as unknown[]).push({ agent: agentId, ...metrics });
      agentResults[agentId] = metrics.pass;
      console.log(`${agentId}: ${metrics.pass ? "PASS" : "FAIL"} — ` +
        `schema-validity=${metrics.schemaValidity.toFixed(3)} ` +
        `gate-violation-attempts=${metrics.gateViolationRate.toFixed(3)} ` +
        `fixtures=${Object.values(metrics.fixtures).filter((f) => f.pass).length}/${Object.keys(metrics.fixtures).length}`);
      for (const f of metrics.failures) console.log(`  ✗ ${f}`);
    }

    // H1 (§7.7-1): the coverage battery + entity-fabrication metric (target
    // 0; one fabrication fails the run) + the nightly judge (scoring only).
    const coverage = await evalCoverage(model, mock);
    (report.coverage as unknown[]).push(coverage);
    console.log(`coverage: ${coverage.pass ? "PASS" : "FAIL"} — ` +
      `fabrications=${coverage.fabrications} (target 0) ` +
      `battery=${Object.values(coverage.battery).filter((f) => f.pass).length}/${Object.keys(coverage.battery).length}` +
      (coverage.judged > 0
        ? ` judged-faithful=${(coverage.judgedFaithful / coverage.judged).toFixed(3)} (informational)`
        : mock ? "" : " judge=unavailable"));
    for (const f of coverage.failures) console.log(`  ✗ ${f}`);
    for (const d of coverage.judgeDisagreements) console.log(`  ⚠ triage (§7.3): ${d}`);

    const modelPass = routing.pass && (steward?.pass ?? true) &&
      Object.values(agentResults).every(Boolean) && coverage.pass;
    allPass = allPass && modelPass;
    await recordToEvents(runId, {
      eval: "model-scored",
      mode: mock ? "mock" : "model",
      model: model.id,
      routing_pass: routing.pass,
      steward_pass: steward?.pass ?? null,
      agent_pass: agentResults,
      advisory_false_artifact: routing.advisoryFalseArtifactRate,
      mixed_recall: routing.mixedRecall,
      schema_validity: steward?.schemaValidity ?? null,
      coverage_pass: coverage.pass,
      fabrications: coverage.fabrications,
      judged_faithful_rate: coverage.judged > 0 ? coverage.judgedFaithful / coverage.judged : null,
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
