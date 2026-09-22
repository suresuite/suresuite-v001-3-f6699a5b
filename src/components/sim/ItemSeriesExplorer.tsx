// Single-run inspection mode — per-item weekly series (blueprint G17 / §9.5.1
// — W3). An inspection run (1 replication, user-chosen seed, full-debug
// trace) persists per-material on-hand / in-transit / orders and per-product
// demand / production / fulfillment / backlog / lost-units weekly series to
// run_item_series; this panel is the picker + chart over that evidence. It
// renders nothing for runs without item series (i.e. every multi-rep run).

import { useEffect, useMemo, useState } from "react";
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
import { Microscope } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface ItemRef {
  kind: "material" | "product";
  item_id: string;
}

const SERIES_LABEL: Record<string, string> = {
  on_hand: "On hand",
  in_transit: "In transit",
  orders: "Orders placed",
  demand: "Demand",
  production: "Production",
  fulfillment: "Fulfillment",
  backlog: "Backlog",
  lost_units: "Lost units",
};

const SERIES_COLORS = [
  "hsl(215 80% 50%)",
  "hsl(25 95% 50%)",
  "hsl(150 65% 40%)",
  "hsl(280 60% 55%)",
  "hsl(0 70% 55%)",
];

interface Props {
  runId: string;
  warmupWeeks?: number | null;
  /** What to say when the run carries no per-item evidence.
   *
   *  Omitted, the panel renders nothing — right on /policies, where the
   *  inspection toggle sits a few rows above and silence is not a dead end.
   *  On /simulation-lab it WAS a dead end: that page dispatches no inspection
   *  run, so the panel was empty there by construction and said nothing about
   *  why — §4 D113's shape exactly. Passing a hint turns "empty forever" into
   *  a state with a remedy the reader can actually reach. */
  emptyHint?: string;
}

