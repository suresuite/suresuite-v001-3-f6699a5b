import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Replication } from "@/hooks/useSimulationRun";

interface Props {
  reps: Replication[];
}

/**
 * Heatmap of node × time utilization. Expects each replication's `time_series`
 * to include `utilization` shaped as `{ [nodeKey]: number[] }`. Averaged across
 * replications; gracefully empty when worker hasn't produced data yet.
 */
export function UtilizationHeatmap({ reps }: Props) {
  const matrix = useMemo(() => {
    const sums: Record<string, number[]> = {};
    const counts: Record<string, number[]> = {};
    for (const r of reps) {
      const u = (r.time_series as Record<string, unknown> | undefined)?.utilization as
        | Record<string, number[]>
        | undefined;
      if (!u || typeof u !== "object") continue;
      for (const [node, series] of Object.entries(u)) {
        if (!Array.isArray(series)) continue;
        if (!sums[node]) {
          sums[node] = [];
          counts[node] = [];
        }
        series.forEach((v, i) => {
          sums[node][i] = (sums[node][i] ?? 0) + v;
          counts[node][i] = (counts[node][i] ?? 0) + 1;
        });
      }
    }
    const out: Record<string, number[]> = {};
    for (const k of Object.keys(sums)) {
      out[k] = sums[k].map((v, i) => v / (counts[k][i] || 1));
    }
    return out;
  }, [reps]);

  const nodes = Object.keys(matrix);
  const maxLen = nodes.reduce((m, n) => Math.max(m, matrix[n].length), 0);

  if (nodes.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Utilization heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            No utilization series yet. Run a simulation that emits per-node utilization to see it here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const colorFor = (v: number) => {
    const t = Math.max(0, Math.min(1, v));
    // dark→primary scale
    return `hsl(var(--primary) / ${0.1 + t * 0.85})`;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Utilization heatmap (node × time)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto">
          <div className="inline-grid gap-px" style={{ gridTemplateColumns: `120px repeat(${maxLen}, 8px)` }}>
            {nodes.map((node) => (
              <div key={node} className="contents">
                <div className="text-[10px] truncate pr-2 py-0.5">{node}</div>
                {Array.from({ length: maxLen }).map((_, i) => (
                  <div
                    key={i}
                    title={`${node} @ t${i}: ${(matrix[node][i] ?? 0).toFixed(2)}`}
                    className="h-3"
                    style={{ background: colorFor(matrix[node][i] ?? 0) }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
          <span>0%</span>
          <div className="h-2 flex-1 bg-gradient-to-r from-primary/10 to-primary" />
          <span>100%</span>
        </div>
      </CardContent>
    </Card>
  );
}
