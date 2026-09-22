// Inventory over time (blueprint G19 / WP 9.1) — how stock moves across the
// horizon, split into the two things a supply chain actually holds: materials
// (raw and component stock, at unit cost) and finished goods (at unit COGS).
//
// Everything here is persisted engine output. The four series come from
// scsim's `WEEKLY_SERIES` declaration, reach `run_replications.time_series`
// through the bridge, and are plain weekly scalars — so unlike the per-item
// panel beside this one they exist on EVERY replication of EVERY run, not only
// on single-replication inspection runs.
//
// `fg_value` was computed on every run since the weekly trace was written and
// never published, because "which series exist" was authored in six places and
// it was present in two of them (§4 D163). It is the finished-goods line here.

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Replication } from "@/hooks/useSimulationRun";
import { meanCI } from "@/lib/sim/validationStats";

/** The two denominations the engine measures each stock in. */
const DENOMINATIONS = {
  value: {
    label: "Value",
    unit: "€",
    material: "on_hand_value",
    finished: "fg_value",
    caption: "Material stock at unit cost; finished goods at unit COGS.",
  },
  units: {
    label: "Units",
    unit: "units",
    material: "on_hand_units",
    finished: "fg_units",
    caption: null, // see UNIT_CAVEAT — this view owes the reader a note
  },
} as const;
type Denomination = keyof typeof DENOMINATIONS;

// T2 — substitution and assumption are visible AT THE POINT OF DISPLAY.
// Neither `materials` nor `products` carries a unit-of-measure column, so a
// units total adds quantities whose comparability nothing in the data
// declares. The value view has no such problem: currency is currency.
const UNIT_CAVEAT =
  "Summed across items. Materials and products carry no unit-of-measure field, " +
  "so this total assumes one common unit — switch to Value to compare across items.";

const LINES = [
  { id: "material", label: "Materials", color: "hsl(215 80% 50%)" },
  { id: "finished", label: "Finished goods", color: "hsl(150 65% 40%)" },
  { id: "total", label: "Total", color: "hsl(280 60% 55%)" },
] as const;

function fmtAxis(v: number, unit: string): string {
  const abs = Math.abs(v);
  const n =
    abs >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
    : abs >= 1_000 ? `${(v / 1_000).toFixed(0)}k`
    : v.toFixed(0);
  return unit === "€" ? `€${n}` : n;
}

/** Weekly traces for one key, across the replications that carry it. */
function tracesFor(reps: Replication[], key: string): number[][] {
  return reps
    .map((r) => r.time_series?.[key])
    .filter((s): s is number[] => Array.isArray(s) && s.length > 0);
}

interface Props {
  reps: Replication[];
  warmupWeeks?: number | null;
  height?: number;
  className?: string;
}

export function InventoryOverTime({
  reps,
  warmupWeeks = null,
  height = 200,
  className,
}: Props) {
  const [denom, setDenom] = useState<Denomination>("value");
  const d = DENOMINATIONS[denom];

  const { data, repCount, missing } = useMemo(() => {
    const mat = tracesFor(reps, d.material);
    const fin = tracesFor(reps, d.finished);
    if (mat.length === 0 && fin.length === 0) {
      return { data: [], repCount: 0, missing: true };
    }
    const lengths = [...mat, ...fin].map((s) => s.length);
    const weeks = Math.min(...lengths);
    const rows = Array.from({ length: weeks }, (_, week) => {
      // Inventory is a `level` in the engine's declaration — a stock measured
      // at the end of the week. Across REPLICATIONS the honest summary is the
      // mean (they are samples of the same week), which is what this does; it
      // is never summed across WEEKS, which would count the same goods again.
      const m = meanCI(mat.map((s) => s[week] ?? 0), 0.95);
      const f = meanCI(fin.map((s) => s[week] ?? 0), 0.95);
      const total = m.mean + f.mean;
      // The band is the total's, so the reader sees the spread of the figure
      // the eye lands on rather than of one component.
      const half = Math.sqrt(m.half ** 2 + f.half ** 2);
      return {
        week,
        material: m.mean,
        finished: f.mean,
        total,
        band: [Math.max(0, total - half), total + half] as [number, number],
      };
    });
    return { data: rows, repCount: Math.max(mat.length, fin.length), missing: false };
  }, [reps, d.material, d.finished]);

  // A run from before this series existed carries neither key. Say that,
  // rather than drawing a flat zero line that reads as "no inventory".
  if (missing) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed bg-card p-3 text-[11px] text-muted-foreground",
          className,
        )}
      >
        <span className="font-semibold">Inventory over time</span> — this run
        carries no inventory series. Runs made before the engine published them
        have none; re-run to see it.
      </div>
    );
  }

  return (
    <div className={cn("rounded-md border bg-card", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Boxes className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Inventory over time</span>
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
          engine data · mean of {repCount} replication{repCount === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {(Object.keys(DENOMINATIONS) as Denomination[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setDenom(k)}
              className={cn(
                "h-6 min-h-11 px-2 rounded-md text-[10px] border transition-colors md:min-h-0",
                k === denom
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card hover:bg-muted/50 border-border",
              )}
            >
              {DENOMINATIONS[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-2">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeOpacity={0.15} />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 9 }}
              label={{ value: "week", position: "insideBottomRight", fontSize: 9 }}
            />
            <YAxis
              tick={{ fontSize: 9 }}
              width={52}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => fmtAxis(v, d.unit)}
            />
            <RTooltip
              contentStyle={{ fontSize: 10 }}
              formatter={(v: number | number[], name: string) =>
                Array.isArray(v)
                  ? [`${fmtAxis(v[0], d.unit)} – ${fmtAxis(v[1], d.unit)}`, "Total 95% CI"]
                  : [fmtAxis(v, d.unit), name]
              }
              labelFormatter={(w) => `Week ${w}`}
            />
            {repCount > 1 && (
              <Area
                dataKey="band"
                name="Total 95% CI"
                stroke="none"
                fill="hsl(280 60% 55%)"
                fillOpacity={0.12}
                isAnimationActive={false}
              />
            )}
            {warmupWeeks != null && warmupWeeks > 0 && (
              <ReferenceLine
                x={warmupWeeks}
                stroke="hsl(var(--destructive))"
                strokeDasharray="4 3"
                label={{ value: "warm-up", fontSize: 9, fill: "hsl(var(--destructive))" }}
              />
            )}
            {LINES.map((l) => (
              <Line
                key={l.id}
                type="monotone"
                dataKey={l.id}
                name={l.label}
                stroke={l.color}
                strokeWidth={l.id === "total" ? 1.8 : 1.4}
                strokeDasharray={l.id === "total" ? undefined : "3 2"}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>

        <div className="flex flex-wrap items-center gap-3 px-1 pt-1">
          {LINES.map((l) => (
            <span key={l.id} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span
                className="inline-block h-1.5 w-3 rounded-sm"
                style={{ background: l.color }}
              />
              {l.label}
            </span>
          ))}
        </div>
        <p className="px-1 pt-1 text-[10px] leading-snug text-muted-foreground">
          {denom === "units" ? UNIT_CAVEAT : d.caption}
        </p>
      </div>
    </div>
  );
}
