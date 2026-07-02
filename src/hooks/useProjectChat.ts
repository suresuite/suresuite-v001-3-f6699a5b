import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useChatThreads } from "@/hooks/useChatThreads";

export type ChatRole = "user" | "assistant";

export interface ChatPart {
  kind: "table" | "kpi" | "bullets" | "text";
  data: unknown;
}

export interface ChatToolCall {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  row_count: number;
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
      setLoading(true);
      setError(null);

      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      try {
        const { data, error: invokeError } = await supabase.functions.invoke<ChatApiResponse>(
          "project-ai-chat",
          {
            body: {
              mode: "tools",
              projectId,
              agentId,
              message: trimmed,
              conversationHistory: history,
              userId: user.id,
              userEmail: user.email,
              model: opts.model ?? "gemini-2.5-flash",
            },
          },
        );

        if (invokeError) throw invokeError;
        if (!data) throw new Error("Empty response from AI service.");
        if (data.error) throw new Error(data.error);

        const assistant: ChatMessage = {
          id: newId(),
          role: "assistant",
          content: data.reply ?? "",
          parts: data.parts,
          toolCalls: data.toolCalls,
          createdAt: Date.now(),
        };
        const withAssistant = [...withUser, assistant];
        setMessages(withAssistant);
        persist(withAssistant);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, user, thread, persist],
  );

  return { messages, loading, error, send, clear };
}
