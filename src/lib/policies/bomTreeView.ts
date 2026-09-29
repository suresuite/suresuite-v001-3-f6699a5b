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
  | {
      kind: "lane";
      row: SupplierLaneRow;
      path: string[];
      /**
       * §4 D179 — true only when the entry directly above already names this
       * lane's material (its own node/root row, or a previous lane of the same
       * material). The grid draws "↳" for key A exactly then; otherwise the
       * lane names its material itself. The "Not in the BOM" tail has no node
       * row, so its first lane per material must carry the id.
       */
      continuation: boolean;
    }
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
      // directly under the node/root row that names `mat`
      entries.push({ kind: "lane", row, path, continuation: true });
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
    let prevMat: string | null = null;
    for (const row of leftovers) {
      attached.add(row.key);
      const mat = s(row.material_id);
      entries.push({ kind: "lane", row, path: [mat], continuation: mat === prevMat });
      prevMat = mat;
    }
  }

  return entries;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4 D180 — THE TREE AS SOMETHING A USER CAN NAVIGATE.
 *
 * D177 put the structure on screen and D179 named every line, and the owner
 * still could not answer "what goes into P", "where is M used" or "how much M
 * does one P need" (§15 runs 36555596249 / 36556326494 / 36559225602): the
 * tree rendered every row open — ≈780 on `Project AA - ver3` — with no level
 * control, no path to a search match, a shared material scattered over 15
 * rows, and the per-product quantity the ENGINE runs shown nowhere.
 *
 * Everything below is built ON `buildBomTreeView`'s entries: the walk above is
 * the only walk (I1). What is added is presentation state and two readings of
 * rows the tree already holds:
 *
 *   · qty per finished product = Σ `weighted` over the material's derived bom
 *     rows under that root ÷ the root's demand — a SUMMATION over the derived
 *     lane, the same numbers the per-occurrence cells show, never a re-walk.
 *     §15 B8 (run 36559225602): equal to the engine's flatten on 195 of 195
 *     (root, material) pairs on AA-ver3 once the lane is current.
 *   · where-used = the material's parents in the UPLOAD, each with its derived
 *     edge rate and flow.
 *
 * The node's kind is `buildBomTreeView`'s `echelon` (the upload-shape test it
 * already makes) — no second classifier (D127). Visibility decides only
 * OPEN / CLOSED: every flat supplier row stays in the model exactly once, and a
 * collapsed occurrence reports what it contains.
 * ═════════════════════════════════════════════════════════════════════════ */

export type OccKind = "root" | "subassembly" | "material";

export interface BomOcc {
  /** Path key — `occKey(path)`. Unique per occurrence. */
  key: string;
  id: string;
  path: string[];
  /** 0 = the finished product; 1 = uploaded level L0 on a consistent upload. */
  depth: number;
  parentKey: string | null;
  parentId: string | null;
  kind: OccKind;
  /** The upload's own `level` for this edge; null on a root. */
  level: number | null;
  /** The edge's rate from the derived row (null = unknown / not derived). */
  edgeRate: number | null;
  /** The derived row's `weighted` for this (child, parent, root). */
  flowPerWeek: number | null;
  /** False when the uploaded edge has no derived row. Roots are true. */
  derived: boolean;
  rootId: string;
  /** Root only: Σ weighted of its outbound rows. */
  demandPerWeek: number | null;
  /** False on a REPEAT occurrence of an id that occurs more than once. */
  canonical: boolean;
  /** The canonical occurrence's key (own key when canonical). */
  canonicalKey: string;
  childKeys: string[];
  /** The flat supplier rows rendered under this occurrence (canonical only). */
  lanes: SupplierLaneRow[];
  /**
   * A sub-assembly's "(made in-house)" flat row, rendered AS the node row:
   * the sub-assembly line and the structural row are the same line.
   */
  ownRow: SupplierLaneRow | null;
  /** What a collapsed occurrence contains (descendants, plus its own lanes). */
  inside: { materials: number; lines: number };
}

export interface WhereUsedParent {
  parentId: string;
  edgeRate: number | null;
  /** Σ over roots of the derived row's `weighted` for (material → parent). */
  flowPerWeek: number | null;
  /** The occurrence under this parent, or null when no shipping product reaches it. */
  occKey: string | null;
  derived: boolean;
}

export interface QtyPerRoot {
  rootId: string;
  demandPerWeek: number | null;
  /** Σ weighted of the material's edges under this root. */
  flowPerWeek: number | null;
  /** flow ÷ demand; null whenever any of its edges is not derived, or demand is 0. */
  qty: number | null;
  edges: number;
}

