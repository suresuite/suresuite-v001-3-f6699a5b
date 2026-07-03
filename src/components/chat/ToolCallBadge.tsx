import { useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import type { ChatToolCall } from "@/hooks/useProjectChat";
import { cn } from "@/lib/utils";

export function ToolCallBadge({ calls }: { calls: ChatToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (!calls?.length) return null;
  const hasError = calls.some((c) => !c.ok);
  return (
    <div className="mt-2.5 overflow-hidden rounded-md border border-border bg-surface-elevated text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted-foreground transition hover:text-foreground"
      >
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            hasError ? "bg-destructive" : "bg-emerald-500",
          )}
        />
        <Wrench className="h-3 w-3" />
        <span className="font-medium">
          {calls.length} tool {calls.length === 1 ? "call" : "calls"}
        </span>
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border bg-background/40 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed">
          {calls.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 truncate">
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  c.ok ? "bg-emerald-500" : "bg-destructive",
                )}
              />
              <span className="text-foreground">{c.name}</span>
              <span className="text-muted-foreground tabular-nums">
                · {c.row_count} rows
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
