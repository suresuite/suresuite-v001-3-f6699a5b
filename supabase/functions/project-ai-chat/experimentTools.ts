// B4 Experiment Designer draft-tool family — Stage 4, single-run subset
// (ai-agents.md §5.4, §4.5, §9.5, §9.8 Phase 1).
//
// One new tool, registered into the shared executeTool registry (bridge 2):
//   * draft_experiment_spec — draft: compiles a decision question into a typed
//     experiment specification bound to a SAVED policy version. Hard gates at
//     draft time (§5.4): the policy version exists and belongs to the project;
//     replications clamp 1-200 (the dispatch.ts clamp restated); disruption
//     schedule ≤ 5 events (engine G11 boundary); acknowledge_warnings is
//     FORCED false regardless of what the model sends — only the approving
//     human can flip it, on the card; a READ-ONLY validation-gate preview
//     (the same runValidationGate the dispatcher enforces) is attached as
//     findings_preview so the reviewer sees what apply will face.
//   * Reads are the Stage 2/3 shared tools (§5.4 least-privilege table):
//     get_run_results + get_validation_status (vvTools.ts), get_policy_config
//     (configuratorTools.ts) — declared here, registered by their modules.
//
// Apply = scenario write path + dispatchExperimentRun (§4.4 experiment_spec
// row) in agent-apply/experimentSpecApply.ts — NEVER a parallel dispatch.
// Simulation results, KPIs and rankings are never LLM-generated: the spec
// dispatches, the engine computes.
//
// Module layout note (ai-agents.md §10 Q21a/Q22): §9.5 homes this tool in
// draftTools.ts; it lives in this sibling module for testability and is
// registered via the agentTurn.ts import — no contract change.

import {
  registerToolHandler,
  type ToolContext,
  type ToolDeclaration,
  type ToolEnvelope,
} from "./tools.ts";
import { loadGateDataset, runValidationGate, type GateFinding } from "../_shared/validationGate.ts";
import { canonicalJson, sha256Hex } from "./telemetry.ts";
import { deploymentEnabledAgents } from "./router.ts";
import {
  AGENT_COMMON,
  failureEnvelope,
  MAX_CITATIONS,
  MAX_PAYLOAD_BYTES,
  proposalEnvelope,
} from "./draftTools.ts";
import { getRunResultsDeclaration, getValidationStatusDeclaration } from "./vvTools.ts";
import { getPolicyConfigDeclaration } from "./configuratorTools.ts";
import {
  getProjectMemoryDeclaration,
  loadActiveMemories,
  loadStaleContext,
  memoryContextBlock,
  memoryEnabled,
} from "./memory.ts";

export const EXPERIMENT_AGENT_ID = "experiment-designer";
export const EXPERIMENT_ARTIFACT_TYPE = "experiment_spec";
/** §10 Q10: prompt versioning — bumped on any §5.4 template change. */
export const EXPERIMENT_PROMPT_VERSION = 1;

/** §5.4 grounding-context budgets (DEFAULT): scenarios ≤ 16 KB, saved policy
 * versions ≤ 8 KB, validation cards + hashes ≤ 8 KB, recent runs ≤ 24 KB;
 * total 64 KB. */
export const EXPERIMENT_SCENARIOS_BUDGET = 16 * 1024;
export const EXPERIMENT_VERSIONS_BUDGET = 8 * 1024;
export const EXPERIMENT_VALIDATION_BUDGET = 8 * 1024;
export const EXPERIMENT_RUNS_BUDGET = 24 * 1024;
export const EXPERIMENT_CONTEXT_BUDGET = 64 * 1024;

/** §5.4 hard gates (restated dispatch.ts bounds). */
export const REPLICATIONS_MIN = 1;
export const REPLICATIONS_MAX = 200;
export const DISRUPTION_EVENTS_MAX = 5;

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** §9.5 experiment-type flag: `AGENT_EXPERIMENT_TYPES=single` grows to
 * `single,comparison,doe,battery` as blueprint Phase C lands each. Default
 * OFF (empty) — flag off ⇒ the draft tool refuses and Stage 0-3 behavior is
 * untouched. */
