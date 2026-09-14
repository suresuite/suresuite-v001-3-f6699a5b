// B7 Cost Estimator draft-tool family — Phase 4a (ai-agents.md §18.1 v1.5,
// §18.5, §4.5; decision §10 Q26). Q21a seam conventions: same module shape,
// same registration, same envelopes as draftTools.ts (B1).
//
// Two tools, registered into the shared executeTool registry (bridge 2):
//   * get_parameter_estimates  — read: the §8.1–8.2 grader finds the gaps,
//     the _shared/estimators.ts method registry computes every applicable
//     method's {value, low, high, basis} per gap, back-test status included.
//   * draft_parameter_estimate — draft: validates the §18.1 schema, recomputes
//     EVERY row through its named method@version (value, low AND high, each
//     within 1e-9 — the LLM never invents a number or an interval), and files
//     the proposal through create_agent_proposal with a canonicalJson
//     idempotency key. Provenance is always `deterministic`.

import {
  clamp,
  registerToolHandler,
  toolDeclarations,
  type ToolContext,
  type ToolDeclaration,
  type ToolEnvelope,
} from "./tools.ts";
import { gradedResultNote, loadGateDataset } from "../_shared/validationGate.ts";
import {
  completenessRows,
  DRAFT_FIELDS,
  entityIdSets,
  gradeDataset,
  loadPolicyDefaults,
  NUMERIC_DRAFT_FIELDS,
  type CompletenessRow,
  type ItemTable,
} from "../_shared/itemMasterCandidates.ts";
import {
  BENCHMARK_TABLE_VERSION,
  backTestMethod,
  ESTIMATOR_METHODS,
  estimateCandidates,
  firmLevelEstimates,
  methodRef,
  verifyEstimateRow,
  type CandidateRow,
  type EstimateRowInput,
  type EstimatorInputs,
  type EstimatorMethod,
} from "../_shared/estimators.ts";
import {
  AGENT_COMMON,
  failureEnvelope,
  MAX_CITATIONS,
  MAX_DIFF_ROWS,
  MAX_PAYLOAD_BYTES,
  proposalEnvelope,
  type DraftErrorCode,
} from "./draftTools.ts";
import { canonicalJson, sha256Hex } from "./telemetry.ts";
import { deploymentEnabledAgents } from "./router.ts";

export const ESTIMATOR_AGENT_ID = "cost-estimator";
export const ESTIMATOR_ARTIFACT_TYPE = "parameter_estimate";
/** §10 Q10: prompt versioning — bumped on any §18.1 template change. */
export const ESTIMATOR_PROMPT_VERSION = 1;

/** §18.1 grounding-context budgets (DEFAULT): findings ≤ 24 KB and the
 * method table ≤ 8 KB inside a 48 KB total context budget. */
export const ESTIMATOR_FINDINGS_BUDGET_BYTES = 24 * 1024;
export const METHODS_BUDGET_BYTES = 8 * 1024;

const failure = failureEnvelope;

// ---------- declarations (§18.1 schemas, provider-safe subset) ----------

export const getParameterEstimatesDeclaration: ToolDeclaration = {
  name: "get_parameter_estimates",
  description:
    "Compute candidate estimates for the project's missing item-master economics. The platform's grader finds the gaps and the versioned method registry derives, per gap and per applicable method, a value with a REQUIRED uncertainty interval [low, high], its basis, sources (dataset + vintage) and assumptions. Methods demoted by this project's back-test are marked and must not be proposed. include_resilience adds firm-level resilience-cost estimates (report-only).",
  parameters: {
    type: "object",
    properties: {
      table: {
        type: "string",
        enum: ["materials", "products", "suppliers", "all"],
        description: "Restrict candidates to one item-master table. Default 'all'.",
      },
      include_resilience: {
        type: "boolean",
        description:
          "Also return the firm-level resilience fixed-cost estimates (P-S.1 coordination, P-P.5 capacity). These are report-only — never draftable.",
      },
      top_n: {
        type: "number",
        description:
          "Maximum candidate rows to return (default 100, max 200). meta.note carries the TRUE total when the list is truncated.",
      },
    },
  },
};

