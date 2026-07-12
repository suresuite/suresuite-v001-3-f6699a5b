// Stage 1 classifier wiring (ai-agents.md §6.2 step 2, §12.2 structured
// outputs): per-provider request bodies (temperature 0, ≤300 tokens,
// structured-output mechanism) and the "do it" re-route helper. The decision
// function's fallbacks stay pinned by router_test.ts.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import {
  buildClassifierPrompt,
  CONFIRMATION_RE,
  decideRoute,
  makeClassifier,
  OFFER_CHIP_TEXT,
  resolveRoutedUtterance,
} from "../router.ts";

const artifactReply = JSON.stringify({
  route: "artifact",
  agent_id: "data-steward",
  intent: "steward.fill_missing",
  confidence: 0.93,
  advisory_part: null,
  artifact_part: "fill in the costs",
});

Deno.test("makeClassifier: Gemini uses responseSchema JSON mode at temperature 0 / 300 tokens", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
  const mock = installFetchMock([
    { json: { candidates: [{ content: { parts: [{ text: artifactReply }] } }] } },
  ]);
  try {
    const classify = makeClassifier({ id: "gemini-2.5-flash", provider: "gemini", apiModel: "gemini-2.5-flash" })!;
    const raw = await classify(buildClassifierPrompt("fill in the costs", ["data-steward"]));
    assertEquals(JSON.parse(raw).agent_id, "data-steward");
  } finally {
    mock.restore();
  }
  const body = mock.calls[0].body as {
    generationConfig: {
      temperature: number;
      maxOutputTokens: number;
      responseMimeType: string;
      responseSchema: { properties: Record<string, unknown> };
    };
  };
  assertEquals(body.generationConfig.temperature, 0);
  assertEquals(body.generationConfig.maxOutputTokens, 300);
  assertEquals(body.generationConfig.responseMimeType, "application/json");
  assert("route" in body.generationConfig.responseSchema.properties, "responseSchema constrains the RouteDecision");
});

Deno.test("makeClassifier: OpenAI uses strict json_schema; DeepSeek uses json_object", async () => {
  Deno.env.set("OPENAI_API_KEY", "test-openai-key");
  Deno.env.set("DEEPSEEK_API_KEY", "test-deepseek-key");
  const mock = installFetchMock([
    { json: { choices: [{ message: { content: artifactReply } }] } },
    { json: { choices: [{ message: { content: artifactReply } }] } },
  ]);
  try {
    const openai = makeClassifier({ id: "gpt-5", provider: "openai", apiModel: "gpt-5-2025-08-07" })!;
    await openai("classify this json request");
    const deepseek = makeClassifier({ id: "deepseek-chat", provider: "deepseek", apiModel: "deepseek-chat" })!;
    await deepseek("classify this json request");
  } finally {
    mock.restore();
  }
  // deno-lint-ignore no-explicit-any
  const openaiBody = mock.calls[0].body as any;
  assertEquals(openaiBody.response_format.type, "json_schema");
  assertEquals(openaiBody.response_format.json_schema.strict, true);
  assertEquals(openaiBody.max_completion_tokens, 300, "gpt-5: completion budget replaces max_tokens");
  assertEquals(openaiBody.reasoning_effort, "minimal", "gpt-5: reasoning kept out of the 300-token budget");
  assertEquals(openaiBody.temperature, undefined, "gpt-5 rejects temperature");
  // deno-lint-ignore no-explicit-any
  const deepseekBody = mock.calls[1].body as any;
  assertEquals(deepseekBody.response_format.type, "json_object");
  assertEquals(deepseekBody.temperature, 0);
  assertEquals(deepseekBody.max_tokens, 300);
});

Deno.test("makeClassifier returns null without a provider key ⇒ classifier_unavailable fallback", async () => {
  Deno.env.delete("DEEPSEEK_API_KEY");
  const classifier = makeClassifier({ id: "deepseek-chat", provider: "deepseek", apiModel: "deepseek-chat" });
  assertEquals(classifier, null);
  Deno.env.set("AGENT_ROUTER_ENABLED", "true");
  try {
    const d = await decideRoute("fill costs", {
      personaId: null,
      hasProject: true,
      enabledAgents: ["data-steward"],
      modelId: "deepseek-chat",
    }, classifier);
    assertEquals(d.route, "advisory");
    assertEquals(d.short_circuit, "classifier_unavailable");
  } finally {
    Deno.env.delete("AGENT_ROUTER_ENABLED");
  }
});

Deno.test("the low-confidence offer chip and the 'do it' re-route (§6.2 step 3)", () => {
  assertStringIncludes(OFFER_CHIP_TEXT, 'say "do it"');
  for (const yes of ["do it", "Do it!", " yes, do it ", "go ahead", "please do it"]) {
    assert(CONFIRMATION_RE.test(yes), `should confirm: "${yes}"`);
  }
  for (const no of ["do it for MAT-17", "what should I do?", "go ahead and explain why"]) {
    assert(!CONFIRMATION_RE.test(no), `must not confirm: "${no}"`);
  }
  const history = [
    { role: "user", content: "Fill in the missing material costs" },
    { role: "assistant", content: `Answer. ${OFFER_CHIP_TEXT}` },
  ];
  assertEquals(
    resolveRoutedUtterance("do it", history),
    "Fill in the missing material costs",
    "the prior utterance becomes the routed artifact part",
  );
  assertEquals(resolveRoutedUtterance("do it", []), "do it", "no prior user turn ⇒ unchanged");
  assertEquals(
    resolveRoutedUtterance("and set MOQ to 5", history),
    "and set MOQ to 5",
    "non-confirmation messages classify fresh",
  );
});
