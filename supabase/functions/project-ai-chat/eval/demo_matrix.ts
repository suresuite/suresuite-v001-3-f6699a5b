// Phase H4 demo (ai-agents.md §24.3 H4 acceptance): a full LIVE-MODE
// run_model_eval.ts --matrix run — mode:"model", the real runChat/classifier
// HTTP layer, the real scoring, the real REST writer — executed offline by
// swapping fetch for (a) a DETERMINISTIC scripted provider that answers like
// a well-behaved gemini-2.5-flash (per-fixture scripts derived from the
// fixtures themselves, the §7.7 judge included), and (b) an in-memory
// Supabase REST stand-in that honors the (model_code, capability_id)
// on_conflict upsert. What it proves, printed at the end:
//   * matrix rows exist for EVERY enabled model × EVERY §23.2 capability
//     (gemini-2.5-flash is the enabled set here — the only provider key);
//   * the report and the table AGREE row for row;
//   * the run is stamped mode:"model" — never a --mock write (the refusal
//     is pinned separately in matrix_test.ts).
// The nightly deployment run is this exact code path with real providers.
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read --allow-write --allow-net demo_matrix.ts

import { AGENT_PRECEDENCE } from "../router.ts";
import { MATRIX_CAPABILITY_IDS } from "../matrix.ts";
import { runModelEval, type CapabilityRow } from "./run_model_eval.ts";
import type { Row } from "./harness/stub_db.ts";

// ── environment: gemini is the ONLY enabled model; REST goes to the stand-in ─

