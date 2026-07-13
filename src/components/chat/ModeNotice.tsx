import { ShieldQuestion } from "lucide-react";
import { useChatThreads } from "@/hooks/useChatThreads";

/**
 * The §15 mode-notice part (ai-agents.md §15 voice): rendered when an Ask-mode
 * turn had a mutation intent subtracted at the server. Carries the one-click
 * "Switch to Review" chip — clicking flips THIS thread's mode (client state +
 * server row via upsert_chat_thread) so the user can re-ask and get a card.
 * The server emitted the refusal; this component only offers the switch.
 */

export interface ModeNoticeData {
  mode: "ask";
  blocked_agent_id: string;
  blocked_intent: string | null;
  action: "switch_to_review";
  label: string;
}

export function ModeNotice({ data }: { data: ModeNoticeData }) {
  const threads = useChatThreads();
  const threadId = threads.activeThreadId;
  const currentMode = threads.activeThread?.mode ?? "review";

  if (currentMode === "review") {
    // Already flipped (possibly from another tab) — the chip's job is done.
    return (
      <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[12px] text-muted-foreground">
        <ShieldQuestion className="h-3.5 w-3.5" />
        This thread is now in Review mode — ask again to get a reviewable proposal.
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[12px]">
      <ShieldQuestion className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">
        Decision Support mode — nothing was changed{data.blocked_intent ? ` (blocked: ${data.blocked_intent})` : ""}.
      </span>
      <button
        type="button"
        onClick={() => threadId && threads.setThreadMode(threadId, "review")}
        className="rounded bg-foreground px-2 py-0.5 text-[12px] font-medium text-background hover:opacity-90"
      >
        {data.label || "Switch to Review"}
      </button>
    </div>
  );
}
