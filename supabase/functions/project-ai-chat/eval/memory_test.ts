// Workstream M1 golden suite, deterministic tier (ai-agents.md §14.3, §14.7):
// mm-01 pins the rolling-summary maintenance (24/8 thresholds, verbatim
// template, write-back seq) and persona injection; mm-02 pins the isolation
// law — the summary is NEVER present in an agent turn's context. The SQL side
// (set_thread_summary owner check + delete semantics) is pinned in
// db_rpc_test.ts against scratch Postgres.

import { assert, assertEquals, assertStringIncludes } from "./harness/asserts.ts";
import { makeStubDb, type Row, type RpcHandler } from "./harness/stub_db.ts";
import { installFetchMock } from "./harness/fetch_mock.ts";
import {
  buildSummaryPrompt,
  refreshThreadSummary,
  shouldRefreshSummary,
  SUMMARY_TAIL_KEEP,
  SUMMARY_TRIGGER_GAP,
  summaryWindow,
} from "../summaries.ts";
import { buildSystemPrompt, runChat } from "../providers.ts";
import { buildStewardPrompt } from "../draftTools.ts";

const mm01 = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/memory/mm-01-summary-recall.json", import.meta.url)),
);
const mm02 = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/memory/mm-02-summary-agent-isolation.json", import.meta.url)),
);

Deno.test("mm-01: 24/8 thresholds and the summarized window", () => {
  assertEquals(SUMMARY_TRIGGER_GAP, 24, "§14.3 DEFAULT trigger");
  assertEquals(SUMMARY_TAIL_KEEP, 8, "§14.3 live-window tail");
  const yes = mm01.expect.should_refresh_at;
  const no = mm01.expect.should_not_refresh_at;
  assert(shouldRefreshSummary(yes.max_seq, yes.upto), "26 unsummarized messages trigger");
  assert(!shouldRefreshSummary(no.max_seq, no.upto), "23 unsummarized messages do not");
  assertEquals(summaryWindow(yes.max_seq, yes.upto), mm01.expect.window, "window is [upto+1 .. max−8]");
  assertEquals(summaryWindow(9, 8), null, "nothing new beyond the tail ⇒ no window");
});

Deno.test("mm-01: the §14.3 template is verbatim and carries the transcript facts", () => {
  const prompt = buildSummaryPrompt(null, [
    { role: "user", content: "Supplier S3 is our strategic supplier for MAT-17." },
    { role: "assistant", content: "Noted — S3 backs MAT-17." },
  ]);
  for (const chunk of mm01.expect.template_includes) {
    assertStringIncludes(prompt, chunk);
  }
  assertStringIncludes(prompt, 'PREVIOUS SUMMARY:\n(none)', "empty previous summary renders as (none)");
  assertStringIncludes(prompt, "USER: Supplier S3 is our strategic supplier for MAT-17.");
  const withPrev = buildSummaryPrompt("Earlier: capacity talk.", []);
  assertStringIncludes(withPrev, "PREVIOUS SUMMARY:\nEarlier: capacity talk.");
});

Deno.test("mm-01: refreshThreadSummary reads the window, calls the model once, writes upto max−8", async () => {
  const t = mm01.thread;
  const messages: Row[] = [];
  for (let seq = 1; seq <= t.message_count; seq++) {
    const seeded = t.seeded_facts.find((f: { seq: number }) => f.seq === seq);
    messages.push({
      thread_id: t.thread_id,
      seq,
      role: seeded?.role ?? (seq % 2 === 1 ? "user" : "assistant"),
      content: seeded?.content ?? `message ${seq}`,
    });
  }
  const writes: Array<Record<string, unknown>> = [];
  const rpcs: Record<string, RpcHandler> = {
    set_thread_summary: (args) => {
      writes.push(args);
      return null;
    },
  };
  const db = makeStubDb({
    chat_threads: [{ id: t.thread_id, user_id: t.user_id, summary: t.summary, summary_upto_seq: t.summary_upto_seq }],
    chat_messages: messages,
  }, rpcs);

  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
  const mock = installFetchMock([
    { json: { candidates: [{ content: { parts: [{ text: mm01.model_summary_reply }] } }] } },
  ]);
  try {
    await refreshThreadSummary(db, {
      threadId: t.thread_id,
      userId: t.user_id,
      model: { provider: "gemini", apiModel: "gemini-2.5-flash" },
    });
  } finally {
    mock.restore();
  }

  assertEquals(mock.calls.length, 1, "exactly one summary model call");
  const body = mock.calls[0].body as {
    contents: Array<{ parts: Array<{ text: string }> }>;
    generationConfig: { temperature: number; maxOutputTokens: number };
  };
  assertEquals(body.generationConfig.temperature, 0, "§14.3: temperature 0");
  assertEquals(body.generationConfig.maxOutputTokens, 800, "§14.3: ≤ 800 output tokens");
  const prompt = body.contents[0].parts[0].text;
  assertStringIncludes(prompt, "Update the running summary of this supply-chain conversation.");
  assertStringIncludes(prompt, "their capacity is 1200 per week", "window includes seeded facts");
  assert(!prompt.includes(`message ${t.message_count}`), "the 8-message tail stays out of the summary");

  assertEquals(writes.length, 1, "one set_thread_summary write");
  assertEquals(writes[0].p_upto_seq, mm01.expect.write_upto_seq, "summary_upto_seq advances to max−8");
  assertEquals(writes[0].p_summary, mm01.model_summary_reply);
  assertEquals(writes[0].p_user_id, t.user_id, "owner-scoped write");
});

