// AFTER THE RUN: did capacity bind, and for whom (§4 D167 / WP 9.3).
//
// `InventoryOverTime` (WP 9.1) is the pattern — an aggregate weekly series with
// per-item evidence behind it — and this is its capacity sibling. What it shows
// is a UTILIZATION READ, never a restatement of the input: the capacity the
// engine offered each week and the part of it the run consumed, both persisted
// engine output from `WEEKLY_SERIES`, so they exist on EVERY replication of
// EVERY run rather than only on full-debug inspection runs.
//
// ── THE MEASURE USED TO BE NaN, WHICH IS WHY THIS PANEL IS NEW ─────────────
//
// `capacity_utilization` read `trace.Q`, a matrix that exists only under
// `full_debug`, so the /policies sanity panel printed "not recorded" on every
// ordinary run and §4 D113's note that "the run-level measure now renders in
// the table above" described something that never appeared.
//
// ── UTILIZATION IS NOT BINDING, AND THE PANEL KEEPS THEM APART ─────────────
//
// A plant can run at 99% and refuse nothing; a plant can sit at 60% and still
// turn demand away in the weeks that matter. The line answers "how hard did it
// run"; `capacity_binding` answers "which products did it hold back, and for
// how many weeks" — measured against the UNCLIPPED want, inside the engine,
// because the clipped plan compared against capacity is equal by construction.

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
import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Replication } from "@/hooks/useSimulationRun";
import { meanCI } from "@/lib/sim/validationStats";

/** One entity the capacity held back, as the engine reports it. */
export interface CapacityBindingRow {
  id: string;
  /** Mean weeks of the analysis window in which capacity clipped this entity. */
  bound_weeks: number;
  /** The weekly capacity itself; null for a supplier declared unlimited. */
  capacity: number | null;
}

export interface CapacityBinding {
  window_weeks: number;
  replications: number;
  products: CapacityBindingRow[];
  suppliers: CapacityBindingRow[];
  unlimited_suppliers: number;
}

/** The two sides the engine publishes, per echelon. */
const SIDES = {
  plant: {
    label: "Plant",
    available: "plant_capacity_units",
    used: "plant_capacity_used_units",
    usedLabel: "Produced",
    caption:
      "Units produced against the capacity the engine offered that week — after any " +
      "disruption throttle and any short-term capacity. Below the line can also mean " +
      "materials ran out, which is not a capacity constraint.",
  },
  supplier: {
    label: "Suppliers",
    available: "supplier_capacity_units",
    used: "supplier_capacity_used_units",
    usedLabel: "Shipped",
    caption:
      "Only suppliers that declare a FINITE capacity_per_week are in this chart. A " +
      "supplier with an empty capacity is declared unlimited and is in neither the " +
      "capacity nor the shipped line — it cannot be utilized.",
  },
} as const;
type Side = keyof typeof SIDES;

function tracesFor(reps: Replication[], key: string): number[][] {
  return reps
    .map((r) => r.time_series?.[key])
    .filter((s): s is number[] => Array.isArray(s) && s.length > 0);
}

function fmtUnits(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toFixed(0);
}

