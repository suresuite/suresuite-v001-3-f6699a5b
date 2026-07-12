import { useState } from "react";
import { Info, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatThreads } from "@/hooks/useChatThreads";

/**
 * Thread-info panel — workstream M1 (ai-agents.md §14.3 integrity clause):
 * the rolling summary is stored, visible ("What the assistant remembers about
 * this conversation"), and user-deletable (delete ⇒ summary NULL,
 * summary_upto_seq 0 via set_thread_summary). Renders nothing until a summary
 * exists, so flag-off behavior is unchanged.
 */
export function ThreadInfoPanel({ threadId }: { threadId: string | null }) {
  const { threads, clearThreadSummary } = useChatThreads();
  const [open, setOpen] = useState(false);

  const thread = threadId ? threads.find((t) => t.id === threadId) : null;
  const summary = thread?.summary?.trim();
  if (!thread || !summary) return null;

  return (
    <div className="border-b border-border bg-surface-elevated">
      <div className="mx-auto flex max-w-[720px] items-center gap-2 px-4 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition hover:text-foreground"
          aria-expanded={open}
        >
          <Info className="h-3.5 w-3.5" />
          What the assistant remembers about this conversation
        </button>
        {open && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close conversation memory panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div
          role="region"
          aria-label="Conversation summary"
          className="mx-auto max-w-[720px] px-4 pb-3"
        >
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
            {summary}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground/70">
              Used only to keep older context in this conversation — never as a source of facts.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-[11.5px]"
              onClick={() => {
                clearThreadSummary(thread.id);
                setOpen(false);
              }}
            >
              <Trash2 className="h-3 w-3" /> Delete summary
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
