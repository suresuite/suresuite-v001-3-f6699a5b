// /policies OVERRIDES of item-master values — PLAN.md §23 WP 13.1, §4 D280.
//
// /policies never writes the item masters. A cost, MOQ, capacity, price or
// demand changed there is a policy override on the grid row, and the engine
// reads it in one order: override → item master → derived from lanes → default.
//
// The DECLARATION of each such key (which master column it overrides, which
// stage's rows carry it, which values it accepts) is the engine's
// (`POLICY_BUNDLE_KEYS` in scsim/scsim/io/project_map.py, published in
// registry.generated.json). This module is the ONE TypeScript reading of HOW
// the mapper resolves a row key to an entity — mirrored from
// `_supplier_row_values`, `_supplier_values` and `_composite_patches` — shared
// by the grid (src/lib/policies/masterOverrides.ts) and the grader
// (grading.ts), so the page, the run check and the dispatch gate cannot
// disagree about which value the run uses.
//
// DEPENDENCY-FREE pure TypeScript, like grading.ts: it is bundled for the edge
// and imported by relative path from the browser.

export type Row = Record<string, unknown>;
export type OverrideDomain =
  | "positive" | "nonnegative" | "fraction" | "percent" | "distribution" | "demand_mode" | "fg_policy"
  | "fulfillment_mode" | "lead_time_distribution";
/** `row` (PLAN.md §24 WP 14.2) is a customer × product row of
 *  `outbound_logistics`, keyed exactly as the Customer stage keys it,
 *  `<customer>::<product>`. `lane` is its inbound twin: one supplier × material
 *  link of `inbound_logistics`, keyed as the Supplier stage keys it,
 *  `<supplier>::<material>` (the row's lead time). */
export type OverrideEntity = "material" | "supplier" | "product" | "row" | "lane";

/** The values an ENUM domain accepts — the mapper's `_ROW_KIND` targets and the
 *  row's two modes. */
type EnumDomain = "distribution" | "demand_mode" | "fg_policy" | "fulfillment_mode" | "lead_time_distribution";
export const ENUM_DOMAIN_VALUES: Record<EnumDomain, readonly string[]> = {
  distribution: ["deterministic", "normal", "triangular", "triangular_av", "poisson"],
  demand_mode: ["forecast", "model"],
  // WP 14.4 — `project_map._FG_POLICIES`.
  fg_policy: ["base_stock", "min_max", "days_of_cover"],
  // Whether the product holds FG stock — `project_map._MODE_OVERRIDE_TOKENS`.
  fulfillment_mode: ["mts", "mto"],
  // PLAN.md §26 WP 16.2 — a lane's lead-time shape, `project_map._LANE_LT_DISTS`.
  lead_time_distribution: ["deterministic", "normal", "lognormal", "gamma", "triangular", "uniform"],
};
export const isEnumDomain = (d: OverrideDomain): d is EnumDomain =>
  d === "distribution" || d === "demand_mode" || d === "fg_policy" || d === "fulfillment_mode" ||
  d === "lead_time_distribution";

export interface OverrideDecl {
  /** The bundle key — the grid column's `field`. */
  key: string;
  family: string;
  /** `table.column` of the item master this key overrides. */
  master: string;
  /** The /policies stage whose rows carry it. */
  rows: "supplier" | "plant" | "customer";
  domain: OverrideDomain;
  entity: OverrideEntity;
  /** What the engine uses when override, master and derivations are all empty:
   *  a number, or null with `emptyNote` saying what it does instead. */
  emptyDefault: number | null;
  emptyNote: string | null;
}

const ENTITY_OF_TABLE: Record<string, OverrideEntity> = {
  materials: "material",
  suppliers: "supplier",
  products: "product",
  outbound_logistics: "row",
  // WP 14.3 — a row's priority / service target override sits over its
  // CUSTOMER's master value, but is keyed by the row like every Customer cell.
  customers: "row",
  // One supplier × material link — the Supplier row's own lead time.
  inbound_logistics: "lane",
};

/** The override declarations among the registry's `policy_bundle_keys`. */
export function overrideDecls(bundleKeys: readonly Row[] | undefined): OverrideDecl[] {
  const out: OverrideDecl[] = [];
  for (const k of bundleKeys ?? []) {
    const master = typeof k.master === "string" ? k.master : "";
    const entity = ENTITY_OF_TABLE[master.split(".")[0]];
    if (!master || !entity) continue;
    out.push({
      key: String(k.key),
      family: String(k.family),
      master,
      rows: k.rows === "plant" ? "plant" : k.rows === "customer" ? "customer" : "supplier",
      domain: (k.domain as OverrideDomain) ?? "nonnegative",
      entity,
      emptyDefault: typeof k.empty_default === "number" ? k.empty_default : null,
      emptyNote: typeof k.empty_note === "string" ? k.empty_note : null,
    });
  }
  return out;
}

/** `_override_num`'s domain test. A value outside it is ignored by the engine,
 *  with a warning, and the master decides. */
