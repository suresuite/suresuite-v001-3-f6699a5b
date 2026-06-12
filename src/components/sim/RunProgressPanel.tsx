import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Play, Square, Plus } from "lucide-react";
import type { SimulationRun, Replication } from "@/hooks/useSimulationRun";

interface Props {
  run: SimulationRun | null;
  reps: Replication[];
  versionLabel?: string | null;
  onCancel: () => void;
  onAddReps: (n: number) => void;
}

export function RunProgressPanel({ run, reps, versionLabel, onCancel, onAddReps }: Props) {
  if (!run) {
    return (
      <Card>
        <CardContent className="pt-6 flex flex-col items-center gap-2 text-center">
          <Play className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No runs yet. Click <strong>Run</strong> above to launch this scenario.
          </p>
        </CardContent>
      </Card>
    );
  }

  const pct = run.rep_count_target
    ? Math.round((run.rep_count_done / run.rep_count_target) * 100)
    : 0;
  const statusColor = {
    queued: "secondary",
    running: "default",
    done: "outline",
    cancelled: "destructive",
    failed: "destructive",
  }[run.status] as "secondary" | "default" | "outline" | "destructive";

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              Latest run
              <Badge variant={statusColor} className="text-[10px] uppercase">
                {run.status}
              </Badge>
              {versionLabel && (
                <Badge variant="outline" className="text-[10px]">
                  {versionLabel}
                </Badge>
              )}
            </CardTitle>
            <div className="flex gap-2">
              {(run.status === "running" || run.status === "queued") && (
                <Button size="sm" variant="outline" className="gap-1" onClick={onCancel}>
                  <Square className="h-3.5 w-3.5" /> Cancel
                </Button>
              )}
              {run.status === "done" && (
                <Button size="sm" variant="outline" className="gap-1" onClick={() => onAddReps(10)}>
                  <Plus className="h-3.5 w-3.5" /> +10 reps
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span>
              {run.rep_count_done} / {run.rep_count_target} replications
            </span>
            <span className="text-muted-foreground">
              {run.warmup_detected_at != null
                ? `Warm-up @ day ${run.warmup_detected_at}`
                : "Warm-up: pending"}
            </span>
          </div>
          <Progress value={pct} />
          {run.error_message && (
            <p className="text-xs text-destructive mt-1">{run.error_message}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Per-replication</CardTitle>
        </CardHeader>
        <CardContent>
          {reps.length === 0 ? (
            <p className="text-xs text-muted-foreground">Waiting for first replication…</p>
          ) : (
            <div className="grid grid-cols-10 gap-1">
              {reps.map((r) => (
                <div
                  key={r.id}
                  title={`rep ${r.rep_index} · seed ${r.seed_used} · ${r.status}`}
                  className={
                    "h-6 border border-border text-[10px] flex items-center justify-center " +
                    (r.status === "done"
                      ? "bg-primary/20 text-foreground"
                      : r.status === "running"
                      ? "bg-amber-500/20"
                      : r.status === "failed"
                      ? "bg-destructive/30"
                      : "bg-muted")
                  }
                >
                  {r.rep_index}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
