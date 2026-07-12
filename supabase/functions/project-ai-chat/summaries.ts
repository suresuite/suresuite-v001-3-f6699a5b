// Rolling thread summaries — workstream M1 (ai-agents.md §14.3, §14.7).
//
// The 8-turn history window stays the token-cost spine; continuity beyond it
// comes from a per-thread rolling summary maintained at the 24/8 thresholds:
// after an assistant reply, if max_seq − summary_upto_seq ≥ 24, a fire-and-
// forget refresh (same posture as logAiUsage) summarizes messages
// [summary_upto_seq+1 .. max_seq−8] on top of the previous summary.
//
// Consumption is PERSONA-ONLY (statelessness law): buildSystemPrompt gains the
// optional summary block; agent turns pass an explicit system prompt and never
// receive it — pinned by the mm-* fixtures. The summary is stored on
// chat_threads, visible in the thread-info panel, and user-deletable via
// set_thread_summary (delete ⇒ summary NULL, summary_upto_seq 0).
//
// Flag: CHAT_SUMMARY_ENABLED (server, default off ⇒ M0 behavior exactly).

/** §14.3 trigger threshold (DEFAULT): refresh when this many messages have
 * accumulated past the summarized prefix. */
export const SUMMARY_TRIGGER_GAP = 24;
/** §14.3: the most recent messages stay in the live history window and are
 * never folded into the summary. */
export const SUMMARY_TAIL_KEEP = 8;
/** §14.3: one LLM call, temperature 0, at most this many output tokens. */
export const SUMMARY_MAX_OUTPUT_TOKENS = 800;
/** chat_threads.summary CHECK (≤ 4000 chars). */
export const SUMMARY_MAX_CHARS = 4000;

export function summariesEnabled(): boolean {
  return (Deno.env.get("CHAT_SUMMARY_ENABLED") ?? "").trim().toLowerCase() === "true";
}

export function shouldRefreshSummary(maxSeq: number, summaryUptoSeq: number): boolean {
  return maxSeq - summaryUptoSeq >= SUMMARY_TRIGGER_GAP;
}

/** The [from, to] seq window one refresh folds in, or null when the tail-keep
 * rule leaves nothing new to summarize. */
export function summaryWindow(
  maxSeq: number,
  summaryUptoSeq: number,
): { from: number; to: number } | null {
  const from = summaryUptoSeq + 1;
  const to = maxSeq - SUMMARY_TAIL_KEEP;
  return to >= from ? { from, to } : null;
}

/** §14.3 verbatim summary template. */
export function buildSummaryPrompt(
  previousSummary: string | null,
  messages: Array<{ role: string; content: string }>,
): string {
  const block = messages
    .map((m) => `${m.role === "assistant" ? "ASSISTANT" : "USER"}: ${m.content.slice(0, 2000)}`)
    .join("\n");
  return `Update the running summary of this supply-chain conversation.
Keep: decisions made, entities discussed (ids verbatim), numbers the user
stated, open questions, and what the user is trying to achieve.
Drop: pleasantries, superseded drafts, tool mechanics.
Write <= 300 words, plain prose, no headers. Do not invent anything not in
the transcript.

PREVIOUS SUMMARY:
${previousSummary?.trim() || "(none)"}

NEW MESSAGES:
${block}`;
}

interface SummaryModel {
  provider: "gemini" | "openai" | "deepseek";
  apiModel: string;
}

/** One plain completion (no tools) on the thread's current model. Throws on
 * provider errors — callers are fire-and-forget and log-only. */
export async function runSummaryModel(model: SummaryModel, prompt: string): Promise<string> {
  if (model.provider === "gemini") {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) throw new Error("GEMINI_API_KEY is not configured.");
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model.apiModel}:generateContent`;
    const res = await fetch(`${endpoint}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) throw new Error(`summary request failed (${res.status})`);
    const data = await res.json();
    const parts: Array<{ text?: string }> = data?.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.text ?? "").join("").trim();
  }
  const isOpenAI = model.provider === "openai";
  const key = Deno.env.get(isOpenAI ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY");
  if (!key) throw new Error(`${isOpenAI ? "OPENAI" : "DEEPSEEK"}_API_KEY is not configured.`);
  const baseUrl = isOpenAI ? "https://api.openai.com/v1" : "https://api.deepseek.com/v1";
  // deno-lint-ignore no-explicit-any
  const body: any = {
    model: model.apiModel,
    messages: [{ role: "user", content: prompt }],
  };
  if (isOpenAI && model.apiModel.startsWith("gpt-5")) {
    body.max_completion_tokens = SUMMARY_MAX_OUTPUT_TOKENS;
    body.reasoning_effort = "minimal";
  } else {
    body.temperature = 0;
    body.max_tokens = SUMMARY_MAX_OUTPUT_TOKENS;
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`summary request failed (${res.status})`);
  const data = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}

// Structural client type so this module never imports the supabase-js bundle.
export interface SummaryDb {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
}

/** Read the thread's summary for persona-turn injection (§14.3 consumption):
 * only the thread owner's summary is ever injected. */
export async function loadThreadSummary(
  db: SummaryDb,
  threadId: string,
  userId: string,
): Promise<{ summary: string | null; summaryUptoSeq: number } | null> {
  try {
    const { data, error } = await db
      .from("chat_threads")
      .select("user_id,summary,summary_upto_seq")
      .eq("id", threadId)
      .maybeSingle();
    if (error || !data || String(data.user_id) !== userId) return null;
    return {
      summary: (data.summary as string | null) ?? null,
      summaryUptoSeq: Number(data.summary_upto_seq ?? 0) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * The §14.3 refresh: recheck the threshold against the store, summarize the
 * window on the thread's current model, persist via set_thread_summary.
 * Never throws — a failed refresh only logs (the next reply retries).
 */
export async function refreshThreadSummary(
  db: SummaryDb,
  args: { threadId: string; userId: string; model: SummaryModel },
): Promise<void> {
  try {
    const state = await loadThreadSummary(db, args.threadId, args.userId);
    if (!state) return;
    const { data: seqRow } = await db
      .from("chat_messages")
      .select("seq")
      .eq("thread_id", args.threadId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxSeq = Number(seqRow?.seq ?? 0) || 0;
    if (!shouldRefreshSummary(maxSeq, state.summaryUptoSeq)) return;
    const window = summaryWindow(maxSeq, state.summaryUptoSeq);
    if (!window) return;

    const { data: rows, error } = await db
      .from("chat_messages")
      .select("seq,role,content")
      .eq("thread_id", args.threadId)
      .gte("seq", window.from)
      .lte("seq", window.to)
      .order("seq", { ascending: true });
    if (error || !Array.isArray(rows) || rows.length === 0) return;

    const prompt = buildSummaryPrompt(
      state.summary,
      rows.map((r: { role: string; content: string }) => ({ role: r.role, content: r.content })),
    );
    const summary = (await runSummaryModel(args.model, prompt)).slice(0, SUMMARY_MAX_CHARS);
    if (!summary) return;

    const { error: writeErr } = await db.rpc("set_thread_summary", {
      p_thread_id: args.threadId,
      p_user_id: args.userId,
      p_summary: summary,
      p_upto_seq: window.to,
    });
    if (writeErr) console.warn("[summary] write failed:", writeErr.message ?? writeErr);
  } catch (e) {
    console.warn("[summary] refresh failed:", e instanceof Error ? e.message : e);
  }
}
