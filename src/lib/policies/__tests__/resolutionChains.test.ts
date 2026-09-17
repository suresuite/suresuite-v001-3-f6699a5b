/**
 * WP 6.1 — EVERY GRID FIELD'S CHAIN, AND THE LIST OF THE ONES THAT BREAK.
 *
 * §13: "For every grid field: CSV column → DB column → RPC → hook →
 * substitution → engine field → unit at each hop. Pin with parity fixtures in
 * `grading.ts` style. **A chain you cannot write down is a bug** — list those
 * rather than inventing prose; the list feeds WP 6.2."
 *
 * The chains are DERIVED (`resolutionChains.ts`) rather than written down,
 * because ~120 hand-written chains are true on the day they are typed. What is
 * pinned here is the part that rots: the resolver's ORDER, the completeness of
 * each chain, and the exception list.
 *
 * ── THE EXCEPTION LIST IS A RATCHET, NOT A GATE ───────────────────────────
 *
 * Nine chains break today and every one is owned by WP 6.2. A gate would be red
 * on arrival and unlandable — the same reasoning that made WP 4.1's writer list
 * a ratchet. The list may SHRINK and may not GROW, and a name that stops
 * breaking must leave it, so it cannot record debt that has already been paid.
 *
 * ── THREE OVER-CLAIMS THIS SUITE CAUGHT IN ITSELF ─────────────────────────
 *
 * Recorded because each one would have shipped a confident list of false
 * findings, which is the failure WP 5.1's D82/D83 are and the thing this plan
 * keeps relearning:
 *
 *   28 → 11  looking only at the registry's `data_requirements` for the engine
 *            hop. A policy PARAMETER is not a data requirement, and some fields
 *            reach the engine only through `project_map.py`. Three doors, not
 *            one.
 *   11 →  9  `__inv_params` is `synthetic: true` — a vector CELL, not a field.
 *            Asking which engine field it reaches is a question about nothing.
 *    7 →  0  comparing the engine's `table.column` against the grid's `field`
 *            id. They differ on purpose for a master-backed column:
 *            `materials.cost` is rendered as `material_cost`, and both it and
 *            `materials.moq` were reported as invisible while on screen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RESOLUTION_ORDER,
  RESOLUTION_ORDER_SOURCE,
  allChains,
  engineFieldsWithNoColumn,
  engineFieldsWithNoEntrySurface,
} from "../resolutionChains";

const ROOT = join(__dirname, "..", "..", "..", "..");
const contract = JSON.parse(
  readFileSync(join(ROOT, "build", "data-contract.generated.json"), "utf8"),
);
const registry = JSON.parse(
  readFileSync(join(ROOT, "supabase", "functions", "_shared", "registry.generated.json"), "utf8"),
);
const projectMap = readFileSync(join(ROOT, "scsim", "scsim", "io", "project_map.py"), "utf8");
const chains = allChains(contract, registry, projectMap);

describe("WP 6.1 · the chains resolve", () => {
  it("there are chains at all — an empty set is a green suite that checks nothing", () => {
    expect(chains.length).toBeGreaterThanOrEqual(30);
  });

  it("every UNBROKEN chain names where the value is stored and how it is written", () => {
    // The hops that exist for every field regardless of stage or family. A
    // chain missing one cannot be followed from the screen to a row — which is
    // exactly what a BREAK is, so broken chains are excluded here and asserted
    // in their own block below. `plant.initial_on_hand` is the live example: its
    // master column does not exist, so there is no storage hop to name.
    for (const c of chains.filter((x) => x.breaks.length === 0)) {
      const kinds = new Set(c.hops.map((h) => h.kind));
      expect(kinds.has("hook"), `${c.stage}.${c.field} has no rendering hop`).toBe(true);
      expect(kinds.has("db"), `${c.stage}.${c.field} has no storage hop`).toBe(true);
      expect(kinds.has("rpc"), `${c.stage}.${c.field} has no write path`).toBe(true);
    }
  });

  it("a declared default is always recorded as a substitution", () => {
    // T2: a value the product shows that no upload contained is visible at the
    // point of display. If `defaultWhenMissing` were silently omitted from the
    // chain, the chain would claim the cell shows data when it shows a constant.
    for (const c of chains) {
      const hasDefault = c.hops.some((h) => h.kind === "substitution");
      const declared = c.hops.some((h) => h.detail.includes("defaultWhenMissing"));
      expect(hasDefault).toBe(declared);
    }
  });
});

describe("WP 6.1 · the resolver's order is transcribed, and still true", () => {
  const src = readFileSync(join(ROOT, RESOLUTION_ORDER_SOURCE), "utf8");

  it("`getEffectiveValue`'s branches appear in the order this module claims", () => {
    // ORDER IS THE WHOLE MEANING: the first branch that matches wins, so a
    // value reachable two ways is decided by this sequence and nowhere else.
    // `resolutionChains.ts` transcribes it rather than executing it (that would
    // be a second implementation of the resolver — I1 broken to document I1), so
    // the transcription has to be checkable, and this is the check.
    const body = src.slice(src.indexOf("export function getEffectiveValue"));
    const markers = [
      "if (draft !== undefined) return draft",
      "masterValueFor",
      "derivedValueFor",
      "if (dataRow[field] !== undefined",
      "effectivePolicy(defaults, overrides, scope, rowKey)",
      "for (const fam of families)",
    ];
    let at = -1;
    for (const m of markers) {
      const next = body.indexOf(m, at + 1);
      expect(next, `\`${m}\` is missing from getEffectiveValue, or has moved earlier`).toBeGreaterThan(at);
      at = next;
    }
  });

  it("the transcription lists a step for each of those branches", () => {
    expect(RESOLUTION_ORDER.map((r) => r.step)).toEqual([
      "draft", "master", "derived", "dataRow", "bundle.family", "bundle.families", "undefined",
    ]);
  });

  it("`dataRow` is BEFORE the bundle, which is the half that surprises people", () => {
    // WP 4.4's brief turns on this: a re-upload refreshes a field that lives ON
    // THE ROW and does NOT refresh one that lives only in the bundle. That is
    // why `seeded_from_hash` exists, and why a stale seeded override is a
    // simulation-correctness problem rather than a display one.
    const steps = RESOLUTION_ORDER.map((r) => r.step);
    expect(steps.indexOf("dataRow")).toBeLessThan(steps.indexOf("bundle.family"));
  });
});

describe("WP 6.1 · the chains that cannot be written down", () => {
  /**
   * Known, computed, and owned by WP 6.2. Shrinking this list is the work.
   *
   * Seven are the class the WP 0.1 gap check named — "stored, versioned and
   * hashed into `policy_hash` but rendered by no column and read by no engine
   * mapping", pointing the other way: rendered, editable, hashed, and read by
   * nothing. `material_price` is §4 D18 itself.
   *
   * `plant.initial_on_hand` is different and NEW (§4 D89): it is master-backed
   * by `products.initial_on_hand`, and `products` has no such column —
   * `materials` does, and the supplier stage uses it correctly two lines away.
   */
  const KNOWN_BREAKS = [
    "customer.primary_source",
    "customer.sourcing_firm",
    "plant.initial_on_hand",
    "plant.reorder_point",
    "plant.review_period_days",
    "supplier.material_price",
    "supplier.primary_source",
    "supplier.reorder_point",
    "supplier.review_period_days",
  ];

  const broken = () => chains.filter((c) => c.breaks.length).map((c) => `${c.stage}.${c.field}`).sort();

  it("no NEW chain may break", () => {
    const added = broken().filter((k) => !KNOWN_BREAKS.includes(k));
    expect(
      added,
      "these grid fields have no followable chain. A field that is editable, " +
        "stored and hashed into `policy_hash` while reaching no engine field is " +
        "the shape §4 D18 is; a master-backed column naming a column that does " +
        "not exist is worse, because the cell silently falls through to the bundle.",
    ).toEqual([]);
  });

  it("the list shrinks honestly — a chain that now resolves must leave it", () => {
    const stale = KNOWN_BREAKS.filter((k) => !broken().includes(k));
    expect(stale, "no longer broken — remove from KNOWN_BREAKS").toEqual([]);
  });

  it("every break says WHY, in a sentence a person can act on", () => {
    for (const c of chains.filter((x) => x.breaks.length)) {
      for (const b of c.breaks) expect(b.length, `${c.stage}.${c.field}`).toBeGreaterThan(40);
    }
  });
});

describe("WP 6.1 · G4 · every engine input has a data-entry surface", () => {
  it("no engine-read field is unreachable by both the grid and every upload", () => {
    // Blueprint gap G4 — "no data-entry surface for the economics" — stated as a
    // check. This is a GATE and not a ratchet because it is EMPTY today: every
    // field the engine reads is either a grid column or a CSV header some
    // upload supplies. A new engine requirement with neither fails here, on the
    // commit that adds it.
    expect(
      engineFieldsWithNoEntrySurface(registry, contract),
      "the engine reads these and nobody can set them — not in the policy grid, " +
        "not through any upload. The fallback decides them permanently.",
    ).toEqual([]);
  });

  it("the fields the grid does not render are uploaded ones, and that is expected", () => {
    // Informational, and deliberately NOT a failure: the policy grid is not
    // where anybody edits a logistics volume. Asserting the shape keeps the
    // distinction from being quietly lost — if something that is NOT an
    // uploaded column appears here, the gate above is what catches it.
    const notInGrid = engineFieldsWithNoColumn(registry);
    for (const f of notInGrid) {
      const [table] = f.split(".");
      expect(
        contract.tables[table],
        `${f} is read by the engine and its table is not even in the contract`,
      ).toBeDefined();
    }
  });
});
