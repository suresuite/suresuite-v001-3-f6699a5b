import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Experiment } from "@/hooks/useExperiments";
import type { RecoveryPlaybook } from "@/hooks/useRecoveryPlaybooks";

interface ScenarioRow {
  id: string;
  name: string;
  recovery_playbook_id: string | null;
}
interface RunRow {
  id: string;
  scenario_id: string;
  status: string;
  aggregate_kpis: Record<string, number>;
  ci_half_widths: Record<string, number>;
  rep_count_done: number;
  rep_count_target: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

interface Props {
  experiment: Experiment;
  playbooks: RecoveryPlaybook[];
  primaryKpi: string;
}

export function ExperimentResultsPanel({ experiment, playbooks, primaryKpi }: Props) {
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);

  const load = useCallback(async () => {
    if (experiment.scenario_ids.length === 0) return;
    const [{ data: sc }, { data: rn }] = await Promise.all([
      sb.from("scenarios").select("id,name,recovery_playbook_id").in("id", experiment.scenario_ids),
      sb
        .from("simulation_runs")
        .select("id,scenario_id,status,aggregate_kpis,ci_half_widths,rep_count_done,rep_count_target")
        .in("scenario_id", experiment.scenario_ids)
        .order("created_at", { ascending: false }),
    ]);
    setScenarios((sc ?? []) as ScenarioRow[]);
    // Keep the latest run per scenario.
    const latest = new Map<string, RunRow>();
    for (const r of (rn ?? []) as RunRow[]) {
      if (!latest.has(r.scenario_id)) latest.set(r.scenario_id, r);
    }
    setRuns(Array.from(latest.values()));
  }, [experiment.scenario_ids]);

  useEffect(() => {
    void load();
    const ch = sb
      .channel(`exp_runs:${experiment.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "simulation_runs" },
        () => void load(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [experiment.id, load]);

  const playbookLookup = useMemo(() => new Map(playbooks.map((p) => [p.id, p.name])), [playbooks]);
  const runByScenario = useMemo(() => new Map(runs.map((r) => [r.scenario_id, r])), [runs]);

  const chartData = useMemo(
    () =>
      scenarios.map((s) => {
        const r = runByScenario.get(s.id);
        const v = Number(r?.aggregate_kpis?.[primaryKpi] ?? 0);
        return {
          name: playbookLookup.get(s.recovery_playbook_id ?? "") ?? s.name.slice(0, 14),
          value: v,
          ci: Number(r?.ci_half_widths?.[primaryKpi] ?? 0),
        };
      }),
    [scenarios, runByScenario, primaryKpi, playbookLookup],
  );

  const doneCount = runs.filter((r) => r.status === "done").length;
  const totalCount = scenarios.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-[10px]">{experiment.design_type}</Badge>
        <span>
          {doneCount}/{totalCount} runs complete · primary KPI:{" "}
          <span className="font-mono text-foreground">{primaryKpi}</span>
        </span>
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
              formatter={(v: number) => v.toFixed(3)}
            />
            <Bar dataKey="value" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-sm border border-border/60 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[10px] uppercase">Scenario</TableHead>
              <TableHead className="text-[10px] uppercase">Playbook</TableHead>
              <TableHead className="text-[10px] uppercase">Status</TableHead>
              <TableHead className="text-[10px] uppercase text-right">{primaryKpi}</TableHead>
              <TableHead className="text-[10px] uppercase text-right">± CI</TableHead>
              <TableHead className="text-[10px] uppercase text-right">Reps</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scenarios.map((s) => {
              const r = runByScenario.get(s.id);
              return (
                <TableRow key={s.id}>
                  <TableCell className="text-xs">{s.name}</TableCell>
                  <TableCell className="text-xs">
                    {s.recovery_playbook_id
                      ? playbookLookup.get(s.recovery_playbook_id) ?? "—"
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {r?.status ?? "pending"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono">
                    {r ? Number(r.aggregate_kpis?.[primaryKpi] ?? 0).toFixed(3) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono text-muted-foreground">
                    {r ? Number(r.ci_half_widths?.[primaryKpi] ?? 0).toFixed(3) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-right font-mono">
                    {r ? `${r.rep_count_done}/${r.rep_count_target}` : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
