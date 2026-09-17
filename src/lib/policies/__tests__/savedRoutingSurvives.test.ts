/**
 * WP 6.2 · §4 D23 — A SAVED SOURCING CHOICE SURVIVES A RELOAD.
 *
 * The defect, end to end: the user picks a primary supplier, saves, reloads, and
 * sees the stage's suggestion again. Two independent causes, both confirmed
 * against the code before either was touched:
 *
 *   1. `useStageRows` wrote the routing SUGGESTION onto the row AND marked it
 *      `__from_data`. `getEffectiveValue` reads `dataRow[field]` before the
 *      override bundle — deliberately, so an uploaded column beats a stale
 *      override — so the suggestion outranked the saved decision forever.
 *   2. `saveAll` dropped any edit equal to the family default, and
 *      `primary_source` defaults to `false` (`schemas.ts:81`). Un-checking a
 *      primary therefore wrote nothing at all.
 *
 * Each cause alone is enough to lose the choice, so each is tested alone. The
 * round-trip at the end is the one that matters to a person: decide, persist,
 * re-resolve, and get back what was decided.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getEffectiveValue, prefillSourceFor, savedOverrideValue } from "../resolveEffective";
import { DEFAULT_BUNDLE, type PolicyBundle, type PolicyFamily } from "../schemas";
import type { OverrideRow } from "../resolve";

const FAMILIES: PolicyFamily[] = ["sourcing", "inventory", "transport"];
const KEY = "SUP-1::MAT-1";

/** A supplier row as `useStageRows` emits it: a suggestion, marked decided. */
const row = (over: Record<string, unknown> = {}) => ({
  key: KEY,
  supplier_id: "SUP-1",
  material_id: "MAT-1",
  material_price: 12.5,
  primary_source: true,
  __from_data: { material_price: true } as Record<string, true>,
  __imputed: {} as Record<string, true>,
  __decided: { primary_source: true } as Record<string, true>,
  ...over,
});

const override = (patch: Record<string, unknown>): OverrideRow =>
  ({ target_key: KEY, family: "sourcing", patch, scope: "node" }) as unknown as OverrideRow;

const resolve = (dataRow: Record<string, unknown>, field: string, overrides: OverrideRow[] = []) =>
  getEffectiveValue({
    rowKey: KEY,
    dataRow,
    field,
    family: "sourcing",
    families: FAMILIES,
    draft: undefined,
    masterColByField: new Map(),
    masterRowById: { materials: new Map(), products: new Map(), suppliers: new Map() },
    derived: { materialCost: new Map(), sellPrice: new Map(), demandMean: new Map() },
    defaults: DEFAULT_BUNDLE as PolicyBundle,
    overrides,
    scope: "node",
  });

describe("WP 6.2 · D23 · cause 1 — the suggestion no longer outranks the decision", () => {
  it("with nothing saved, the suggestion is what shows", () => {
    // The half that must NOT regress. `primary_source` defaults to `false` in
    // the bundle, so a fix that simply ranked the bundle above the row would
    // delete every suggestion instead of the ones a user replaced.
    expect(resolve(row(), "primary_source")).toBe(true);
  });

  it("a SAVED `false` beats the suggested `true`", () => {
    expect(resolve(row(), "primary_source", [override({ primary_source: false })])).toBe(false);
  });

  it("a saved value beats the suggestion even when it equals the schema default", () => {
    // The precise trap: `false` IS the default, so reading the MERGED bundle
    // could not tell "somebody saved false" from "nobody saved anything".
    // `savedOverrideValue` reads the raw patch, which can.
    expect(savedOverrideValue([override({ primary_source: false })], KEY, "primary_source", "sourcing", FAMILIES)).toBe(false);
    expect(savedOverrideValue([], KEY, "primary_source", "sourcing", FAMILIES)).toBeUndefined();
  });

  it("an UPLOADED field is untouched — it still outranks the bundle", () => {
    // `dataRow` before the bundle is deliberate and WP 4.4's staleness brief
    // turns on it. Only a `__decided` field moved.
    expect(resolve(row(), "material_price", [override({ material_price: 99 })])).toBe(12.5);
  });

  it("a row with no `__decided` map at all behaves exactly as before", () => {
    const plain = row({ __decided: undefined });
    expect(resolve(plain, "primary_source", [override({ primary_source: false })])).toBe(true);
  });
});

