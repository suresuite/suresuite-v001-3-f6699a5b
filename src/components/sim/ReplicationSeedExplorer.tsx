// Per-seed replication filter on run results (blueprint G17 / §9.5.1 — W1).
//
// run_replications already persists per-rep seeds, KPIs and weekly series;
// this panel makes that evidence addressable per seed: the default view is
// the cross-replication mean ± CI band over all persisted weekly traces,
// and selecting a seed overlays (or isolates) that replication's trace and
// shows its KPI row next to the aggregate. Everything rendered here is
// persisted engine output — nothing synthetic.

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Replication } from "@/hooks/useSimulationRun";
import { meanCI } from "@/lib/sim/validationStats";
import { FROZEN_CELL } from '@/components/shared';

/** The weekly series keys the worker persists on run_replications.time_series. */
export const REPLICATION_SERIES = [
  { key: "fill_rate", label: "Fill rate", unit: "fraction" },
  { key: "backlog_units", label: "Backlog", unit: "units" },
  { key: "on_hand_value", label: "Material inventory", unit: "€" },
  { key: "fg_value", label: "Finished-goods inventory", unit: "€" },
  { key: "on_hand_units", label: "Material inventory", unit: "units" },
  { key: "fg_units", label: "Finished-goods inventory", unit: "units" },
  { key: "revenue_value", label: "Revenue", unit: "€/week" },
] as const;
export type ReplicationSeriesKey = (typeof REPLICATION_SERIES)[number]["key"];

/** KPI columns of the selected replication's row. */
const SEED_KPI_ROW: Array<{ key: string; label: string }> = [
  { key: "fill_rate", label: "Fill rate" },
  { key: "revenue", label: "Revenue" },
  { key: "lost_sales_value", label: "Lost sales" },
  { key: "max_backlog", label: "Max backlog" },
  { key: "avg_on_hand_value", label: "On-hand value" },
  { key: "cost_of_resilience", label: "Cost of resilience" },
];

function fmt(key: string, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (key === "fill_rate") return `${(v * 100).toFixed(2)}%`;
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(3);
}

function nameForSeriesKey(key: string): string {
  if (key === "mean") return "Mean";
  if (key === "upper") return "Upper (95% CI)";
  if (key === "lower") return "Lower (95% CI)";
  const m = /^s(-?\d+)$/.exec(key);
  return m ? `Seed ${m[1]}` : key;
}

interface SeedSelectorProps {
  reps: Replication[];
  value: number | null; // seed_used, or null = all reps
  onChange: (seed: number | null) => void;
  className?: string;
}

