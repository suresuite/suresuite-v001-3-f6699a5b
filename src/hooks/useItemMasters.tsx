import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  cheapestInboundCost,
  demandWeightedSellPrice,
  weeklyDemand,
  type InboundArc,
  type OutboundArc,
} from "@/lib/policies/effectiveEconomics";

// Item-master rows (supabase/migrations/20260614000001_item_master.sql).
// The generated Supabase types are out of sync with the supply-chain schema,
// so these tables are typed locally like the rest of the data layer.

export interface MaterialRow {
  material_id: string;
  name: string | null;
  cost: number | null; // €/unit
  holding_cost_pct: number | null; // fraction, e.g. 0.20
  moq: number | null;
  initial_on_hand: number | null;
  lead_time_dist: string | null; // deterministic | lognormal | gamma
  lead_time_cv: number | null;
}

export interface ProductRow {
  product_id: string;
  name: string | null;
  sell_price: number | null; // €/unit
  production_capacity: number | null; // units/week
  fulfillment_mode: string | null; // mto | mts
  demand_distribution: string | null; // triangular | deterministic | poisson | negbin
  demand_mean: number | null; // units/week
  demand_cv: number | null;
}

export interface SupplierRow {
  supplier_id: string;
  name: string | null;
  capacity_per_week: number | null; // null = unlimited
  reliability_score: number | null;
}

export type ItemMasterTable = "materials" | "products" | "suppliers";

// Fields the engine reads with a lossy fallback when NULL
// (scsim/scsim/io/project_map.py — the G4 MappingWarning set).
export const REQUIRED_FIELDS: Record<ItemMasterTable, string[]> = {
  materials: ["cost"],
  products: ["sell_price", "demand_mean", "production_capacity"],
  suppliers: [], // capacity_per_week: NULL is a valid choice (unlimited)
};

const ID_COLUMN: Record<ItemMasterTable, string> = {
  materials: "material_id",
  products: "product_id",
  suppliers: "supplier_id",
};

const UPSERT_RPC: Record<ItemMasterTable, string> = {
  materials: "bulk_upsert_materials",
  products: "bulk_upsert_products",
  suppliers: "bulk_upsert_suppliers",
};

const SAVE_BATCH_SIZE = 100;

/**
 * Engine-fallback economics derived live from the uploaded logistics lanes
 * (inbound/outbound unit_price) via effectiveEconomics.ts. NULL master fields
 * with a derived value here are NOT "missing" — the engine resolves them.
 */
export interface DerivedEconomics {
  /** materials.cost fallback: cheapest inbound unit_price per material. */
  materialCost: Map<string, number>;
  /** products.sell_price fallback: demand-weighted outbound unit_price. */
  sellPrice: Map<string, number>;
  /** products.demand_mean fallback: Σ weekly outbound volume. */
  demandMean: Map<string, number>;
}

interface UseItemMastersResult {
  materials: MaterialRow[];
  products: ProductRow[];
  suppliers: SupplierRow[];
  loading: boolean;
  error: string | null;
  missingCounts: Record<ItemMasterTable, number>;
  derived: DerivedEconomics;
  reload: () => Promise<void>;
  saveRows: (
    table: ItemMasterTable,
    rows: Array<MaterialRow | ProductRow | SupplierRow>,
  ) => Promise<void>;
}

/**
 * Load + edit the item masters of a project. Calls ensure_item_masters on
 * mount so a row exists for every id referenced by the logistics/BOM tables,
 * then keeps the three tables live via postgres_changes.
 */
