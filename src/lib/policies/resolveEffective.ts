import { effectivePolicy, type OverrideRow } from "./resolve";
import type { PolicyBundle, PolicyFamily } from "./schemas";
import type { ColSpec } from "./columnSpecs";
import type { Provenance } from "@/components/policies/policyGridUi";

/**
 * Single source of truth for "what value does this cell actually show, and
 * where did it come from" — extracted from StagePolicyTable so the desktop
 * grid and any read-only surface (the mobile stage list) resolve a line's
 * fields identically. A duplicated copy that drifts would mean mobile and
 * desktop silently disagree about the same row's own value, which is a
 * correctness bug, not a style one.
 */

export interface MasterRowMaps {
  materials: Map<string, Record<string, unknown>>;
  products: Map<string, Record<string, unknown>>;
  suppliers: Map<string, Record<string, unknown>>;
}

export interface DerivedMaps {
  materialCost: Map<string, number>;
  sellPrice: Map<string, number>;
  demandMean: Map<string, number>;
}

export function masterValueFor(
  col: ColSpec,
  row: Record<string, unknown>,
  masterRowById: MasterRowMaps,
): number | undefined {
  if (!col.master) return undefined;
  const id = String(row[col.master.idFrom] ?? "");
  const v = masterRowById[col.master.table].get(id)?.[col.master.field];
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? undefined : n;
}

export function derivedValueFor(
  col: ColSpec,
  row: Record<string, unknown>,
  derived: DerivedMaps,
): number | undefined {
  if (!col.master) return undefined;
  const id = String(row[col.master.idFrom] ?? "");
  if (col.master.table === "materials" && col.master.field === "cost") return derived.materialCost.get(id);
  if (col.master.field === "sell_price") return derived.sellPrice.get(id);
  if (col.master.field === "demand_mean") {
    const v = derived.demandMean.get(id) ?? 0;
    return v > 0 ? v : undefined;
  }
  return undefined; // production_capacity has no logistics-derived fallback
}

/** `getEffective` — data prefill → override → default; master-backed columns
 *  resolve draft → item-master value → derived fallback. `draft` is the
 *  unsaved-edit value for this row+field, or undefined for a read-only caller. */
export function getEffectiveValue(args: {
  rowKey: string;
  dataRow: Record<string, unknown>;
  field: string;
  family: PolicyFamily | undefined;
  families: readonly PolicyFamily[];
  draft?: unknown;
  masterColByField: Map<string, ColSpec>;
  masterRowById: MasterRowMaps;
  derived: DerivedMaps;
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  scope: "node" | "edge";
}): unknown {
  const {
    rowKey, dataRow, field, family, families, draft,
    masterColByField, masterRowById, derived, defaults, overrides, scope,
  } = args;
  if (draft !== undefined) return draft;
  const mcol = masterColByField.get(field);
  if (mcol) {
    const mv = masterValueFor(mcol, dataRow, masterRowById);
    return mv !== undefined ? mv : derivedValueFor(mcol, dataRow, derived);
  }
  if (dataRow[field] !== undefined && dataRow[field] !== null) return dataRow[field];
  const bundle = effectivePolicy(defaults, overrides, scope, rowKey);
  if (family) {
    const own = bundle[family] as Record<string, unknown> | undefined;
    if (own && own[field] !== undefined) return own[field];
  }
  for (const fam of families) {
    const eff = bundle[fam] as Record<string, unknown>;
    if (eff[field] !== undefined) return eff[field];
  }
  return undefined;
}

export interface ResolvedCell {
  /** What the grid actually displays for this cell (`cellValue ?? liveDefault`). */
  value: unknown;
  provenance: Provenance;
}

/** Resolves one cell's displayed value + provenance dot, matching exactly
 *  what StagePolicyTable's own cell renderer computes and shows. */
export function resolveCell(args: {
  rowKey: string;
  row: Record<string, unknown>;
  col: ColSpec;
  /** Unsaved-edit value for this row+field, or undefined for a read-only caller. */
  draft?: unknown;
  families: readonly PolicyFamily[];
  masterColByField: Map<string, ColSpec>;
  masterRowById: MasterRowMaps;
  derived: DerivedMaps;
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  scope: "node" | "edge";
  /** family raw default fallback, mirroring StagePolicyTable's `getDefault`. */
  familyDefault: (field: string, family: PolicyFamily) => unknown;
}): ResolvedCell {
  const {
    rowKey, row, col, draft, families,
    masterColByField, masterRowById, derived, defaults, overrides, scope, familyDefault,
  } = args;

  const cellValue = getEffectiveValue({
    rowKey, dataRow: row, field: col.field, family: col.family, families, draft,
    masterColByField, masterRowById, derived, defaults, overrides, scope,
  });

  const masterSet = col.master ? masterValueFor(col, row, masterRowById) !== undefined : false;
  const derivedVal = col.master && !masterSet ? derivedValueFor(col, row, derived) : undefined;

  const bundleVal = (
    effectivePolicy(defaults, overrides, scope, rowKey)[col.family] as Record<string, unknown> | undefined
  )?.[col.field];
  const liveDefault = col.master
    ? derivedVal ?? 0
    : bundleVal !== undefined
      ? bundleVal
      : col.defaultWhenMissing !== undefined
        ? col.defaultWhenMissing
        : familyDefault(col.field, col.family);

  const edited = draft !== undefined;
  const fromDataMap = (row.__from_data ?? {}) as Record<string, true>;
  const imputedMap = (row.__imputed ?? {}) as Record<string, true>;
  const tracked = col.field in fromDataMap || col.field in imputedMap;
  const imputed = !edited && !col.master && imputedMap[col.field] === true;
  const fromData =
    !edited &&
    !imputed &&
    (col.master
      ? masterSet
      : tracked
        ? fromDataMap[col.field] === true
        : row[col.field] !== undefined && row[col.field] !== null);
  const derivedFallback = !edited && !!col.master && !masterSet && derivedVal !== undefined;
  const fromOverride =
    !edited &&
    !imputed &&
    !fromData &&
    !col.master &&
    overrides.some(
      (o) => o.target_key === rowKey && o.family === col.family && col.field in (o.patch ?? {}),
    );

  const provenance: Provenance = edited
    ? "edited"
    : imputed
      ? "imputed"
      : fromData
        ? col.master
          ? "master"
          : "data"
        : derivedFallback
          ? "derived"
          : fromOverride
            ? "override"
            : "default";

  return { value: cellValue ?? liveDefault, provenance };
}
