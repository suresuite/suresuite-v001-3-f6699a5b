import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCapabilities } from "@/hooks/useCapabilities";
import { useChatThreads } from "@/hooks/useChatThreads";
import { chatModesUiEnabled } from "@/components/chat/ModeSwitch";
import { DEFAULT_MODEL_ID } from "@/components/chat/ModelPicker";
import { registerPlanResumePoster } from "@/lib/chat/planResume";

/** The history window the SERVER applies (providers.ts): the last 8 turns,
 * each clamped to 2,000 chars. Mirrored here so the request body is bounded
 * at the source instead of shipping the whole thread for the server to drop. */
const HISTORY_TURNS = 8;
const HISTORY_CHARS_PER_TURN = 2000;

/** Client-side deadline for a chat turn.
 *
 * The server's wall budget is 60 s and is only checked BETWEEN provider calls,
 * so a turn can legitimately overrun it; this sits above that with room for the
 * reply to come back. Without it there was no client timeout at all — a hung
 * edge function left the composer spinning on `loading` forever with no way
 * out but a page reload.
 *
 * supabase-js's functions.invoke() accepts no AbortSignal, so this frees the UI
 * rather than cancelling the request in flight; the server's own budgets bound
 * the work itself. */
const CHAT_DEADLINE_MS = 90_000;

