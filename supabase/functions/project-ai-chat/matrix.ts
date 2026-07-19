// Phase H4 — the §23 per-model capability matrix, server side
// (ai-agents.md §23.2 vocabulary, §23.4 enforcement, §22.5 template, §7.6
// staleness). Flag MODEL_MATRIX_ENABLED (default off): with it unset this
// module is never consulted by index.ts and the store is inert data.
//
// The three laws, restated where they are enforced:
//   * the matrix INFORMS and REFUSES honestly — it never hides a model
//     (the org allowlist owns that) and NEVER auto-switches (the user chose
//     the model; the platform's job is honesty about what that choice can
//     do — the §15 posture applied to model choice);
//   * fail-open on absent evidence — no row, a stale row (> 7 days, §7.6),
//     or an advisory route ⇒ proceed normally (blocking on absent data
//     would freeze the product on day one; advisory replies are separately
//     guarded by the §22.3 verifier);
//   * capability ids are the CLOSED §23.2 set — a new suite adds an id via
//     a doc change first.

import { MODEL_REGISTRY } from "./providers.ts";
import { closedLoopEnabled } from "./experimentTools.ts";
import type { RouteDecision } from "./router.ts";

export function matrixEnabled(): boolean {
  return (Deno.env.get("MODEL_MATRIX_ENABLED") ?? "").trim().toLowerCase() === "true";
}

/** §7.6: a matrix older than 7 days (DEFAULT) renders stale wherever it is
 * displayed and stops gating the §23.4 template. */
export const MATRIX_STALE_DAYS = 7;

/** The §23.2 capability vocabulary — CLOSED SET, in doc order. Growing it is
 * a doc change to ai-agents.md §23.2 first, then this array, then the writer
 * (run_model_eval.ts keys its rows off this exact list). */
export const MATRIX_CAPABILITY_IDS = [
  "router",
  "router.needs_run",
  "router.cache_checkable",
  "agent:data-steward",
  "agent:policy-configurator",
  "agent:vv-analyst",
  "agent:experiment-designer",
  "agent:report-builder",
  "loop:cache_hit",
  "loop:run_needed",
  "plan:integrity",
  "coverage:relations",
  "coverage:policy_reads",
  "coverage:run_reads",
  "fabrication",
  "faithfulness",
] as const;

export type MatrixCapabilityId = (typeof MATRIX_CAPABILITY_IDS)[number];

/** Plain-language names for the §22.5 template's {{capability_name}} and the
 * §23.3 picker hints. Mirrored in src/lib/modelMatrix.ts — keep in sync. */
export const CAPABILITY_NAMES: Record<MatrixCapabilityId, string> = {
  "router": "intent routing",
  "router.needs_run": "run-need detection",
  "router.cache_checkable": "cache-answer detection",
  "agent:data-steward": "the Data Steward agent",
  "agent:policy-configurator": "the Policy Configurator agent",
  "agent:vv-analyst": "the V&V Analyst agent",
  "agent:experiment-designer": "the Experiment Designer agent",
  "agent:report-builder": "the Report Builder agent",
  "loop:cache_hit": "the cache-first decision loop",
  "loop:run_needed": "the decision loop",
  "plan:integrity": "plan tracking",
  "coverage:relations": "relationship lookups",
  "coverage:policy_reads": "policy reads",
  "coverage:run_reads": "run-result reads",
  "fabrication": "grounded answers",
  "faithfulness": "faithful reporting",
};

/** One stored matrix row, as get_model_capability_matrix() returns it. */
export interface MatrixRow {
  model_code: string;
  capability_id: string;
  score: number;
  target: number;
  pass: boolean;
  eval_run_id: string;
  measured_at: string;
}

export function isFreshRow(row: Pick<MatrixRow, "measured_at">, now: Date): boolean {
  const measured = Date.parse(row.measured_at);
  if (Number.isNaN(measured)) return false;
  return now.getTime() - measured <= MATRIX_STALE_DAYS * 24 * 60 * 60 * 1000;
}

// ── §22.5: the needs-a-stronger-model template (verbatim) ───────────────────
// Instantiated by the SERVER, before any LLM call — appended as the reply
// with the routed intent unexecuted. Inputs: the below-target capability's
// plain-language name, the current model label, the best passing model's
// label (omitted when none passes).