export interface BomTreeModel {
  occs: BomOcc[];
  byKey: Map<string, BomOcc>;
  roots: string[];
  maxDepth: number;
  /** Tail: derived edges reaching no product, and rows with no BOM place. */
  unreachableEdges: number;
  tail: Array<{ row: SupplierLaneRow; continuation: boolean }>;
  tailMaterials: number;
  /**
   * The derived lane predates WP 8.2's ETL: every outbound row has a NULL
   * `bom_depth` (the current ETL writes 0 there by definition). Its numbers
   * were computed by a writer this repository no longer runs — §15 run
   * 36559225602 measured Project 2's per-YEAR values labelled /wk.
   */
  stale: boolean;
  /** Every flat supplier row the model holds (= the flat set, exactly once). */
  totalLines: number;
  whereUsed: (materialId: string) => WhereUsedParent[];
  qtyPerRoot: (materialId: string) => QtyPerRoot[];
}

const SEP = "\u001f";
export const occKey = (path: readonly string[]): string => path.join(SEP);

export function buildBomTreeModel(i: BomTreeInputs): BomTreeModel {
  const entries = buildBomTreeView(i);
  const occs: BomOcc[] = [];
  const byKey = new Map<string, BomOcc>();
  const roots: string[] = [];
  const tail: Array<{ row: SupplierLaneRow; continuation: boolean }> = [];
  let unreachableEdges = 0;
  let tailMaterials = 0;
  let inTail = false;

  const mk = (o: Omit<BomOcc, "childKeys" | "lanes" | "ownRow" | "inside">): BomOcc => {
    const occ: BomOcc = { ...o, childKeys: [], lanes: [], ownRow: null, inside: { materials: 0, lines: 0 } };
    occs.push(occ);
    byKey.set(occ.key, occ);
    if (occ.parentKey) byKey.get(occ.parentKey)?.childKeys.push(occ.key);
    return occ;
  };

  for (const e of entries) {
    if (e.kind === "root") {
      roots.push(e.nodeId);
      const key = occKey(e.path);
      mk({
        key, id: e.nodeId, path: e.path, depth: 0, parentKey: null, parentId: null, kind: "root",
        level: null, edgeRate: null, flowPerWeek: e.demandPerWeek, derived: true, rootId: e.nodeId,
        demandPerWeek: e.demandPerWeek, canonical: true, canonicalKey: key,
      });
    } else if (e.kind === "node") {
      const key = occKey(e.path);
      mk({
        key, id: e.nodeId, path: e.path, depth: e.path.length - 1,
        parentKey: occKey(e.path.slice(0, -1)), parentId: e.parentId,
        kind: e.echelon, level: e.depth, edgeRate: e.edgeRate, flowPerWeek: e.flowPerWeek,
        derived: e.derived, rootId: e.rootId, demandPerWeek: null,
        canonical: !e.canonicalPath,
        canonicalKey: e.canonicalPath ? occKey(e.canonicalPath) : key,
      });
    } else if (e.kind === "section") {
      if (e.id === "unreachable") unreachableEdges = e.count;
      else {
        inTail = true;
        tailMaterials = e.count;
      }
    } else if (e.kind === "lane") {
      if (inTail) {
        tail.push({ row: e.row, continuation: e.continuation });
        continue;
      }
      const occ = byKey.get(occKey(e.path));
      if (!occ) {
        tail.push({ row: e.row, continuation: false }); // never dropped
        continue;
      }
      occ.lanes.push(e.row);
    }
  }

  // A sub-assembly whose only line is its "(made in-house)" row renders AS
  // that row. Anything else (a bought sub-assembly) keeps its lines nested.
  for (const o of occs) {
    if (o.kind === "subassembly" && o.lanes.length === 1 && o.lanes[0].__in_house) {
      o.ownRow = o.lanes[0];
      o.lanes = [];
    }
  }

  // What each occurrence contains, bottom-up (occs are in DFS pre-order).
  const matSets = new Map<string, Set<string>>();
  for (let k = occs.length - 1; k >= 0; k--) {
    const o = occs[k];
    const set = new Set<string>();
    let lines = o.lanes.length;
    for (const ck of o.childKeys) {
      const c = byKey.get(ck)!;
      if (c.kind === "material") set.add(c.id);
      for (const m of matSets.get(ck) ?? []) set.add(m);
      lines += c.inside.lines + (c.ownRow ? 1 : 0);
    }
    matSets.set(o.key, set);
    o.inside = { materials: set.size, lines };
  }

  // Readings of rows the tree already holds (no new read, no walk).
  const byId = new Map<string, BomOcc[]>();
  for (const o of occs) {
    const list = byId.get(o.id) ?? [];
    list.push(o);
    byId.set(o.id, list);
  }
  const uploadParents = new Map<string, string[]>();
  for (const r of i.bomRows) {
    const child = s(r.material_id);
    const parent = s(r.higher_level_component_id);
    if (!child || !parent || child === parent) continue;
    const list = uploadParents.get(child) ?? [];
    if (!list.includes(parent)) list.push(parent);
    uploadParents.set(child, list);
  }
  const rootDemand = new Map<string, number | null>();
  for (const o of occs) if (o.kind === "root") rootDemand.set(o.id, o.demandPerWeek);

  const whereUsed = (m: string): WhereUsedParent[] => {
    const under = (byId.get(m) ?? []).filter((o) => o.kind !== "root");
    const out: WhereUsedParent[] = [];
    const seen = new Set<string>();
    const seenEdgeRoot = new Set<string>();
    for (const o of under) {
      const p = o.parentId ?? "";
      const edgeRoot = `${p}${SEP}${o.rootId}`;
      // The same (child → parent, root) row read again through a repeated
      // ancestor is the SAME derived row — it is never added twice.
      if (seenEdgeRoot.has(edgeRoot)) continue;
      seenEdgeRoot.add(edgeRoot);
      if (seen.has(p)) {
        const w = out.find((x) => x.parentId === p)!;
        // another root reaches the same edge: flows add, one rate
        if (w.flowPerWeek !== null && o.flowPerWeek !== null) w.flowPerWeek += o.flowPerWeek;
        else w.flowPerWeek = null;
        w.derived = w.derived && o.derived;
        continue;
      }
      seen.add(p);
      out.push({ parentId: p, edgeRate: o.edgeRate, flowPerWeek: o.flowPerWeek, occKey: o.key, derived: o.derived });
    }
    // Parents the upload names that no shipping product reaches: listed, never hidden.
    for (const p of uploadParents.get(m) ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push({ parentId: p, edgeRate: null, flowPerWeek: null, occKey: null, derived: false });
    }
    return out;
  };

  const qtyPerRoot = (m: string): QtyPerRoot[] => {
    const out: QtyPerRoot[] = [];
    const under = (byId.get(m) ?? []).filter((o) => o.kind !== "root");
    for (const root of roots) {
      // One summand per distinct (child → parent) edge under this root: the
      // derived row is per (child, parent, root), and an occurrence repeated
      // by a repeated ancestor reads the SAME row — summing occurrences would
      // count it twice.
      const perEdge = new Map<string, BomOcc>();
      for (const o of under) if (o.rootId === root && !perEdge.has(o.parentId ?? "")) perEdge.set(o.parentId ?? "", o);
      if (perEdge.size === 0) continue;
      const demand = rootDemand.get(root) ?? null;
      let flow: number | null = 0;
      for (const o of perEdge.values()) {
        if (!o.derived || o.flowPerWeek === null) {
          flow = null;
          break;
        }
        flow += o.flowPerWeek;
      }
      out.push({
        rootId: root,
        demandPerWeek: demand,
        flowPerWeek: flow,
        qty: flow !== null && demand !== null && demand > 0 ? flow / demand : null,
        edges: perEdge.size,
      });
    }
    return out;
  };

  const outbound = i.deepRows.filter((r) => s(r.data_source) === "outbound");
  const stale = outbound.length > 0 && outbound.every((r) => r.bom_depth === null || r.bom_depth === undefined);

  const totalLines =
    occs.reduce((n, o) => n + o.lanes.length + (o.ownRow ? 1 : 0), 0) + tail.length;

  return {
    occs,
    byKey,
    roots,
    maxDepth: occs.reduce((d, o) => Math.max(d, o.depth), 0),
    unreachableEdges,
    tail,
    tailMaterials,
    stale,
    totalLines,
    whereUsed,
    qtyPerRoot,
  };
}

