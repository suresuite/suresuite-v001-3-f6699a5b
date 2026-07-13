import { useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import type { ChatToolCall } from "@/hooks/useProjectChat";
import { cn } from "@/lib/utils";
import { PART_TREATMENTS } from "@/lib/chat/partStyles";

/**
 * Tool activity, in the §17.2 grammar (ai-agents.md v1.2 Phase 2): collapsed
 * by default into one line — "Analyzed project data · 4 steps · 2.1s" —
 * expanding to a step timeline (tool label, row count, duration, error
 * state). Replaces the always-expanded ToolCallBadge row.
 *
 * Durations render only when the stored call record carries one
 * (`duration_ms`, additive) — pre-v1.2 messages never do, and the line
 * simply omits the timing segment (§10 Phase-2 landing notes).
 */

const t = PART_TREATMENTS.activity;

function totalSeconds(calls: ChatToolCall[]): string | null {
  const timed = calls.filter((c) => typeof c.duration_ms === "number");
  if (timed.length === 0) return null;
  const total = timed.reduce((s, c) => s + (c.duration_ms as number), 0);
  return `${(total / 1000).toFixed(1)}s`;
}

function stepSeconds(c: ChatToolCall): string | null {
  return typeof c.duration_ms === "number" ? `${(c.duration_ms / 1000).toFixed(1)}s` : null;
}

export function ActivityGroup({ calls }: { calls: ChatToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (!calls?.length) return null;
  const failed = calls.filter((c) => !c.ok).length;
  const seconds = totalSeconds(calls);

  return (
    <div className={cn("mt-2.5 overflow-hidden text-[12px]", t.card)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn("flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:text-foreground", t.accent)}
      >
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
            failed > 0 ? "bg-destructive" : "bg-emerald-500",
          )}
        />
        <Wrench className={cn("h-3 w-3 shrink-0", t.icon)} />
        <span className="truncate font-medium">
          Analyzed project data · {calls.length} {calls.length === 1 ? "step" : "steps"}
          {seconds ? ` · ${seconds}` : ""}
          {failed > 0 ? ` · ${failed} failed` : ""}
        </span>
        <ChevronRight
          className={cn("ml-auto h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <ol className="border-t border-border bg-background/40 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed">
          {calls.map((c, i) => (
            <li key={i} className="flex items-center gap-1.5 truncate">
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  c.ok ? "bg-emerald-500" : "bg-destructive",
                )}
              />
              <span className="text-foreground">{c.name}</span>
              <span className="text-muted-foreground tabular-nums">
                · {c.row_count} {c.row_count === 1 ? "row" : "rows"}
              </span>
              {stepSeconds(c) && (
                <span className="text-muted-foreground tabular-nums">· {stepSeconds(c)}</span>
              )}
              {!c.ok && (
                <span className={PART_TREATMENTS.error.accent}>· failed</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