export const NEEDS_STRONGER_MODEL_TEMPLATE = `This request needs {{capability_name}}, which {{current_model}} doesn't
currently pass our quality checks for. Switch models in the composer
{{#best_model}}({{best_model}} passes){{/best_model}} and ask again —
I won't guess with a below-target setup.`;

export function renderNeedsStrongerModel(input: {
  capabilityName: string;
  currentModel: string;
  bestModel: string | null;
}): string {
  const withInputs = NEEDS_STRONGER_MODEL_TEMPLATE
    .replace("{{capability_name}}", input.capabilityName)
    .replace("{{current_model}}", input.currentModel);
  return input.bestModel === null
    ? withInputs.replace("{{#best_model}}({{best_model}} passes){{/best_model}} ", "")
    : withInputs.replace(
      "{{#best_model}}({{best_model}} passes){{/best_model}}",
      `(${input.bestModel} passes)`,
    );
}

// ── §23.4: the routing-boundary gate ────────────────────────────────────────

/** The deterministic route → capability mapping (the "routes to an
 * agent/loop" of §23.4). Advisory routes never reach this function — the
 * caller gates only routed agent turns (fail-open rule 3). Order matters:
 * the first fresh failing capability names the template. */
export function routedCapabilityIds(
  decision: Pick<RouteDecision, "agent_id" | "needs_run" | "cache_checkable">,
  routedAgentId: string,
): string[] {
  const ids: string[] = [`agent:${routedAgentId}`];
  // The B4 closed-loop turn (§6.6 rule 2) is "the loop" — it engages exactly
  // when the routed agent is experiment-designer, the router said needs_run,
  // and CLOSED_LOOP_ENABLED swaps in the §20.4 prompt + §20.2 surface.
  if (routedAgentId === "experiment-designer" && decision.needs_run && closedLoopEnabled()) {
    ids.push("loop:run_needed");
    // The cache-first read (§6.6 rule 1) joins that same executing turn.
    if (decision.cache_checkable) ids.push("loop:cache_hit");
  }
  return ids;
}

/** Structural client — .rpc is all this module needs. */
export interface MatrixDb {
  rpc(fn: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type MatrixGateResult =
  | { blocked: false }
  | {
    blocked: true;
    capabilityId: string;
    /** Label of the best fresh passing model for that capability (highest
     * score, ties by model_code), null when none passes. */
    bestModel: string | null;
    reply: string;
  };

/** The §23.4 decision: a fresh (≤ 7 days) failing row for the routed
 * (model, capability) blocks the agent turn with the §22.5 template; no row,
 * a stale row, or a read failure ⇒ fail open. Never throws. `now` is
 * injectable for the clock-mocked staleness tests. */
export async function checkMatrixGate(
  db: MatrixDb,
  input: {
    modelCode: string;
    modelLabel: string;
    capabilityIds: string[];
    now?: Date;
  },
): Promise<MatrixGateResult> {
  const now = input.now ?? new Date();
  let rows: MatrixRow[];
  try {
    const { data, error } = await db.rpc("get_model_capability_matrix");
    if (error || !Array.isArray(data)) {
      if (error) console.warn("[matrix] read failed, failing open:", error.message);
      return { blocked: false };
    }
    rows = data as MatrixRow[];
  } catch (e) {
    console.warn("[matrix] read failed, failing open:", e instanceof Error ? e.message : e);
    return { blocked: false };
  }

  for (const capabilityId of input.capabilityIds) {
    const row = rows.find(
      (r) => r.model_code === input.modelCode && r.capability_id === capabilityId,
    );
    // No row or a stale row ⇒ the matrix subtracts nothing (§23.4 fail-open;
    // the template must never fire off month-old evidence — §7.6).
    if (!row || !isFreshRow(row, now) || row.pass) continue;

    const best = rows
      .filter((r) =>
        r.capability_id === capabilityId && r.pass && isFreshRow(r, now) &&
        r.model_code !== input.modelCode
      )
      .sort((a, b) =>
        Number(b.score) - Number(a.score) || a.model_code.localeCompare(b.model_code)
      )[0] ?? null;
    const bestModel = best
      ? (MODEL_REGISTRY[best.model_code]?.label ?? best.model_code)
      : null;
    return {
      blocked: true,
      capabilityId,
      bestModel,
      reply: renderNeedsStrongerModel({
        capabilityName:
          CAPABILITY_NAMES[capabilityId as MatrixCapabilityId] ?? capabilityId,
        currentModel: input.modelLabel,
        bestModel,
      }),
    };
  }
  return { blocked: false };
}
