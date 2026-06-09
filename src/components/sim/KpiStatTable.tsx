import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Replication } from "@/hooks/useSimulationRun";
import { summarize } from "@/lib/sim/stats";

interface Props {
  reps: Replication[];
}

const KPI_DISPLAY: Array<{ key: string; label: string; format: (n: number) => string }> = [
  { key: "fill_rate", label: "Fill rate (α)", format: (n) => `${(n * 100).toFixed(2)}%` },
  { key: "fill_rate_beta", label: "Fill rate (β)", format: (n) => `${(n * 100).toFixed(2)}%` },
  { key: "otif", label: "OTIF", format: (n) => `${(n * 100).toFixed(2)}%` },
  { key: "lead_time_days", label: "Lead time (days)", format: (n) => n.toFixed(2) },
  { key: "lead_time_p95", label: "Lead time p95", format: (n) => n.toFixed(2) },
  { key: "revenue", label: "Revenue", format: (n) => `$${Math.round(n).toLocaleString()}` },
  { key: "cost", label: "Cost", format: (n) => `$${Math.round(n).toLocaleString()}` },
  { key: "profit", label: "Profit", format: (n) => `$${Math.round(n).toLocaleString()}` },
  { key: "utilization", label: "Utilization (avg)", format: (n) => `${(n * 100).toFixed(1)}%` },
  { key: "inventory_turns", label: "Inventory turns", format: (n) => n.toFixed(2) },
  { key: "backorder_days", label: "Backorder days", format: (n) => n.toFixed(1) },
  { key: "ttr_days", label: "Time-to-recover", format: (n) => n.toFixed(1) },
  { key: "resilience_index", label: "Resilience index", format: (n) => n.toFixed(3) },
];

export function KpiStatTable({ reps }: Props) {
  const stats = useMemo(() => {
    const done = reps.filter((r) => r.status === "done");
    return KPI_DISPLAY.map((kpi) => {
      const xs = done.map((r) => r.kpis[kpi.key]).filter((n): n is number => typeof n === "number");
      return { ...kpi, stat: summarize(xs) };
    }).filter((row) => row.stat.n > 0);
  }, [reps]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">KPI summary across replications</CardTitle>
      </CardHeader>
      <CardContent>
        {stats.length === 0 ? (
          <p className="text-xs text-muted-foreground">No completed replications yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px]">KPI</TableHead>
                <TableHead className="text-[11px] text-right">Mean</TableHead>
                <TableHead className="text-[11px] text-right">± 95% CI</TableHead>
                <TableHead className="text-[11px] text-right">σ</TableHead>
                <TableHead className="text-[11px] text-right">Min</TableHead>
                <TableHead className="text-[11px] text-right">Max</TableHead>
                <TableHead className="text-[11px] text-right">n</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="text-xs font-medium">{row.label}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{row.format(row.stat.mean)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{row.format(row.stat.ci95)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{row.format(row.stat.std)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{row.format(row.stat.min)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{row.format(row.stat.max)}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{row.stat.n}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
