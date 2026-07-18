import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCapabilities } from "@/hooks/useCapabilities";
import { useChatThreads } from "@/hooks/useChatThreads";
import { chatModesUiEnabled } from "@/components/chat/ModeSwitch";

export type ChatRole = "user" | "assistant";

export interface ChatPart {
  // "proposal" carries {proposal_id} and renders as a ProposalCard
  // (ai-agents.md §4.5/§4.6); "memory_offer"/"memory_saved" are the M2
  // consent-chip parts (§14.4); "mode_notice" is the §15 Ask-mode refusal
  // chip ("Switch to Review"); "evidence" is the H1 §22.2 citation list
  // ("grounded — N sources"); older clients ignore unknown kinds.
  kind: "table" | "kpi" | "bullets" | "text" | "proposal" | "memory_offer" | "memory_saved" | "mode_notice" | "evidence";
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
      const modelId = opts.model ?? "gemini-2.5-flash";
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

      const history = messages.map((m) => ({ role: m.role, content: m.content }));

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
          model: opts.model ?? "gemini-2.5-flash",
          ...(serverThreadId ? { threadId: serverThreadId } : {}),
          // §15: unsynced/localStorage threads carry the mode in the request
          // body — the server still enforces it (synced threads resolve from
          // chat_threads.mode, which wins over this hint). Sent only when the
          // modes UI is on so pre-§15 request bodies stay byte-identical.
          ...(chatModesUiEnabled() ? { threadMode: thread?.mode ?? "review" } : {}),
        };

        const { data, error: invokeError } = await supabase.functions.invoke<ChatApiResponse>(
          "project-ai-chat",
          { body: payload },
        );

        // supabase-js swallows response bodies on non-2xx. Fall back to a plain
        // fetch so we can surface the real reason instead of the generic
        // "Edge Function returned a non-2xx status code" string.
        let resolved: ChatApiResponse | null = data ?? null;
        if (invokeError) {
          try {
            const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project-ai-chat`;
            const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
            const res = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: anon,
                Authorization: `Bearer ${anon}`,
              },
              body: JSON.stringify(payload),
            });
            const body = await res.json().catch(() => null);
            if (body?.error) throw new Error(body.error);
            if (!res.ok) throw new Error(`Chat service error (${res.status}).`);
            resolved = body as ChatApiResponse;
          } catch (fetchErr) {
            if (fetchErr instanceof Error && fetchErr.message) throw fetchErr;
            throw invokeError;
          }
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

  return { messages, loading, error, send, clear };
}
