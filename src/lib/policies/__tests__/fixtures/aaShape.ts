/**
 * `Project AA - ver3`'s multi-level BOM, reproduced from §15's measurements
 * (runs 36555596249 / 36559225602): one product; uploaded levels L0–L4 hold
 * 2 / 5 / 29 / 45 / 315 edge rows; 65 sub-assemblies each under ONE parent;
 * 195 purchased materials; 136 extra parent edges over 49 shared materials;
 * 321 supplier links + 65 "(made in-house)" lines = 386. Ids are synthetic,
 * counts are production's. Every edge rate is 1 so every derived flow is the
 * root demand — the numbers are checked elsewhere against the REAL branch.
 */
import type { SupplierLaneRow } from "../../bomTreeView";

export type Row = Record<string, unknown>;

/** AA-ver3's measured shape, every edge rate 1, root demand `d`. */
export function aaShape(d = 1.91649555099247) {
  const bomRows: Row[] = [];
  const deepRows: Row[] = [{ data_source: "outbound", from_location: "R", to_location: "C", weighted: d, bom_depth: 0 }];
  const edge = (child: string, parent: string, level: number) => {
    bomRows.push({ material_id: child, higher_level_component_id: parent, level });
    // every sub-assembly has one parent and every rate is 1, so each edge's
    // derived flow is the root demand
    deepRows.push({
      data_source: "bom", from_location: child, to_location: parent, path_root: "R",
      bom_depth: level, material_consumption_rate: 1, weighted: d,
    });
  };
  const A = ["A1", "A2"];
  A.forEach((a) => edge(a, "R", 0));
  const B = ["B1", "B2", "B3", "B4", "B5"];
  B.forEach((b, i) => edge(b, i < 3 ? "A1" : "A2", 1));
  const C = Array.from({ length: 29 }, (_, i) => `C${i + 1}`);
  C.forEach((c, i) => edge(c, B[i % 5], 2));
  const D = Array.from({ length: 29 }, (_, i) => `D${i + 1}`);
  D.forEach((x, i) => edge(x, C[i], 3));
  const leaves3 = Array.from({ length: 16 }, (_, i) => `L3_${i + 1}`);
  leaves3.forEach((x, i) => edge(x, C[i], 3));
  const X = Array.from({ length: 179 }, (_, i) => `X${i + 1}`);
  X.forEach((x, i) => edge(x, D[i % 29], 4));
  // 136 extra parent edges over 49 shared materials: X1 +14, then 26 × +3, 22 × +2
  const extra = (x: string, n: number, start: number) => {
    for (let k = 0; k < n; k++) edge(x, D[(start + 1 + k) % 29], 4);
  };
  extra("X1", 14, 0);
  for (let i = 1; i <= 26; i++) extra(X[i], 3, i % 29);
  for (let i = 27; i <= 48; i++) extra(X[i], 2, i % 29);

  const supplierRows: SupplierLaneRow[] = [];
  const leaves = [...leaves3, ...X];
  leaves.forEach((m) => supplierRows.push({ key: `S1::${m}`, supplier_id: "S1", material_id: m }));
  let k = 0;
  while (supplierRows.length < 321) {
    const m = leaves[k % 20];
    supplierRows.push({ key: `S${2 + Math.floor(k / 20)}::${m}`, supplier_id: `S${2 + Math.floor(k / 20)}`, material_id: m });
    k++;
  }
  [...A, ...B, ...C, ...D].forEach((m) =>
    supplierRows.push({ key: `(made in-house)::${m}`, supplier_id: "(made in-house)", material_id: m, __in_house: true }),
  );
  return { bomRows, deepRows, supplierRows };
}