export const draftParameterEstimateDeclaration: ToolDeclaration = {
  name: "draft_parameter_estimate",
  description:
    "File ONE reviewable parameter-estimate proposal from candidate rows you selected. Every row is recomputed server-side through its named method@version — value, low and high must each equal the recomputation exactly, so copy them verbatim from get_parameter_estimates. Call this once per ask with all rows.",
  parameters: {
    type: "object",
    properties: {
      rows: {
        type: "array",
        description: "1-500 estimates. One entry per (table, entity_id, field).",
        items: {
          type: "object",
          properties: {
            table: { type: "string", enum: ["materials", "products", "suppliers"] },
            entity_id: { type: "string", description: "Entity id exactly as the project stores it (max 120 chars)." },
            field: {
              type: "string",
              enum: [...NUMERIC_DRAFT_FIELDS],
              description: "The numeric item-master column to estimate; must belong to the chosen table.",
            },
            method: {
              type: "string",
              description: "The method reference '<id>@<version>' from get_parameter_estimates.",
            },
            value: { type: "number", description: "The point estimate, verbatim from the candidate row." },
            low: { type: "number", description: "Interval lower bound, verbatim from the candidate row." },
            high: { type: "number", description: "Interval upper bound, verbatim from the candidate row." },
            why: { type: "string", description: "One short sentence on method fit (max 300 chars)." },
          },
          required: ["table", "entity_id", "field", "method", "value", "low", "high"],
        },
      },
      title: { type: "string", description: "Card title (max 140 chars)." },
    },
    required: ["rows"],
  },
};

/** The Estimator's complete least-privilege tool surface (§18.1): nothing
 * else is declared to the model. */
export const estimatorToolDeclarations: ReadonlyArray<ToolDeclaration> = [
  toolDeclarations[0], // list_project_entities (existing read tool)
  getParameterEstimatesDeclaration,
  draftParameterEstimateDeclaration,
];

// ---------- §18.1 system-prompt template (verbatim) ----------

export function buildEstimatorPrompt(args: {
  projectId: string;
  utterance: string;
  findingsJson: string;
  datasetCountsJson: string;
  methodsJson: string;
}): string {
  return `You are the Cost Estimator, the SuReSuite agent that estimates missing
item-master economics (materials, products, suppliers) for one project,
with method-cited values and uncertainty intervals.

CONTEXT
- Project: ${args.projectId}
- Data-completeness findings (computed by the platform's grader, not by you):
${args.findingsJson}
- Dataset counts: ${args.datasetCountsJson}
- Available estimation methods (versioned; computed by the platform, not by
  you — a demoted method failed this project's back-test and must not be
  proposed):
${args.methodsJson}

TASK
- The user asked: "${args.utterance}"
- Call get_parameter_estimates to obtain the candidate estimates. Every
  candidate row carries value, low, high, basis, method and sources — all
  computed deterministically by the platform's method registry.
- Decide which candidates this ask covers and which method fits each gap;
  prefer family direct_from_project where it resolves. Copy value, low and
  high EXACTLY from the candidate rows — never adjust, round, or invent a
  number or an interval.
- Then call draft_parameter_estimate ONCE with all rows. Do not include:
  demoted methods, firm-level resilience estimates (report those in your
  reply instead — they have no apply path yet), or gaps with no candidate —
  list those in your reply as still-missing.
- After the tool returns, reply in 2-4 sentences: what the proposal covers
  and by which method families, what remains missing or report-only, and
  that the card must be reviewed before it applies.

${AGENT_COMMON}`;
}

/** Serialize under a byte budget: beyond it, drop infos first (block+warn
 * only), then halve — the same fold rule as §5.1's serializeFindings, with
 * the §18.1 budget. */
function serializeFindingsUnderBudget(rows: CompletenessRow[], budget: number): string {
  let out = JSON.stringify(rows);
  if (out.length <= budget) return out;
  let filtered = rows.filter((r) => r.severity !== "info");
  out = JSON.stringify(filtered);
  while (out.length > budget && filtered.length > 1) {
    filtered = filtered.slice(0, Math.max(1, Math.floor(filtered.length / 2)));
    out = JSON.stringify(filtered);
  }
  return out;
}

/** The §18.1 method table — serialized from the registry, never hand-written.
 * Assumptions are dropped first when the 8 KB budget binds. */
