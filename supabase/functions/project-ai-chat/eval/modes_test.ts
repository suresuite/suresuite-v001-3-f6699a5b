// §15 interaction modes, deterministic tier: mode resolution (server row >
// body hint > default), the checkpoint-2 subtraction (ask ⇒ artifact routes
// disabled; modes only SUBTRACT — never grant), the mode-notice contract, and
// the ask-mode golden fixtures (classification still detects the intent; the
// mode blocks it; mode.blocked_intent is the recorded signal). No LLM — the
// classifier is the mocked oracle, exactly as §7.4 tier 1 prescribes.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeStubDb, type Row } from "./harness/stub_db.ts";
import {
  applyModeToRoute,
  ASK_MODE_AGENT_ALLOWLIST,
  DEFAULT_CHAT_MODE,
  MODE_NOTICE_TEXT,
  modeNoticePart,
  modesEnabled,
  resolveThreadMode,
} from "../modes.ts";
import { decideRoute, type ClassifierCall, type RoutedDecision } from "../router.ts";

const THREAD = "33333333-3333-4333-8333-333333333333";

interface GoldenRow {
  id: string;
  utterance: string;
  mode?: string;
  expect: { route: string; agent_id: string | null; intent: string | null; blocked_intent?: string | null };
  class: string;
}

const goldenText = await Deno.readTextFile(new URL("./routing.golden.jsonl", import.meta.url));
const goldenRows: GoldenRow[] = goldenText.trim().split("\n").map((l) => JSON.parse(l));
const askRows = goldenRows.filter((r) => r.mode === "ask");

function artifactDecision(agentId: string, intent: string): RoutedDecision {
  return {
    route: "artifact",
    agent_id: agentId as RoutedDecision["agent_id"],
    intent,
    confidence: 0.95,
    advisory_part: null,
    artifact_part: "do it",
    needs_run: false,
    cache_checkable: false,
    short_circuit: null,
  };
}

Deno.test("flag: CHAT_MODES_ENABLED default off ⇒ every thread behaves as review", async () => {
  Deno.env.delete("CHAT_MODES_ENABLED");
  assertEquals(modesEnabled(), false);
  // even an explicit body hint is ignored while the flag is off
  assertEquals(await resolveThreadMode(null, null, "ask"), "review");
  assertEquals(DEFAULT_CHAT_MODE, "review");
});

Deno.test("mode resolution: server row wins over the body; unsynced threads carry the body mode; malformed ⇒ review", async () => {
  Deno.env.set("CHAT_MODES_ENABLED", "true");
  try {
    const db = makeStubDb({ chat_threads: [{ id: THREAD, mode: "ask" } as Row] });
    // synced thread: chat_threads.mode is the source of truth
    assertEquals(await resolveThreadMode(db, THREAD, "review"), "ask", "the stored row wins over the body");
    // unsynced thread (no server row / non-uuid id): the body carries the mode
    assertEquals(await resolveThreadMode(db, null, "ask"), "ask");
    assertEquals(await resolveThreadMode(db, "quick", "ask"), "ask", "non-uuid thread ids fall to the body");
    // malformed / absent ⇒ review (the DEFAULT)
    assertEquals(await resolveThreadMode(db, null, "auto"), "review", "'auto' does not exist (§10 Q23)");
    assertEquals(await resolveThreadMode(db, null, undefined), "review");
  } finally {
    Deno.env.delete("CHAT_MODES_ENABLED");
  }
});

