import { effectivePolicy, type OverrideRow } from "./resolve";
import type { PolicyBundle, PolicyFamily } from "./schemas";
import type { ColSpec } from "./columnSpecs";
import { reducerLabel, type DerivedValue } from "./effectiveEconomics";
import { shadowedBy } from "./registryAccess";
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
  /**
   * `products.production_capacity`, resolved through the registry's own chain,
   * carrying the STEP that answered (§4 D167).
   *
   * It is a `DerivedValue` rather than a bare number because the two steps mean
   * opposite things — the plant grid's converted line rate (`info`) versus the
   * engine's max(2·demand, 1000) floor (`warn`), which is the engine declaring
   * that capacity will not bind. A cell showing the second as if it were the
   * first is T1 broken: a number with no honest source.
   *
   * Optional so a caller that predates this (and every test fixture that builds
   * a `DerivedMaps` by hand) keeps compiling and simply resolves no capacity —
   * which is exactly the behaviour it had before.
   */
  productionCapacity?: Map<string, DerivedValue>;
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
  // THE LINE THAT USED TO BE HERE WAS WRONG, AND THE COMMENT SAID WHY (§4 D167):
  //
  //     return undefined; // production_capacity has no logistics-derived fallback
  //
  // True of the LOGISTICS tables and false of the engine. `project_map.py` has
  // always built a weekly capacity from the plant grid's units/day × 7 ×
  // utilization, and `base_data_requirements` has declared that chain
  // machine-readably since the reducer library existed — the shared grader
  // resolves it, the edge gate grades it, and only the grid could not see it.
  // So the one cell the run was CERTAIN to use a number for was the one cell
  // that showed nothing.
  if (col.master.field === "production_capacity") {
    return derived.productionCapacity?.get(id)?.value;
  }
  return undefined;
}

/** The registry step behind a derived master value, when there is one and the
 *  caller supplied the map that carries it. Only `production_capacity` has a
 *  chain whose steps disagree about what the number MEANS; the rest resolve to
 *  one kind of answer and need no step. */
