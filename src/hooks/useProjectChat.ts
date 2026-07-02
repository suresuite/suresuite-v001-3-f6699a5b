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

/**
 * Project-scoped chat hook.
 *
 * When `threadId` is provided the message list is hydrated from and persisted
 * to the shared per-project thread store (localStorage) so the floating
 * bubble and the full Project Intelligence page stay in sync.
 * When omitted, the hook falls back to in-memory session state.
 */
export function useProjectChat(projectId: string | null, threadId?: string | null) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastKey = useRef<string | null>(null);

  const threads = useChatThreads(projectId);
  const boundThreadId = threadId ?? null;

  // Hydrate messages when project or thread changes.
  useEffect(() => {
    const key = `${projectId ?? ""}::${boundThreadId ?? ""}`;
    if (lastKey.current === key) return;
    lastKey.current = key;

    setError(null);
    if (!projectId || !boundThreadId) {
      setMessages([]);
      return;
    }
    const t = threads.threads.find((x) => x.id === boundThreadId);
    setMessages(t?.messages ?? []);
    // We intentionally depend only on identity of project/thread, not on the
    // threads array — updates within the active thread come from this hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, boundThreadId]);

  const persist = useCallback(
    (next: ChatMessage[]) => {
      if (projectId && boundThreadId) {
        threads.setThreadMessages(boundThreadId, next);
      }
    },
    [projectId, boundThreadId, threads],
  );

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
    if (projectId && boundThreadId) threads.clearThread(boundThreadId);
  }, [projectId, boundThreadId, threads]);

  const send = useCallback(
    async (text: string, model?: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      if (!projectId) {
        setError("Select a project first.");
        return;
      }
      if (!user) {
        setError("You must be signed in.");
        return;
      }

      const userMsg: ChatMessage = {
        id: newId(),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };
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
              message: trimmed,
              conversationHistory: history,
              userId: user.id,
              userEmail: user.email,
              model: model ?? "gemini-2.5-flash",
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
    [loading, messages, projectId, user, persist],
  );

  return { messages, loading, error, send, clear };
}
