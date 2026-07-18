// §6.6 router v2 — the "needs a run?" / "cache-checkable?" signals, behind
// ROUTER_V2_SIGNALS (Phase H2). Deterministic tier: flag off ⇒ the v1 prompt
// and both provider structured-output schemas byte-identically; flag on ⇒
// exactly one verbatim block joins the prompt and the two boolean properties
// join the schemas; malformed or missing booleans always default false; the
// deterministic advisory fallbacks carry the signals through (rule 1 applies
// on ANY route).

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import {
  buildClassifierPrompt,
  decideRoute,
  geminiRouteSchema,
  makeClassifier,
  openaiRouteSchema,
  parseClassifierResponse,
  ROUTER_V2_PROMPT_BLOCK,
  routerV2Enabled,
} from "../router.ts";
import { applyModeToRoute } from "../modes.ts";

const ctx = (over: Record<string, unknown> = {}) => ({
  personaId: null,
  hasProject: true,
  enabledAgents: ["experiment-designer"],
  modelId: "gemini-2.5-flash",
  ...over,
  // deno-lint-ignore no-explicit-any
}) as any;

function withV2<T>(fn: () => T): T {
  Deno.env.set("ROUTER_V2_SIGNALS", "true");
  try {
    return fn();
  } finally {
    Deno.env.delete("ROUTER_V2_SIGNALS");
  }
}

Deno.test("flag off ⇒ the v1 classifier prompt byte-identically; flag on adds EXACTLY the §6.6 verbatim block", () => {
  Deno.env.delete("ROUTER_V2_SIGNALS");
  assertEquals(routerV2Enabled(), false);
  const v1 = buildClassifierPrompt("what did the outage do?", ["experiment-designer"]);
  assert(!v1.includes("Also decide two booleans"), "v1 never carries the block");
  const v2 = withV2(() => buildClassifierPrompt("what did the outage do?", ["experiment-designer"]));
  assertStringIncludes(v2, ROUTER_V2_PROMPT_BLOCK);
  // The block sits between the intent-label line and the "Reply with ONLY"
  // line, and removing it restores v1 byte-for-byte.
  assert(
    v2.indexOf("Also pick the closest intent label") < v2.indexOf(ROUTER_V2_PROMPT_BLOCK),
    "block after the intent-label line",
  );
  assert(
    v2.indexOf(ROUTER_V2_PROMPT_BLOCK) < v2.indexOf("Reply with ONLY a JSON object"),
    "block before the Reply-with-ONLY line",
  );
  assertEquals(v2.replace(`${ROUTER_V2_PROMPT_BLOCK}\n\n`, ""), v1, "everything else is byte-identical");
  // The verbatim §6.6 text.
  assertStringIncludes(ROUTER_V2_PROMPT_BLOCK, '"needs_run": true only if a correct answer requires SIMULATION RESULTS');
  assertStringIncludes(ROUTER_V2_PROMPT_BLOCK, '"cache_checkable": true only if the user is asking for a RESULT that a');
  assertStringIncludes(ROUTER_V2_PROMPT_BLOCK, '"what did the last run show?"');
});

Deno.test("provider schemas: flag off ⇒ v1 shapes byte-identically; flag on gains the two boolean properties (OpenAI strict lists them required)", () => {
  Deno.env.delete("ROUTER_V2_SIGNALS");
  const gemini = geminiRouteSchema() as { properties: Record<string, unknown>; required: string[] };
  assertEquals(Object.keys(gemini.properties), [
    "route", "agent_id", "intent", "confidence", "advisory_part", "artifact_part",
  ]);
  const openai = openaiRouteSchema() as { properties: Record<string, unknown>; required: string[] };
  assertEquals(openai.required, ["route", "agent_id", "intent", "confidence", "advisory_part", "artifact_part"]);

  withV2(() => {
    const g2 = geminiRouteSchema() as { properties: Record<string, unknown> };
    assertEquals((g2.properties.needs_run as { type: string }).type, "boolean");
    assertEquals((g2.properties.cache_checkable as { type: string }).type, "boolean");
    const o2 = openaiRouteSchema() as { properties: Record<string, unknown>; required: string[] };
    assert("needs_run" in o2.properties && "cache_checkable" in o2.properties);
    assert(
      o2.required.includes("needs_run") && o2.required.includes("cache_checkable"),
      "OpenAI strict mode requires every property listed",
    );
  });
});