/** The reusable "all reps / one seed" dropdown. */
export function SeedSelector({ reps, value, onChange, className }: SeedSelectorProps) {
  return (
    <Select
      value={value == null ? "__all__" : String(value)}
      onValueChange={(v) => onChange(v === "__all__" ? null : Number(v))}
    >
      {/* §2.4/G3 Case B: full width below `md`, the 210px literal at `md`. */}
      <SelectTrigger className={cn("h-7 min-h-11 w-full min-w-0 text-[11px] md:min-h-0 md:w-[210px]", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__" className="min-h-11 text-xs md:min-h-0">
          All replications (mean + CI)
        </SelectItem>
        {reps.map((r) => (
          <SelectItem key={r.seed_used} value={String(r.seed_used)} className="min-h-11 text-xs md:min-h-0">
            seed {r.seed_used} · rep {r.rep_index}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface Props {
  reps: Replication[]; // completed replications with kpis
  warmupWeeks?: number | null;
  confidence?: number;
  /** Compact mode drops the header title (embedding surface provides one). */
  title?: string;
}

export function ReplicationSeedExplorer({
  reps,
  warmupWeeks = null,
  confidence = 0.95,
  title = "Weekly traces by seed",
}: Props) {
  const [seriesKey, setSeriesKey] = useState<ReplicationSeriesKey>("fill_rate");
  const [seed, setSeed] = useState<number | null>(null);
  const [isolate, setIsolate] = useState(false);

  // The selected series' own unit decides percent display — reused for the
  // y-axis and tooltip below. Computed here (not from the later `meta` const)
  // because `data`'s useMemo factory runs before `meta` is declared.
  const isPercent = REPLICATION_SERIES.find((s) => s.key === seriesKey)?.unit === "fraction";

  const withSeries = useMemo(
    () =>
      reps.filter(
        (r) => Array.isArray(r.time_series?.[seriesKey]) && r.time_series[seriesKey].length > 0,
      ),
    [reps, seriesKey],
  );
  const availableKeys = useMemo(
    () =>
      REPLICATION_SERIES.filter((s) =>
        reps.some((r) => Array.isArray(r.time_series?.[s.key]) && r.time_series[s.key].length > 0),
      ),
    [reps],
  );

  const selected = seed != null ? withSeries.find((r) => r.seed_used === seed) ?? null : null;
  const selectedRep = seed != null ? reps.find((r) => r.seed_used === seed) ?? null : null;

  const data = useMemo(() => {
    if (withSeries.length === 0) return [];
    const shown = withSeries.slice(0, 10);
    if (selected && !shown.includes(selected)) shown.push(selected);
    const n = Math.min(...shown.map((r) => r.time_series[seriesKey].length));
    const scale = isPercent ? 100 : 1;
    return Array.from({ length: n }, (_, week) => {
      const vals = withSeries.map((r) => r.time_series[seriesKey][week]);
      const { mean, half } = meanCI(vals, confidence);
      const row: Record<string, number> = {
        week,
        mean: mean * scale,
        lower: (mean - half) * scale,
        upper: (mean + half) * scale,
      };      
      shown.forEach((r) => {
        row[`s${r.seed_used}`] = r.time_series[seriesKey][week] * scale;
      });
      return row;
    });
  }, [withSeries, selected, seriesKey, confidence, isPercent]);

  const shownReps = useMemo(() => {
    const shown = withSeries.slice(0, 10);
    if (selected && !shown.includes(selected)) shown.push(selected);
    return shown;
  }, [withSeries, selected]);

  if (reps.length === 0) return null;
  const meta = REPLICATION_SERIES.find((s) => s.key === seriesKey)!;

  return (
    <div className="rounded-md border bg-card flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-xs font-semibold">{title}</span>
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
          engine data · {reps.length} rep(s)
        </span>
        <div className="flex-1" />
        {availableKeys.length > 1 && (
          <div className="flex items-center gap-1">
            {availableKeys.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSeriesKey(s.key)}
                className={cn(
                  "h-6 min-h-11 px-2 rounded-md text-[10px] border transition-colors whitespace-nowrap md:min-h-0",
                  s.key === seriesKey
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent hover:bg-muted/50 border-transparent",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <SeedSelector reps={reps} value={seed} onChange={setSeed} />
        {seed != null && (
          <button
            type="button"
            onClick={() => setIsolate((v) => !v)}
            className="h-6 min-h-11 px-2 rounded-md text-[10px] border bg-card hover:bg-muted/50 md:min-h-0"
            title="Overlay keeps the mean ± CI band and the other traces dimmed; Isolate shows only the selected replication"
          >
            {isolate ? "Isolated" : "Overlaid"}
          </button>
        )}
      </div>

      {withSeries.length === 0 ? (
        <div className="p-4 text-[11px] text-muted-foreground">
          No persisted weekly series ({meta.label}) on this run.
        </div>
      ) : (
        <div className="p-2">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeOpacity={0.15} />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} />
              <YAxis
                tick={{ fontSize: 10 }}
                width={44}
                domain={["auto", "auto"]}
                tickFormatter={(v) => (isPercent ? `${v}%` : v)}
              />
              <RTooltip
                contentStyle={{ fontSize: 11 }}
                labelFormatter={(week) => `Week ${week}`}
                formatter={(value: number, key: string) => [
                  isPercent ? `${Number(value).toFixed(2)}%` : Number(value).toFixed(3),
                  nameForSeriesKey(key),
                ]}
              />
              {warmupWeeks != null && warmupWeeks > 0 && (
                <ReferenceLine
                  x={warmupWeeks}
                  stroke="hsl(var(--destructive))"
                  strokeDasharray="4 3"
                  label={{ value: "warm-up", fontSize: 9, fill: "hsl(var(--destructive))" }}
                />
              )}
              {!(isolate && selected) && (
                <>
                  <Line type="monotone" dataKey="upper" stroke="hsl(var(--primary) / 0.2)" strokeWidth={1} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="lower" stroke="hsl(var(--primary) / 0.2)" strokeWidth={1} dot={false} isAnimationActive={false} />
                </>
              )}
              {shownReps.map((r, i) => {
                const isSel = selected != null && r.seed_used === selected.seed_used;
                if (isolate && selected && !isSel) return null;
                if (isolate && !selected) return null;
                return (
                  <Line
                    key={r.seed_used}
                    type="monotone"
                    dataKey={`s${r.seed_used}`}
                    stroke={isSel ? "hsl(25 95% 50%)" : `hsl(${(i * 47) % 360} 65% 55%)`}
                    strokeOpacity={isSel ? 1 : selected ? 0.18 : 0.4}
                    strokeWidth={isSel ? 2.2 : 0.8}
                    dot={false}
                    isAnimationActive={false}
                  />
                );
              })}
              {!(isolate && selected) && (
                <Line type="monotone" dataKey="mean" stroke="hsl(var(--primary))" strokeWidth={2.2} dot={false} isAnimationActive={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
          <div className="px-1 pt-1 text-[10px] text-muted-foreground">
            {selected
              ? isolate
                ? `Isolated: replication ${selected.rep_index} (seed ${selected.seed_used}).`
                : `Selected seed ${selected.seed_used} highlighted over the cross-replication mean ± CI band.`
              : "Cross-replication mean ± CI band with individual seed traces dimmed."}
          </div>
        </div>
      )}

      {/* The selected replication's KPI row vs. the cross-rep mean. */}
      {selectedRep && (
        <div className="border-t px-3 py-2 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className={`text-left font-normal pr-3 py-0.5 ${FROZEN_CELL}`}>KPI</th>
                {SEED_KPI_ROW.map((k) => (
                  <th key={k.key} className="text-right font-normal px-2 py-0.5">
                    {k.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`pr-3 py-0.5 font-medium whitespace-nowrap ${FROZEN_CELL}`}>
                  seed {selectedRep.seed_used} · rep {selectedRep.rep_index}
                </td>
                {SEED_KPI_ROW.map((k) => (
                  <td key={k.key} className="text-right px-2 py-0.5 font-mono tabular-nums">
                    {fmt(k.key, Number(selectedRep.kpis[k.key]))}
                  </td>
                ))}
              </tr>
              <tr className="text-muted-foreground">
                <td className={`pr-3 py-0.5 whitespace-nowrap ${FROZEN_CELL}`}>mean over {reps.length} rep(s)</td>
                {SEED_KPI_ROW.map((k) => {
                  const vals = reps
                    .map((r) => Number(r.kpis[k.key]))
                    .filter((n) => Number.isFinite(n));
                  const m = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                  return (
                    <td key={k.key} className="text-right px-2 py-0.5 font-mono tabular-nums">
                      {fmt(k.key, m)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
