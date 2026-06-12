import { useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import type { ChatToolCall } from "@/hooks/useProjectChat";

export function ToolCallBadge({ calls }: { calls: ChatToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (!calls?.length) return null;
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/30 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-muted-foreground hover:text-foreground"
      >
        <Wrench className="h-3 w-3" />
        <span>{calls.length} tool {calls.length === 1 ? "call" : "calls"}</span>
        <ChevronDown className={`ml-auto h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-border px-2 py-1.5 font-mono text-[10px] leading-snug">
          {calls.map((c, i) => (
            <div key={i} className="truncate">
              <span className={c.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>●</span>{" "}
              <span className="text-foreground">{c.name}</span>
              <span className="text-muted-foreground"> ({c.row_count} rows)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