Deno.test("the live classifier request carries the v2 schema only when the flag is on", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
  const reply = JSON.stringify({
    route: "artifact", agent_id: "experiment-designer", intent: "exp.brief",
    confidence: 0.92, advisory_part: null, artifact_part: "x",
    needs_run: true, cache_checkable: true,
  });
  await withV2(async () => {
    const mock = installFetchMock([
      { json: { candidates: [{ content: { parts: [{ text: reply }] } }] } },
    ]);
    try {
      const classify = makeClassifier({ id: "gemini-2.5-flash", provider: "gemini", apiModel: "gemini-2.5-flash" })!;
      await classify(buildClassifierPrompt("what did the last run show?", ["experiment-designer"]));
    } finally {
      mock.restore();
    }
    const body = mock.calls[0].body as {
      generationConfig: { responseSchema: { properties: Record<string, unknown> } };
    };
    assert("needs_run" in body.generationConfig.responseSchema.properties);
    assert("cache_checkable" in body.generationConfig.responseSchema.properties);
  });
});

Deno.test("parse: booleans present ⇒ carried; absent/malformed ⇒ both false (DeepSeek json_object tolerance)", () => {
  const base = {
    route: "artifact", agent_id: "experiment-designer", intent: "exp.brief",
    confidence: 0.9, advisory_part: null, artifact_part: "x",
  };
  const withBooleans = parseClassifierResponse(JSON.stringify({ ...base, needs_run: true, cache_checkable: true }))!;
  assertEquals(withBooleans.needs_run, true);
  assertEquals(withBooleans.cache_checkable, true);

  const absent = parseClassifierResponse(JSON.stringify(base))!;
  assertEquals(absent.needs_run, false, "absent ⇒ false (the v1 behavior)");
  assertEquals(absent.cache_checkable, false);

  const malformed = parseClassifierResponse(JSON.stringify({ ...base, needs_run: "yes", cache_checkable: 1 }))!;
  assertEquals(malformed.needs_run, false, "non-boolean ⇒ false, never a truthy coercion");
  assertEquals(malformed.cache_checkable, false);
});

Deno.test("the deterministic fallbacks carry the signals: low_confidence and agent_not_enabled demote the route but keep the facts", async () => {
  Deno.env.set("AGENT_ROUTER_ENABLED", "true");
  try {
    const reply = (confidence: number, agent = "experiment-designer") =>
      JSON.stringify({
        route: "artifact", agent_id: agent, intent: "exp.brief", confidence,
        advisory_part: null, artifact_part: "x", needs_run: true, cache_checkable: true,
      });

    const low = await decideRoute("what did the last run show?", ctx(), () => Promise.resolve(reply(0.5)));
    assertEquals(low.route, "advisory");
    assertEquals(low.short_circuit, "low_confidence");
    assertEquals(low.needs_run, true, "rule 1 applies on ANY route — the signal survives the demotion");
    assertEquals(low.cache_checkable, true);

    const disabled = await decideRoute("what did the last run show?", ctx({ enabledAgents: ["data-steward"] }),
      () => Promise.resolve(reply(0.95)));
    assertEquals(disabled.short_circuit, "agent_not_enabled");
    assertEquals(disabled.cache_checkable, true);

    const parseFail = await decideRoute("x", ctx(), () => Promise.resolve("not json at all"));
    assertEquals(parseFail.needs_run, false, "nothing parsed ⇒ the safe default");
    assertEquals(parseFail.cache_checkable, false);

    // §15 mode subtraction keeps the signals too (modes only subtract).
    const artifact = await decideRoute("what did the last run show?", ctx(), () => Promise.resolve(reply(0.95)));
    assertEquals(artifact.route, "artifact");
    const asked = applyModeToRoute(artifact, "ask");
    assertEquals(asked.decision.route, "advisory");
    assertEquals(asked.decision.needs_run, true);
    assertEquals(asked.decision.cache_checkable, true);
  } finally {
    Deno.env.delete("AGENT_ROUTER_ENABLED");
  }
});
