/**
 * `material_price` shows the engine's number and refuses an edit — §4 D18.
 *
 * ── WHAT THE DEFECT ACTUALLY WAS ───────────────────────────────────────────
 *
 * §4 D18 records "displayed prominently; consumed nowhere", and that understates
 * it. The cell was SEEDED FROM `inbound_logistics.unit_price` — `useStageRows`
 * calls `resolveField(prov, "material_price", enrich.unit_price, …)` — and that
 * column IS a declared engine requirement and IS what the engine reads
 * (`project_map.py` takes `arc.unit_price` straight off the arc). So:
 *
 *   · the number on screen was correct;
 *   · the cell was editable;
 *   · the edit was stored as a policy override and hashed into `policy_hash`;
 *   · and the engine went on reading the uploaded value.
 *
 * A user correcting a price got no error, no warning and no effect — and because
 * the cell was seeded with the REAL value, they had nothing to compare against.
 * That is not "a field nothing reads". It is a number that is right until you fix
 * it, which is D17's class (a displayed value that misrepresents what the run will
 * use) landing on the economics.
 *
 * ── WHY READ-ONLY IS THE FIX AND NOT A RETREAT ─────────────────────────────
 *
 * The end state is master-backing it on the arc, and that is not a reader change:
 * `ColSpec["master"]` is typed to the three item masters with a single-column
 * `idFrom`, while an arc needs the composite `(supplier_id, material_id)` and a
 * write path that does not exist. The UPLOAD does exist — `inbound_logistics` is
 * landable dataset #1 — so "this is the engine's number, change it in the inbound
 * file" is the honest affordance today. It is also the same answer WP 6.2 gave
 * `customers`: when an engine field has no way in, the way in is the upload, not a
 * grid cell that pretends to be one.
 *
 * These assertions are on the SPEC rather than on a rendered grid, because the
 * spec is what every surface reads — the table, the Parameter Sheet, the mobile
 * sheet and the resolution chains. A test that drove one screen would leave the
 * other three free to disagree.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGE_TABLE_SPEC } from "../columnSpecs";
import { resolveParamMeta } from "../paramMeta";
import type { ColSpec } from "../columnSpecs";

const ROOT = join(__dirname, "..", "..", "..", "..");

function spec(stage: keyof typeof STAGE_TABLE_SPEC, field: string): ColSpec {
  const found = (STAGE_TABLE_SPEC[stage].cols as ColSpec[]).find((c) => c.field === field);
  expect(found, `${stage} has no column "${field}" — the spec moved and this test is stale`).toBeTruthy();
  return found as ColSpec;
}

describe("§4 D18 · the supplier price is shown, not edited", () => {
  const price = () => spec("supplier", "material_price");

  it("the column is read-only", () => {
    expect(
      price().readOnly,
      "an editable `material_price` stores an override the engine never reads. If this " +
        "is being made editable again, the write must reach `inbound_logistics.unit_price` " +
        "— the column the engine actually consumes — not `policy_overrides` (§4 D18).",
    ).toBe(true);
  });

  it("it carries no `defaultWhenMissing`, because that table never spoke for it", () => {
    // The Zod sourcing bundle declares `material_price: z.number().min(0).default(0)`
    // and a parsed bundle always has the key, so `bundleVal` wins before
    // `columnSpecs.defaultWhenMissing` is consulted. A second default table that
    // can only ever speak when it disagrees by accident is the WP 0.1 gap check's
    // second divergence, and this field was one of its cases.
    expect(price().defaultWhenMissing).toBeUndefined();
  });

  it("it is NOT master-backed — that would be a claim about a write path", () => {
    // `resolveParamMeta` reports a master column as "from item master", and the
    // Parameter Sheet renders that. Pointing `master` at a table whose write path
    // does not exist is §4 D89 exactly (`plant.initial_on_hand` named a column
    // `products` does not have), so the absence here is deliberate.
    expect(price().master).toBeUndefined();
  });

  it("the Parameter Sheet names the inbound file as the place to change it", () => {
    const meta = resolveParamMeta(price());
    expect(meta.meaning).toMatch(/inbound/i);
    expect(
      meta.meaning,
      "the meaning must say which column the number IS, or a reader cannot act on " +
        "'read-only' — they are told they cannot edit it and not where it lives",
    ).toMatch(/inbound_logistics\.unit_price/);
  });

  it("the meaning states the imputation divergence rather than hiding it", () => {
    // Where the inbound file supplies no price, `resolveField` imputes an average
    // and the ENGINE does something else — `cheapestInboundCost` takes the
    // cheapest link for the material and floors a missing one at 1.0. So the
    // imputed cell is a number the run will not use, and T1 leaves no third
    // option between "resolves to data" and "says what it is".
    const meaning = resolveParamMeta(price()).meaning;
    expect(meaning).toMatch(/imput/i);
    expect(meaning).toMatch(/cheapest|1\.0/);
  });

  it("the grid's own write path skips it — the claim is enforced, not stated", () => {
    // `StagePolicyTable` filters `col.synthetic || col.readOnly` out of the loop
    // that builds an override patch. If that filter goes, the cell is read-only
    // on screen and writable through a prefill, which is the worse version of the
    // same defect: an override the user never typed.
    const table = readFileSync(
      join(ROOT, "src", "components", "policies", "StagePolicyTable.tsx"),
      "utf8",
    );
    expect(table).toMatch(/col\.synthetic\s*\|\|\s*col\.readOnly/);
  });

  it("`material_cost` is a DIFFERENT column and stays master-backed", () => {
    // §4 D18 offers "map it to `materials.cost`" as a remedy, and taking it would
    // have merged two quantities to make one chain resolve: the material's own
    // cost per unit is already on screen beside this one as `material_cost`, and
    // it is master-backed on the column the engine reads. The two rendering the
    // same unit is not evidence that they are the same number.
    const cost = spec("supplier", "material_cost");
    expect(cost.master).toEqual({ table: "materials", field: "cost", idFrom: "material_id" });
    expect(cost.field).not.toBe(price().field);
  });
});