Deno.test("mm-01: refresh is a no-op below the threshold and for foreign users", async () => {
  const t = mm01.thread;
  const writes: Array<Record<string, unknown>> = [];
  const db = makeStubDb({
    chat_threads: [{ id: t.thread_id, user_id: t.user_id, summary: null, summary_upto_seq: 0 }],
    chat_messages: [{ thread_id: t.thread_id, seq: 5, role: "user", content: "hello" }],
  }, { set_thread_summary: (args) => (writes.push(args), null) });
  const mock = installFetchMock([]);
  try {
    await refreshThreadSummary(db, { threadId: t.thread_id, userId: t.user_id, model: { provider: "gemini", apiModel: "g" } });
    await refreshThreadSummary(db, { threadId: t.thread_id, userId: "99999999-9999-4999-8999-999999999999", model: { provider: "gemini", apiModel: "g" } });
  } finally {
    mock.restore();
  }
  assertEquals(mock.calls.length, 0, "no model call below threshold / for non-owners");
  assertEquals(writes.length, 0);
});

Deno.test("mm-01/mm-02: persona prompts carry the summary block; absence leaves the prompt byte-identical", () => {
  const withSummary = buildSystemPrompt("Gemini 2.5 Flash", "risk-analyst", true, mm02.summary_text);
  assertStringIncludes(withSummary, `${mm01.expect.persona_prompt_includes}: ${mm02.summary_text}`);
  const without = buildSystemPrompt("Gemini 2.5 Flash", "risk-analyst", true);
  const legacyShape = buildSystemPrompt("Gemini 2.5 Flash", "risk-analyst", true, null);
  assertEquals(without, legacyShape, "no summary ⇒ unchanged prompt (flag-off regression)");
  assert(!without.includes("CONVERSATION SUMMARY"));
});

Deno.test("mm-02: the summary is never present in an agent turn's context", async () => {
  // (a) the Steward's §5.1 template has no summary slot;
  const stewardPrompt = buildStewardPrompt({
    projectId: "11111111-1111-4111-8111-111111111111",
    utterance: "fill in the missing costs",
    findingsJson: "[]",
    datasetCountsJson: "{}",
    enumVocabJson: "{}",
  });
  assert(
    !stewardPrompt.includes(mm02.expect.agent_prompt_excludes),
    "steward system prompt carries no conversation summary",
  );

  // (b) runChat ignores opts.summary whenever an explicit system prompt is
  // passed — assert on the exact bytes the provider receives.
  Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
  const mock = installFetchMock([
    { json: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } },
  ]);
  try {
    await runChat("gemini-2.5-flash", "fill in the costs", [], null, null, {
      system: stewardPrompt,
      summary: mm02.summary_text,
    });
  } finally {
    mock.restore();
  }
  const body = mock.calls[0].body as { systemInstruction: { parts: Array<{ text: string }> } };
  const system = body.systemInstruction.parts[0].text;
  assertEquals(system, stewardPrompt, "explicit agent system prompt is sent verbatim");
  assert(!system.includes(mm02.summary_text), "the summary text never reaches the agent turn");
  assert(!system.includes(mm02.expect.agent_prompt_excludes));
});
