import { useState } from "react";
import { Brain, Info, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCapabilities } from "@/hooks/useCapabilities";
import { useChatThreads } from "@/hooks/useChatThreads";

/**
 * Thread-info panel — workstream M1 (ai-agents.md §14.3 integrity clause):
 * the rolling summary is stored, visible ("What the assistant remembers about
 * this conversation"), and user-deletable (delete ⇒ summary NULL,
 * summary_upto_seq 0 via set_thread_summary).
 *
 * §17.4 adds the "How memory works" explainer alongside it — shown when the
 * project_memory capability is on (or a summary exists), so flag-off behavior
 * is unchanged: without either, the panel still renders nothing.
 */
export function ThreadInfoPanel({ threadId }: { threadId: string | null }) {
  const { threads, clearThreadSummary } = useChatThreads();
  const { canFeature } = useCapabilities();
  const [open, setOpen] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);

  const thread = threadId ? threads.find((t) => t.id === threadId) : null;
  const summary = thread?.summary?.trim();
  const memoryOn = canFeature("project_memory");
  if (!thread || (!summary && !memoryOn)) return null;

  return (
    <div className="border-b border-border bg-surface-elevated">
      <div className="mx-auto flex max-w-[720px] items-center gap-3 px-4 py-1.5">
        {summary && (
          <button
            type="button"
            onClick={() => { setOpen((v) => !v); setExplainerOpen(false); }}
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition hover:text-foreground"
            aria-expanded={open}
          >
            <Info className="h-3.5 w-3.5" />
            What the assistant remembers about this conversation
          </button>
        )}
        {memoryOn && (
          <button
            type="button"
            onClick={() => { setExplainerOpen((v) => !v); setOpen(false); }}
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition hover:text-foreground"
            aria-expanded={explainerOpen}
          >
            <Brain className="h-3.5 w-3.5" />
            How memory works
          </button>
        )}
        {(open || explainerOpen) && (
          <button
            type="button"
            onClick={() => { setOpen(false); setExplainerOpen(false); }}
            className="ml-auto rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close memory panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && summary && (
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
      {explainerOpen && (
        <div
          role="region"
          aria-label="How memory works"
          className="mx-auto max-w-[720px] px-4 pb-3 text-[12.5px] leading-relaxed text-muted-foreground"
        >
          <p>The assistant keeps two kinds of memory, and you control both:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>
              <span className="font-medium text-foreground">This conversation</span> — a rolling
              summary of older turns in this thread. It's shown above when it exists, and you can
              delete it at any time. It's recall only, never a source of facts.
            </li>
            <li>
              <span className="font-medium text-foreground">Project memory</span> — facts,
              preferences, and decisions saved for the whole project. Writes are{" "}
              <span className="font-medium text-foreground">consent-only</span>: something is stored
              only when you say "remember …" or accept a Save chip. Every entry stays{" "}
              <span className="font-medium text-foreground">visible</span> in the Project memory
              panel (with its source), and is <span className="font-medium text-foreground">cited</span>{" "}
              whenever it informs an answer or a draft.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
