import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Area,
  ComposedChart,
  ReferenceArea,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Replication } from "@/hooks/useSimulationRun";
import { mean, ciHalfWidth95 } from "@/lib/sim/stats";

interface Props {
  reps: Replication[];
  primaryKpi: string;
  warmupAt?: number | null;
}

/** Running mean ± 95% CI as more replications complete. */
export function ConvergencePlot({ reps, primaryKpi, warmupAt }: Props) {
  const data = useMemo(() => {
    const xs: number[] = [];
    const out: Array<{ n: number; mean: number; ci_lo: number; ci_hi: number }> = [];
    reps
      .filter((r) => r.status === "done" && typeof r.kpis[primaryKpi] === "number")
      .sort((a, b) => a.rep_index - b.rep_index)
      .forEach((r) => {
        xs.push(r.kpis[primaryKpi] as number);
        const m = mean(xs);
        const hw = ciHalfWidth95(xs);
        out.push({ n: xs.length, mean: m, ci_lo: m - hw, ci_hi: m + hw });
      });
    return out;
  }, [reps, primaryKpi]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Convergence — {primaryKpi} (mean ± 95% CI)
        </CardTitle>
      </CardHeader>
      <CardContent style={{ height: 240 }}>
        {data.length < 2 ? (
          <p className="text-xs text-muted-foreground">
            Need at least 2 completed replications to plot convergence.
          </p>
        ) : (
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="n" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }}
              />
              {warmupAt != null && (
                <ReferenceArea
                  x1={1}
                  x2={Math.min(warmupAt, data.length)}
                  fillOpacity={0.08}
                  fill="hsl(var(--muted-foreground))"
                />
              )}
              <Area
                type="monotone"
                dataKey="ci_hi"
                stroke="none"
                fill="hsl(var(--primary))"
                fillOpacity={0.12}
              />
              <Area
                type="monotone"
                dataKey="ci_lo"
                stroke="none"
                fill="hsl(var(--background))"
                fillOpacity={1}
              />
              <Line type="monotone" dataKey="mean" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
