import { useState } from "react";
import { Brain, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Memory chip (ai-agents.md §14.4 consent path b): the save-this offer for a
 * decision-shaped exchange. Rendered from a deterministic {kind:"memory_offer"}
 * part the SERVER emitted — the model never writes memory; nothing is stored
 * until the user clicks Save (which calls save_project_memory).
 */

export interface MemoryOfferData {
  content: string;
  kind: "fact" | "preference" | "decision";
  project_id: string;
}

// The project_memory RPCs postdate the generated supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function MemoryChip({ offer, threadId }: { offer: MemoryOfferData; threadId?: string | null }) {
  const { user } = useAuth();
  const [state, setState] = useState<"offered" | "saving" | "saved" | "dismissed" | "error">("offered");
  const [error, setError] = useState<string | null>(null);

  if (!offer?.content || !offer.project_id) return null;
  if (state === "dismissed") return null;

  const onSave = async () => {
    setState("saving");
    const { error: err } = await db.rpc("save_project_memory", {
      p_project_id: offer.project_id,
      p_kind: offer.kind ?? "decision",
      p_content: offer.content,
      p_citations: [{
        kind: "user_message",
        ref: `thread:${threadId ?? "current"}`,
        quote: offer.content.slice(0, 500),
      }],
      p_source_thread_id: threadId ?? null,
      p_user_id: user?.id ?? null,
      p_grounding: {},
    });
    if (err) {
      setError(err.message ?? "Save failed.");
      setState("error");
    } else {
      setState("saved");
    }
  };

  return (
    <div
      role="region"
      aria-label="Save to project memory?"
      className="my-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-elevated/50 px-3 py-2 text-[12.5px]"
    >
      <Brain className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {state === "saved" ? (
        <span className="text-emerald-700 dark:text-emerald-400" aria-live="polite">
          <Check className="mr-1 inline h-3.5 w-3.5" />
          Saved to project memory.
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            Save this for the project? <span className="text-muted-foreground">“{offer.content}”</span>
          </span>
          {state === "error" && <span className="text-destructive">{error}</span>}
          <button
            type="button"
            className="rounded bg-primary px-2 py-0.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
            disabled={state === "saving"}
            onClick={() => void onSave()}
          >
            Save
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 text-[12px]"
            onClick={() => setState("dismissed")}
          >
            <X className="mr-0.5 inline h-3 w-3" />
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
