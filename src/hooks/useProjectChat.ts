import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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

export function useProjectChat(projectId: string | null) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastProject = useRef<string | null>(null);

  // Reset thread when the active project changes.
  useEffect(() => {
    if (lastProject.current !== projectId) {
      lastProject.current = projectId;
      setMessages([]);
      setError(null);
    }
  }, [projectId]);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const send = useCallback(
    async (text: string) => {
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
      setMessages((m) => [...m, userMsg]);
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
        setMessages((m) => [...m, assistant]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, projectId, user],
  );

  return { messages, loading, error, send, clear };
}