export function serializeMethods(inputs: EstimatorInputs): string {
  const rows = ESTIMATOR_METHODS.map((m) => ({
    method: methodRef(m),
    family: m.family,
    target: m.target
      ? `${m.target.table}.${m.target.field}`
      : `firm-level: ${m.firmLevel?.catalogRef ?? "?"} ${m.firmLevel?.label ?? ""}`,
    sources: m.sources.map((s) => ({ dataset: s.dataset, vintage: s.vintage, role: s.role })),
    assumptions: m.assumptions,
    status: backTestMethod(m, inputs).demoted ? "demoted" : "ok",
  }));
  let out = JSON.stringify(rows);
  if (out.length <= METHODS_BUDGET_BYTES) return out;
  out = JSON.stringify(rows.map(({ assumptions: _a, ...rest }) => rest));
  return out.length <= METHODS_BUDGET_BYTES ? out : out.slice(0, METHODS_BUDGET_BYTES);
}

/** Deterministic grounding-context builder (bridge 3): project artifacts only,
 * never chat history. Total budget 48 KB DEFAULT (§18.1). */
export async function buildEstimatorContext(
  ctx: ToolContext,
  args: { utterance: string; userEmail: string | null },
): Promise<string> {
  const [dataset, defaults] = await Promise.all([
    loadGateDataset(ctx.supabase, ctx.projectId),
    loadPolicyDefaults(ctx.supabase, ctx.projectId),
  ]);
  const inputs: EstimatorInputs = { dataset, defaults };
  const rows = completenessRows(gradeDataset(dataset, defaults));

  let countsJson = "{}";
  try {
    const { data } = await ctx.supabase.rpc("get_project_dataset_counts", {
      p_project_id: ctx.projectId,
      p_user_id: ctx.userId,
      p_user_email: args.userEmail,
    });
    if (data) countsJson = JSON.stringify(data);
  } catch { /* counts are context, not a gate */ }

  return buildEstimatorPrompt({
    projectId: ctx.projectId,
    utterance: args.utterance.slice(0, 4000),
    findingsJson: serializeFindingsUnderBudget(rows, ESTIMATOR_FINDINGS_BUDGET_BYTES),
    datasetCountsJson: countsJson,
    methodsJson: serializeMethods(inputs),
  });
}

// ---------- get_parameter_estimates handler ----------

const candidateSourceLabel = (c: CandidateRow): { dataset: string; vintage: string } => {
  const prior = c.sources.find((s) => s.role === "prior");
  const s = prior ?? c.sources[0];
  return { dataset: s?.dataset ?? "project (live)", vintage: String(s?.vintage ?? "live") };
};

