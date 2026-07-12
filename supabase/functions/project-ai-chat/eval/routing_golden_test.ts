// routing.golden.jsonl integrity (ai-agents.md §6.5): the seed must satisfy
// the class quotas and every row must be well-formed against the router's
// vocabularies. The model-scored tier (Stage 1+) consumes the same file.

import { assert, assertEquals } from "./harness/asserts.ts";
import { AGENT_PRECEDENCE, AGENT_ROSTER } from "../router.ts";

interface GoldenRow {
  id: string;
  utterance: string;
  expect: { route: string; agent_id: string | null; intent: string | null };
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

Deno.test("single-agent classes stay label-consistent", () => {
  for (const r of rows) {
    const expected = AGENT_CLASS[r.class];
    if (expected) {
      assertEquals(r.expect.route, "artifact", `${r.id}: agent-class rows are artifact routes`);
      assertEquals(r.expect.agent_id, expected, `${r.id}: class/agent mismatch`);
    }
  }
});
