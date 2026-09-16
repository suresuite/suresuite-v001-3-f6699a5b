// Joins the static field-mapping contract (src/lib/policies/dataMap.ts) with
// the project's live data to show, per uploaded column, whether the engine
// resolves it from the master, from a logistics fallback, or from a default.
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useItemMasters } from "@/hooks/useItemMasters";
import { fetchProjectLanes } from "@/lib/policies/projectLanes";
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
  expected_lead_time?: number | string | null;
  volume?: number | string | null;
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
  // D20: named lane tables whose read was cut short, for the grid to show.
  const [truncated, setTruncated] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setInbound([]);
      setOutbound([]);
      setBomCount(0);
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
      setTruncated(lanes.truncated);
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

    const mats = materials as unknown as Array<Record<string, unknown>>;
    const prods = products as unknown as Array<Record<string, unknown>>;
    const sups = suppliers as unknown as Array<Record<string, unknown>>;

    return {
      identity: {
        status: inbound.length + outbound.length + bomCount > 0 ? "ok" : "missing",
        detail: `${inbound.length} inbound · ${bomCount} BOM · ${outbound.length} outbound lanes`,
      },
      inbound_unit_price: laneCoverage(inbound, "unit_price", "default to 1.0 (warn)"),
      inbound_lead_time: laneCoverage(inbound, "lead_time", "default to 2 weeks (warn)"),
      inbound_volume: laneCoverage(inbound, "volume", "excluded from share ranking"),
      outbound_unit_price: laneCoverage(outbound, "unit_price", "skipped in the weighted price"),
      outbound_volume: laneCoverage(outbound, "volume", "contribute zero demand"),
      outbound_expected_lead_time: {
        status: "unused",
        detail: "engine does not read it (display only)",
      },
      bom_consumption_rate:
        bomCount > 0
          ? { status: "ok", detail: `${bomCount} BOM lines` }
          : { status: "missing", detail: "no BOM uploaded" },
      material_cost: withFallback(
        mats, "material_id", "cost",
        (id) => derived.materialCost.has(id),
        "resolve from cheapest inbound unit_price",
        "engine would default cost to 1.0",
      ),
      material_holding: masterField(mats, "holding_cost_pct", { status: "default", detail: "policy holding_cost_pct → 20%" }),
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
      product_capacity: masterField(prods, "production_capacity", { status: "default", detail: "max(2·demand, 1000) — capacity never binds" }),
      product_fulfillment_mode: masterField(prods, "fulfillment_mode", { status: "default", detail: "project supply-chain model (MTS/MTO)" }),
      product_demand_distribution: masterField(prods, "demand_distribution", { status: "default", detail: "triangular" }),
      product_demand_cv: masterField(prods, "demand_cv", { status: "default", detail: "0.30" }),
      product_demand_min: masterField(prods, "demand_min", { status: "default", detail: "demand_mean·(1−cv)" }),
      product_demand_max: masterField(prods, "demand_max", { status: "default", detail: "demand_mean·(1+cv)" }),
      supplier_capacity:
        sups.length === 0
          ? { status: "missing", detail: "no rows yet" }
          : { status: "ok", detail: `${sups.filter((s) => s.capacity_per_week != null).length}/${sups.length} finite — empty = unlimited (valid)` },
      supplier_reliability: masterField(sups, "reliability_score", { status: "default", detail: "1.0 (fully reliable)" }),
      name: { status: "ok", detail: "display only" },
    };
  }, [inbound, outbound, bomCount, materials, products, suppliers, derived]);

  return { statuses, truncated, loading: loading || mastersLoading };
}
