// Phase H1 demo transcript (ai-agents.md §24.3 H1 acceptance): drives the
// REAL H1 machinery offline on the TRON-ver2-shaped dataset — the very
// project of the §19.0 incident (60 suppliers · 560 materials · 560 arcs;
// supplier 10 supplies 187 materials). Three scenes:
//   1. "what does supplier 10 supply?" → get_supplier_materials → the
//      grounded 187-material answer (truncated, noted) + the evidence chip;
//   2. the same ask with the relation tool disabled → the §19.4 bounded
//      honest refusal (count spoken, nothing enumerated);
//   3. a forced-fabrication mock (the five incident ids) → verifier catch →
//      corrective retry → §22.5 fallback; the user never sees the ids.
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read demo_coverage.ts

import { runChat } from "../providers.ts";
import { executeTool, type ToolContext, type ToolEnvelope } from "../tools.ts";
import { personaToolDeclarations } from "../personaTools.ts";
import {
  assembleCitations,
  verifyReply,
  verifyWithRetry,
  type RecordedToolCall,
} from "../verifier.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { makeAgentRpcs, makeStubDb, type Row } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

Deno.env.set("GEMINI_API_KEY", "demo-key");
Deno.env.set("COVERAGE_TOOLS_ENABLED", "true");
Deno.env.set("VERIFIER_ENABLED", "true");

// ── the real dataset (the audited project) ──────────────────────────────────
const ds = JSON.parse(
  await Deno.readTextFile(new URL("../../../../scripts/tron_ver2/dataset.json", import.meta.url)),
);
const tables: Record<string, Row[]> = {
  suppliers: ds.suppliers.map((s: Row) => ({ project_id: PROJECT, ...s })),
  materials: ds.materials.map((m: Row) => ({ project_id: PROJECT, ...m })),
  products: ds.products.map((p: Row) => ({ project_id: PROJECT, ...p })),
  inbound_logistics: ds.inbound.map((r: Row) => ({ project_id: PROJECT, ...r })),
  outbound_logistics: ds.outbound.map((r: Row) => ({ project_id: PROJECT, ...r })),
  bom_multi_level: ds.bom.map((r: Row) => ({
    project_id: PROJECT,
    material_id: r.material_id,
    higher_level_component_id: r.product_id,
    level: 1,
    consumption_rate: r.consumption_rate,
  })),
};
const db = makeStubDb(tables, makeAgentRpcs(tables));
const ctx: ToolContext = { projectId: PROJECT, userId: USER, supabase: db as unknown as ToolContext["supabase"] };

const say = (who: string, text: string) => console.log(`\n[${who}]\n${text}`);
const geminiText = (text: string) => ({ json: { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] } });
const geminiCall = (name: string, args: Record<string, unknown>) => ({ json: { candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args } }] }, finishReason: "STOP" }] } });

const utterance = "what does supplier 10 supply?";
const INCIDENT_IDS = ["007507784A", "007507785A", "007507786A", "007507787A", "007507788A"];

// ── scene 1: the grounded answer (tool enabled) ─────────────────────────────
console.log("═══ SCENE 1 — COVERAGE_TOOLS_ENABLED: the grounded 187-material answer ═══");
say("user", utterance);

// Peek at the envelope first so the scripted model text quotes real rows —
// the same handler the live turn will call.
const peek = await executeTool("get_supplier_materials", { supplier: "10" }, ctx);
const peekRows = (peek.data as { rows: unknown[][] }).rows;
const topMaterial = String(peekRows[0][0]);
const groundedText =
  `Supplier 10 (TTI INC) supplies 187 materials — every one of them sole-sourced, ` +
  `so it's your single biggest concentration risk. The table shows the top 50 by exposure; ` +
  `the longest-lead item is ${topMaterial}. Want the full list paged, or the risk breakdown?`;

const calls1: RecordedToolCall[] = [];
const mock1 = installFetchMock([
  geminiCall("get_supplier_materials", { supplier: "10" }),
  geminiText(groundedText),
]);
let result1;
try {
  result1 = await runChat("gemini-2.5-flash", utterance, [], ctx, null, {
    tools: personaToolDeclarations(),
    onToolResult: (name, args, envelope) => calls1.push({ name, args, envelope }),
  });
} finally {
  mock1.restore();
}
const verdict1 = await verifyWithRetry({
  projectId: PROJECT,
  db,
  userMessage: utterance,
  attempt: { reply: result1.reply, calls: calls1 },
  retry: null,
});
say("tool → get_supplier_materials", `kind=${calls1[0].envelope.kind} row_count=${calls1[0].envelope.meta.row_count}\nnote="${calls1[0].envelope.meta.note}"`);
say("assistant (verified)", verdict1.reply);
say("evidence part (the 'grounded — N sources' chip)", JSON.stringify({
  kind: "evidence",
  data: { citations: verdict1.citations, verified: verdict1.verified, fallback: verdict1.fallback },
}, null, 2));
if (!verdict1.verified) throw new Error("scene 1 must verify");

