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
  /**
   * The two halves of `value`, exposed because the DESKTOP grid needs them
   * apart and used to compute them itself (see the note on `resolveCell`).
   * `kindOf` picks a widget from both, a `<Select>` falls back through them to
   * an option list, and a checkbox reads `liveDefault` for its unchecked state.
   */
  cellValue: unknown;
  liveDefault: unknown;
  /** True when an unsaved draft supplied the value. */
  edited: boolean;
  /**
   * What an empty cell should SHOW, when the schema declares a meaning for empty
   * (§4 D17). `undefined` for every other column, which keeps the "—" placeholder.
   */
  placeholder?: string;
  /** The sentence explaining that token, for the cell's own tooltip. */
  placeholderTitle?: string;
}

/**
 * Resolves one cell's displayed value + provenance dot.
 *
 * ── THIS WAS TWO IMPLEMENTATIONS UNTIL WP 6.2 ─────────────────────────────
 *
 * `StagePolicyTable.tsx`'s desktop renderer carried a VERBATIM copy of the body
 * below — about seventy lines, from `masterSet` through the `provenance`
 * ladder — and both copies carried a comment telling the next reader that "every
 * change here changes BOTH". It had been that way since WP 0.1. Two copies of a
 * resolution rule is `single-source` (I1) broken in the one place the product
 * decides what a number MEANS, and the plan already has D26 on the record for
 * what it costs: two implementations of the D1 prefill rule, both unit-tested,
 * one of them dead and unreachable, so the tests stayed green while only one ran.
 *
 * The desktop grid now calls this. The extra fields on `ResolvedCell` are the
 * intermediates its renderer needs and nothing else — deliberately not a second
 * return shape, because that is how the copy started.
 */
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
  /**
   * `?? 0` WAS A SUBSTITUTION NOBODY DECLARED (§4 D17).
   *
   * For a master column with no master value and no derived fallback, this read
   * `derivedVal ?? 0` — a hard-coded zero, with provenance `default`, whose
   * colour is null, so the cell showed a number and no dot. For
   * `capacity_per_week` that zero is the exact inverse of the schema's meaning
   * (`item_master.sql:44`: "NULL = ∞"), and §15 measured 60 of 60 suppliers with
   * a null capacity — so the grid reported every supplier in the network as
   * having no capacity at all.
   *
   * `declared-fallback` (I6) is the rule this broke: a fallback absent from the
   * contract may not exist in code. A column whose empty state MEANS something
   * now declares it in `columnSpecs.ts`, and the cell renders that token instead
   * of inventing a number.
   */
  const nullMeans = col.master?.nullMeans;
  const liveDefault = col.master
    ? derivedVal ?? (nullMeans ? undefined : 0)
    : bundleVal !== undefined
      ? bundleVal
      : col.defaultWhenMissing !== undefined
        ? col.defaultWhenMissing
        : familyDefault(col.field, col.family);

  const edited = draft !== undefined;
  const fromDataMap = (row.__from_data ?? {}) as Record<string, true>;
  const imputedMap = (row.__imputed ?? {}) as Record<string, true>;
  // The stage's own routing decisions (`primary_source`, `sourcing_firm`), written
  // by `useStageRows::markFromData`. Read here so the `suggested` branch below has
  // a map to test — it referenced `decidedMap` without one from `5c7129f` until the
  // Phase 1 precondition check, and every cell render threw (D26's sibling). That
  // bug is exactly what one copy of a two-copy rule looks like from the inside.
  const decidedMap = (row.__decided ?? {}) as Record<string, true>;
  const imputed = !edited && !col.master && imputedMap[col.field] === true;
  // D16 — `__from_data` is the ONLY evidence that a value came from the
  // project. The old fallback ("untracked but the row carries a value")
  // green-dotted every hardcoded constant useStageRows wrote onto the row as
  // "From project data". A field that is neither tracked nor master-backed
  // resolves to `default`, never `data`.
  const fromData =
    !edited && !imputed && (col.master ? masterSet : fromDataMap[col.field] === true);
  const derivedFallback = !edited && !!col.master && !masterSet && derivedVal !== undefined;
  // The master column is empty, nothing derived a value for it, and the schema
  // says what empty means. Ranked BELOW `derived`: a computed fallback is a
  // better answer than "this is what blank means", and above everything else,
  // because for a master column there is nothing else left.
  const declaredEmpty =
    !edited && !!nullMeans && !masterSet && derivedVal === undefined && cellValue === undefined;
  const fromOverride =
    !edited &&
    !imputed &&
    !fromData &&
    !col.master &&
    overrides.some(
      (o) => o.target_key === rowKey && o.family === col.family && col.field in (o.patch ?? {}),
    );
  // A routing decision this stage derived from the uploaded volumes (primary
  // source, sourcing firm). Ranked BELOW a saved override: once the user (or
  // the prefill) has persisted a choice, the override is the truer answer.
  const suggested =
    !edited && !imputed && !fromData && !col.master && !fromOverride && decidedMap[col.field] === true;

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
          : declaredEmpty
            ? "contract"
            : fromOverride
            ? "override"
            : suggested
              ? "suggested"
              : "default";

  return {
    value: cellValue ?? liveDefault,
    provenance,
    cellValue,
    liveDefault,
    edited,
    placeholder: declaredEmpty ? nullMeans!.token : undefined,
    placeholderTitle: declaredEmpty ? nullMeans!.title : undefined,
  };
}