function BindingTable({
  rows, windowWeeks, kind,
}: {
  rows: CapacityBindingRow[];
  windowWeeks: number;
  kind: "product" | "supplier";
}) {
  if (rows.length === 0) return null;
  return (
    <div className="border-t px-3 py-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Capacity held these {kind === "product" ? "products" : "suppliers"} back
      </div>
      <table className="w-full text-[10.5px]">
        <tbody>
          {rows.slice(0, 10).map((r) => (
            <tr key={r.id} className="border-b border-dashed last:border-b-0">
              <td className="py-[3px] pr-2 font-mono">{r.id}</td>
              <td className="py-[3px] pr-2 text-right tabular-nums">
                {r.capacity == null ? "∞" : fmtUnits(r.capacity)}
                <span className="ml-1 text-muted-foreground">/wk</span>
              </td>
              <td className="py-[3px] text-right tabular-nums">
                {r.bound_weeks.toFixed(r.bound_weeks % 1 === 0 ? 0 : 1)}
                <span className="ml-1 text-muted-foreground">of {windowWeeks} wk</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 10 && (
        <div className="pt-1 text-[10px] text-muted-foreground">
          …and {rows.length - 10} more.
        </div>
      )}
    </div>
  );
}

export function CapacityOverTime({
  reps,
  binding,
  warmupWeeks = null,
  height = 180,
  className,
}: {
  reps: Replication[];
  /** `aggregate_kpis._meta.capacity_binding`, or null on a run without it. */
  binding: CapacityBinding | null;
  warmupWeeks?: number | null;
  height?: number;
  className?: string;
}) {
  const [side, setSide] = useState<Side>("plant");
  const s = SIDES[side];

  const { data, repCount, missing, allZero } = useMemo(() => {
    const avail = tracesFor(reps, s.available);
    const used = tracesFor(reps, s.used);
    if (avail.length === 0 && used.length === 0) {
      return { data: [], repCount: 0, missing: true, allZero: false };
    }
    const weeks = Math.min(...[...avail, ...used].map((x) => x.length));
    const rows = Array.from({ length: weeks }, (_, week) => {
      // Capacity is a `flow` in the engine's declaration — a quantity the week
      // can pass — so the honest cross-REPLICATION summary is the mean of the
      // week, exactly as for a level. It is the cross-WEEK aggregate that
      // differs, and this chart never takes one.
      const a = meanCI(avail.map((x) => x[week] ?? 0), 0.95);
      const u = meanCI(used.map((x) => x[week] ?? 0), 0.95);
      return {
        week,
        available: a.mean,
        used: u.mean,
        band: [Math.max(0, u.mean - u.half), u.mean + u.half] as [number, number],
      };
    });
    return {
      data: rows,
      repCount: Math.max(avail.length, used.length),
      missing: false,
      allZero: rows.every((r) => r.available === 0),
    };
  }, [reps, s.available, s.used]);

  // A run from before these series existed carries neither key. Say that rather
  // than drawing a flat zero that reads as "no capacity".
  if (missing) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed bg-card p-3 text-[11px] text-muted-foreground",
          className,
        )}
      >
        <span className="font-semibold">Capacity utilization</span> — this run
        carries no capacity series. Runs made before the engine published them
        have none; re-run to see it.
      </div>
    );
  }

  const boundRows = side === "plant" ? binding?.products ?? [] : binding?.suppliers ?? [];

  return (
    <div className={cn("rounded-md border bg-card", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Gauge className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Capacity utilization</span>
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
          engine data · mean of {repCount} replication{repCount === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {(Object.keys(SIDES) as Side[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSide(k)}
              className={cn(
                "h-6 min-h-11 px-2 rounded-md text-[10px] border transition-colors md:min-h-0",
                k === side
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card hover:bg-muted/50 border-border",
              )}
            >
              {SIDES[k].label}
            </button>
          ))}
        </div>
      </div>

      {allZero ? (
        // NOT an empty chart. Zero available capacity on the supplier side is a
        // statement — every supplier is declared unlimited — and a flat line at
        // zero would read as "the suppliers had no capacity", the exact inverse.
        <div className="px-3 py-3 text-[11px] leading-snug text-muted-foreground">
          {side === "supplier"
            ? `No supplier in this project declares a finite capacity_per_week${
                binding ? ` (${binding.unlimited_suppliers} declared unlimited)` : ""
              }, so supplier capacity could not bind and there is nothing to divide by. This is a modelling choice, not missing data — but a partial-magnitude disruption on an unlimited supplier degrades to a full outage.`
            : "The engine offered no plant capacity in any week of this run."}
        </div>
      ) : (
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
                tickFormatter={fmtUnits}
              />
              <RTooltip
                contentStyle={{ fontSize: 10 }}
                formatter={(v: number | number[], name: string) =>
                  Array.isArray(v)
                    ? [`${fmtUnits(v[0])} – ${fmtUnits(v[1])}`, "95% CI"]
                    : [fmtUnits(v), name]
                }
                labelFormatter={(w) => `Week ${w}`}
              />
              {repCount > 1 && (
                <Area
                  dataKey="band"
                  name="95% CI"
                  stroke="none"
                  fill="hsl(215 80% 50%)"
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
              <Line
                type="monotone"
                dataKey="available"
                name="Capacity"
                stroke="hsl(30 90% 45%)"
                strokeWidth={1.6}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="used"
                name={s.usedLabel}
                stroke="hsl(215 80% 50%)"
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="px-1 pt-1 text-[10px] leading-snug text-muted-foreground">
            {s.caption}
          </p>
        </div>
      )}

      {binding ? (
        boundRows.length > 0 ? (
          <BindingTable
            rows={boundRows}
            windowWeeks={binding.window_weeks}
            kind={side === "plant" ? "product" : "supplier"}
          />
        ) : (
          // The absence is the finding, so it is stated rather than left blank.
          <div className="border-t px-3 py-2 text-[10.5px] text-muted-foreground">
            Capacity held nothing back on this side: in every week of the{" "}
            {binding.window_weeks}-week analysis window, the plan the engine wanted
            fitted inside the capacity available.
          </div>
        )
      ) : (
        <div className="border-t px-3 py-2 text-[10.5px] text-muted-foreground">
          This run records no per-entity capacity evidence — it predates the
          measurement. The chart above is still engine data; only the "which
          products" half is missing.
        </div>
      )}
    </div>
  );
}
