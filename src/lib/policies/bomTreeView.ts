/**
 * The Supplier stage's BOM tree — §4 D177.
 *
 * On a multi-level project the flat lane grid answered "which lanes exist" and
 * nothing else: the structure (which finished product a material feeds, through
 * which sub-assemblies, at what effective rate) was invisible, so the owner
 * could not validate the model the engine actually runs. This module builds the
 * PRESENTATION order for the tree the grid renders instead.
 *
 * ── WHAT IS AUTHORITATIVE WHERE (single-source, I1) ────────────────────────
 *
 *   · The tree SHAPE is the upload itself: `bom_multi_level` rows
 *     (material_id, higher_level_component_id, level). Never inferred.
 *   · The NUMBERS are the one lane derivation: `supply_chain_data_multi_tier`
 *     bom rows carry, per (child → parent, path_root): `bom_depth`, the edge's
 *     own `material_consumption_rate`, and `weighted` — the inherited weekly
 *     flow computed by `rebuild_supply_chain_lanes`' demand walk. Root demand
 *     is the root's outbound rows' `weighted` sum. This module RE-AUTHORS NO
 *     WALK: the only arithmetic on display is one division,
 *     effective rate = weighted ÷ root demand.
 *   · An uploaded edge with NO derived row renders `derived: false`
 *     ("not derived — run Combine"), and a derived edge reaching no shipping
 *     product lands in its own section — upload/derivation drift becomes
 *     visible (D142's class) instead of being papered over.
 *
 * ── WHAT THIS MODULE MUST NOT TOUCH ────────────────────────────────────────
 *
 * The flat supplier rows (`useStageRows` output) pass through UNCHANGED as
 * `lane` entries: same objects, same keys, same flags. Stage guards, prefill,
 * verification and export all read that flat set; this module only orders it
 * and interleaves render-only structural entries. Every supplier row appears
 * in the output EXACTLY once (the tests pin it).
 *
 * The same guards as the SQL walk and the engine's flatten apply: a visited
 * path is never re-entered (cycle guard) and depth is capped at 64.
 */

export interface BomRawRow {
  material_id?: unknown;
  higher_level_component_id?: unknown;
  level?: unknown;
  [key: string]: unknown;
}

export interface DeepLaneRow {
  from_location?: unknown;
  to_location?: unknown;
  data_source?: unknown;
  path_root?: unknown;
  bom_depth?: unknown;
  material_consumption_rate?: unknown;
  weighted?: unknown;
  [key: string]: unknown;
}

/** The flat supplier row exactly as useStageRows built it. Opaque here. */
export interface SupplierLaneRow {
  key: string;
  material_id?: unknown;
  supplier_id?: unknown;
  __not_in_bom?: unknown;
  [key: string]: unknown;
}

export type TreeEntry =
  | {
      kind: "root";
      nodeId: string;
      /** Weekly demand from the root's outbound lane rows, or null when none. */
      demandPerWeek: number | null;
      path: string[];
    }
  | {
      kind: "node";
      nodeId: string;
      parentId: string;
      rootId: string;
      /** The raw upload's level for this edge (bom_multi_level.level). */
      depth: number | null;
      echelon: "subassembly" | "material";
      /** The edge's own consumption rate, read from the derived lane row. */
      edgeRate: number | null;
      /** weighted ÷ root demand — the ONLY client-side arithmetic. */
      effRate: number | null;
      /** The inherited weekly flow (`weighted`), read from the derived row. */
      flowPerWeek: number | null;
      /** False when the upload's edge has no derived lane row. */
      derived: boolean;
      /** True on the one occurrence that carries the material's lanes. */
      carriesLanes: boolean;
      /** Where the lanes live, when this occurrence does not carry them. */
      canonicalPath?: string[];
      path: string[];
    }
  | { kind: "lane"; row: SupplierLaneRow; path: string[] }
  | {
      kind: "section";
      id: "unreachable" | "not_in_bom";
      /** unreachable: derived bom edges with no path_root; not_in_bom: materials. */
      count: number;
    };

export interface BomTreeInputs {
  bomRows: readonly BomRawRow[];
  deepRows: readonly DeepLaneRow[];
  supplierRows: readonly SupplierLaneRow[];
}

const MAX_DEPTH = 64; // the SQL walk's own cap