/**
 * May the prefill persist this row×field as a saved override? (D1)
 *
 * The prefill's job is to freeze what the **project data** says, plus whatever
 * the user has typed. It is not a default-materializer: a field the data is
 * silent about must keep resolving live through the policy bundle, so that the
 * engine's own default still applies and a later change to that default still
 * reaches the project. Persisting a default instead froze a decision nobody
 * made — `safety_stock_days` went in as `0` while both the bundle
 * (`schemas.ts`) and the engine (`project_map.py:783`) say 7.
 *
 * `__from_data` is therefore the whole allow-list. It carries both the values
 * read off an uploaded column and the routing decisions the data's own shape
 * determines (`primary_source`, `sourcing_firm` — `useStageRows::markFromData`),
 * which the pre-dispatch validator reads from the saved bundle.
 *
 * Imputed averages are excluded even when edited: they are estimates to verify,
 * and silently freezing them has poisoned projects before. Note the ORDER — the
 * imputed test runs BEFORE the draft test, and that is the whole of the
 * difference described next.
 *
 * ── THE SECOND IMPLEMENTATION IS GONE, AND IT DISAGREED (§4 D26, D93) ──────
 *
 * `prefillSelect.ts` held `prefillSourceFor` / `isPrefillable`: the same rule,
 * separately written, imported by `StagePolicyTable` and never called. D26
 * predicted the cost — "the next edit to the rule has even odds of landing on the
 * dead one" — and understated it. The two did not merely risk drifting; they had
 * already drifted, on a case each of them was TESTED for:
 *
 *     the user types a value over an imputed average
 *       · this rule      → NOT persisted by the prefill (imputed is checked first)
 *       · prefillSelect  → persisted as `"edit"` (imputed was not checked at all)
 *
 * `policyPrefill.test.ts` asserted the second answer, in a test named "does NOT
 * persist an imputed average, but DOES persist an edit of one", and it passed for
 * as long as it existed — against a function no screen ever called. A green test
 * for behaviour that has never run is worse than no test: it is a claim on the
 * record that the product does something it does not do.
 *
 * This rule's answer is kept because it is the one that has been running and the
 * safer of the two: the prefill's job is to freeze what the DATA says, and an
 * imputed average is an estimate to verify whether or not somebody typed over it.
 * A manual save is a different path and still writes the user's value.
 *
 * `__decided` is deliberately NOT a source here. It marks the stage's routing
 * suggestion for the `suggested` provenance dot; the routing decision reaches the
 * prefill through `__from_data`, which `useStageRows::markFromData` sets for
 * `primary_source`/`sourcing_firm` whenever they have a value. Adding a
 * `__decided` branch would make a field with NO value newly persistable, which is
 * the other half of §4 D23 and not this package's to change blind.
 */

/** Why a row×field may be persisted by the prefill. */
export type PrefillSource = "edit" | "data";

export function prefillSourceFor(
  row: Record<string, unknown>,
  field: string,
  draft?: unknown,
): PrefillSource | null {
  const imputed = (row.__imputed ?? {}) as Record<string, true>;
  if (imputed[field] === true) return null;
  if (draft !== undefined) return "edit";
  const fromData = (row.__from_data ?? {}) as Record<string, true>;
  return fromData[field] === true ? "data" : null;
}

export function isPrefillPersistable(
  row: Record<string, unknown>,
  field: string,
  draft?: unknown,
): boolean {
  return prefillSourceFor(row, field, draft) !== null;
}
