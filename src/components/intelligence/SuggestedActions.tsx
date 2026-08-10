import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Suggested-action chips (ai-agents.md §17.3 v0): server-computed,
 * deterministic, capability-filtered guidance rendered above the composer and
 * as starter prompts on empty threads. Every chip's utterance is a plain
 * sentence the user could have typed — clicking sends it (the chips teach the
 * interface by example) and records suggestion.clicked.
 *
 * Client visibility flag mirrors the server flag SUGGESTED_ACTIONS_ENABLED
 * (§9 conventions; both default off ⇒ no chips, no suggest calls).
 */

export function suggestedActionsUiEnabled(): boolean {
  return import.meta.env.VITE_SUGGESTED_ACTIONS_ENABLED === "true";
}

export interface SuggestedAction {
  label: string;
  utterance: string;
  agent_hint: string | null;
  reason: string;
  rule: string;
}

// The suggest mode + ui-event RPC postdate the generated supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Props {
  projectId: string | null;
  threadId: string | null;
  threadMode: "ask" | "review";
  onPick: (utterance: string) => void;
  disabled?: boolean;
}

export function SuggestedActions({ projectId, threadId, threadMode, onPick, disabled }: Props) {
  const { user } = useAuth();
  const [suggestions, setSuggestions] = useState<SuggestedAction[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSuggestions([]);
    if (!suggestedActionsUiEnabled() || !projectId || !user) return;
    (async () => {
      try {
        const { data } = await db.functions.invoke("project-ai-chat", {
          body: {
            mode: "suggest",
            projectId,
            userId: user.id,
            userEmail: user.email,
            threadMode,
            ...(threadId ? { threadId } : {}),
          },
        });
        if (!cancelled && Array.isArray(data?.suggestions)) {
          setSuggestions(data.suggestions as SuggestedAction[]);
        }
      } catch {
        // guidance is optional — a failed read renders nothing
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, threadMode, threadId, user]);

  if (suggestions.length === 0) return null;

  const pick = (s: SuggestedAction) => {
    db.rpc("record_chat_ui_event", {
      p_kind: "suggestion.clicked",
      p_user_id: user?.id ?? null,
      p_project_id: projectId,
      p_thread_id: threadId,
      p_payload: { rule: s.rule, agent_hint: s.agent_hint },
    }).then(({ error }: { error: { message: string } | null }) => {
      if (error) console.warn("[suggestions] click event failed:", error.message);
    });
    onPick(s.utterance);
  };

  return (
    <div className="flex flex-wrap gap-1.5 pb-2" aria-label="Suggested actions">
      {suggestions.map((s) => (
        <button
          key={s.rule}
          type="button"
          disabled={disabled}
          title={s.reason}
          onClick={() => pick(s)}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-elevated px-2.5 py-1 text-[12px] text-muted-foreground transition hover:border-strong hover:text-foreground disabled:opacity-50"
        >
          <Lightbulb className="h-3 w-3 shrink-0" />
          {s.label}
        </button>
      ))}
    </div>
  );
}