async function getParameterEstimates(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolEnvelope> {
  const tool = "get_parameter_estimates";
  const tableArg = ["materials", "products", "suppliers", "all"].includes(String(args.table))
    ? String(args.table)
    : "all";
  const topN = clamp(args.top_n, 100, 1, 200);
  try {
    const [dataset, defaults] = await Promise.all([
      loadGateDataset(ctx.supabase, ctx.projectId),
      loadPolicyDefaults(ctx.supabase, ctx.projectId),
    ]);
    const inputs: EstimatorInputs = { dataset, defaults };
    const candidates = estimateCandidates(inputs).filter(
      (c) => tableArg === "all" || c.table === tableArg,
    );
    const firm = args.include_resilience === true ? firmLevelEstimates(inputs) : [];
    const all = [...candidates, ...firm];
    // estimateCandidates is a cross-product of (missing value × applicable
    // method) with an assumptions string per row, and the envelope is
    // stringified verbatim into the model's context (providers.ts). Cap it the
    // way the §19.3 reads do; the firm-level rows are few and always kept.
    const rows = [...firm, ...candidates].slice(0, topN);
    if (all.length === 0) {
      return {
        kind: "text",
        data: "No estimable gaps — every graded item-master field either has a master value or no method grounds an estimate.",
        meta: { tool, row_count: 0, note: "empty" },
      };
    }
    return {
      kind: "table",
      data: {
        columns: ["field", "entity_id", "method", "value", "low", "high", "basis", "dataset", "vintage", "status", "assumptions"],
        rows: rows.map((c) => {
          const src = candidateSourceLabel(c);
          const field = c.entity_id === "firm" ? c.field : `${c.table}.${c.field}`;
          return [
            field,
            c.entity_id,
            c.method,
            c.value,
            c.low,
            c.high,
            c.basis,
            src.dataset,
            src.vintage,
            c.status,
            c.assumptions.join(" | "),
          ];
        }),
      },
      meta: {
        tool,
        row_count: rows.length,
        ...(gradedResultNote(dataset, all.length, rows.length, "candidates")),
      },
    };
  } catch (e) {
    console.warn("get_parameter_estimates failed:", (e as Error).message);
    return { kind: "text", data: "Parameter estimation failed.", meta: { tool, row_count: 0, note: "error" } };
  }
}

// ---------- draft_parameter_estimate handler ----------

interface NormalizedEstimateRow extends EstimateRowInput {
  why?: string;
}

/** Validate + normalize the raw model arguments against the §18.1 schema. */
export function normalizeEstimateRows(
  rawRows: unknown,
): { rows: NormalizedEstimateRow[] } | { code: DraftErrorCode; reason: string } {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return { code: "invalid_params", reason: "rows must be a non-empty array of estimates" };
  }
  if (rawRows.length > MAX_DIFF_ROWS) {
    return {
      code: "too_large",
      reason: `rows exceed the ${MAX_DIFF_ROWS}-row limit — narrow the ask (e.g. one table or field at a time)`,
    };
  }
  const allowedKeys = new Set(["table", "entity_id", "field", "method", "value", "low", "high", "why"]);
  const seen = new Set<string>();
  const rows: NormalizedEstimateRow[] = [];
  for (const raw of rawRows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { code: "invalid_params", reason: "each row must be an object" };
    }
    const r = raw as Record<string, unknown>;
    for (const k of Object.keys(r)) {
      if (!allowedKeys.has(k)) return { code: "invalid_params", reason: `unknown row property "${k}"` };
    }
    const table = String(r.table ?? "");
    if (!["materials", "products", "suppliers"].includes(table)) {
      return { code: "invalid_params", reason: `unknown table "${table}"` };
    }
    const field = String(r.field ?? "");
    if (!NUMERIC_DRAFT_FIELDS.has(field)) {
      return {
        code: "invalid_params",
        reason: `field "${field}" is not an estimable numeric field — enum-valued fields are the Data Steward's territory`,
      };
    }
    if (DRAFT_FIELDS[field] !== table) {
      return {
        code: "invalid_params",
        reason: `field "${field}" belongs to ${DRAFT_FIELDS[field]}, not ${table}`,
      };
    }
    const entityId = String(r.entity_id ?? "").trim();
    if (!entityId || entityId.length > 120) {
      return { code: "invalid_params", reason: "entity_id must be a non-empty string (max 120 chars)" };
    }
    const method = String(r.method ?? "").trim();
    if (!method || method.length > 80) {
      return { code: "invalid_params", reason: "method must be a '<id>@<version>' reference (max 80 chars)" };
    }
    // §18.1 hard gate 2: the interval is REQUIRED on every row.
    if (r.low == null || r.high == null) {
      return {
        code: "invalid_params",
        reason: `${field} for ${entityId}: every estimate requires an interval — low and high are mandatory`,
      };
    }
    const toNum = (v: unknown): number =>
      typeof v === "number" ? v : Number(String(v ?? "").trim());
    const value = toNum(r.value);
    const low = toNum(r.low);
    const high = toNum(r.high);
    if (![value, low, high].every(Number.isFinite)) {
      return {
        code: "invalid_params",
        reason: `${field} for ${entityId}: value, low and high must all be finite numbers`,
      };
    }
    if (!(low <= value && value <= high)) {
      return {
        code: "invalid_params",
        reason: `${field} for ${entityId}: the interval must satisfy low ≤ value ≤ high (got ${value} ∉ [${low}, ${high}])`,
      };
    }
    if (r.why != null && (typeof r.why !== "string" || r.why.length > 300)) {
      return { code: "invalid_params", reason: "why must be a string (max 300 chars)" };
    }
    const dupKey = `${table}|${entityId}|${field}`;
    if (seen.has(dupKey)) {
      return { code: "invalid_params", reason: `duplicate row for ${table}.${field} on ${entityId}` };
    }
    seen.add(dupKey);
    rows.push({
      table: table as ItemTable,
      entity_id: entityId,
      field,
      method,
      value,
      low,
      high,
      ...(typeof r.why === "string" && r.why ? { why: r.why } : {}),
    });
  }
  return { rows };
}