// ── scene 2: relation tool disabled → the §19.4 bounded refusal ─────────────
console.log("\n═══ SCENE 2 — relation tool DISABLED: the §19.4 bounded honest refusal ═══");
Deno.env.set("COVERAGE_TOOLS_ENABLED", "false");
say("user", utterance);
const declared = personaToolDeclarations().map((d) => d.name);
say("persona surface", declared.join(", ") + "  (no supplier→materials tool)");

const refusalText =
  `I can't list supplier 10's materials individually yet, but I can tell you it supplies 187 — ` +
  `all 187 sole-sourced, and it's your top supplier by spend. Want the risk breakdown?`;
const calls2: RecordedToolCall[] = [];
const mock2 = installFetchMock([
  geminiCall("get_supplier_risk", { supplier: "10" }),
  geminiText(refusalText),
]);
let result2;
try {
  result2 = await runChat("gemini-2.5-flash", utterance, [], ctx, null, {
    tools: personaToolDeclarations(),
    onToolResult: (name, args, envelope) => calls2.push({ name, args, envelope }),
  });
} finally {
  mock2.restore();
}
const check2 = await verifyReply({
  reply: result2.reply,
  calls: calls2,
  citations: [],
  userMessage: utterance,
  projectId: PROJECT,
  db,
});
say("tool → get_supplier_risk (count, not list)", `row_count=${calls2[0].envelope.meta.row_count}`);
say("assistant (bounded refusal — verifier: " + (check2.ok ? "PASS" : "FAIL") + ")", result2.reply);
if (!check2.ok) throw new Error("the bounded refusal must always be shippable");
for (const id of INCIDENT_IDS) {
  if (result2.reply.includes(id)) throw new Error("refusal must enumerate nothing");
}
Deno.env.set("COVERAGE_TOOLS_ENABLED", "true");

// ── scene 3: forced fabrication → verifier fallback ─────────────────────────
console.log("\n═══ SCENE 3 — forced fabrication: the §22.3 catch → retry → §22.5 fallback ═══");
say("user", utterance);
const fabricated = `Supplier 10 supplies these materials: ${INCIDENT_IDS.join(", ")}.`;
say("model draft #1 (fabricated — the real §19.0 incident ids; they belong to supplier 41679)", fabricated);

const calls3: RecordedToolCall[] = [];
const mock3 = installFetchMock([
  geminiCall("get_supplier_materials", { supplier: "10" }),
  geminiText(fabricated),
]);
let result3;
try {
  result3 = await runChat("gemini-2.5-flash", utterance, [], ctx, null, {
    tools: personaToolDeclarations(),
    onToolResult: (name, args, envelope) => calls3.push({ name, args, envelope }),
  });
} finally {
  mock3.restore();
}
let addendumShown = "";
const verdict3 = await verifyWithRetry({
  projectId: PROJECT,
  db,
  userMessage: utterance,
  attempt: { reply: result3.reply, calls: calls3 },
  retry: (addendum) => {
    addendumShown = addendum;
    // The mocked model doubles down — the fallback must save the user.
    return Promise.resolve({ reply: fabricated, calls: calls3 });
  },
});
say("verifier → corrective addendum (the ONE retry)", addendumShown);
say("model draft #2 (still fabricated)", fabricated);
say("assistant (deterministic §22.5 fallback — the user NEVER sees the ids)", verdict3.reply);
say("verifier.blocked_reply telemetry payload (§7.5: counts only)", JSON.stringify({
  violations: verdict3.violationCounts,
  retried: verdict3.retried,
  model_code: "gemini-2.5-flash",
}));
if (!verdict3.fallback) throw new Error("scene 3 must fall back");
for (const id of INCIDENT_IDS) {
  if (verdict3.reply.includes(id)) throw new Error(`fabricated id ${id} leaked to the user`);
}

console.log("\n═══ demo complete: grounded answer · bounded refusal · fallback — all three floors hold ═══");