export function isUsableOverride(v: unknown, domain: OverrideDomain): boolean {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return false;
  if (isEnumDomain(domain)) {
    const t = String(v).trim().toLowerCase().replace(/[- ]/g, "_");
    const norm = t === "triangularav" ? "triangular_av" : t;
    return ENUM_DOMAIN_VALUES[domain].includes(norm);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return false;
  if (domain === "positive") return n > 0;
  if (domain === "fraction") return n <= 1;
  if (domain === "percent") return n <= 100;
  return true;
}

/** Python's `str.partition("::")` / `rpartition("::")`. */
function partition(s: string, last = false): [string, string] | null {
  const at = last ? s.lastIndexOf("::") : s.indexOf("::");
  return at < 0 ? null : [s.slice(0, at), s.slice(at + 2)];
}

/** Node-scope override rows in the mapper's visiting order: `sorted()` over
 *  `node:<target_key>`, i.e. code-point order of the target key. */
function sortedNodeRows(overrides: readonly Row[]): Row[] {
  return overrides
    .filter((o) => String(o.scope ?? "node") === "node" && typeof o.target_key === "string")
    .slice()
    .sort((a, b) => {
      const x = String(a.target_key);
      const y = String(b.target_key);
      return x < y ? -1 : x > y ? 1 : 0;
    });
}

export interface ResolvedOverride {
  /** The raw value as saved. */
  value: unknown;
  /** The row whose patch supplied it. */
  targetKey: string;
  /** Whether the engine will use it (`isUsableOverride` against the domain). */
  usable: boolean;
}

/**
 * The override the ENGINE reads for one entity, or undefined.
 *
 * - material (Supplier rows `<supplier>::<material>`): split at the FIRST `::`,
 *   the right half is the material; sorted order, FIRST non-null wins
 *   (`_supplier_row_values`).
 * - supplier: the left half is the supplier; first wins (`_supplier_values`).
 * - product (Plant rows `<plant>::<product>`): the bare `<product>` patch, then
 *   every composite key whose target is the product — first `::` then last,
 *   each checked against the product ids (`_composite_target`) — merged in
 *   sorted order, LAST wins (`_composite_patches`, a dict `.update`).
 *
 * `productIds` is the set the mapper validates a composite target against.
 * Omitted, only `entityId` is known.
 */
export function entityOverride(
  overrides: readonly Row[],
  decl: Pick<OverrideDecl, "key" | "family" | "domain" | "entity">,
  entityId: string,
  productIds?: ReadonlySet<string>,
): ResolvedOverride | undefined {
  if (!entityId) return undefined;
  const patchOf = (o: Row): Row =>
    String(o.family ?? "") === decl.family && o.patch && typeof o.patch === "object"
      ? (o.patch as Row)
      : {};
  const rows = sortedNodeRows(overrides);

  if (decl.entity === "product") {
    const ids = productIds ?? new Set([entityId]);
    let found: { value: unknown; targetKey: string } | undefined;
    for (const o of rows) {
      if (o.target_key !== entityId) continue;
      const patch = patchOf(o);
      if (decl.key in patch) found = { value: patch[decl.key], targetKey: String(o.target_key) };
    }
    for (const o of rows) {
      const key = String(o.target_key);
      if (!key.includes("::")) continue;
      const first = partition(key)?.[1];
      const last = partition(key, true)?.[1];
      const target = first && ids.has(first) ? first : last && ids.has(last) ? last : undefined;
      if (target !== entityId) continue;
      const patch = patchOf(o);
      if (decl.key in patch) found = { value: patch[decl.key], targetKey: key };
    }
    if (!found || found.value === null || found.value === undefined) return undefined;
    return { ...found, usable: isUsableOverride(found.value, decl.domain) };
  }

  // A customer × product row (WP 14.2): the Customer row's own key, exactly
  // (`_apply_row_demand_overrides` reads `node:<customer>::<product>`). A
  // supplier × material LANE is read the same way: the arc loop looks up
  // `node:<supplier>::<material>` exactly, never split to an entity.
  if (decl.entity === "row" || decl.entity === "lane") {
    for (const o of rows) {
      if (String(o.target_key) !== entityId) continue;
      const v = patchOf(o)[decl.key];
      if (v === undefined || v === null || v === "") continue;
      return { value: v, targetKey: entityId, usable: isUsableOverride(v, decl.domain) };
    }
    return undefined;
  }

  for (const o of rows) {
    const parts = partition(String(o.target_key));
    if (!parts) continue;
    const [sup, mat] = parts;
    if ((decl.entity === "material" ? mat : sup) !== entityId) continue;
    const v = patchOf(o)[decl.key];
    if (v === undefined || v === null) continue;
    return { value: v, targetKey: String(o.target_key), usable: isUsableOverride(v, decl.domain) };
  }
  return undefined;
}

/**
 * Per master column, the entities whose value the engine takes from a USABLE
 * /policies override: `"materials.cost" → {"M1", …}`. What the grader asks to
 * decide "set" ahead of "missing".
 */
export function overriddenEntities(
  overrides: readonly Row[] | undefined,
  bundleKeys: readonly Row[] | undefined,
  idsByEntity: Partial<Record<OverrideEntity, ReadonlySet<string>>>,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  if (!overrides?.length) return out;
  for (const decl of overrideDecls(bundleKeys)) {
    const ids = idsByEntity[decl.entity];
    // The grader grades the item masters; a customer-row override (WP 14.2) is
    // not one of them and has no ids here.
    if (!ids) continue;
    const hit = new Map<string, number>();
    for (const id of ids) {
      const ov = entityOverride(overrides, decl, id, decl.entity === "product" ? ids : undefined);
      if (ov?.usable) hit.set(id, Number(ov.value));
    }
    if (hit.size) out.set(decl.master, hit);
  }
  return out;
}