/** Does an occurrence open onto anything (children, or its own lines)? */
export const occCanOpen = (o: BomOcc): boolean => o.childKeys.length > 0 || o.lanes.length > 0;

/**
 * "Expand to Ln": every occurrence with children whose uploaded-level slot
 * (depth − 1) is above `n` is open, so items AT level n are visible and
 * closed. `"all"` opens everything, supplier lines included.
 */
export function expandToLevel(model: BomTreeModel, n: number | "all"): Set<string> {
  const open = new Set<string>();
  for (const o of model.occs) {
    if (n === "all") {
      if (occCanOpen(o)) open.add(o.key);
    } else if (o.childKeys.length > 0 && o.depth - 1 < n) {
      open.add(o.key);
    }
  }
  return open;
}

/** Keys to open so `key` is on screen (its ancestors), plus itself when it has lines. */
export function revealKeys(model: BomTreeModel, key: string): string[] {
  const out: string[] = [];
  let k = model.byKey.get(key)?.parentKey ?? null;
  while (k) {
    out.push(k);
    k = model.byKey.get(k)?.parentKey ?? null;
  }
  const o = model.byKey.get(key);
  if (o && o.lanes.length > 0) out.push(key);
  return out;
}

export const normalizeTreeFilter = (q: string): string => {
  const t = q.trim().toLowerCase();
  return t.length >= 2 ? t : "";
};