Deno.env.set("GEMINI_API_KEY", "demo-key");
Deno.env.delete("OPENAI_API_KEY");
Deno.env.delete("DEEPSEEK_API_KEY");
Deno.env.set("SUPABASE_URL", "http://matrix-demo.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "demo-service-key");

// ── fixture loading (the runner's reuse/patch semantics) ─────────────────────

// deno-lint-ignore no-explicit-any
async function loadFixture(dir: string, id: string): Promise<Record<string, any>> {
  const f = JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/${dir}/${id}.json`, import.meta.url)),
  );
  if (f.project_snapshot && "reuse" in f.project_snapshot) {
    const base = await loadFixture(dir, f.project_snapshot.reuse);
    f.project_snapshot = { ...base.project_snapshot, ...(f.project_snapshot.patch ?? {}) };
    if (f.mocked_llm && "reuse" in f.mocked_llm) f.mocked_llm = base.mocked_llm;
    if (base.stub) f.stub = { ...base.stub, ...(f.stub ?? {}) };
  }
  return f;
}

// ── the scripted well-behaved model ──────────────────────────────────────────
// Per-utterance queues of provider responses, built from the fixtures in the
// exact order the runner processes them. A turn consumes entries until its
// final text; duplicate utterances (fixture reuse) consume in build order.

type Entry =
  | { kind: "call"; name: string; args: Record<string, unknown> }
  | { kind: "text"; text: string }
  // cl-04 plan bindings: plan_id/proposal_id read from the conversation's
  // functionResponse envelopes — exactly what a live model does.
  | { kind: "binding"; update: Record<string, unknown> };

const scripts = new Map<string, Entry[]>();
const enqueue = (utterance: string, entries: Entry[]) => {
  scripts.set(utterance, [...(scripts.get(utterance) ?? []), ...entries]);
};

const DRAFT_REPLY = "Drafted — the card below holds the exact values for review before anything applies.";
const REFUSAL_REPLY = "I can't draft that from this project's data as asked — nothing was changed. Tell me the missing piece and I'll retry.";

const STEWARD_FIXTURES = [
  "ds-01-fill-costs", "ds-02-no-source", "ds-03-user-value", "ds-04-enum-guard",
  "ds-05-mixed", "ds-06-scope", "ds-07-idempotent", "ds-08-injection",
];
const AGENT_SUITES: Array<{ dir: string; tool: string; fixtures: string[] }> = [
  { dir: "data-steward", tool: "draft_item_master_update", fixtures: STEWARD_FIXTURES },
  {
    dir: "policy-configurator",
    tool: "draft_policy_bundle",
    fixtures: [
      "pc-01-simple-param", "pc-02-family-default", "pc-03-unknown-field",
      "pc-04-planned-policy", "pc-05-data-demand", "pc-06-run-ready", "pc-07-no-kpi-claims",
    ],
  },
  {
    dir: "vv-analyst",
    tool: "draft_model_card_narrative",
    fixtures: [
      "vv-02-adopt-pass", "vv-03-adopt-fail-tests", "vv-04-no-run",
      "vv-05-gate-skipped", "vv-07-adequacy-quote",
    ],
  },
  {
    dir: "experiment-designer",
    tool: "draft_experiment_spec",
    fixtures: [
      "ed-01-simple-run", "ed-02-new-scenario", "ed-03-no-version",
      "ed-04-doe-honest", "ed-05-ack-forced-false", "ed-06-brief-grounded",
    ],
  },
  {
    dir: "report-builder",
    tool: "draft_decision_report",
    fixtures: [
      "rb-01-run-results", "rb-02-disruption-brief", "rb-03-citation-required",
      "rb-04-no-evidence-run", "rb-05-template-vocabulary",
    ],
  },
];

for (const suite of AGENT_SUITES) {
  for (const id of suite.fixtures) {
    const f = await loadFixture(suite.dir, id);
    const wantsProposal = f.expect.proposal !== undefined || (f.expect.proposal_count ?? 0) >= 1;
    enqueue(
      f.utterance,
      wantsProposal && f.mocked_llm?.args
        ? [{ kind: "call", name: suite.tool, args: f.mocked_llm.args }, { kind: "text", text: DRAFT_REPLY }]
        : [{ kind: "text", text: REFUSAL_REPLY }],
    );
  }
}

// The §19.2 coverage battery: grounded tool call(s) + a grounded reply (the
// fixtures' own clean/honest replies where they exist — the corpus pins that
// they verify clean).
{
  const cov = (id: string) => loadFixture("coverage", id);
  let f = await cov("cov-01-supplier-materials");
  enqueue(f.utterance, [
    { kind: "call", name: "get_supplier_materials", args: f.mocked_llm.args },
    { kind: "text", text: "Supplier 10 supplies 60 materials — the top 50 by exposure are listed below, every one sole-sourced." },
  ]);
  f = await cov("cov-02-material-suppliers");
  enqueue(f.utterance, [
    { kind: "call", name: "get_material_suppliers", args: f.mocked_llm.args },
    { kind: "text", text: "The suppliers are listed below with their prices and lead times." },
  ]);
  f = await cov("cov-03-bom-both-directions");
  enqueue(f.utterance, [
    { kind: "call", name: "get_bom_relations", args: { direction: "material_to_products", target: "M3" } },
    { kind: "call", name: "get_bom_relations", args: { direction: "product_to_materials", target: "XP1" } },
    { kind: "text", text: "Both directions are shown below from the bill of materials." },
  ]);
  f = await cov("cov-04-disambiguation");
  enqueue(f.utterance, [
    { kind: "call", name: "get_supplier_materials", args: f.mocked_llm.args },
    { kind: "text", text: '"acme" matches more than one entity — which did you mean?' },
  ]);
  f = await cov("cov-05-count-not-list");
  enqueue(f.utterance, [
    { kind: "call", name: "get_supplier_risk", args: f.mocked_llm.args },
    { kind: "text", text: f.expect.clean_reply },
  ]);
  f = await cov("cov-06-policy-read");
  enqueue(f.utterance, [
    { kind: "call", name: "get_policy_config", args: {} },
    { kind: "text", text: "The effective policy is shown below, with the default and the override each named." },
  ]);
  f = await cov("cov-07-readiness");
  enqueue(f.utterance, [
    { kind: "call", name: "get_data_completeness", args: {} },
    { kind: "text", text: "The missing fields are listed below." },
  ]);
  f = await cov("cov-08-run-results");
  enqueue(f.utterance, [
    { kind: "call", name: "get_run_results", args: f.mocked_llm.args },
    { kind: "text", text: f.expect.clean_reply },
  ]);
  f = await cov("cov-09-no-data-honesty");
  enqueue(f.utterance, [
    { kind: "call", name: "get_supplier_materials", args: f.mocked_llm.args },
    { kind: "text", text: f.expect.honest_reply },
  ]);
}

// The §7.6 loop slices, in the runner's processing order: cache-hit trio,
// run-needed trio, then the plan-shaped cl-04 turn (script = the fixture's
// own compliant calls + its plan bindings).
{
  for (const id of ["cl-01-cache-hit", "cl-08-engine-version-caveat", "cl-09-multi-sourced-project", "cl-02-cache-miss-proposes", "cl-05-stale-data", "cl-06-reps-upgrade"]) {
    const f = await loadFixture("closed-loop", id);
    enqueue(f.utterance, [
      ...f.mocked_llm.tool_calls.map((tc: { tool: string; args: Record<string, unknown> }) =>
        ({ kind: "call", name: tc.tool, args: tc.args }) as Entry
      ),
      { kind: "text", text: f.mocked_llm.reply },
    ]);
  }
  const f = await loadFixture("closed-loop", "cl-04-approve-resume-cite");
  enqueue(f.utterance, [
    ...f.mocked_llm.tool_calls.map((tc: { tool: string; args: Record<string, unknown> }) =>
      ({ kind: "call", name: tc.tool, args: tc.args }) as Entry
    ),
    ...(f.plan_binding_updates as Record<string, unknown>[]).map((update) =>
      ({ kind: "binding", update }) as Entry
    ),
    { kind: "text", text: f.mocked_llm.reply },
  ]);
}

// ── the routing oracle (the runner's mock oracle, spoken over live HTTP) ─────

const goldenText = await Deno.readTextFile(new URL("./routing.golden.jsonl", import.meta.url));
// deno-lint-ignore no-explicit-any
const goldenRows: Record<string, any>[] = goldenText.trim().split("\n").map((l) => JSON.parse(l));

function classifierAnswer(prompt: string): string {
  const utterance = prompt.slice(prompt.indexOf("USER MESSAGE:") + 14).trim();
  const row = goldenRows.find((r) => r.utterance === utterance);
  const v2 = {
    needs_run: row?.expect.needs_run === true,
    cache_checkable: row?.expect.cache_checkable === true,
  };
  if (row?.mode === "ask" && row.expect.blocked_intent) {
    const intent = row.expect.blocked_intent;
    const agent = AGENT_PRECEDENCE.find((a) =>
      intent.startsWith(
        a === "data-steward"
          ? "steward"
          : a === "policy-configurator"
          ? "policy"
          : a === "vv-analyst"
          ? "vv"
          : a === "experiment-designer"
          ? "exp"
          : "explain",
      )
    ) ?? null;
    return JSON.stringify({
      route: "artifact", agent_id: agent, intent, confidence: 0.95,
      advisory_part: null, artifact_part: utterance, ...v2,
    });
  }
  const e = row?.expect ?? { route: "advisory", agent_id: null, intent: null };
  return JSON.stringify({
    route: e.route,
    agent_id: e.agent_id,
    intent: e.intent,
    confidence: 0.95,
    advisory_part: e.route === "mixed" ? "question part" : null,
    artifact_part: e.route === "mixed" || e.route === "artifact" ? utterance : null,
    ...v2,
  });
}

// ── the fetch dispatcher ─────────────────────────────────────────────────────

const capturedTable = new Map<string, Row>(); // (model_code|capability_id) → row
const capturedEvents: Row[] = [];
let providerCalls = 0;

const geminiParts = (parts: unknown[]) => ({
  candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
});
const geminiText = (text: string) => geminiParts([{ text }]);

// deno-lint-ignore no-explicit-any
function latestEnvelopeField(body: any, tool: string, field: string): string {
  const contents: Array<{ parts?: Array<{ functionResponse?: { name: string; response: { data?: Record<string, unknown> } } }> }> =
    body?.contents ?? [];
  for (let i = contents.length - 1; i >= 0; i--) {
    for (const p of contents[i].parts ?? []) {
      const fr = p.functionResponse;
      if (fr?.name === tool && fr.response?.data && field in fr.response.data) {
        return String((fr.response.data as Record<string, unknown>)[field]);
      }
    }
  }
  return "";
}

// deno-lint-ignore no-explicit-any
function answerProvider(body: any): Response {
  providerCalls++;
  const firstText: string = body?.contents?.[0]?.parts?.[0]?.text ?? "";
  if (firstText.startsWith("You are a verification judge")) {
    return Response.json(geminiText(JSON.stringify({
      faithful: true, unsupported_claims: [], hedged_correctly: true, notes: "grounded",
    })));
  }
  if (firstText.includes("USER MESSAGE:")) {
    return Response.json(geminiText(classifierAnswer(firstText)));
  }
  // A turn call: the last user text is the utterance (agent turns carry the
  // grounding in systemInstruction; history is empty in the eval).
  let utterance = "";
  for (const c of body?.contents ?? []) {
    if (c.role === "user") utterance = c.parts?.map((p: { text?: string }) => p.text ?? "").join("") || utterance;
  }
  const queue = scripts.get(utterance);
  if (!queue || queue.length === 0) {
    throw new Error(`demo provider: no script left for utterance "${utterance.slice(0, 80)}"`);
  }
  const entry = queue.shift()!;
  if (entry.kind === "text") return Response.json(geminiText(entry.text));
  if (entry.kind === "call") {
    return Response.json(geminiParts([{ functionCall: { name: entry.name, args: entry.args } }]));
  }
  // binding: the model reads the ids out of the tool results it was handed.
  const planId = latestEnvelopeField(body, "update_task_plan", "plan_id");
  const proposalId = latestEnvelopeField(body, "draft_experiment_spec", "proposal_id");
  const args = JSON.parse(
    JSON.stringify({ plan_id: planId, ...entry.update }).replaceAll("{PROPOSAL_ID}", proposalId),
  );
  return Response.json(geminiParts([{ functionCall: { name: "update_task_plan", args } }]));
}

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: Request | URL | string, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (url.includes("generativelanguage.googleapis.com")) {
    return Promise.resolve(answerProvider(body));
  }
  if (url.includes("matrix-demo.local/rest/v1/ai_model_capabilities")) {
    if (!url.includes("on_conflict=model_code,capability_id")) {
      return Promise.resolve(new Response("missing on_conflict", { status: 400 }));
    }
    for (const row of body as Row[]) {
      capturedTable.set(`${row.model_code}|${row.capability_id}`, row); // merge-duplicates
    }
    return Promise.resolve(new Response("[]", { status: 201 }));
  }
  if (url.includes("matrix-demo.local/rest/v1/ai_chat_events")) {
    capturedEvents.push(body as Row);
    return Promise.resolve(new Response("[]", { status: 201 }));
  }
  return Promise.reject(new Error(`demo fetch: unexpected URL ${url}`));
}) as typeof fetch;

// ── the LIVE run ─────────────────────────────────────────────────────────────

console.log("═══ Phase H4 demo: LIVE-mode run_model_eval.ts --matrix over the scripted provider ═══");
let report: Record<string, unknown>;
try {
  ({ report } = await runModelEval({
    models: ["gemini-2.5-flash"],
    agents: ["data-steward", "policy-configurator", "vv-analyst", "experiment-designer", "report-builder"],
    mock: false,
    out: null,
    matrix: true,
  }));
} finally {
  globalThis.fetch = realFetch;
}

// ── acceptance assertions ────────────────────────────────────────────────────

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  ok = ok && cond;
};

const matrix = report.matrix as {
  eval_run_id: string;
  measured_at: string;
  rows: CapabilityRow[];
  missing: string[];
  write: Record<string, unknown>;
};

check(report.mode === "model", `the run is mode:"model" — a LIVE run, not mock (mode=${report.mode})`);
check(providerCalls > 0, `the real provider HTTP layer was exercised (${providerCalls} provider calls)`);
check(
  matrix.rows.length === MATRIX_CAPABILITY_IDS.length && matrix.missing.length === 0,
  `matrix rows for EVERY §23.2 capability: ${matrix.rows.length}/${MATRIX_CAPABILITY_IDS.length}, missing=[${matrix.missing}]`,
);
check(
  (report.models as string[]).length === 1 && (report.models as string[])[0] === "gemini-2.5-flash",
  "every ENABLED model is scored (gemini-2.5-flash is the enabled set — the only provider key)",
);
check("written" in matrix.write && matrix.write.written === matrix.rows.length, `the writer upserted ${matrix.write.written} rows`);
check(capturedTable.size === matrix.rows.length, `the table holds exactly the report's rows (${capturedTable.size})`);

let agree = true;
for (const r of matrix.rows) {
  const t = capturedTable.get(`${r.model_code}|${r.capability_id}`);
  if (
    !t || t.score !== r.score || t.target !== r.target || t.pass !== r.pass ||
    t.eval_run_id !== matrix.eval_run_id || t.measured_at !== matrix.measured_at
  ) {
    agree = false;
    console.log(`  ✗ disagreement at ${r.capability_id}: report=${JSON.stringify(r)} table=${JSON.stringify(t)}`);
  }
}
check(agree, "the report and the table AGREE row for row (score/target/pass/eval_run_id/measured_at)");
check(
  capturedEvents.some((e) => e.event_kind === "chat.reply" && String(e.thread_id).startsWith("eval:")),
  "the run recorded into ai_chat_events under the eval:<run-id> thread (§7.4)",
);

console.log("\n── the published matrix (gemini-2.5-flash) ──");
for (const r of matrix.rows) {
  console.log(`  ${r.pass ? "✓" : "✗"} ${r.capability_id.padEnd(26)} score=${r.score.toFixed(3)} target=${r.target} (${matrix.eval_run_id})`);
}

console.log(`\n${ok ? "DEMO PASS" : "DEMO FAIL"} — the §23 matrix is published from a live-mode run and the store agrees with the report.`);
Deno.exit(ok ? 0 : 1);
