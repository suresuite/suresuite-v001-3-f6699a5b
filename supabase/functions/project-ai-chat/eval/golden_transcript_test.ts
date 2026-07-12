// Golden-transcript equivalence test (ai-agents.md §9.1 exit criterion).
// Recorded Layer A request/response pairs (fixtures/golden-transcripts.json,
// captured against pre-Stage-0 code) are replayed under the current code with
// every agent flag off. Both the exact provider request bodies and the exact
// ChatRunResult must match — Stage 0 must be byte-identical when disabled.

import { assertEquals } from "./harness/asserts.ts";
import { runScenario, setTestProviderKeys } from "./golden/run_scenarios.ts";
import { GOLDEN_SCENARIOS } from "./golden/scenarios.ts";
import type { GoldenCapture } from "./golden/run_scenarios.ts";

const fixturePath = new URL("./fixtures/golden-transcripts.json", import.meta.url);
const recorded: GoldenCapture[] = JSON.parse(await Deno.readTextFile(fixturePath));
const recordedById = new Map(recorded.map((c) => [c.id, c]));

// Flags off — the §9 global kill-switch state.
Deno.env.delete("AGENT_TELEMETRY_ENABLED");
Deno.env.delete("AGENT_ROUTER_ENABLED");
Deno.env.delete("AGENT_ENABLED_IDS");
Deno.env.delete("CHAT_STORE_ENABLED");
setTestProviderKeys();

for (const scenario of GOLDEN_SCENARIOS) {
  Deno.test(`golden transcript: ${scenario.id}`, async () => {
    const baseline = recordedById.get(scenario.id);
    if (!baseline) throw new Error(`no recorded baseline for ${scenario.id} — run golden/record_golden.ts`);
    const live = await runScenario(scenario);
    assertEquals(live.providerCalls, baseline.providerCalls, "provider request bodies drifted");
    assertEquals(live.result, baseline.result, "ChatRunResult drifted");
  });
}

Deno.test("golden fixture covers every scenario (no orphans)", () => {
  assertEquals(
    recorded.map((c) => c.id).sort(),
    GOLDEN_SCENARIOS.map((s) => s.id).sort(),
  );
});
