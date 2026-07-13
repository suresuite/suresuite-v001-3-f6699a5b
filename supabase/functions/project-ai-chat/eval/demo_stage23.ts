// Stage 2/3 + M2 end-to-end demo transcript (ai-agents.md §9.3/§9.4/§14.7
// acceptance): drives the REAL machinery offline and prints the four
// acceptance scenarios:
//   (a) "set review period to 2 weeks for MAT-4" → card → apply → new
//       policy_versions row labeled "agent:" with the correct parent and a
//       zero-block post-grade;
//   (b) an out-of-band policy edit between approve and apply fails cleanly
//       with stale_values;
//   (c) "adopt these validation results" → card whose computed block equals
//       the evidence run's persisted stats verbatim → record_model_validation
//       supersedes the prior card;
//   (d) a saved project memory is cited in a later B2 draft and shows a stale
//       chip after a CSV re-upload (graph-hash drift).
// The SQL-side counterparts run against scratch Postgres in db_stage23_test.ts.
//
//   cd supabase/functions/project-ai-chat/eval
//   deno run --allow-env --allow-read demo_stage23.ts

import { decideRoute } from "../router.ts";
import { type ToolContext } from "../tools.ts";
import { runAgentTurn } from "../agentTurn.ts";
import {
  isMemoryStale,
  memoryContextBlock,
  saveExplicitMemory,
  detectExplicitMemoryRequest,
} from "../memory.ts";
import { buildConfiguratorContext } from "../configuratorTools.ts";
import { applyPolicyBundle } from "../../agent-apply/policyBundleApply.ts";
import { applyModelCard } from "../../agent-apply/modelCardApply.ts";
import { ApplyFailure } from "../../agent-apply/itemMasterApply.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import { makeAgentRpcs, makeStubDb, type Row, type StubDb } from "./harness/stub_db.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";

Deno.env.set("AGENT_ROUTER_ENABLED", "true");
Deno.env.set("AGENT_ENABLED_IDS", "policy-configurator,vv-analyst");
Deno.env.set("PROJECT_MEMORY_ENABLED", "true");
Deno.env.set("GEMINI_API_KEY", "demo-key");

const say = (who: string, text: string) => console.log(`\n[${who}]\n${text}`);

async function loadSnapshot(dir: string, id: string): Promise<Record<string, Row[]>> {
  const f = JSON.parse(
    await Deno.readTextFile(new URL(`./fixtures/${dir}/${id}.json`, import.meta.url)),
  );
  return structuredClone(f.project_snapshot) as Record<string, Row[]>;
}

function ctxFor(db: StubDb, utterance: string): ToolContext {
  return {
    projectId: PROJECT,
    userId: USER,
    supabase: db as unknown as ToolContext["supabase"],
    draft: {
      userEmail: "demo@example.com",
      threadId: THREAD,
      modelCode: "gemini-2.5-flash",
      providerCode: "gemini",
      canProposals: true,
      utterance,
    },
  };
}

function scriptedTurn(tool: string, args: Record<string, unknown>, reply: string) {
  return installFetchMock([
    { json: { candidates: [{ content: { parts: [{ functionCall: { name: tool, args } }] } }] } },
    { json: { candidates: [{ content: { parts: [{ text: reply }] } }] } },
  ]);
}

// ═══ (a) policy bundle: ask → card → apply → agent-labeled snapshot ══════════
console.log("\n════ (a) policy bundle: draft → approve → apply ════");
{
  const tables = await loadSnapshot("policy-configurator", "pc-01-simple-param");
  const db = makeStubDb(tables, makeAgentRpcs(tables));
  const utterance = "set review period to 2 weeks for MAT-4";
  say("user", utterance);

  const decision = await decideRoute(utterance, {
    personaId: "inventory-strategist",
    hasProject: true,
    enabledAgents: ["policy-configurator", "vv-analyst"],
    modelId: "gemini-2.5-flash",
  }, () =>
    Promise.resolve(JSON.stringify({
      route: "artifact", agent_id: "policy-configurator", intent: "policy.configure",
      confidence: 0.95, advisory_part: null, artifact_part: utterance,
    })));
  say("router.decision", JSON.stringify(decision));

  const mock = scriptedTurn("draft_policy_bundle", {
    diff: { overrides: [{ scope: "node", target_key: "MAT-4", family: "inventory", patch: { review_period_days: 14 } }] },
    title: "Review period 2 weeks for MAT-4",
  }, "Drafted the change — review the card; applying will create a policy version snapshot.");
  const turn = await runAgentTurn({ agentId: "policy-configurator", modelId: "gemini-2.5-flash", utterance, ctx: ctxFor(db, utterance) });
  mock.restore();
  say("policy-configurator", turn.reply);
  const card = db.tables.proposals[0];
  say("proposal card", `${card.title} · ${card.status} · provenance ${card.provenance}`);

  card.status = "approved"; // the card's Approve (rights pinned in db_rpc_test)
  const result = await applyPolicyBundle(db, {
    projectId: PROJECT,
    title: String(card.title),
    payload: card.payload as Record<string, unknown>,
    grounding: card.grounding as Record<string, unknown>,
    userId: USER,
  });
  const version = db.tables.policy_versions.find((v) => String(v.id) === result.policy_version_id)!;
  say("applied", JSON.stringify({
    policy_version_label: version.label,
    parent_version_id: version.parent_version_id,
    post_grade_blocks: result.findings.filter((f) => f.severity === "block").length,
  }));
}