const s = (v: unknown): string => String(v ?? "").trim();
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export function buildBomTreeView(i: BomTreeInputs): TreeEntry[] {
  // ── derived lookups ───────────────────────────────────────────────────────
  // Root demand: Σ weighted over the product's outbound rows.
  const rootDemand = new Map<string, number>();
  // Derived bom edge per (child, parent, root).
  const edgeDerived = new Map<
    string,
    { rate: number | null; flow: number | null; depth: number | null }
  >();
  let unreachableEdges = 0;
  for (const r of i.deepRows) {
    const ds = s(r.data_source);
    if (ds === "outbound") {
      const p = s(r.from_location);
      const w = num(r.weighted) ?? 0;
      if (p) rootDemand.set(p, (rootDemand.get(p) ?? 0) + w);
    } else if (ds === "bom") {
      const child = s(r.from_location);
      const parent = s(r.to_location);
      const root = s(r.path_root);
      if (!root) {
        unreachableEdges += 1;
        continue;
      }
      edgeDerived.set(`${child}\u0000${parent}\u0000${root}`, {
        rate: num(r.material_consumption_rate),
        flow: num(r.weighted),
        depth: num(r.bom_depth),
      });
    }
  }

  // ── raw shape ─────────────────────────────────────────────────────────────
  // children[parent] = edges from the upload. A blank-parent row feeds every
  // shipping product (D129's rule) UNLESS the child is itself a root — that is
  // the product's own root row, not an edge (D171's rule).
  const roots = [...rootDemand.keys()].sort(
    (a, b) => (rootDemand.get(b) ?? 0) - (rootDemand.get(a) ?? 0) || a.localeCompare(b),
  );
  const rootSet = new Set(roots);
  const children = new Map<string, Array<{ child: string; level: number | null }>>();
  const push = (parent: string, child: string, level: number | null) => {
    if (!parent || !child || child === parent) return;
    const list = children.get(parent) ?? [];
    if (!list.some((e) => e.child === child)) list.push({ child, level });
    children.set(parent, list);
  };
  for (const r of i.bomRows) {
    const child = s(r.material_id);
    const parent = s(r.higher_level_component_id);
    const level = num(r.level);
    if (!child) continue;
    if (parent) push(parent, child, level);
    else if (!rootSet.has(child)) for (const root of roots) push(root, child, level);
  }

  // Lanes by material, preserving useStageRows' order.
  const lanesByMaterial = new Map<string, SupplierLaneRow[]>();
  for (const row of i.supplierRows) {
    const mat = s(row.material_id);
    const list = lanesByMaterial.get(mat) ?? [];
    list.push(row);
    lanesByMaterial.set(mat, list);
  }

  // ── the walk (per root, DFS, path-guarded) ────────────────────────────────
  type NodeEntry = Extract<TreeEntry, { kind: "node" }>;
  const nodeEntries: NodeEntry[] = [];
  const orderedPerRoot = new Map<string, NodeEntry[]>();

  const walk = (root: string, parent: string, path: string[], out: NodeEntry[]) => {
    if (path.length >= MAX_DEPTH) return;
    const kids = [...(children.get(parent) ?? [])];
    const rd = rootDemand.get(root) ?? 0;
    // deterministic: heaviest derived flow first, then id
    kids.sort((a, b) => {
      const fa = edgeDerived.get(`${a.child}\u0000${parent}\u0000${root}`)?.flow ?? -1;
      const fb = edgeDerived.get(`${b.child}\u0000${parent}\u0000${root}`)?.flow ?? -1;
      return fb - fa || a.child.localeCompare(b.child);
    });
    for (const { child, level } of kids) {
      if (path.includes(child)) continue; // cycle guard, as in the SQL walk
      const d = edgeDerived.get(`${child}\u0000${parent}\u0000${root}`);
      const entry: NodeEntry = {
        kind: "node",
        nodeId: child,
        parentId: parent,
        rootId: root,
        depth: level ?? d?.depth ?? null,
        echelon: children.has(child) ? "subassembly" : "material",
        edgeRate: d?.rate ?? null,
        effRate: d && d.flow !== null && rd > 0 ? d.flow / rd : null,
        flowPerWeek: d?.flow ?? null,
        derived: Boolean(d),
        carriesLanes: false, // decided below
        path: [...path, child],
      };
      out.push(entry);
      nodeEntries.push(entry);
      walk(root, child, entry.path, out);
    }
  };

  for (const root of roots) {
    const out: NodeEntry[] = [];
    walk(root, root, [root], out);
    orderedPerRoot.set(root, out);
  }

  // ── canonical occurrence per material: shallowest depth, first in order ───
  const canonical = new Map<string, NodeEntry>();
  for (const e of nodeEntries) {
    const cur = canonical.get(e.nodeId);
    const d = e.depth ?? Number.POSITIVE_INFINITY;
    const cd = cur ? (cur.depth ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
    if (!cur || d < cd) canonical.set(e.nodeId, e);
  }
  for (const e of nodeEntries) {
    const c = canonical.get(e.nodeId);
    if (c === e) e.carriesLanes = lanesByMaterial.has(e.nodeId);
    else if (c) e.canonicalPath = c.path;
  }

  // ── assemble ──────────────────────────────────────────────────────────────
  const entries: TreeEntry[] = [];
  const attached = new Set<string>(); // supplier row keys placed in the output
  const attachLanes = (mat: string, path: string[]) => {
    for (const row of lanesByMaterial.get(mat) ?? []) {
      if (attached.has(row.key)) continue;
      attached.add(row.key);
      entries.push({ kind: "lane", row, path });
    }
  };

  for (const root of roots) {
    entries.push({
      kind: "root",
      nodeId: root,
      demandPerWeek: rootDemand.get(root) ?? null,
      path: [root],
    });
    // a root that itself has lanes (a bought product) keeps them at the top
    attachLanes(root, [root]);
    for (const e of orderedPerRoot.get(root) ?? []) {
      entries.push(e);
      if (e.carriesLanes) attachLanes(e.nodeId, e.path);
    }
  }

  if (unreachableEdges > 0) {
    entries.push({ kind: "section", id: "unreachable", count: unreachableEdges });
  }

  // Everything not reachable from a root — __not_in_bom rows, materials in a
  // BOM no shipping product reaches, or any row the walk could not place
  // (the completeness safety net): one flat tail section, today's order.
  const leftovers = i.supplierRows.filter((r) => !attached.has(r.key));
  if (leftovers.length > 0) {
    const mats = new Set(leftovers.map((r) => s(r.material_id)));
    entries.push({ kind: "section", id: "not_in_bom", count: mats.size });
    for (const row of leftovers) {
      attached.add(row.key);
      entries.push({ kind: "lane", row, path: [s(row.material_id)] });
    }
  }

  return entries;
}
