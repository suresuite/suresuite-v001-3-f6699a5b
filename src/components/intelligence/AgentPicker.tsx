import { AGENTS } from "@/lib/chat/agents";
import { cn } from "@/lib/utils";

interface Props {
  activeId?: string | null;
  onSelect: (id: string) => void;
  className?: string;
}

export function AgentPicker({ activeId, onSelect, className }: Props) {
  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", className)}>
      {AGENTS.map((a) => {
        const Icon = a.icon;
        const active = a.id === activeId;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id)}
            className={cn(
              "group flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-all duration-150",
              active
                ? "border-foreground/70 bg-surface-elevated shadow-xs"
                : "border-border bg-surface-elevated hover:border-strong hover:shadow-xs hover:-translate-y-px",
            )}
          >
            <div
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md bg-muted",
                a.color,
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="text-[13px] font-medium text-foreground leading-tight">
              {a.name}
            </div>
            <div className="text-[11.5px] leading-snug text-muted-foreground line-clamp-2">
              {a.blurb}
            </div>
          </button>
        );
      })}
    </div>
  );
}
