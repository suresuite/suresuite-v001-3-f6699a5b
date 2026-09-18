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

/** KPIs whose engine values are stored as fractions (0–1) — displayed as
 *  percentages throughout the results views. Mirrors the fill_rate special
 *  case in ReplicationSeedExplorer's fmt(); extend this set if more
 *  fraction-valued KPIs are added (e.g. "otif"). */
const PERCENT_KPIS = new Set(["fill_rate"]);

function nameForKey(key: string): string {
  if (key === "mean") return "Mean";
  if (key === "ci_hi") return "95% CI (upper)";
  if (key === "ci_lo") return "95% CI (lower)";
  return key;
}

/** Running mean ± 95% CI as more replications complete. */
export function ConvergencePlot({ reps, primaryKpi, warmupAt }: Props) {
  const isPercent = PERCENT_KPIS.has(primaryKpi);
  const scale = isPercent ? 100 : 1;

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
        // Half-width is computed in the engine's native units (fractions for
        // fill_rate, etc.) — only the OUTPUT is scaled to percent, so the CI
        // math itself is unaffected by display units.
        out.push({
          n: xs.length,
          mean: m * scale,
          ci_lo: (m - hw) * scale,
          ci_hi: (m + hw) * scale,
        });
      });
    return out;
  }, [reps, primaryKpi, scale]);

  const formatValue = (v: number) =>
    isPercent ? `${v.toFixed(2)}%` : v.toLocaleString(undefined, { maximumFractionDigits: 4 });

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
              <YAxis
                tick={{ fontSize: 10 }}
                domain={["auto", "auto"]}
                tickFormatter={(v) => (isPercent ? `${v.toFixed(2)}%` : v)}
              />
              <Tooltip
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }}
                labelFormatter={(n) => `Replication ${n}`}
                formatter={(value: number, key: string) => [formatValue(value), nameForKey(key)]}
              />
              {warmupAt != null && (
                <ReferenceArea
                  x1={1}
                  x2={Math.min(warmupAt, data.length)}
                  fillOpacity={0.08}
                  fill="hsl(var(--muted-foreground))"
                />
              )}
              <Area type="monotone" dataKey="ci_hi" stroke="none" fill="hsl(var(--primary))" fillOpacity={0.12} />
              <Area type="monotone" dataKey="ci_lo" stroke="none" fill="hsl(var(--background))" fillOpacity={1} />
              <Line type="monotone" dataKey="mean" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}