async function withDeadline<T>(p: Promise<T>, ms: number = CHAT_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("The assistant took too long to respond. Try again, or narrow the question.")),
      ms,
    );
  });
  try {
    return await Promise.race([p, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

export type ChatRole = "user" | "assistant";

export interface ChatPart {
  // "proposal" carries {proposal_id} and renders as a ProposalCard
  // (ai-agents.md §4.5/§4.6); "memory_offer"/"memory_saved" are the M2
  // consent-chip parts (§14.4); "mode_notice" is the §15 Ask-mode refusal
  // chip ("Switch to Review"); "evidence" is the H1 §22.2 citation list
  // ("grounded — N sources"); "plan" carries {plan_id} + a render snapshot
  // and renders as the H3 §21.2 PlanCard checklist; older clients ignore
  // unknown kinds.
  kind: "table" | "kpi" | "bullets" | "text" | "proposal" | "memory_offer" | "memory_saved" | "mode_notice" | "evidence" | "plan";
  data: unknown;
}

export interface ChatToolCall {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  row_count: number;
  /** Additive (§17.2 ActivityGroup): step timing, rendered only when a
   * stored call record carries it — the server does not emit it today. */
  duration_ms?: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  parts?: ChatPart[];
  toolCalls?: ChatToolCall[];
  createdAt: number;
}

interface ChatApiResponse {
  reply?: string;
  parts?: ChatPart[];
  toolCalls?: ChatToolCall[];
  blocked?: boolean;
  error?: string;
  /** True when the server already appended the assistant message to the
   * chat store (CHAT_STORE_ENABLED, ai-agents.md §14.7 M0). */
  persisted?: boolean;
}

const newId = () => Math.random().toString(36).slice(2, 10);

interface SendOptions {
  model?: string;
  projectId?: string | null;
  agentId?: string | null;
}

/**
 * Thread-bound chat hook. Reads/writes messages from the global thread store.
 * `send()` accepts optional per-call overrides for model, projectId and agentId
 * so surfaces like the floating bubble can pass an ephemeral project without
 * mutating the thread record.
 */
export function useProjectChat(threadId: string | null) {
  const { user } = useAuth();
  const caps = useCapabilities();
  const threads = useChatThreads();
  const thread = threads.threads.find((t) => t.id === threadId) ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>(thread?.messages ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastKey = useRef<string | null>(null);
  // H3 (§21.4): the resume poster reads live state from refs — it fires from
  // realtime/apply callbacks outside the render cycle.
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  const lastModelRef = useRef<string>(DEFAULT_MODEL_ID);
  const resumesInFlight = useRef<Set<string>>(new Set());

  // Hydrate when thread changes.
  useEffect(() => {
    const key = threadId ?? "";
    if (lastKey.current === key) return;
    lastKey.current = key;
    setError(null);
    setMessages(thread?.messages ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const persist = useCallback(
    (next: ChatMessage[]) => {
      if (threadId) threads.setThreadMessages(threadId, next);
    },
    [threadId, threads],
  );

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
    if (threadId) threads.clearThread(threadId);
  }, [threadId, threads]);

  const send = useCallback(
    async (text: string, opts: SendOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      if (!user) { setError("You must be signed in."); return; }

      const projectId = opts.projectId !== undefined ? opts.projectId : (thread?.projectId ?? null);
      const agentId = opts.agentId ?? thread?.agentId ?? null;

      const userMsg: ChatMessage = { id: newId(), role: "user", content: trimmed, createdAt: Date.now() };
      const withUser = [...messages, userMsg];
      setMessages(withUser);
      persist(withUser);
      // Chat store (M0): the client owns the user-message append; the server
      // appends the assistant reply. No-op while chat_history_sync is off.
      if (threadId) void threads.appendMessageToStore(threadId, userMsg);

      // Access control: block disallowed features/models and over-budget calls
      // before we ever reach the LLM, with a clear, actionable reason.
      const modelId = opts.model ?? DEFAULT_MODEL_ID;
      lastModelRef.current = modelId;
      if (!caps.can("ai_chat")) {
        setError("The AI assistant isn't enabled for your account. Contact an administrator.");
        return;
      }
      const modelGate = caps.isModelAllowed(modelId);
      if (!modelGate.ok) {
        setError(modelGate.reason ?? "That model isn't available for your account.");
        return;
      }
      const budgetGate = caps.checkBudget();
      if (!budgetGate.ok) {
        setError(budgetGate.reason ?? "Your AI budget for this period has been reached.");
        return;
      }

      setLoading(true);
      setError(null);

      // The server keeps only the last 8 turns and clamps each to 2,000 chars
      // (providers.ts). Sending the entire thread grew the request without
      // bound for no benefit — and on a long thread the provider rejected it.
      // Mirror the server's window here so the wire payload stays bounded.
      const history = messages
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_CHARS_PER_TURN) }));

      try {
        const serverThreadId = threadId ? threads.getServerThreadId(threadId) : null;
        const payload = {
          mode: "tools",
          projectId,
          agentId,
          message: trimmed,
          conversationHistory: history,
          userId: user.id,
          userEmail: user.email,
          model: opts.model ?? DEFAULT_MODEL_ID,
          ...(serverThreadId ? { threadId: serverThreadId } : {}),
          // §15: unsynced/localStorage threads carry the mode in the request
          // body — the server still enforces it (synced threads resolve from
          // chat_threads.mode, which wins over this hint). Sent only when the
          // modes UI is on so pre-§15 request bodies stay byte-identical.
          ...(chatModesUiEnabled() ? { threadMode: thread?.mode ?? "review" } : {}),
        };

        const { data, error: invokeError } = await withDeadline(
          supabase.functions.invoke<ChatApiResponse>("project-ai-chat", { body: payload }),
        );

        // supabase-js swallows response bodies on non-2xx, which is why this
        // used to re-POST the whole request just to read the error string —
        // a second billable turn on every failure, after the first had already
        // spent its provider calls. FunctionsHttpError carries the original
        // Response on .context, so read it from there instead.
        const resolved: ChatApiResponse | null = data ?? null;
        if (invokeError) {
          const ctx = (invokeError as { context?: unknown }).context;
          let serverMessage: string | null = null;
          if (ctx instanceof Response) {
            const body = await ctx.clone().json().catch(() => null);
            serverMessage = (body as { error?: string } | null)?.error ?? null;
            if (!serverMessage && !ctx.ok) serverMessage = `Chat service error (${ctx.status}).`;
          }
          throw new Error(serverMessage ?? invokeError.message ?? "Chat service error.");
        }

        if (!resolved) throw new Error("Empty response from AI service.");
        if (resolved.error) throw new Error(resolved.error);
        const data2 = resolved;

        const assistant: ChatMessage = {
          id: newId(),
          role: "assistant",
          content: data2.reply ?? "",
          parts: data2.parts,
          toolCalls: data2.toolCalls,
          createdAt: Date.now(),
        };
        const withAssistant = [...withUser, assistant];
        setMessages(withAssistant);
        persist(withAssistant);
        // If the server didn't persist the assistant reply (CHAT_STORE_ENABLED
        // off), the client covers it so the store stays complete.
        if (threadId && !data2.persisted) void threads.appendMessageToStore(threadId, assistant);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, user, thread, persist, caps, threadId, threads],
  );

  // --- H3 (§21.4): the resume turn — a normal mode:"tools" request with
  // resume_plan_id in the body, posted by the approve flow / the run
  // subscription (never a background job: it renders into this thread like
  // any reply). No user bubble: the turn is client-caused, not user-typed;
  // the server's zero-LLM progress branch answers while the run is
  // queued/running, so posting is always cheap.
  const sendResume = useCallback(
    async (planId: string) => {
      if (!user || !threadId) return;
      if (resumesInFlight.current.has(planId)) return;
      if (loadingRef.current) {
        // A turn is in flight — try once more when it clears.
        setTimeout(() => { void sendResume(planId); }, 2000);
        return;
      }
      const serverThreadId = threads.getServerThreadId(threadId);
      if (!serverThreadId) return;
      resumesInFlight.current.add(planId);
      setLoading(true);
      try {
        const payload = {
          mode: "tools",
          projectId: thread?.projectId ?? null,
          agentId: thread?.agentId ?? null,
          message: "Continue the task plan.",
          resume_plan_id: planId,
          conversationHistory: messagesRef.current
            .slice(-HISTORY_TURNS)
            .map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_CHARS_PER_TURN) })),
          userId: user.id,
          userEmail: user.email,
          model: lastModelRef.current,
          threadId: serverThreadId,
        };
        const { data, error: invokeError } = await withDeadline(
          supabase.functions.invoke<ChatApiResponse>("project-ai-chat", { body: payload }),
        );
        if (invokeError || !data) throw invokeError ?? new Error("Empty response from AI service.");
        if (data.error) throw new Error(data.error);
        const assistant: ChatMessage = {
          id: newId(),
          role: "assistant",
          content: data.reply ?? "",
          parts: data.parts,
          toolCalls: data.toolCalls,
          createdAt: Date.now(),
        };
        const next = [...messagesRef.current, assistant];
        setMessages(next);
        persist(next);
        if (!data.persisted) void threads.appendMessageToStore(threadId, assistant);
      } catch (e) {
        // The user is watching a plan checklist that will simply stop
        // advancing; swallowing this to the console left them with no idea
        // why. Surface it the same way a failed send is surfaced.
        console.warn("[plan-resume] resume turn failed:", e instanceof Error ? e.message : e);
        setError(
          e instanceof Error && e.message
            ? `Couldn't continue the plan: ${e.message}`
            : "Couldn't continue the plan.",
        );
      } finally {
        resumesInFlight.current.delete(planId);
        setLoading(false);
      }
    },
    [user, threadId, thread?.projectId, thread?.agentId, threads, persist],
  );

  // Register this surface as the thread's resume poster (§21.4 triggers:
  // approve flow + run-completion subscription). Unregisters on unmount — a
  // closed surface simply delays resume until the user returns.
  useEffect(() => {
    if (!threadId) return;
    const serverThreadId = threads.getServerThreadId(threadId);
    if (!serverThreadId) return;
    return registerPlanResumePoster(serverThreadId, sendResume);
  }, [threadId, threads, sendResume]);

  return { messages, loading, error, send, clear };
}
