import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Copy, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Scenario } from "@/hooks/useScenarios";

interface Props {
  scenarios: Scenario[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (s: Scenario) => void;
  onDelete: (id: string) => void;
  loading?: boolean;
}

export function ScenarioRail({
  scenarios,
  selectedId,
  onSelect,
  onCreate,
  onDuplicate,
  onDelete,
  loading,
}: Props) {
  return (
    <div className="flex flex-col border border-border bg-card h-full min-h-[60vh] w-64 shrink-0">
      <div className="flex flex-col gap-2 px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Scenarios
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs w-full"
          onClick={onCreate}
        >
          <Plus className="h-3.5 w-3.5" /> New scenario
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {loading && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
          )}
          {!loading && scenarios.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              No scenarios yet. Create one to get started.
            </p>
          )}
          {scenarios.map((s) => (
            <div
              key={s.id}
              className={cn(
                "group flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 border-l-2",
                selectedId === s.id
                  ? "bg-muted border-l-primary"
                  : "border-l-transparent",
              )}
              onClick={() => onSelect(s.id)}
            >
              <div className="flex flex-col min-w-0">
                <span className="text-sm truncate">{s.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {s.replications}× · {s.horizon_days}d · seed {s.seed}
                </span>
              </div>
              <div className="hidden group-hover:flex gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(s);
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete scenario "${s.name}"?`)) onDelete(s.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