/** §4.5 idempotency key: the payload core drops free-text (`why`) so
 * re-phrasings of the same substantive estimate converge. */
export async function estimatorIdempotencyKey(rows: NormalizedEstimateRow[]): Promise<string> {
  const core = {
    schema_version: 1,
    rows: rows.map(({ table, entity_id, field, method, value, low, high }) => ({
      table, entity_id, field, method, value, low, high,
    })),
  };
  return await sha256Hex(`${ESTIMATOR_AGENT_ID} ${ESTIMATOR_ARTIFACT_TYPE} ${canonicalJson(core)}`);
}

function summarizeEstimateRows(rows: NormalizedEstimateRow[]): string {
  const groups = new Map<string, number>();
  for (const r of rows) {
    const label = `${r.table}.${r.field} via ${r.method}`;
    groups.set(label, (groups.get(label) ?? 0) + 1);
  }
  return [...groups.entries()].map(([label, n]) => `${n} × ${label}`).join("; ");
}

async function draftParameterEstimate(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolEnvelope> {
  const tool = "draft_parameter_estimate";

  // §13.2 checkpoints 2-3: deployment kill switch + agent_proposals capability.
  if (!deploymentEnabledAgents().includes(ESTIMATOR_AGENT_ID)) {
    return failure(tool, "agent_disabled", "The Cost Estimator agent is not enabled in this deployment.");
  }
  if (!ctx.draft || !ctx.draft.canProposals) {
    return failure(tool, "agent_disabled", "Proposal drafting is not enabled for this account (agent_proposals).");
  }

  const normalized = normalizeEstimateRows(args.rows);
  if ("code" in normalized) return failure(tool, normalized.code, normalized.reason);
  const rows = normalized.rows;

  // Grounding data: the same tables + live defaults the gate grades.
  let dataset, defaults;
  try {
    [dataset, defaults] = await Promise.all([
      loadGateDataset(ctx.supabase, ctx.projectId),
      loadPolicyDefaults(ctx.supabase, ctx.projectId),
    ]);
  } catch (e) {
    console.warn("draft_parameter_estimate dataset load failed:", (e as Error).message);
    return failure(tool, "dependency_missing", "Could not load the project's item-master tables — try again.");
  }
  const inputs: EstimatorInputs = { dataset, defaults };

  // §18.1 hard gate 3: every entity_id must exist in this project.
  const idSets = entityIdSets(dataset);
  const unknown = rows.filter((r) => !idSets[r.table].has(r.entity_id));
  if (unknown.length > 0) {
    const names = [...new Set(unknown.map((r) => `${r.table}:${r.entity_id}`))].slice(0, 10);
    return failure(
      tool,
      "project_scope_violation",
      `These entities are not in this project: ${names.join(", ")}`,
    );
  }

  // §18.1 hard gates 1/2/5/6: recompute every row through its named
  // method@version — value, low AND high each within 1e-9; firm-level and
  // mistargeted methods are invalid_params; demoted methods are not_grounded.
  const enriched: Array<Record<string, unknown>> = [];
  const usedMethods = new Map<string, EstimatorMethod>();
  for (const r of rows) {
    const check = verifyEstimateRow(r, inputs);
    if (!check.ok || !check.method || !check.estimate) {
      return failure(tool, check.code ?? "not_grounded", check.reason ?? "estimate recomputation failed");
    }
    usedMethods.set(methodRef(check.method), check.method);
    // Server-enriched payload row (§18.1 output contract): the recomputed
    // triple (verified equal within tolerance) + registry metadata — the LLM
    // never writes family/basis/sources/assumptions.
    enriched.push({
      table: r.table,
      entity_id: r.entity_id,
      field: r.field,
      value: check.estimate.value,
      low: check.estimate.low,
      high: check.estimate.high,
      method: methodRef(check.method),
      family: check.method.family,
      basis: check.estimate.basis,
      sources: check.method.sources.map((s) => ({ dataset: s.dataset, vintage: s.vintage })),
      assumptions: check.method.assumptions,
      ...(r.why ? { why: r.why } : {}),
    });
  }

  const payload = { schema_version: 1, prompt_version: ESTIMATOR_PROMPT_VERSION, rows: enriched };
  if (canonicalJson(payload).length > MAX_PAYLOAD_BYTES) {
    return failure(tool, "too_large", "The estimate set exceeds the 256 KB payload limit — narrow the ask.");
  }

  // §18.1: provenance is ALWAYS deterministic — every row was recomputed.
  const provenance = "deterministic";

  // Citations (§4.3, closed enum): each method as a `document` citation into
  // the registry (repo path + anchor), the seed table once when any prior
  // source is consumed, and `table_rows` per ground table read.
  const citations: Array<Record<string, unknown>> = [];
  const groundRows = new Map<string, string[]>();
  let anyPrior = false;
  for (const [ref, method] of usedMethods) {
    citations.push({ kind: "document", ref: `supabase/functions/_shared/estimators.ts#${ref}` });
    if (method.sources.some((s) => s.role === "prior")) anyPrior = true;
    for (const t of method.groundTables) {
      if (!groundRows.has(t)) groundRows.set(t, []);
    }
  }
  if (anyPrior) {
    citations.push({
      kind: "document",
      ref: `supabase/functions/_shared/estimatorBenchmarks.json#v${BENCHMARK_TABLE_VERSION}`,
    });
  }
  for (const r of rows) {
    const method = usedMethods.get(r.method);
    for (const t of method?.groundTables ?? []) groundRows.get(t)?.push(r.entity_id);
  }
  for (const [table, ids] of groundRows) {
    citations.push({ kind: "table_rows", ref: table, rows: [...new Set(ids)].slice(0, 200) });
  }
  if (citations.length > MAX_CITATIONS) citations.length = MAX_CITATIONS;

  // Grounding freshness (§18.1 failure modes): stale estimates after a CSV
  // re-upload expire via graph_hash drift.
  let grounding: Record<string, unknown> = {};
  try {
    const { data: gh } = await ctx.supabase.rpc("current_graph_hash", { p_project_id: ctx.projectId });
    if (typeof gh === "string" && gh) grounding = { graph_hash: gh };
  } catch { /* grounding hash is best-effort; TTL still bounds the card */ }

  const idemKey = await estimatorIdempotencyKey(rows);
  const entityCount = new Set(rows.map((r) => `${r.table}|${r.entity_id}`)).size;
  const title = (typeof args.title === "string" && args.title.trim()
    ? args.title.trim()
    : `Parameter estimates: ${rows.length} field(s) across ${entityCount} entit${entityCount === 1 ? "y" : "ies"}`)
    .slice(0, 140);
  const summary = summarizeEstimateRows(rows);

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
        artifact_type: ESTIMATOR_ARTIFACT_TYPE,
        summary,
        provenance,
        duplicate: true,
      });
    }
  } catch { /* the RPC's own idempotency check still converges below */ }

  const { data: proposalId, error } = await ctx.supabase.rpc("create_agent_proposal", {
    p_project_id: ctx.projectId,
    p_agent_id: ESTIMATOR_AGENT_ID,
    p_artifact_type: ESTIMATOR_ARTIFACT_TYPE,
    p_title: title,
    p_payload: payload,
    p_citations: citations,
    p_provenance: provenance,
    p_grounding: grounding,
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
    if (msg.includes("too_large")) return failure(tool, "too_large", msg);
    console.error("create_agent_proposal failed:", msg);
    return { kind: "text", data: "Filing the proposal failed — try again.", meta: { tool, row_count: 0, note: "error" } };
  }

  return proposalEnvelope(tool, {
    proposal_id: String(proposalId),
    status: "proposed",
    title,
    artifact_type: ESTIMATOR_ARTIFACT_TYPE,
    summary,
    provenance,
  });
}

// Register into the shared executeTool registry (bridge 2). Personas never
// see these tools — only the Estimator's least-privilege subset
// (estimatorToolDeclarations) declares them.
registerToolHandler("get_parameter_estimates", getParameterEstimates);
registerToolHandler("draft_parameter_estimate", draftParameterEstimate);