Deno.test("checkpoint 2: ask subtracts every artifact route except the §15 allowlist; review is byte-identical passthrough", () => {
  assertEquals([...ASK_MODE_AGENT_ALLOWLIST], ["report-builder"]);
  for (const agent of ["data-steward", "policy-configurator", "vv-analyst", "experiment-designer"]) {
    const decision = artifactDecision(agent, "x.y");
    const review = applyModeToRoute(decision, "review");
    assertEquals(review.decision, decision, "review never alters the decision");
    assertEquals(review.blocked, null);

    const ask = applyModeToRoute(decision, "ask");
    assertEquals(ask.decision.route, "advisory");
    assertEquals(ask.decision.agent_id, null);
    assertEquals(ask.decision.short_circuit, "mode_ask");
    assertEquals(ask.blocked, { agent_id: agent, intent: "x.y" }, "the blocked intent is preserved for telemetry");
  }
  // advisory routes pass through untouched in every mode (modes only subtract)
  const advisory: RoutedDecision = {
    route: "advisory", agent_id: null, intent: null, confidence: 0,
    advisory_part: null, artifact_part: null,
    needs_run: false, cache_checkable: false, short_circuit: null,
  };
  assertEquals(applyModeToRoute(advisory, "ask").decision, advisory);
  assertEquals(applyModeToRoute(advisory, "ask").blocked, null);
});

Deno.test("the mode notice: server-authored text + the one-click Switch-to-Review chip part", () => {
  assertStringIncludes(MODE_NOTICE_TEXT, "Decision Support");
  assertStringIncludes(MODE_NOTICE_TEXT, "Switch this thread to Review");
  const part = modeNoticePart({ agent_id: "experiment-designer", intent: "exp.design" });
  assertEquals(part.kind, "mode_notice");
  assertEquals(part.data.action, "switch_to_review");
  assertEquals(part.data.label, "Switch to Review");
  assertEquals(part.data.blocked_agent_id, "experiment-designer");
  assertEquals(part.data.blocked_intent, "exp.design");
});

Deno.test("ask-mode golden fixtures: classification detects the intent, the mode blocks it, advisory asks pass", async () => {
  assert(askRows.length >= 5, `ask-mode golden rows required (got ${askRows.length})`);
  Deno.env.set("AGENT_ROUTER_ENABLED", "true");
  try {
    const enabledAgents = ["data-steward", "policy-configurator", "vv-analyst", "experiment-designer", "report-builder"];
    // Oracle classifier (§7.4 tier 1): answers with the underlying intent the
    // utterance would classify to in review mode.
    const oracle: ClassifierCall = (prompt) => {
      const utterance = prompt.slice(prompt.indexOf("USER MESSAGE:") + 14).trim();
      const row = askRows.find((r) => r.utterance === utterance)!;
      if (row.expect.route === "artifact") {
        // §15/§16.1: the allowlist agent (report-builder) — classified
        // normally, and the mode subtraction must let it through.
        return Promise.resolve(JSON.stringify({
          route: "artifact", agent_id: row.expect.agent_id, intent: row.expect.intent,
          confidence: 0.95, advisory_part: null, artifact_part: utterance,
        }));
      }
      const blocked = row.expect.blocked_intent ?? null;
      const agent = blocked
        ? enabledAgents.find((a) => blocked.startsWith(a === "data-steward" ? "steward" : a === "policy-configurator" ? "policy" : a === "vv-analyst" ? "vv" : "exp")) ?? null
        : null;
      return Promise.resolve(JSON.stringify(blocked
        ? { route: "artifact", agent_id: agent, intent: blocked, confidence: 0.95, advisory_part: null, artifact_part: utterance }
        : { route: "advisory", agent_id: null, intent: null, confidence: 0.9, advisory_part: null, artifact_part: null }));
    };

    for (const row of askRows) {
      const raw = await decideRoute(row.utterance, {
        personaId: null,
        hasProject: true,
        enabledAgents,
        modelId: "gemini-2.5-flash",
      }, oracle);
      const { decision, blocked } = applyModeToRoute(raw, "ask");
      assertEquals(decision.route, row.expect.route, `${row.id}: ask mode must return ${row.expect.route}`);
      assertEquals(decision.agent_id, row.expect.agent_id, `${row.id}: no agent may execute`);
      if (row.expect.blocked_intent) {
        assert(blocked, `${row.id}: the subtracted intent must be recorded (mode.blocked_intent)`);
        assertEquals(blocked!.intent, row.expect.blocked_intent, `${row.id}`);
      } else {
        assertEquals(blocked, null, `${row.id}: advisory asks are never 'blocked' by ask mode`);
      }
    }
  } finally {
    Deno.env.delete("AGENT_ROUTER_ENABLED");
  }
});