export function experimentTypesEnabled(): string[] {
  return (Deno.env.get("AGENT_EXPERIMENT_TYPES") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// ---------- §5.4 output contract (verbatim JSON Schema) ----------

/** The §5.4 `draft_experiment_spec` parameter schema, VERBATIM. The handler
 * below enforces it deterministically (providers get the provider-safe
 * declaration; this constant is the contract fixtures pin). */
export const DRAFT_EXPERIMENT_SPEC_SCHEMA = {
  "$id": "https://suresuite.dev/schemas/draft_experiment_spec.v1.json",
  "type": "object",
  "required": ["policy_version_id", "replications"],
  "properties": {
    "scenario_id": { "type": "string", "format": "uuid" },
    "new_scenario": {
      "type": "object",
      "required": ["name", "horizon_days"],
      "properties": {
        "name": { "type": "string", "maxLength": 120 },
        "horizon_days": { "type": "integer", "minimum": 7, "maximum": 3650 },
        "disruption_schedule": { "type": "array", "maxItems": 5, "items": { "type": "object" } },
        "recovery_overrides": { "type": "object" }
      },
      "additionalProperties": false
    },
    "policy_version_id": { "type": "string", "format": "uuid" },
    "replications": { "type": "integer", "minimum": 1, "maximum": 200 },
    "acknowledge_warnings": { "type": "boolean", "default": false },
    "title": { "type": "string", "maxLength": 140 },
    "question": { "type": "string", "maxLength": 500 }
  },
  "oneOf": [{ "required": ["scenario_id"] }, { "required": ["new_scenario"] }],
  "additionalProperties": false
} as const;

// ---------- declarations (§5.4 schema, provider-safe subset) ----------

export const draftExperimentSpecDeclaration: ToolDeclaration = {
  name: "draft_experiment_spec",
  description:
    "File ONE reviewable experiment-specification proposal: a single scenario run bound to a SAVED policy version (never live tables). Provide EITHER scenario_id (an existing scenario from CONTEXT) OR new_scenario (name + horizon_days, optional disruption_schedule of at most 5 events). Replications 1-200 — default to the active validated card's recommendation when one exists. The platform pre-checks the dispatch gate and attaches the findings; you cannot acknowledge warnings — only the approving reviewer can. Call this once per design ask.",
  parameters: {
    type: "object",
    properties: {
      scenario_id: {
        type: "string",
        description: "An existing scenarios id from CONTEXT. Mutually exclusive with new_scenario.",
      },
      new_scenario: {
        type: "object",
        description: "Define a new scenario instead of reusing one. Mutually exclusive with scenario_id.",
        properties: {
          name: { type: "string", description: "Scenario name (max 120 chars)." },
          horizon_days: { type: "number", description: "Simulation horizon in days (7-3650)." },
          disruption_schedule: {
            type: "array",
            description:
              "At most 5 disruption events: {target, target_type ('node'|'edge'), start_day, duration_days, magnitude_pct}.",
            items: { type: "object" },
          },
          recovery_overrides: { type: "object", description: "Recovery-policy overrides for this scenario." },
        },
        required: ["name", "horizon_days"],
      },
      policy_version_id: {
        type: "string",
        description: "The SAVED policy version to bind (from CONTEXT). Runs never use live policy tables.",
      },
      replications: { type: "number", description: "Replication count (1-200)." },
      acknowledge_warnings: {
        type: "boolean",
        description: "Always send false. Warning acknowledgment belongs to the human reviewer on the card.",
      },
      title: { type: "string", description: "Card title (max 140 chars)." },
      question: { type: "string", description: "The decision question this run answers (max 500 chars)." },
    },
    required: ["policy_version_id", "replications"],
  },
};

/** The Designer's complete least-privilege tool surface (§5.4): nothing else
 * is declared to the model. get_project_memory joins when M2 is on (§14.4). */
export function experimentToolDeclarations(): ReadonlyArray<ToolDeclaration> {
  return [
    getRunResultsDeclaration,
    getValidationStatusDeclaration,
    getPolicyConfigDeclaration,
    ...(memoryEnabled() ? [getProjectMemoryDeclaration] : []),
    draftExperimentSpecDeclaration,
  ];
}

// ---------- §5.4 system-prompt template (verbatim) ----------

export function buildExperimentPrompt(args: {
  projectId: string;
  utterance: string;
  scenariosJson: string;
  policyVersionsJson: string;
  validationJson: string;
  runsJson: string;
  memoryBlock?: string;
}): string {
  const memory = args.memoryBlock ? `\n${args.memoryBlock}` : "";
  return `You are the Experiment Designer, the SureSuite agent that compiles decision
questions into reviewable experiment specifications for one project.

CONTEXT
- Project: ${args.projectId}
- Scenarios: ${args.scenariosJson}
- Saved policy versions: ${args.policyVersionsJson}
- Validation cards and current hashes: ${args.validationJson}
- Recent runs: ${args.runsJson}${memory}

TASK
- The user asked: "${args.utterance}"
- Design asks: choose or define the scenario, bind a SAVED policy version
  (never live tables), set replications (1-200; default to the validated
  card's recommendation when one is active), and call draft_experiment_spec
  ONCE. If the ask needs an experiment type the platform has not shipped
  (comparison, DOE, battery), say exactly that and offer the nearest single
  run.
- Brief asks: report ONLY numbers present in run results from CONTEXT or
  tools, each with its run id and credibility badge. Differences between
  runs are DESCRIPTIVE unless a paired statistic is persisted — say which.
- Reply in 2-6 sentences. Never present a projection as a result.

${AGENT_COMMON}`;
}

// ---------- grounding-context builder (bridge 3, §5.4) ----------

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

function clampJson(value: unknown, budget: number): string {
  const s = JSON.stringify(value ?? null);
  return s.length <= budget ? s : s.slice(0, budget) + "…";
}

interface ScenarioRow {
  id: string;
  name: string;
  horizon_days?: number;
  replications?: number;
  disruption_schedule?: Array<Record<string, unknown>>;
  project_id?: string;
  [k: string]: unknown;
}

function scenarioSummary(s: ScenarioRow): Record<string, unknown> {
  const events = Array.isArray(s.disruption_schedule) ? s.disruption_schedule : [];
  return {
    id: s.id,
    name: s.name,
    horizon_days: s.horizon_days ?? null,
    replications: s.replications ?? null,
    disruption_events: events.length,
    disruption_summary: events.slice(0, DISRUPTION_EVENTS_MAX).map((e) => ({
      target: e.target ?? null,
      start_day: e.start_day ?? null,
      duration_days: e.duration_days ?? null,
      magnitude_pct: e.magnitude_pct ?? null,
    })),
  };
}

/** Deterministic grounding-context builder (§5.4): scenario list ≤ 16 KB,
 * saved policy versions ≤ 8 KB, active validation cards + current hashes
 * ≤ 8 KB, recent runs ≤ 24 KB; 64 KB total. Project artifacts only — never
 * chat history (statelessness law §3.4-5). */
export async function buildExperimentContext(
  ctx: ToolContext,
  args: { utterance: string },
): Promise<string> {
  const db = ctx.supabase as unknown as Db;

  let scenariosJson = "[]";
  try {
    const { data } = await db
      .from("scenarios")
      .select("*")
      .eq("project_id", ctx.projectId)
      .order("created_at", { ascending: false })
      .limit(20);
    scenariosJson = clampJson(((data ?? []) as ScenarioRow[]).map(scenarioSummary), EXPERIMENT_SCENARIOS_BUDGET);
  } catch { /* shown as empty */ }

  let versionsJson = "[]";
  try {
    const { data } = await db.rpc("list_policy_versions", { p_project_id: ctx.projectId });
    const rows = (Array.isArray(data) ? data : []).slice(0, 10).map((v: Record<string, unknown>) => ({
      id: v.id,
      label: v.label ?? null,
      policy_hash: v.policy_hash ?? null,
      created_at: v.created_at ?? null,
    }));
    versionsJson = clampJson(rows, EXPERIMENT_VERSIONS_BUDGET);
  } catch { /* shown as empty */ }

  let validationJson = "null";
  try {
    const hashes: Record<string, string> = {};
    try {
      const { data } = await db.rpc("current_policy_hash", { p_project_id: ctx.projectId });
      if (typeof data === "string" && data) hashes.policy_hash = data;
    } catch { /* omitted */ }
    try {
      const { data } = await db.rpc("current_graph_hash", { p_project_id: ctx.projectId });
      if (typeof data === "string" && data) hashes.graph_hash = data;
    } catch { /* omitted */ }
    const { data: cards } = await db.rpc("list_model_validations", { p_project_id: ctx.projectId });
    const active = (Array.isArray(cards) ? cards : [])
      .filter((c: Record<string, unknown>) => c.status === "active")
      .slice(0, 5)
      .map((c: Record<string, unknown>) => ({
        id: c.id,
        verdict: c.verdict,
        basis: c.basis,
        policy_version_id: c.policy_version_id,
        policy_hash: c.policy_hash,
        graph_hash: c.graph_hash,
        scenario_hash: c.scenario_hash,
        adopted_warmup_days: c.adopted_warmup_days,
        recommended_replications: c.recommended_replications,
      }));
    validationJson = clampJson({ current_hashes: hashes, active_cards: active }, EXPERIMENT_VALIDATION_BUDGET);
  } catch { /* shown as null */ }

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
      model_validation_id: r.model_validation_id ?? null,
      aggregate_kpis: r.aggregate_kpis ?? {},
    }));
    runsJson = clampJson(rows, EXPERIMENT_RUNS_BUDGET);
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

  const prompt = buildExperimentPrompt({
    projectId: ctx.projectId,
    utterance: args.utterance.slice(0, 4000),
    scenariosJson,
    policyVersionsJson: versionsJson,
    validationJson,
    runsJson,
    memoryBlock,
  });
  return prompt.length <= EXPERIMENT_CONTEXT_BUDGET ? prompt : prompt.slice(0, EXPERIMENT_CONTEXT_BUDGET);
}