export function ItemSeriesExplorer({ runId, warmupWeeks = null, emptyHint }: Props) {
  const [items, setItems] = useState<ItemRef[] | null>(null);
  const [kind, setKind] = useState<"material" | "product">("product");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [series, setSeries] = useState<Record<string, number[]> | null>(null);
  const [loadingSeries, setLoadingSeries] = useState(false);

  // Item index for this run (cheap: ids only). Empty ⇒ not an inspection run.
  useEffect(() => {
    let alive = true;
    setItems(null);
    setSelectedId(null);
    setSeries(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    void sb
      .from("run_item_series")
      .select("kind,item_id")
      .eq("run_id", runId)
      .order("item_id")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data, error }: any) => {
        if (!alive) return;
        if (error) {
          console.warn("run_item_series index load failed", error);
          setItems([]);
          return;
        }
        setItems((data ?? []) as ItemRef[]);
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  // The chosen item's series, fetched on demand (one row).
  useEffect(() => {
    if (!selectedId) {
      setSeries(null);
      return;
    }
    let alive = true;
    setLoadingSeries(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    void sb
      .from("run_item_series")
      .select("series")
      .eq("run_id", runId)
      .eq("kind", kind)
      .eq("item_id", selectedId)
      .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data, error }: any) => {
        if (!alive) return;
        setLoadingSeries(false);
        if (error || !data) {
          console.warn("run_item_series load failed", error);
          setSeries(null);
          return;
        }
        setSeries((data.series ?? {}) as Record<string, number[]>);
      });
    return () => {
      alive = false;
    };
  }, [runId, kind, selectedId]);

  const ofKind = useMemo(() => (items ?? []).filter((i) => i.kind === kind), [items, kind]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? ofKind.filter((i) => i.item_id.toLowerCase().includes(q)) : ofKind;
    return list.slice(0, 30);
  }, [ofKind, query]);

  const counts = useMemo(() => {
    const c = { material: 0, product: 0 };
    for (const i of items ?? []) c[i.kind] += 1;
    return c;
  }, [items]);

  const chartData = useMemo(() => {
    if (!series) return [];
    const keys = Object.keys(series).filter((k) => Array.isArray(series[k]));
    if (keys.length === 0) return [];
    const n = Math.min(...keys.map((k) => series[k].length));
    return Array.from({ length: n }, (_, week) => {
      const row: Record<string, number> = { week };
      keys.forEach((k) => {
        row[k] = series[k][week];
      });
      return row;
    });
  }, [series]);

  // Not an inspection run (or index still loading with zero rows). Render
  // nothing, unless the caller asked for the absence to be explained.
  if (!items || items.length === 0) {
    if (!items || !emptyHint) return null;
    return (
      <div className="rounded-md border border-dashed bg-card px-3 py-2 text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">Per-item weekly series</span>{" "}
        — {emptyHint}
      </div>
    );
  }

  const seriesKeys = series ? Object.keys(series).filter((k) => Array.isArray(series[k])) : [];

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Microscope className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Per-item weekly series (inspection run)</span>
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
          engine data · {counts.product} product(s) · {counts.material} material(s)
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {(["product", "material"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setSelectedId(null);
                setQuery("");
              }}
              className={cn(
                "h-6 min-h-11 px-2 rounded-md text-[10px] border transition-colors capitalize md:min-h-0",
                k === kind
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card hover:bg-muted/50 border-border",
              )}
            >
              {k}s
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-0">
        <div className="border-b md:border-b-0 md:border-r p-2 flex flex-col gap-2">
          <Input
            placeholder={`Search ${counts[kind]} ${kind}s…`}
            className="h-7 min-h-11 text-xs md:min-h-0"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex flex-col gap-0.5 overflow-y-auto max-h-56">
            {filtered.map((i) => (
              <button
                key={i.item_id}
                type="button"
                onClick={() => setSelectedId(i.item_id)}
                className={cn(
                  "text-left px-2 py-1 min-h-11 flex items-center rounded text-[11px] font-mono truncate transition-colors md:min-h-0 md:block",
                  i.item_id === selectedId
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted/50",
                )}
                title={i.item_id}
              >
                {i.item_id}
              </button>
            ))}
            {filtered.length === 0 && (
              <span className="text-[11px] text-muted-foreground px-2 py-1">No match.</span>
            )}
            {ofKind.length > filtered.length && query.trim() === "" && (
              <span className="text-[10px] text-muted-foreground px-2 py-1">
                Showing first {filtered.length} of {ofKind.length} — type to search.
              </span>
            )}
          </div>
        </div>

        <div className="p-2 min-h-[200px]">
          {!selectedId ? (
            <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground p-6">
              Pick a {kind} to see its weekly {kind === "material" ? "on-hand / in-transit / orders" : "demand / production / fulfillment"} series from this run.
            </div>
          ) : loadingSeries ? (
            <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground p-6">
              Loading series…
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground p-6">
              No series persisted for this item.
            </div>
          ) : (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 font-mono">
                {selectedId}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeOpacity={0.15} />
                  <XAxis dataKey="week" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} width={44} domain={["auto", "auto"]} />
                  <RTooltip contentStyle={{ fontSize: 10 }} />
                  {warmupWeeks != null && warmupWeeks > 0 && (
                    <ReferenceLine
                      x={warmupWeeks}
                      stroke="hsl(var(--destructive))"
                      strokeDasharray="4 3"
                      label={{ value: "warm-up", fontSize: 9, fill: "hsl(var(--destructive))" }}
                    />
                  )}
                  {seriesKeys.map((k, i) => (
                    <Line
                      key={k}
                      type="monotone"
                      dataKey={k}
                      name={SERIES_LABEL[k] ?? k}
                      stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                      strokeWidth={1.4}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 px-1 pt-1">
                {seriesKeys.map((k, i) => (
                  <span key={k} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span
                      className="inline-block h-1.5 w-3 rounded-sm"
                      style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                    />
                    {SERIES_LABEL[k] ?? k}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
