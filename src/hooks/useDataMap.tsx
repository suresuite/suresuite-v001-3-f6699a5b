// Joins the static field-mapping contract (src/lib/policies/dataMap.ts) with
// the project's live data to show, per uploaded column, whether the engine
// resolves it from the master, from a logistics fallback, or from a default.
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useItemMasters } from "@/hooks/useItemMasters";
import { useScenarios } from "@/hooks/useScenarios";
import { supabase } from "@/integrations/supabase/client";
import { fetchProjectForecasts, fetchProjectLanes } from "@/lib/policies/projectLanes";
import type { StatusKey } from "@/lib/policies/dataMap";

export type DataMapStatus = "ok" | "fallback" | "default" | "unused" | "missing";

export interface LiveFieldStatus {
  status: DataMapStatus;
  /** Short human-readable summary, e.g. "12/12 lanes priced". */
  detail: string;
}

interface LaneRow {
  material_id?: string | null;
  product_id?: string | null;
  unit_price: number | string | null;
  lead_time?: number | string | null;
  lead_time_unit?: string | null;
  lead_time_dist?: string | null;
  expected_lead_time?: number | string | null;
  volume?: number | string | null;
  demand_distribution?: string | null;
  demand_mean?: number | string | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function useDataMap(projectId: string | null | undefined) {
  const { user } = useAuth();
  const { materials, products, suppliers, derived, loading: mastersLoading } =
    useItemMasters(projectId);
  const [inbound, setInbound] = useState<LaneRow[]>([]);
  const [outbound, setOutbound] = useState<LaneRow[]>([]);
  const [bomCount, setBomCount] = useState(0);
  const [bomBlankRates, setBomBlankRates] = useState(0);
  // Product ids a BOM row consumes — the engine's sub-assembly rule (D174).
  const [bomConsumed, setBomConsumed] = useState<Set<string>>(new Set());
  const [bomTable, setBomTable] = useState<"bom_multi_level" | "bom_single_level">("bom_single_level");
  // customers: null = could not read (said so on screen), [] = none uploaded.
  const [customers, setCustomers] = useState<Array<Record<string, unknown>> | null>([]);
  // WP 14.2 — forecast buckets: null = could not read (said so), [] = none uploaded.
  const [forecasts, setForecasts] = useState<Array<Record<string, unknown>> | null>([]);
  const { scenarios } = useScenarios(projectId);
  // D20: named lane tables whose read was cut short, for the grid to show.
  const [truncated, setTruncated] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setInbound([]);
      setOutbound([]);
      setBomCount(0);
      setBomBlankRates(0);
      setBomConsumed(new Set());
      setCustomers([]);
      setForecasts([]);
      setTruncated([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Lane rows via the SECURITY DEFINER RPC (direct reads are RLS-blocked
      // under the app's custom auth — see src/lib/policies/projectLanes.ts).
      const lanes = await fetchProjectLanes(projectId, user);
      if (cancelled) return;
      setInbound(lanes.inbound as unknown as LaneRow[]);
      setOutbound(lanes.outbound as unknown as LaneRow[]);
      setBomCount(lanes.bom.length);
      setBomBlankRates(lanes.bom.filter((r) => !(num((r as Record<string, unknown>).consumption_rate) > 0)).length);
      // datamap.py's rule: a single-level row's material, or a multi-level
      // row's material under a real parent, is consumed.
      setBomConsumed(new Set(
        lanes.bom
          .filter((r) => {
            const x = r as Record<string, unknown>;
            return x.product_id != null || String(x.higher_level_component_id ?? "").trim() !== "";
          })
          .map((r) => String((r as Record<string, unknown>).material_id ?? "").trim())
          .filter(Boolean),
      ));
      // The engine's rule, not the label: multi-level rows win whenever they
      // exist — projectLanes decides the same way on its direct path.
      setBomTable(lanes.bom.some((r) => (r as Record<string, unknown>).higher_level_component_id != null) ? "bom_multi_level" : "bom_single_level");
      setTruncated(lanes.truncated);
      // The engine reads `customers` (§4 D69); production grants anon read.
      const cq = await (supabase as unknown as {
        from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => Promise<{ data: unknown; error: unknown }> } };
      }).from("customers").select("customer_id,segment,priority_weight,sla_fill_floor_pct").eq("project_id", projectId);
      if (cancelled) return;
      setCustomers(cq.error ? null : ((cq.data ?? []) as Array<Record<string, unknown>>));
      const fq = await fetchProjectForecasts(projectId, user);
      if (cancelled) return;
      setForecasts(fq.error ? null : fq.rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, user]);

  const statuses = useMemo<Record<StatusKey, LiveFieldStatus>>(() => {
    // Helper for "k of n rows have this field set" master columns.
    const masterField = (
      rows: Array<Record<string, unknown>>,
      field: string,
      whenUnset: LiveFieldStatus,
    ): LiveFieldStatus => {
      const n = rows.length;
      if (n === 0) return { status: "missing", detail: "no rows yet" };
      const set = rows.filter((r) => r[field] != null).length;
      if (set === n) return { status: "ok", detail: `${set}/${n} set in master` };
      return { ...whenUnset, detail: `${set}/${n} set — rest: ${whenUnset.detail}` };
    };

    const laneCoverage = (
      rows: LaneRow[],
      field: keyof LaneRow,
      defaultNote: string,
    ): LiveFieldStatus => {
      const n = rows.length;
      if (n === 0) return { status: "missing", detail: "no lanes uploaded" };
      const set = rows.filter((r) => num(r[field]) > 0).length;
      return set === n
        ? { status: "ok", detail: `${set}/${n} lanes` }
        : { status: "default", detail: `${set}/${n} lanes — missing ones ${defaultNote}` };
    };

    // Economics with a logistics fallback: ok when all masters set, fallback
    // when the derived value covers the gap, default when even that is absent.
    const withFallback = (
      rows: Array<Record<string, unknown>>,
      idField: string,
      valueField: string,
      covered: (id: string) => boolean,
      fallbackNote: string,
      defaultNote: string,
    ): LiveFieldStatus => {
      const n = rows.length;
      if (n === 0) return { status: "missing", detail: "no rows yet" };
      const unset = rows.filter((r) => r[valueField] == null || num(r[valueField]) <= 0);
      if (unset.length === 0) return { status: "ok", detail: `${n}/${n} set in master` };
      const uncovered = unset.filter((r) => !covered(String(r[idField])));
      if (uncovered.length === 0) {
        return { status: "fallback", detail: `${n - unset.length}/${n} in master — rest ${fallbackNote}` };
      }
      return { status: "default", detail: `${uncovered.length}/${n} have no source — ${defaultNote}` };
    };

    const scenarioKinds = [
      ...new Set(
        scenarios.map((sc) => String((sc.demand_model as { kind?: string } | null)?.kind ?? "")).filter(Boolean),
      ),
    ];
    const customerField = (field: string, whenUnset: string): LiveFieldStatus => {
      if (customers === null) return { status: "missing", detail: "could not read the customers table" };
      if (customers.length === 0) return { status: "missing", detail: "no customers uploaded — engine defaults apply" };
      return masterField(customers, field, { status: "default", detail: whenUnset });
    };

    const mats = materials as unknown as Array<Record<string, unknown>>;
    const prods = products as unknown as Array<Record<string, unknown>>;
    const sups = suppliers as unknown as Array<Record<string, unknown>>;

    return {
      identity: {
        status: inbound.length + outbound.length + bomCount > 0 ? "ok" : "missing",
        detail: `${inbound.length} inbound · ${bomCount} BOM · ${outbound.length} outbound lanes`,
      },
      inbound_unit_price: laneCoverage(inbound, "unit_price", "default to 1.0 (warn)"),
      inbound_lead_time: laneCoverage(inbound, "lead_time", "run at 2 weeks (warn)"),
      inbound_lead_time_unit: (() => {
        if (inbound.length === 0) return { status: "missing" as const, detail: "no lanes uploaded" };
        const set = inbound.filter((r) => (r.lead_time_unit ?? "") !== "");
        const units = [...new Set(set.map((r) => String(r.lead_time_unit).trim().toLowerCase()))];
        return set.length === 0
          ? { status: "default" as const, detail: `0/${inbound.length} lanes state a unit — lead time read as weeks` }
          : { status: "ok" as const, detail: `${set.length}/${inbound.length} lanes state a unit (${units.join(", ")}); the rest read as weeks` };
      })(),
      // WP 16.2 — a lane with no spread of its own is not a gap: it runs on its
      // material's shape, else deterministic, as every lane did before Phase 16.
      inbound_lead_time_spread: (() => {
        if (inbound.length === 0) return { status: "missing" as const, detail: "no lanes uploaded" };
        const set = inbound.filter((r) => (r.lead_time_dist ?? "") !== "").length;
        return set === 0
          ? { status: "default" as const, detail: `0/${inbound.length} lanes state a lead-time shape — each runs on its material's, else deterministic` }
          : { status: "ok" as const, detail: `${set}/${inbound.length} lanes state a lead-time shape; the rest run on their material's, else deterministic` };
      })(),
      inbound_volume: laneCoverage(inbound, "volume", "carry no weight in the cost fallback"),
      outbound_unit_price: laneCoverage(outbound, "unit_price", "skipped in the weighted price"),
      outbound_volume: laneCoverage(outbound, "volume", "contribute zero demand"),
      outbound_expected_lead_time: {
        status: "unused",
        detail: "engine does not read it (display only)",
      },
      // WP 14.2 — a row with no spec is not a gap: it runs on its product's
      // distribution scaled by its volume share, as every project did before.
      outbound_demand_spec: (() => {
        if (outbound.length === 0) return { status: "missing" as const, detail: "no lanes uploaded" };
        const set = outbound.filter((r) => (r.demand_distribution ?? "") !== "" || r.demand_mean != null).length;
        return set === 0
          ? { status: "default" as const, detail: `0/${outbound.length} rows state their own demand — each runs on its product's distribution × its volume share` }
          : { status: "ok" as const, detail: `${set}/${outbound.length} rows state their own demand; the rest run on their product's distribution × share` };
      })(),
      forecast_series: (() => {
        if (forecasts === null) return { status: "missing" as const, detail: "could not read the forecast table" };
        if (forecasts.length === 0) return { status: "unused" as const, detail: "no forecast uploaded — rows plan on their mean" };
        const rows = new Set(forecasts.map((f) => `${f.customer_id}::${f.product_id}`)).size;
        return { status: "ok" as const, detail: `${forecasts.length} buckets across ${rows} customer × product row(s)` };
      })(),
      bom_consumption_rate:
        bomCount === 0
          ? { status: "missing", detail: "no BOM uploaded" }
          : bomBlankRates > 0
            ? { status: "default", detail: `${bomBlankRates}/${bomCount} lines blank or 0 — run at 1.0 (the network pages read them as 0)` }
            : { status: "ok", detail: `${bomCount} lines of ${bomTable}, the table the engine reads` },
      bom_level_column: { status: "unused", detail: "fetched but not used — structure comes from the parent links" },
      material_cost: withFallback(
        mats, "material_id", "cost",
        (id) => derived.materialCost.has(id),
        "resolve from volume-weighted inbound unit_price",
        "engine would default cost to 1.0",
      ),
      material_holding: masterField(mats, "holding_cost_pct", { status: "default", detail: "the project-default policy's holding_cost_pct, else 20 %/yr" }),
      material_moq: masterField(mats, "moq", { status: "default", detail: "0 (no MOQ)" }),
      material_initial_on_hand: masterField(mats, "initial_on_hand", { status: "default", detail: "engine warm-starts at base stock" }),
      material_lead_time_dist: masterField(mats, "lead_time_dist", { status: "default", detail: "deterministic, cv 0" }),
      product_sell_price: withFallback(
        prods, "product_id", "sell_price",
        (id) => derived.sellPrice.has(id),
        "resolve from demand-weighted outbound unit_price",
        "engine would default price to 1.0 (revenue meaningless)",
      ),
      product_demand_mean: withFallback(
        prods, "product_id", "demand_mean",
        (id) => (derived.demandMean.get(id) ?? 0) > 0,
        "resolve from Σ weekly outbound volume",
        "zero demand — product never ordered",
      ),
      // Like the engine: a 0 or negative capacity counts as blank.
      product_capacity: masterField(
        prods.map((p) => ({ ...p, production_capacity: num(p.production_capacity) > 0 ? p.production_capacity : null })),
        "production_capacity",
        { status: "default", detail: "the Plant grid's line capacity if set, else max(2·demand, 1000) — capacity never binds" },
      ),
      product_fulfillment_mode: masterField(prods, "fulfillment_mode", { status: "default", detail: "projects.supply_chain_model, else MTO" }),
      // WP 16.5 — a product with no production lead time completes in the week it starts.
      product_production_lead_time: masterField(prods, "production_lead_time", { status: "default", detail: "0 weeks — completes in the week it starts" }),
      product_identity: (() => {
        if (prods.length === 0) return { status: "missing" as const, detail: "no product rows" };
        const sub = prods.filter((p) => bomConsumed.has(String(p.product_id ?? "").trim())).length;
        return sub > 0
          ? { status: "ok" as const, detail: `${prods.length} products — ${sub} are sub-assemblies, modelled through their components` }
          : { status: "ok" as const, detail: `${prods.length} finished products` };
      })(),
      product_demand_distribution: masterField(prods, "demand_distribution", {
        status: "default",
        detail: scenarioKinds.length
          ? `the scenario's model — this project's scenarios: ${scenarioKinds.join(", ")}`
          : "the scenario's model, else triangular",
      }),
      product_demand_cv: masterField(prods, "demand_cv", {
        status: "default",
        detail: "the scenario's cv, else 0.30 (no effect under poisson or deterministic)",
      }),
      product_demand_min: masterField(prods, "demand_min", { status: "default", detail: "demand_mean·(1−cv)" }),
      product_demand_max: masterField(prods, "demand_max", { status: "default", detail: "demand_mean·(1+cv)" }),
      supplier_capacity:
        sups.length === 0
          ? { status: "missing", detail: "no rows yet" }
          : { status: "ok", detail: `${sups.filter((s) => s.capacity_per_week != null).length}/${sups.length} finite — empty = unlimited (valid)` },
      supplier_reliability: {
        status: "unused",
        detail: "no effect — only the backup-supplier 'reliability' rule reads it, and it is never selected",
      },
      customer_segment: customerField("segment", "every customer in segment 'default'"),
      customer_priority: customerField("priority_weight", "priority 1.0"),
      customer_sla_floor: customerField("sla_fill_floor_pct", "no contracted floor — the segment's tier floor applies"),
      plant_ignored: { status: "unused", detail: "not read by the engine" },
      name: { status: "ok", detail: "display only" },
    };
  }, [inbound, outbound, bomCount, bomBlankRates, bomConsumed, bomTable, customers, forecasts, scenarios, materials, products, suppliers, derived]);

  return { statuses, truncated, bomTable, loading: loading || mastersLoading };
}
