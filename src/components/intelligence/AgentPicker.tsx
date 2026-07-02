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
              "group flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition",
              active
                ? "border-foreground bg-accent"
                : "border-border bg-card hover:border-foreground/40 hover:bg-accent/50",
            )}
          >
            <div className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted", a.color)}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="text-sm font-medium text-foreground">{a.name}</div>
            <div className="text-[11px] leading-snug text-muted-foreground">{a.blurb}</div>
          </button>
        );
      })}
    </div>
  );
}
