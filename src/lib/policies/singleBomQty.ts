// Qty per assembly on a SINGLE-level BOM — the Supplier grid's flat "Qty / assy"
// column. A single-level row is already the engine's arc (product ← material),
// so the value is the uploaded `bom_single_level.consumption_rate` read by the
// engine's own rule: `datamap.py` builds `BomArc(consumption_rate=_num(rate) or
// 1.0)`, i.e. a blank or zero rate RUNS as 1.0. The column shows exactly that,
// marked, rather than a blank the run does not have (T2). The multi-level tree
// has its own Qty / assy from the derived lane (bomTreeView.ts); this module is
// only the shape that has no tree.

export interface QtyPerProduct {
  productId: string;
  /** The rate the engine uses. */
  qty: number;
  /** True when the upload left it blank or 0 and the engine substitutes 1.0. */
  defaulted: boolean;
}

/** material_id → one entry per product that consumes it, in product order. */
export function qtyPerAssemblyByMaterial(
  rows: ReadonlyArray<Record<string, unknown>>,
): Map<string, QtyPerProduct[]> {
  const out = new Map<string, QtyPerProduct[]>();
  for (const r of rows) {
    const material = String(r.material_id ?? "").trim();
    const product = String(r.product_id ?? "").trim();
    if (!material || !product) continue;
    const raw = Number(r.consumption_rate);
    const defaulted = !Number.isFinite(raw) || raw === 0;
    const list = out.get(material) ?? [];
    list.push({ productId: product, qty: defaulted ? 1 : raw, defaulted });
    out.set(material, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.productId.localeCompare(b.productId));
  return out;
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Cell text and tooltip for one material's entries. */
export function qtyCellText(entries: readonly QtyPerProduct[] | undefined): {
  text: string;
  title: string;
  defaulted: boolean;
} {
  if (!entries || entries.length === 0) {
    return { text: "—", title: "Not in the bill of materials", defaulted: false };
  }
  const defaulted = entries.some((e) => e.defaulted);
  const lines = entries.map(
    (e) => `${fmt(e.qty)} per ${e.productId}${e.defaulted ? " (blank in the BOM — the engine uses 1)" : ""}`,
  );
  const qtys = entries.map((e) => e.qty);
  const lo = Math.min(...qtys);
  const hi = Math.max(...qtys);
  const text = lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
  const suffix = entries.length > 1 ? ` · ${entries.length} products` : "";
  return { text: `${text}${suffix}`, title: lines.join("\n"), defaulted };
}