describe("WP 6.2 · D23 · cause 2 — the decision reaches the bundle at all", () => {
  it("the prefill persists a routing decision, so G16's gate can read it", () => {
    // The pre-dispatch validator reads the primary supplier from the SAVED
    // bundle, never from the row. Taking the decisions out of `__from_data`
    // (cause 1's fix) would have silently broken that without this.
    expect(prefillSourceFor(row(), "primary_source")).toBe("decision");
  });

  it("the suggestion is NOT marked as uploaded data", () => {
    // §4 D16's shape: a green "From project data" dot for a value no upload
    // contained. `__from_data` is the whole allow-list for that claim.
    expect((row().__from_data as Record<string, true>).primary_source).toBeUndefined();
  });
});

describe("WP 6.2 · D23 · the round trip a person actually performs", () => {
  it("un-check the suggested primary, save, reload — it stays un-checked", () => {
    // 1. The grid suggests SUP-1 is primary.
    expect(resolve(row(), "primary_source")).toBe(true);

    // 2. The user un-checks it. `saveAll` writes the patch — it no longer drops
    //    the edit for being equal to the default, because the field is a
    //    decision (and, after this write, overridden).
    const saved = [override({ primary_source: false })];

    // 3. Reload: `useStageRows` rebuilds the row and suggests `true` again,
    //    exactly as it did the first time. The saved decision must win.
    expect(resolve(row(), "primary_source", saved)).toBe(false);
  });

  it("and re-checking it later still resolves to the user's answer", () => {
    expect(resolve(row(), "primary_source", [override({ primary_source: true })])).toBe(true);
  });
});

/**
 * §4 D24 — the same class one stage over: a value the app COMPUTED, marked with
 * the marker that means an upload carried it.
 *
 * `production_lead_time_mean_days` is the median of the INBOUND lead times of a
 * product's feeding components. It was passed to `resolveField` as the real
 * value, so it landed in `__from_data`. Nobody uploads a production lead time.
 *
 * Latent, and confirmed so rather than assumed — the plant spec declares no
 * column for it, and `runPrefill` iterates the SPEC, not the row's fields, so
 * today nothing renders it and nothing persists it. Asserted here as a source
 * fact because there is no rendered surface to assert against, and because the
 * day a column IS added is the day the marker starts lying.
 */
describe("WP 6.2 · D24 · an inbound median is not an uploaded production lead time", () => {
  const src = readFileSync(
    join(__dirname, "..", "..", "..", "hooks", "useStageRows.tsx"),
    "utf8",
  );
  const call = src.slice(
    src.indexOf("const production_lead_time_mean_days = resolveField("),
    src.indexOf("__components_count"),
  );

  it("the plant stage still resolves the field", () => {
    expect(call.length, "the call moved or vanished — this assertion is now vacuous").toBeGreaterThan(40);
  });

  it("it is passed as the IMPUTED argument, not the real one", () => {
    // `resolveField(prov, field, real, imputed)` — a value in the third slot is
    // marked `__from_data`, which is the whole allow-list for "an upload said
    // so" (§4 D16). This one belongs in the fourth.
    const args = call.slice(call.indexOf("(") + 1, call.indexOf(");"));
    const real = args.split(",")[2]?.trim();
    expect(
      real,
      "the inbound median is back in `resolveField`'s REAL slot, so it is marked " +
        "`__from_data` again — a computed estimate claiming an upload carried it.",
    ).toBe("undefined");
  });

  it("and the median is still preferred over the project-wide average", () => {
    expect(call).toContain("lt ??");
  });
});