// ═══ (b) out-of-band edit between approve and apply ⇒ stale_values ═══════════
console.log("\n════ (b) stale_values on out-of-band policy edit ════");
{
  const tables = await loadSnapshot("policy-configurator", "pc-01-simple-param");
  const db = makeStubDb(tables, makeAgentRpcs(tables));
  const utterance = "set review period to 2 weeks for MAT-4";
  const mock = scriptedTurn("draft_policy_bundle", {
    diff: { overrides: [{ scope: "node", target_key: "MAT-4", family: "inventory", patch: { review_period_days: 14 } }] },
  }, "Drafted.");
  await runAgentTurn({ agentId: "policy-configurator", modelId: "gemini-2.5-flash", utterance, ctx: ctxFor(db, utterance) });
  mock.restore();
  const card = db.tables.proposals[0];
  card.status = "approved";
  say("out-of-band", "a human flips inventory type to (R,Q) on /policies after the approve…");
  (db.tables.policy_defaults[0] as Row).inventory = { type: "rop" };
  try {
    await applyPolicyBundle(db, {
      projectId: PROJECT,
      title: String(card.title),
      payload: card.payload as Record<string, unknown>,
      grounding: card.grounding as Record<string, unknown>,
    });
  } catch (e) {
    if (e instanceof ApplyFailure) say("apply failed cleanly", `${e.code}: ${e.message}`);
    else throw e;
  }
}

// ═══ (c) model card: adopt → computed verbatim → supersede ═══════════════════
console.log("\n════ (c) model card: adopt → record_model_validation supersedes ════");
{
  const tables = await loadSnapshot("vv-analyst", "vv-08-apply");
  const db = makeStubDb(tables, makeAgentRpcs(tables));
  const utterance = "adopt these validation results";
  say("user", utterance);
  const mock = scriptedTurn("draft_model_card_narrative", {
    evidence_run_id: "66666666-6666-4666-8666-666666666601",
    verdict: "validated", basis: "statistical",
    narrative_md: "All persisted tests pass and adequacy is met.",
  }, "Drafted the adoption card — it must be reviewed and approved before it governs Lab runs.");
  const turn = await runAgentTurn({ agentId: "vv-analyst", modelId: "gemini-2.5-flash", utterance, ctx: ctxFor(db, utterance) });
  mock.restore();
  say("vv-analyst", turn.reply);
  const card = db.tables.proposals[0];
  const computed = (card.payload as Record<string, unknown>).computed as Record<string, unknown>;
  say("card computed (handler-read, verbatim from the run)", JSON.stringify({
    adopted_warmup_days: computed.adopted_warmup_days,
    warmup_method: computed.warmup_method,
    recommended_replications: computed.recommended_replications,
  }));

  card.status = "approved";
  const result = await applyModelCard(db, { projectId: PROJECT, payload: card.payload as Record<string, unknown>, userId: USER });
  const prior = db.tables.model_validations.find((c) => String(c.id) === "88888888-8888-4888-8888-888888888801")!;
  say("applied", JSON.stringify({
    model_validation_id: result.model_validation_id,
    prior_card_status: prior.status,
    prior_superseded_by: prior.superseded_by,
  }));
}

// ═══ (d) project memory: save → cited in a B2 draft → stale after re-upload ══
console.log("\n════ (d) project memory: consented save → citation → stale chip ════");
{
  const tables = await loadSnapshot("policy-configurator", "pc-01-simple-param");
  const db = makeStubDb(tables, makeAgentRpcs(tables));
  const rememberAsk = "remember that we review inventory fortnightly across the board";
  say("user", rememberAsk);
  const explicit = detectExplicitMemoryRequest(rememberAsk)!;
  const saved = await saveExplicitMemory(db, {
    projectId: PROJECT, userId: USER, threadId: THREAD,
    content: explicit.content, kind: explicit.kind,
  });
  say("assistant", `Saved to project memory (${explicit.kind}): “${explicit.content}”`);

  const utterance = "make MAT-4's review period two weeks";
  const context = await buildConfiguratorContext(ctxFor(db, utterance), { utterance });
  say("B2 grounding context (excerpt)", context.split("\n").filter((l) => l.includes("PROJECT MEMORY") || l.includes("fortnightly")).join("\n"));

  const mock = scriptedTurn("draft_policy_bundle", {
    diff: { overrides: [{ scope: "node", target_key: "MAT-4", family: "inventory", patch: { review_period_days: 14 } }] },
  }, "Drafted, consistent with the saved fortnightly-review preference.");
  await runAgentTurn({ agentId: "policy-configurator", modelId: "gemini-2.5-flash", utterance, ctx: ctxFor(db, utterance) });
  mock.restore();
  const card = db.tables.proposals[0];
  const memoryCitations = (card.citations as Array<{ kind: string; ref: string }>)
    .filter((c) => c.kind === "document");
  say("draft citations", JSON.stringify(memoryCitations));

  say("out-of-band", "a CSV re-upload changes the graph hash…");
  const memRow = db.tables.project_memory.find((m) => String(m.id) === saved.id)! as unknown as Parameters<typeof isMemoryStale>[0];
  const stale = isMemoryStale(memRow, { policyHash: null, graphHash: "graph-hash-AFTER-REUPLOAD" });
  const { block } = memoryContextBlock([memRow], { policyHash: null, graphHash: "graph-hash-AFTER-REUPLOAD" });
  say("memory panel", `stale chip: ${stale} · context line: ${block.split("\n")[1]}`);
}

console.log("\ndemo complete — all four acceptance scenarios exercised.\n");
