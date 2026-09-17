/**
 * WP 6.2 · A `master:` BLOCK IS A CLAIM ABOUT A COLUMN, AND IT WAS NEVER CHECKED.
 *
 * `columnSpecs.ts` may declare that a grid column's value lives in an item-master
 * table: `master: { table: "products", field: "initial_on_hand", idFrom: … }`.
 * Three things downstream believe that claim without verifying it:
 *
 *   · `masterValueFor` reads the named column off the master row,
 *   · `paramMeta.ts::columnEngineStatus` returns `reaches-engine` for ANY column
 *     with a `master:` block — a master column is an engine input by definition,
 *   · the Parameter Sheet renders "reaches engine · from item master".
 *
 * When the column does not exist, none of the three notices. `masterValueFor`
 * returns `undefined` — exactly as it does for a master row that has no value —
 * so the cell falls through the resolver to the policy bundle and shows a number,
 * while the sheet states that number came from the item master and reaches the
 * simulation. That is §4 D89, and it is a T1 failure of the plainest kind: a
 * displayed value whose stated source is not its source.
 *
 * THIS IS A GATE, NOT A RATCHET. The one violation is fixed in the same commit
 * (`plant.initial_on_hand` lost its pointer), so the list is empty on arrival and
 * a gate is affordable — the test that a ratchet exists to avoid. The next copied
 * `master:` block fails here, on the commit that writes it, instead of being
 * found by a chain resolver two phases later.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAGE_TABLE_SPEC } from "../columnSpecs";
import type { ColSpec } from "../columnSpecs";

const ROOT = join(__dirname, "..", "..", "..", "..");
const contract = JSON.parse(
  readFileSync(join(ROOT, "build", "data-contract.generated.json"), "utf8"),
) as { tables: Record<string, { columns?: Array<{ name: string }> }> };

const pointers = Object.entries(STAGE_TABLE_SPEC).flatMap(([stage, spec]) =>
  (spec.cols as ColSpec[])
    .filter((c) => c.master)
    .map((c) => ({ stage, field: c.field, ...c.master! })),
);

describe("WP 6.2 · every `master:` pointer names a column that exists", () => {
  it("there are pointers to check — an empty set would make this gate vacuous", () => {
    expect(pointers.length).toBeGreaterThan(0);
  });

  it("the master TABLE is described by the data contract", () => {
    for (const p of pointers) {
      expect(
        contract.tables[p.table],
        `${p.stage}.${p.field} is master-backed by \`${p.table}\`, which the contract does not describe`,
      ).toBeDefined();
    }
  });

  it("the master COLUMN exists on that table", () => {
    const missing = pointers
      .filter((p) => !contract.tables[p.table]?.columns?.some((c) => c.name === p.field))
      .map((p) => `${p.stage}.${p.field} → ${p.table}.${p.field}`);
    expect(
      missing,
      "these grid columns claim their value comes from an item-master column that " +
        "does not exist. The cell falls through to the policy bundle and shows a " +
        "number the Parameter Sheet attributes to the item master (§4 D89, T1).",
    ).toEqual([]);
  });

  it("the id column the pointer keys from exists on the master table too", () => {
    // `idFrom` names the STAGE ROW's id field, and the master table must carry a
    // column of that name to be joined on. A pointer whose key is wrong fails the
    // same way the column being wrong does — silently, as `undefined`.
    const missing = pointers
      .filter((p) => !contract.tables[p.table]?.columns?.some((c) => c.name === p.idFrom))
      .map((p) => `${p.stage}.${p.field} keyed from ${p.table}.${p.idFrom}`);
    expect(missing, "the join key for this item-master lookup does not exist").toEqual([]);
  });
});
