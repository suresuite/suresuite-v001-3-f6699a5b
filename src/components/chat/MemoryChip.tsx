import { useEffect, useState } from "react";
import { Brain, Check, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PART_TREATMENTS } from "@/lib/chat/partStyles";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Memory chip (ai-agents.md §14.4 consent path b): the save-this offer for a
 * decision-shaped exchange. Rendered from a deterministic {kind:"memory_offer"}
 * part the SERVER emitted — the model never writes memory; nothing is stored
 * until the user clicks Save (which calls save_project_memory).
 *
 * §17.2: the chip wears the violet memory treatment (partStyles.ts).
 * §17.4: the first offered chip a user ever sees opens a one-time
 * "What happens when you Save?" popover carrying the three-bullet contract
 * (consent-only · always visible in the panel · cited when used).
 */

export interface MemoryOfferData {
  content: string;
  kind: "fact" | "preference" | "decision";
  project_id: string;
}

// The project_memory RPCs postdate the generated supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const memory = PART_TREATMENTS.memory;

/** One-time flag for the §17.4 first-run popover (a UI preference, local). */
const INTRO_KEY = "chat.memoryChipIntro.v1";

function introSeen(): boolean {
  try { return window.localStorage.getItem(INTRO_KEY) === "seen"; } catch { return true; }
}
function markIntroSeen() {
  try { window.localStorage.setItem(INTRO_KEY, "seen"); } catch { /* ignore */ }
}

function MemoryIntroPopover({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!introSeen()) setOpen(true);
  }, []);

  const dismiss = (next: boolean) => {
    setOpen(next);
    if (!next) markIntroSeen();
  };

  return (
    <Popover open={open} onOpenChange={dismiss}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 text-[12.5px]">
        <div className="mb-1.5 font-semibold">What happens when you Save?</div>
        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
          <li>
            Memory is <span className="font-medium text-foreground">consent-only</span> — nothing is
            stored unless you click Save or say "remember …". The assistant never writes memory silently.
          </li>
          <li>
            Every entry is <span className="font-medium text-foreground">always visible</span> in the
            Project memory panel, with its source — and you can archive it any time.
          </li>
          <li>
            When a memory informs an answer or a draft, it is{" "}
            <span className="font-medium text-foreground">cited</span> so you can see exactly what was used.
          </li>
        </ul>
        <button
          type="button"
          onClick={() => dismiss(false)}
          className="mt-2 rounded bg-primary px-2 py-0.5 text-[12px] font-medium text-primary-foreground"
        >
          Got it
        </button>
      </PopoverContent>
    </Popover>
  );
}

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
      className={cn("my-2 flex flex-wrap items-center gap-2 px-3 py-2 text-[12.5px]", memory.card)}
    >
      <MemoryIntroPopover>
        <button type="button" aria-label="How project memory works" className="shrink-0">
          <Brain className={cn("h-3.5 w-3.5", memory.icon)} />
        </button>
      </MemoryIntroPopover>
      {state === "saved" ? (
        <span className={memory.accent} aria-live="polite">
          <Check className="mr-1 inline h-3.5 w-3.5" />
          Saved to project memory.
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            Save this for the project? <span className="text-muted-foreground">“{offer.content}”</span>
          </span>
          {state === "error" && <span className={PART_TREATMENTS.error.accent}>{error}</span>}
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
