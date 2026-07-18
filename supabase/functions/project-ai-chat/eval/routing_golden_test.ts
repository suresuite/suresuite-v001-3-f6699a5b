// routing.golden.jsonl integrity (ai-agents.md §6.5): the seed must satisfy
// the class quotas and every row must be well-formed against the router's
// vocabularies. The model-scored tier (Stage 1+) consumes the same file.

import { assert, assertEquals } from "./harness/asserts.ts";
import { AGENT_PRECEDENCE, AGENT_ROSTER } from "../router.ts";
import { ASK_MODE_AGENT_ALLOWLIST } from "../modes.ts";

interface GoldenRow {
  id: string;
  utterance: string;
  /** §15 ask-mode fixtures: the row is classified normally, then the mode
   * subtracts at checkpoint 2 — expected route is post-mode. */
  mode?: string;
  expect: {
    route: string;
    agent_id: string | null;
    intent: string | null;
    /** ask-mode rows: the intent the mode is expected to subtract (null for
     * advisory asks, which ask mode never touches). */
    blocked_intent?: string | null;
    /** §6.6 (H2): optional v2-signal labels — absent means expected false. */
    needs_run?: boolean;
    cache_checkable?: boolean;
  };
  class: string;
  retired_reason: string | null;
}

const text = await Deno.readTextFile(new URL("./routing.golden.jsonl", import.meta.url));
const rows: GoldenRow[] = text.trim().split("\n").map((l) => JSON.parse(l));

const AGENT_CLASS: Record<string, string> = {
  steward: "data-steward",
  policy: "policy-configurator",
  vv: "vv-analyst",
  exp: "experiment-designer",
  explain: "explainer",
  report: "report-builder",
};

Deno.test("class quotas meet the §6.5 seed requirements", () => {
  const byClass = new Map<string, number>();
  for (const r of rows) byClass.set(r.class, (byClass.get(r.class) ?? 0) + 1);
  for (const cls of Object.keys(AGENT_CLASS)) {
    assert((byClass.get(cls) ?? 0) >= 25, `≥25 utterances required for class ${cls}, got ${byClass.get(cls)}`);
  }
  assert((byClass.get("advisory") ?? 0) >= 25, "≥25 advisory utterances required");
  assert((byClass.get("mixed") ?? 0) >= 15, "≥15 mixed utterances required");
  assert((byClass.get("adversarial") ?? 0) >= 10, "≥10 adversarial utterances required");
  assert(rows.length >= 150, `≥150 total labeled utterances required, got ${rows.length}`);
});

Deno.test("every row is well-formed against the router vocabularies", () => {
  const ids = new Set<string>();
  const utterances = new Set<string>();
  for (const r of rows) {
    assert(r.id && !ids.has(r.id), `duplicate/missing id: ${r.id}`);
    ids.add(r.id);
    assert(r.utterance.trim().length >= 5, `${r.id}: utterance too short`);
    assert(!utterances.has(r.utterance), `${r.id}: duplicate utterance`);
    utterances.add(r.utterance);
    assert(["advisory", "artifact", "mixed"].includes(r.expect.route), `${r.id}: bad route`);
    if (r.expect.route === "advisory") {
      assertEquals(r.expect.agent_id, null, `${r.id}: advisory rows carry no agent`);
    } else {
      const agent = r.expect.agent_id as string;
      assert((AGENT_PRECEDENCE as readonly string[]).includes(agent), `${r.id}: unknown agent ${agent}`);
      assert(
        r.expect.intent !== null &&
          AGENT_ROSTER[agent as keyof typeof AGENT_ROSTER].intents.includes(r.expect.intent),
        `${r.id}: intent ${r.expect.intent} does not belong to ${agent}`,
      );
    }
    assertEquals(r.retired_reason, null, `${r.id}: seed rows are never retired`);
  }
});

Deno.test("§6.6 v2-signal labels are well-formed and sufficiently seeded (H2)", () => {
  let needsTrue = 0;
  let cacheTrue = 0;
  for (const r of rows) {
    for (const key of ["needs_run", "cache_checkable"] as const) {
      const v = r.expect[key];
      assert(v === undefined || typeof v === "boolean", `${r.id}: ${key} must be boolean when present`);
    }
    if (r.expect.needs_run === true) needsTrue++;
    if (r.expect.cache_checkable === true) cacheTrue++;
    // A cache-checkable ask is by definition result-shaped; on artifact rows
    // that means the Experiment Designer owns it (results live in runs).
    if (r.expect.cache_checkable === true && r.expect.route === "artifact") {
      assertEquals(r.expect.agent_id, "experiment-designer", `${r.id}: cache-checkable artifact asks are B4's`);
    }
  }
  // Enough positives that the §6.6 recall/precision targets are measurable.
  assert(needsTrue >= 20, `≥20 needs_run=true labels required (got ${needsTrue})`);
  assert(cacheTrue >= 10, `≥10 cache_checkable=true labels required (got ${cacheTrue})`);
  // Every exp-class row carries a needs_run label (a run-shaped ask is the
  // signal's home class — unlabeled exp rows would silently score as false).
  for (const r of rows.filter((x) => x.class === "exp")) {
    assertEquals(typeof r.expect.needs_run, "boolean", `${r.id}: exp rows must be needs_run-labeled`);
  }
});

Deno.test("single-agent classes stay label-consistent", () => {
  for (const r of rows) {
    const expected = AGENT_CLASS[r.class];
    if (expected) {
      assertEquals(r.expect.route, "artifact", `${r.id}: agent-class rows are artifact routes`);
      assertEquals(r.expect.agent_id, expected, `${r.id}: class/agent mismatch`);
    }
  }
});

Deno.test("ask-mode rows are well-formed (§15: post-mode route is advisory — except the §16.1 allowlist agent; the subtracted intent is a real label)", () => {
  const allIntents = new Set(
    (AGENT_PRECEDENCE as readonly string[]).flatMap((a) => AGENT_ROSTER[a as keyof typeof AGENT_ROSTER].intents),
  );
  const askRows = rows.filter((r) => r.mode !== undefined);
  assert(askRows.length >= 5, `≥5 ask-mode fixtures required (got ${askRows.length})`);
  for (const r of askRows) {
    assertEquals(r.mode, "ask", `${r.id}: only 'ask' fixtures exist ('auto' does not, §10 Q23)`);
    assertEquals(r.class, "ask-mode", `${r.id}: ask fixtures carry their own class`);
    if (r.expect.route === "advisory") {
      assertEquals(r.expect.agent_id, null, `${r.id}: advisory ask rows carry no agent`);
    } else {
      // §15/§16.1: report-builder is the ONE agent routable in Ask mode —
      // its rows survive the mode subtraction as artifact routes.
      assertEquals(r.expect.route, "artifact", `${r.id}: non-advisory ask rows must be artifact routes`);
      assert(
        ASK_MODE_AGENT_ALLOWLIST.includes(String(r.expect.agent_id)),
        `${r.id}: only the §15 allowlist (${ASK_MODE_AGENT_ALLOWLIST.join(", ")}) may execute in ask mode`,
      );
      assertEquals(r.expect.blocked_intent ?? null, null, `${r.id}: an executed intent is never a blocked intent`);
    }
    if (r.expect.blocked_intent != null) {
      assert(allIntents.has(r.expect.blocked_intent), `${r.id}: unknown blocked intent ${r.expect.blocked_intent}`);
    }
  }
  assert(askRows.some((r) => r.expect.blocked_intent == null && r.expect.route === "advisory"),
    "at least one advisory control row");
});