// ---------- draft_experiment_spec handler ----------

interface NormalizedNewScenario {
  name: string;
  horizon_days: number;
  disruption_schedule: Array<Record<string, unknown>>;
  recovery_overrides: Record<string, unknown>;
}

/** §4.5 idempotency core: the substantive spec minus free-text (title,
 * question) — re-phrasings of the same run converge on one card. */
export async function experimentIdempotencyKey(core: {
  scenario_id?: string;
  new_scenario?: NormalizedNewScenario;
  policy_version_id: string;
  replications: number;
}): Promise<string> {
  return await sha256Hex(
    `${EXPERIMENT_AGENT_ID} ${EXPERIMENT_ARTIFACT_TYPE} ${canonicalJson({ schema_version: 1, ...core })}`,
  );
}

function validateNewScenario(raw: unknown): { ok: true; value: NormalizedNewScenario } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "new_scenario must be an object" };
  }
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!["name", "horizon_days", "disruption_schedule", "recovery_overrides"].includes(k)) {
      return { ok: false, reason: `unknown new_scenario field "${k}"` };
    }
  }
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name || name.length > 120) {
    return { ok: false, reason: "new_scenario.name must be a non-empty string (max 120 chars)" };
  }
  const horizon = Number(o.horizon_days);
  if (!Number.isFinite(horizon) || !Number.isInteger(horizon) || horizon < 7 || horizon > 3650) {
    return { ok: false, reason: "new_scenario.horizon_days must be an integer between 7 and 3650" };
  }
  const schedule = o.disruption_schedule ?? [];
  if (!Array.isArray(schedule)) {
    return { ok: false, reason: "new_scenario.disruption_schedule must be an array" };
  }
  if (schedule.length > DISRUPTION_EVENTS_MAX) {
    // §5.4 hard gate: the engine G11 boundary — never negotiable at draft time.
    return { ok: false, reason: `disruption_schedule allows at most ${DISRUPTION_EVENTS_MAX} events (got ${schedule.length})` };
  }
  for (const e of schedule) {
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      return { ok: false, reason: "disruption_schedule items must be objects" };
    }
  }
  const recovery = o.recovery_overrides ?? {};
  if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)) {
    return { ok: false, reason: "new_scenario.recovery_overrides must be an object" };
  }
  return {
    ok: true,
    value: {
      name,
      horizon_days: horizon,
      disruption_schedule: schedule as Array<Record<string, unknown>>,
      recovery_overrides: recovery as Record<string, unknown>,
    },
  };
}