/**
 * The Material filter OPENS paths; it never removes a row. Every ancestor of
 * every match opens, and a matched material's canonical occurrence opens too
 * (with its own ancestors) so its lines show.
 */
export function revealForFilter(model: BomTreeModel, q: string): { open: Set<string>; matches: Set<string> } {
  const needle = normalizeTreeFilter(q);
  const open = new Set<string>();
  const matches = new Set<string>();
  if (!needle) return { open, matches };
  for (const o of model.occs) {
    if (!o.id.toLowerCase().includes(needle)) continue;
    matches.add(o.key);
    for (const k of revealKeys(model, o.key)) open.add(k);
    if (!o.canonical) for (const k of revealKeys(model, o.canonicalKey)) open.add(k);
  }
  return { open, matches };
}

export type TreeLayout = "compact" | "outline" | "tabular";

export type VisRow =
  | {
      t: "node";
      occ: BomOcc;
      open: boolean;
      /** Tabular, collapsed material: how many lines its one row stands for. */
      linesHere: number;
    }
  | {
      t: "lane";
      row: SupplierLaneRow;
      occ: BomOcc | null;
      /** The entry above names this lane's material (D179). */
      continuation: boolean;
      /** Tabular: this first line carries its material's label and Qty / assy. */
      carrier: boolean;
    }
  | { t: "where"; occ: BomOcc }
  | { t: "section"; id: "unreachable" | "not_in_bom"; count: number };

/**
 * The rows to render. Decides OPEN / CLOSED only: every lane stays in the
 * model; the tail (lines with no BOM place) is always on screen.
 */
export function visibleTreeRows(
  model: BomTreeModel,
  o: { open: ReadonlySet<string>; layout: TreeLayout; whereOpen: string | null },
): { rows: VisRow[]; shownLines: number } {
  const rows: VisRow[] = [];
  let shownLines = 0;
  const emit = (occ: BomOcc) => {
    const open = o.open.has(occ.key) && occCanOpen(occ);
    if (occ.ownRow) shownLines += 1;
    const tabularCarrier = o.layout === "tabular" && occ.kind === "material" && open && occ.lanes.length > 0;
    if (tabularCarrier) {
      occ.lanes.forEach((row, idx) => {
        rows.push({ t: "lane", row, occ, continuation: idx > 0, carrier: idx === 0 });
        shownLines += 1;
        if (idx === 0 && o.whereOpen === occ.key) rows.push({ t: "where", occ });
      });
    } else {
      rows.push({ t: "node", occ, open, linesHere: open ? 0 : occ.lanes.length });
      if (o.whereOpen === occ.key) rows.push({ t: "where", occ });
      if (open) {
        for (const row of occ.lanes) {
          rows.push({ t: "lane", row, occ, continuation: true, carrier: false });
          shownLines += 1;
        }
      }
    }
    if (open) for (const ck of occ.childKeys) emit(model.byKey.get(ck)!);
  };
  for (const occ of model.occs) if (occ.depth === 0) emit(occ);
  if (model.unreachableEdges > 0) rows.push({ t: "section", id: "unreachable", count: model.unreachableEdges });
  if (model.tail.length > 0) {
    rows.push({ t: "section", id: "not_in_bom", count: model.tailMaterials });
    for (const t of model.tail) {
      rows.push({ t: "lane", row: t.row, occ: null, continuation: t.continuation, carrier: false });
      shownLines += 1;
    }
  }
  return { rows, shownLines };
}