export function useItemMasters(projectId: string | null | undefined): UseItemMastersResult {
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [inboundArcs, setInboundArcs] = useState<InboundArc[]>([]);
  const [outboundArcs, setOutboundArcs] = useState<OutboundArc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Logistics lanes — the engine's price/demand fallback sources.
  const loadLogistics = useCallback(async () => {
    if (!projectId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [inQ, outQ] = await Promise.all([
      sb
        .from("inbound_logistics")
        .select("material_id,unit_price")
        .eq("project_id", projectId)
        .limit(10000),
      sb
        .from("outbound_logistics")
        .select("product_id,unit_price,volume,time_unit")
        .eq("project_id", projectId)
        .limit(10000),
    ]);
    if (inQ.error) console.warn("[useItemMasters] inbound_logistics read failed", inQ.error);
    if (outQ.error) console.warn("[useItemMasters] outbound_logistics read failed", outQ.error);
    if (!inQ.error) setInboundArcs((inQ.data ?? []) as InboundArc[]);
    if (!outQ.error) setOutboundArcs((outQ.data ?? []) as OutboundArc[]);
  }, [projectId]);

  const loadTable = useCallback(
    async (table: ItemMasterTable) => {
      if (!projectId) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error: err } = await sb
        .from(table)
        .select("*")
        .eq("project_id", projectId)
        .order(ID_COLUMN[table]);
      if (err) {
        console.error(`load ${table} failed`, err);
        setError(err.message ?? `Failed to load ${table}`);
        return;
      }
      if (table === "materials") setMaterials((data ?? []) as MaterialRow[]);
      else if (table === "products") setProducts((data ?? []) as ProductRow[]);
      else setSuppliers((data ?? []) as SupplierRow[]);
    },
    [projectId],
  );

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Materialize master rows for every id in the logistics/BOM tables so
    // there is always a row to edit (ON CONFLICT DO NOTHING — user-entered
    // economics survive re-uploads).
    const { error: ensureErr } = await sb.rpc("ensure_item_masters", {
      p_project_id: projectId,
    });
    if (ensureErr) console.error("ensure_item_masters failed", ensureErr);
    await Promise.all([
      loadTable("materials"),
      loadTable("products"),
      loadTable("suppliers"),
      loadLogistics(),
    ]);
    setLoading(false);
  }, [projectId, loadTable, loadLogistics]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Realtime: item masters are in the supabase_realtime publication; reload
  // the affected table on any change (rows are few, merging isn't worth it).
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase.channel(`item-masters:${projectId}`);
    (["materials", "products", "suppliers"] as ItemMasterTable[]).forEach((table) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` },
        () => void loadTable(table),
      );
    });
    // Logistics re-uploads change the derived (fallback) economics too.
    (["inbound_logistics", "outbound_logistics"] as const).forEach((table) => {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` },
        () => void loadLogistics(),
      );
    });
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, loadTable, loadLogistics]);

  const saveRows = useCallback(
    async (table: ItemMasterTable, rows: Array<MaterialRow | ProductRow | SupplierRow>) => {
      if (!projectId || rows.length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      for (let i = 0; i < rows.length; i += SAVE_BATCH_SIZE) {
        const batch = rows.slice(i, i + SAVE_BATCH_SIZE);
        const { error: err } = await sb.rpc(UPSERT_RPC[table], {
          p_project_id: projectId,
          p_rows: batch,
        });
        if (err) {
          console.error(`${UPSERT_RPC[table]} failed`, err);
          throw new Error(err.message ?? `Failed to save ${table}`);
        }
      }
      await loadTable(table);
    },
    [projectId, loadTable],
  );

  const derived: DerivedEconomics = useMemo(
    () => ({
      materialCost: cheapestInboundCost(inboundArcs),
      sellPrice: demandWeightedSellPrice(outboundArcs),
      demandMean: weeklyDemand(outboundArcs),
    }),
    [inboundArcs, outboundArcs],
  );

  // A field is "missing" only when the master is NULL *and* the engine has no
  // logistics fallback for it — mirroring verification.ts's warn/block split.
  const derivedFor = (table: ItemMasterTable, field: string, id: string): boolean => {
    if (table === "materials" && field === "cost") return derived.materialCost.has(id);
    if (table === "products" && field === "sell_price") return derived.sellPrice.has(id);
    if (table === "products" && field === "demand_mean") return (derived.demandMean.get(id) ?? 0) > 0;
    return false;
  };
  const missingCounts: Record<ItemMasterTable, number> = {
    materials: materials.filter((r) =>
      REQUIRED_FIELDS.materials.some(
        (f) => r[f as keyof MaterialRow] == null && !derivedFor("materials", f, r.material_id),
      ),
    ).length,
    products: products.filter((r) =>
      REQUIRED_FIELDS.products.some(
        (f) => r[f as keyof ProductRow] == null && !derivedFor("products", f, r.product_id),
      ),
    ).length,
    suppliers: 0,
  };

  return { materials, products, suppliers, loading, error, missingCounts, derived, reload, saveRows };
}