async function draftExperimentSpec(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolEnvelope> {
  const tool = "draft_experiment_spec";

  // §13.2 checkpoints 2-3: deployment kill switches + agent_proposals capability.
  if (!deploymentEnabledAgents().includes(EXPERIMENT_AGENT_ID)) {
    return failureEnvelope(tool, "agent_disabled", "The Experiment Designer agent is not enabled in this deployment.");
  }
  if (!experimentTypesEnabled().includes("single")) {
    return failureEnvelope(
      tool,
      "agent_disabled",
      "Single-run experiment dispatch is not enabled in this deployment (AGENT_EXPERIMENT_TYPES).",
    );
  }
  if (!ctx.draft || !ctx.draft.canProposals) {
    return failureEnvelope(tool, "agent_disabled", "Proposal drafting is not enabled for this account (agent_proposals).");
  }

  // §5.4 schema, enforced deterministically (additionalProperties: false).
  for (const k of Object.keys(args)) {
    if (!["scenario_id", "new_scenario", "policy_version_id", "replications", "acknowledge_warnings", "title", "question"].includes(k)) {
      return failureEnvelope(tool, "invalid_params", `unknown parameter "${k}"`);
    }
  }
  const hasScenarioId = args.scenario_id !== undefined && args.scenario_id !== null && args.scenario_id !== "";
  const hasNewScenario = args.new_scenario !== undefined && args.new_scenario !== null;
  if (hasScenarioId === hasNewScenario) {
    // the §5.4 oneOf: exactly one of the two.
    return failureEnvelope(tool, "invalid_params", "provide exactly ONE of scenario_id or new_scenario");
  }
  const policyVersionId = String(args.policy_version_id ?? "");
  if (!uuidRe.test(policyVersionId)) {
    return failureEnvelope(tool, "invalid_params", "policy_version_id must be a uuid of a SAVED policy version");
  }
  const rawReps = typeof args.replications === "number" ? args.replications : Number(args.replications);
  if (!Number.isFinite(rawReps)) {
    return failureEnvelope(tool, "invalid_params", "replications must be a number (1-200)");
  }
  // §5.4 hard gate: the dispatch.ts clamp restated at draft time.
  const replications = Math.max(REPLICATIONS_MIN, Math.min(REPLICATIONS_MAX, Math.floor(rawReps)));

  let newScenario: NormalizedNewScenario | null = null;
  if (hasNewScenario) {
    const v = validateNewScenario(args.new_scenario);
    if (!v.ok) return failureEnvelope(tool, "invalid_params", v.reason);
    newScenario = v.value;
  }

  const db = ctx.supabase as unknown as Db;

  // §5.4 hard gate 1: the policy version exists and belongs to this project —
  // no dispatch without a SAVED policy_version_id (mirrors dispatch.ts's own
  // refusal: no version, no run).
  const { data: version } = await db
    .from("policy_versions")
    .select("id,project_id,label,snapshot,policy_hash,created_at")
    .eq("id", policyVersionId)
    .maybeSingle();
  if (!version || String(version.project_id) !== ctx.projectId) {
    const { data: any } = await db
      .from("policy_versions")
      .select("id")
      .eq("project_id", ctx.projectId)
      .limit(1);
    if (!Array.isArray(any) || any.length === 0) {
      return failureEnvelope(
        tool,
        "dependency_missing",
        "This project has no saved policy version yet — save/snapshot the policy configuration on /policies first; runs never bind live tables.",
      );
    }
    return failureEnvelope(tool, "project_scope_violation", `policy version ${policyVersionId} is not in this project`);
  }

  // Scenario resolution (existing id must be in-project).
  let scenario: ScenarioRow | null = null;
  if (hasScenarioId) {
    const scenarioId = String(args.scenario_id ?? "");
    if (!uuidRe.test(scenarioId)) {
      return failureEnvelope(tool, "invalid_params", "scenario_id must be a uuid");
    }
    const { data } = await db.from("scenarios").select("*").eq("id", scenarioId).maybeSingle();
    if (!data || String((data as ScenarioRow).project_id) !== ctx.projectId) {
      return failureEnvelope(tool, "project_scope_violation", `scenario ${scenarioId} is not in this project`);
    }
    scenario = data as ScenarioRow;
  }

  // §5.4 hard gate 4: read-only gate preview — the SAME runValidationGate the
  // dispatcher enforces, run with acknowledgeWarnings=false and stored as
  // findings_preview so acknowledgment on the card is informed (§5.4:
  // acknowledge_warnings is only honored at apply if the card DISPLAYED the
  // warn findings).
  let findingsPreview: GateFinding[] = [];
  let gateStatus = "pass";
  const disruptionSchedule = newScenario
    ? newScenario.disruption_schedule
    : ((scenario?.disruption_schedule as Array<Record<string, unknown>>) ?? []);
  try {
    const snapshot = (version.snapshot ?? {}) as Record<string, unknown>;
    const snapshotDefaults = ("defaults" in snapshot ? snapshot.defaults : snapshot) as Record<string, unknown>;
    const dataset = await loadGateDataset(ctx.supabase, ctx.projectId);
    const gate = runValidationGate({
      dataset,
      snapshotDefaults: snapshotDefaults ?? {},
      disruptionSchedule,
      acknowledgeWarnings: false,
    });
    if (gate) {
      gateStatus = gate.status;
      findingsPreview = gate.findings.slice(0, 200);
    }
  } catch {
    gateStatus = "preview_unavailable"; // preview only — apply re-runs the authoritative gate
  }

  // Grounding = {policy_hash} of the bound version (§5.4). Versions are
  // immutable, so this hash cannot drift — it documents what the spec binds.
  const snapshot = (version.snapshot ?? {}) as Record<string, unknown>;
  const policyHash: string = (version.policy_hash as string | null) ?? (await sha256Hex(canonicalJson(snapshot)));

  // Stale-version visibility (§5.4 failure modes): allowed, but the card shows
  // the version's age and whether a newer one exists.
  let newerVersionExists = false;
  try {
    const { data: siblings } = await db
      .from("policy_versions")
      .select("id,created_at")
      .eq("project_id", ctx.projectId);
    const t = (v: Record<string, unknown>): number => {
      const c = v?.created_at;
      return typeof c === "number" ? c : Date.parse(String(c ?? "")) || 0;
    };
    const own = t(version as Record<string, unknown>);
    newerVersionExists = (Array.isArray(siblings) ? siblings : []).some(
      (s: Record<string, unknown>) => String(s.id) !== policyVersionId && t(s) > own,
    );
  } catch { /* visibility only */ }

  const specCore = {
    ...(scenario ? { scenario_id: scenario.id } : {}),
    ...(newScenario ? { new_scenario: newScenario } : {}),
    policy_version_id: policyVersionId,
    replications,
  };
  const title = (typeof args.title === "string" && args.title.trim()
    ? args.title.trim()
    : `Run: ${scenario ? scenario.name : newScenario!.name} × ${version.label ?? policyVersionId.slice(0, 8)} (${replications} reps)`)
    .slice(0, 140);
  const question = typeof args.question === "string" ? args.question.slice(0, 500) : null;

  const payload: Record<string, unknown> = {
    schema_version: 1,
    prompt_version: EXPERIMENT_PROMPT_VERSION,
    ...specCore,
    // §5.4 failure mode, hard rule: the tool FORCES acknowledge_warnings
    // false regardless of what the model sent — only the approving human can
    // flip it, on the card (recorded with their review).
    acknowledge_warnings: false,
    title,
    ...(question ? { question } : {}),
    // card display (deterministic, computed here — never by the model):
    ...(scenario ? { scenario_name: scenario.name } : {}),
    policy_version_label: version.label ?? null,
    policy_version_created_at: version.created_at ?? null,
    newer_version_exists: newerVersionExists,
    gate_status: gateStatus,
    findings_preview: findingsPreview,
  };
  if (canonicalJson(payload).length > MAX_PAYLOAD_BYTES) {
    return failureEnvelope(tool, "too_large", "The spec payload exceeds the 256 KB limit — narrow the disruption schedule.");
  }

  const citations: Array<Record<string, unknown>> = [
    { kind: "table_rows", ref: "policy_versions", rows: [policyVersionId] },
    ...(scenario ? [{ kind: "table_rows", ref: "scenarios", rows: [scenario.id] }] : []),
    {
      kind: "user_message",
      ref: `thread:${ctx.draft.threadId ?? "current"}`,
      quote: ctx.draft.utterance.slice(0, 500),
    },
  ];
  if (citations.length > MAX_CITATIONS) citations.length = MAX_CITATIONS;

  const warnCount = findingsPreview.filter((f) => f.severity === "warn").length;
  const blockCount = findingsPreview.filter((f) => f.severity === "block").length;
  const gateNote = gateStatus === "pass"
    ? "gate pre-check: pass"
    : gateStatus === "preview_unavailable"
    ? "gate pre-check unavailable (apply re-runs it)"
    : `gate pre-check: ${gateStatus} (${blockCount} block / ${warnCount} warn)`;
  const summary =
    `scenario "${scenario ? scenario.name : newScenario!.name}"${newScenario ? " (new)" : ""} · ` +
    `policy version ${version.label ?? policyVersionId.slice(0, 8)} (${policyHash.slice(0, 12)}) · ` +
    `${replications} replications · ${gateNote}`;

  const idemKey = await experimentIdempotencyKey(specCore);
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
        artifact_type: EXPERIMENT_ARTIFACT_TYPE,
        summary,
        provenance: "llm_drafted",
        duplicate: true,
      });
    }
  } catch { /* the RPC's own idempotency check still converges below */ }

  const { data: proposalId, error } = await ctx.supabase.rpc("create_agent_proposal", {
    p_project_id: ctx.projectId,
    p_agent_id: EXPERIMENT_AGENT_ID,
    p_artifact_type: EXPERIMENT_ARTIFACT_TYPE,
    p_title: title,
    p_payload: payload,
    p_citations: citations,
    // §5.4: the spec (scenario choice, version binding, replications) is the
    // LLM's — human must verify. Results are never drafted: the engine computes.
    p_provenance: "llm_drafted",
    p_grounding: { policy_hash: policyHash },
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
    artifact_type: EXPERIMENT_ARTIFACT_TYPE,
    summary,
    provenance: "llm_drafted",
  });
}

// Register into the shared executeTool registry (bridge 2). The read tools of
// the §5.4 surface are registered by vvTools.ts / configuratorTools.ts.
registerToolHandler("draft_experiment_spec", draftExperimentSpec);