function derivedStepFor(
  col: ColSpec,
  row: Record<string, unknown>,
  derived: DerivedMaps,
): DerivedValue | undefined {
  if (col.master?.field !== "production_capacity") return undefined;
  return derived.productionCapacity?.get(String(row[col.master.idFrom] ?? ""));
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
  /**
   * A ROUTING SUGGESTION IS NOT UPLOADED DATA, AND THAT DISTINCTION IS §4 D23.
   *
   * `dataRow[field]` ranks above the bundle on purpose: an uploaded column is a
   * fact about the project and must beat a stale override, and WP 4.4's
   * staleness brief turns on exactly that. But `useStageRows` also puts the
   * stage's own routing SUGGESTION on the row — which supplier it thinks is
   * primary, which firm it thinks ships a lane — and a suggestion in that slot
   * outranked the user's saved decision forever: pick a supplier, save, reload,
   * and the suggestion is back. Nothing on screen said why.
   *
   * So a `__decided` field is resolved in two pieces. An EXPLICIT override — a
   * patch somebody saved — beats it; the family DEFAULT does not, because the
   * bundle always carries one (`primary_source` defaults to `false`) and letting
   * that win would delete every suggestion instead of the ones a user replaced.
   * Ordering it against the raw patches rather than against `effectivePolicy`'s
   * merged answer is the whole of the fix.
   */
  const decided = (dataRow.__decided ?? {}) as Record<string, true>;
  const isSuggestion = decided[field] === true;
  const hasValue = dataRow[field] !== undefined && dataRow[field] !== null;
  if (hasValue && !isSuggestion) return dataRow[field];

  if (isSuggestion) {
    const saved = savedOverrideValue(overrides, rowKey, field, family, families);
    if (saved !== undefined) return saved;
    if (hasValue) return dataRow[field];
  }

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

/**
 * The value an override PATCH carries for this row+field, or `undefined`.
 *
 * Deliberately not `effectivePolicy`: that merges the schema defaults under the
 * patches and cannot tell "somebody saved `false`" from "nobody saved anything
 * and the default is `false`". For a routing decision those are opposite
 * answers — the first is a user un-checking a primary supplier, the second is a
 * fresh row — so the distinction has to be read from the patches themselves.
 */
export function savedOverrideValue(
  overrides: OverrideRow[],
  rowKey: string,
  field: string,
  family: PolicyFamily | undefined,
  families: readonly PolicyFamily[],
): unknown {
  const forRow = overrides.filter((o) => o.target_key === rowKey);
  const pick = (fam: PolicyFamily): unknown => {
    for (const o of forRow) {
      if (o.family !== fam) continue;
      const patch = (o.patch ?? {}) as Record<string, unknown>;
      if (field in patch) return patch[field];
    }
    return undefined;
  };
  // The column's own family first, then the others — the same order the bundle
  // lookup below uses, so a name shared across families resolves consistently.
  if (family) {
    const own = pick(family);
    if (own !== undefined) return own;
  }
  for (const fam of families) {
    const v = pick(fam);
    if (v !== undefined) return v;
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
  /**
   * The registry step that supplied this value, when a fallback did (§4 D167).
   *
   * `provenance: "derived"` already says A fallback answered; this says WHICH,
   * and at what grade — the difference between "your plant grid's line rate,
   * converted" and "the engine's max(2·demand, 1000) floor, chosen so capacity
   * never binds". T2 asks for the substitution to be visible AT THE POINT OF
   * DISPLAY, and one dot cannot carry two opposite meanings.
   */
  derivedVia?: DerivedValue;
  /**
   * This cell is EDITABLE and the engine will not read it, because another
   * field outranks it (§4 D167). Today the only case is the plant grid's
   * `capacity_units_per_day` / `utilization_cap_pct` under a product that
   * carries a master `products.production_capacity`.
   *
   * Not a provenance state: the cell's own value still comes from wherever the
   * dot says it does. What is false is the IMPLICATION that typing here
   * changes the run — which is the same defect class as §4 D18, a field shown
   * and consumed by nothing, one step worse because this one is consumed
   * SOMETIMES.
   */
  supersededBy?: { field: string; note: string };
}

/**
 * Human sentence for a shadowed cell. The RULE is the registry's
 * (`policy_bundle_keys[].shadowed_by`); this is the sentence for it.
 */
export function supersededNote(shadowingField: string, label: string): string {
  return (
    `Not applied on this row. ${shadowingField} has a value, and the engine ` +
    `reads the item master before the plant grid — so the run uses that ` +
    `number and this ${label} is stored but ignored. Clear the master value ` +
    `to make this cell decide the capacity again.`
  );
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
  const derivedVia = derivedVal !== undefined ? derivedStepFor(col, row, derived) : undefined;

  /**
   * IS THIS EDITABLE CELL ONE THE ENGINE WILL READ? (§4 D167)
   *
   * Asked of the registry, per row. `shadowedBy` returns the `dataset.column`
   * that outranks this bundle key — `products.production_capacity` for the
   * plant grid's two capacity cells — and the row is shadowed when the master
   * column named there carries a value. The master COLUMN is found through
   * `masterColByField`, which already knows which row field holds the id, so
   * this needs no second convention for resolving `dataset.column` against a
   * grid row (and stays silent on a stage that renders no such column).
   */
  const shadowField = col.master ? undefined : shadowedBy(col.field);
  let supersededBy: ResolvedCell["supersededBy"];
  if (shadowField) {
    const [, shadowCol] = shadowField.split(".");
    const spec = shadowCol ? masterColByField.get(shadowCol) : undefined;
    if (spec && masterValueFor(spec, row, masterRowById) !== undefined) {
      supersededBy = {
        field: shadowField,
        note: supersededNote(spec.label, col.label.toLowerCase()),
      };
    }
  }

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
    derivedVia: derivedFallback ? derivedVia : undefined,
    supersededBy,
  };
}

/**
 * The one sentence a capacity cell owes its reader (T1/T2), or undefined.
 *
 * Assembled from the resolved cell rather than from the column, so the same
 * call answers for the desktop grid's `title`, the mobile stage list and the
 * value-chain popover. Order matters and is the order of the claims: a cell the
 * engine will not read says that FIRST — a correct provenance for a number
 * nothing consumes is still the wrong headline.
 */
export function substitutionNote(cell: ResolvedCell): string | undefined {
  if (cell.supersededBy) return cell.supersededBy.note;
  if (cell.derivedVia) {
    const lead =
      cell.derivedVia.grade === "warn"
        ? "No value for this, so the engine substitutes"
        : "Derived for the run from";
    return `${lead} ${reducerLabel(cell.derivedVia.via)}.`;
  }
  if (cell.placeholderTitle) return cell.placeholderTitle;
  return undefined;
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
export type PrefillSource = "edit" | "data" | "decision";

export function prefillSourceFor(
  row: Record<string, unknown>,
  field: string,
  draft?: unknown,
): PrefillSource | null {
  const imputed = (row.__imputed ?? {}) as Record<string, true>;
  if (imputed[field] === true) return null;
  if (draft !== undefined) return "edit";
  const fromData = (row.__from_data ?? {}) as Record<string, true>;
  if (fromData[field] === true) return "data";
  // THE THIRD SOURCE, RESTORED DELIBERATELY (§4 D23). WP 6.2 slice 3 deleted a
  // dead copy of this rule that had one, and did NOT adopt it, because at the
  // time the routing decisions ALSO sat in `__from_data` and a `__decided`
  // branch would only have made a valueless field newly persistable. D23 took
  // them out of `__from_data` — they were never uploaded — so this branch is
  // now the only thing that keeps blueprint G16 satisfied: the pre-dispatch
  // gate reads the primary supplier from the SAVED bundle, so the prefill has
  // to write it. `useStageRows` sets `__decided` only where a value exists.
  const decided = (row.__decided ?? {}) as Record<string, true>;
  return decided[field] === true ? "decision" : null;
}

export function isPrefillPersistable(
  row: Record<string, unknown>,
  field: string,
  draft?: unknown,
): boolean {
  return prefillSourceFor(row, field, draft) !== null;
}
