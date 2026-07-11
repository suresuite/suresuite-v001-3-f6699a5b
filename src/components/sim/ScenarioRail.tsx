import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Copy, Trash2, AlertTriangle, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Scenario } from "@/hooks/useScenarios";
import type { Credibility } from "@/hooks/useModelValidation";

interface Props {
  scenarios: Scenario[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (s: Scenario) => void;
  onDelete: (id: string) => void;
  loading?: boolean;
  /** B0b (§2.6): per-row credibility dot — derived, never stored. */
  credibilityFor?: (s: Scenario) => Credibility;
}

const CRED_DOT: Record<Credibility["state"], { cls: string; label: string }> = {
  validated: { cls: "bg-emerald-500", label: "model validated" },
  stale: { cls: "bg-amber-500", label: "validation stale — something drifted" },
  unvalidated: { cls: "bg-muted-foreground/40", label: "model unvalidated" },
};

function formatRelative(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const day = 86_400_000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toLocaleDateString();
}

export function ScenarioRail({
  scenarios,
  selectedId,
  onSelect,
  onCreate,
  onDuplicate,
  onDelete,
  loading,
  credibilityFor,
}: Props) {
  return (
    <div className="flex flex-col border border-border bg-card w-64 shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Scenarios
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onCreate}
          title="New scenario"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="max-h-[55vh]">
        <div className="flex flex-col">
          {loading && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
          )}
          {!loading && scenarios.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground leading-snug">
              No scenarios yet. Create one or launch a stress test above.
            </p>
          )}
          {scenarios.map((s) => {
            const disruptions = s.disruption_schedule?.length ?? 0;
            const isSelected = selectedId === s.id;
            const cred = credibilityFor?.(s) ?? null;
            return (
              <div
                key={s.id}
                className={cn(
                  "group flex items-start justify-between gap-2 px-3 py-2.5 cursor-pointer border-l-2 transition-colors",
                  isSelected
                    ? "bg-muted border-l-primary"
                    : "border-l-transparent hover:bg-muted/40",
                )}
                onClick={() => onSelect(s.id)}
              >
                <div className="flex flex-col min-w-0 gap-1 flex-1">
                  <span
                    className={cn(
                      "text-sm leading-tight truncate flex items-center gap-1.5",
                      isSelected
                        ? "font-semibold text-foreground"
                        : "font-medium text-foreground/90",
                    )}
                  >
                    {cred && (
                      <span
                        className={cn("h-1.5 w-1.5 rounded-full shrink-0", CRED_DOT[cred.state].cls)}
                        title={CRED_DOT[cred.state].label}
                      />
                    )}
                    <span className="truncate">{s.name || "Untitled scenario"}</span>
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {disruptions > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {disruptions} disruption{disruptions > 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <CircleDot className="h-2.5 w-2.5" />
                        Steady-state
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">·</span>
                    <span className="text-[10px] text-muted-foreground">
                      {s.replications} reps · {s.horizon_days}d
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70">
                    {formatRelative(s.updated_at || s.created_at)}
                  </span>
                </div>
                <div className="hidden group-hover:flex gap-0.5 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicate(s);
                    }}
                    title="Duplicate"
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
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
