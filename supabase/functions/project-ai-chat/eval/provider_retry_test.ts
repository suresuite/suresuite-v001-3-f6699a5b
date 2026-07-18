// §20.5 free-tier operations, deterministic tier (Phase H2): each provider
// call gets ONE retry on HTTP 429/5xx with exponential backoff (1 s, then
// 2 s; jittered ±25%); a second failure surfaces the typed error honestly —
// no queueing, no silent model substitution (§23.4). Non-retryable statuses
// and the success path are byte-identical to pre-H2 behavior (the golden
// transcripts pin the success path separately).

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import {
  PROVIDER_RETRY_BASE_MS,
  PROVIDER_RETRY_JITTER,
  PROVIDER_RETRY_MAX,
  ProviderRateLimitError,
  providerRetryDelayMs,
  runChat,
} from "../providers.ts";

const geminiText = (text: string) => ({
  json: { candidates: [{ content: { parts: [{ text }] } }] },
});

Deno.test("§20.5 contract constants: one retry, 1 s base, ±25% jitter", () => {
  assertEquals(PROVIDER_RETRY_MAX, 1);
  assertEquals(PROVIDER_RETRY_BASE_MS, 1000);
  assertEquals(PROVIDER_RETRY_JITTER, 0.25);
});

Deno.test("backoff schedule: 1 s then 2 s, jittered ±25% (injectable rand)", () => {
  assertEquals(providerRetryDelayMs(0, () => 0.5), 1000);
  assertEquals(providerRetryDelayMs(1, () => 0.5), 2000, "exponential: the second step doubles");
  assertEquals(providerRetryDelayMs(0, () => 0), 750, "-25% floor");
  assertEquals(providerRetryDelayMs(0, () => 1), 1250, "+25% ceiling");
  assertEquals(providerRetryDelayMs(1, () => 0), 1500);
  assertEquals(providerRetryDelayMs(1, () => 1), 2500);
  // Bounds hold across the random range.
  for (let i = 0; i < 50; i++) {
    const d = providerRetryDelayMs(0);
    assert(d >= 750 && d <= 1250, `jittered delay out of bounds: ${d}`);
  }
});

Deno.test("a 429 is retried ONCE and the retried call succeeds (the wait counts against wall time — budget counters land in H3)", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
  const mock = installFetchMock([
    { status: 429, json: { error: { message: "rate limited" } } },
    geminiText("recovered on the retry"),
  ]);
  const t0 = Date.now();
  try {
    const result = await runChat("gemini-2.5-flash", "hello", [], null, null);
    assertEquals(result.reply, "recovered on the retry");
    assertEquals(mock.calls.length, 2, "exactly one retry");
    assert(Date.now() - t0 >= 700, "the backoff wait actually elapsed");
  } finally {
    mock.restore();
  }
});

Deno.test("a second 429/5xx failure surfaces the §20.5 typed error — no silent model substitution, no queueing", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
  const mock = installFetchMock([
    { status: 429, json: {} },
    { status: 503, json: {} },
  ]);
  try {
    await runChat("gemini-2.5-flash", "hello", [], null, null);
    throw new Error("expected ProviderRateLimitError");
  } catch (e) {
    assert(e instanceof ProviderRateLimitError, `expected the typed error, got: ${e}`);
    assertStringIncludes(
      (e as Error).message,
      "the model provider is rate-limiting — try again shortly or switch models",
    );
    assertEquals((e as ProviderRateLimitError).status, 503);
    assertEquals(mock.calls.length, 2, "one retry, then the honest error — never a third call");
  } finally {
    mock.restore();
  }
});

Deno.test("non-retryable statuses keep the pre-H2 error path byte-identically (a 400 is never retried)", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
  const mock = installFetchMock([
    { status: 400, json: { error: { message: "bad request" } } },
  ]);
  try {
    await runChat("gemini-2.5-flash", "hello", [], null, null);
    throw new Error("expected a provider error");
  } catch (e) {
    assert(!(e instanceof ProviderRateLimitError), "a 400 is the caller's bug, not a rate limit");
    assertStringIncludes((e as Error).message, "Gemini request failed (400)");
    assertEquals(mock.calls.length, 1, "no retry on 4xx (except 429)");
  } finally {
    mock.restore();
  }
});

Deno.test("the OpenAI-compatible path shares the same retry contract", async () => {
  Deno.env.set("DEEPSEEK_API_KEY", "test-deepseek-key");
  const mock = installFetchMock([
    { status: 500, json: {} },
    { json: { choices: [{ message: { content: "recovered" } }] } },
  ]);
  try {
    const result = await runChat("deepseek-chat", "hello", [], null, null);
    assertEquals(result.reply, "recovered");
    assertEquals(mock.calls.length, 2);
  } finally {
    mock.restore();
  }
});
