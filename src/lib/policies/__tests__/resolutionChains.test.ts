/**
 * WP 6.1 — EVERY GRID FIELD'S CHAIN, AND THE LIST OF THE ONES THAT BREAK.
 * WP 6.2 — …AND THE SCAN THAT PRODUCED IT WAS WRONG IN BOTH DIRECTIONS (§4 D91).
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
 * ── FIVE OVER-CLAIMS THIS SUITE CAUGHT IN ITSELF ──────────────────────────
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
 *    9 → 11  (WP 6.2) door 3 read `project_map.py` ALONE and accepted any
 *            QUOTED occurrence. Too narrow — the legacy engine and the product
 *            were invisible, so six breaks said "read by nothing" about fields
 *            that are read. Too loose — `order_up_to` passed on the text of the
 *            warning that says it is dropped.
 *
 * Every one of the five is the same failure: a scan whose result was believed
 * because it was produced by code. The count is the cheapest thing to check and
 * it caught all five.
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

/**
 * THE SOURCES THE CLASSIFIER READS. WP 6.1 passed `project_map.py` alone, and
 * that single omission is §4 D91: four of its nine breaks said "read by nothing"
 * about fields the legacy engine reads, and one field that IS dead passed as
 * live. A scan is only as honest as the tree it is pointed at.
 */
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const legacyEngine = Object.fromEntries(
  ["engine.py", "policies.py", "datamap.py", "worker.py", "scsim_bridge.py"].map((f) => [
    `sim-worker/sim_worker/${f}`,
    read("sim-worker", "sim_worker", f),
  ]),
);
const appSrc = Object.fromEntries(
  [
    ["src/hooks/useStageRows.tsx", ["src", "hooks", "useStageRows.tsx"]],
    ["src/components/policies/StagePolicyTable.tsx", ["src", "components", "policies", "StagePolicyTable.tsx"]],
    ["src/lib/policies/resolveEffective.ts", ["src", "lib", "policies", "resolveEffective.ts"]],
  ].map(([label, parts]) => [label as string, read(...(parts as string[]))]),
);
const chains = allChains(contract, registry, {
  projectMap: read("scsim", "scsim", "io", "project_map.py"),
  legacyEngine,
  appSrc,
});

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
      "if (hasValue && !isSuggestion) return dataRow[field]",
      // §4 D23 — the rung that lets a SAVED routing choice outrank the stage's
      // own suggestion. It reads the raw patches, not `effectivePolicy`, so it
      // must appear BEFORE the bundle lookup or the schema default wins and
      // every suggestion disappears instead of only the replaced ones.
      "savedOverrideValue(overrides, rowKey, field, family, families)",
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
      "draft", "master", "derived", "dataRow",
      "savedOverride", "suggestion",
      "bundle.family", "bundle.families", "undefined",
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
   * ── IT GREW FROM NINE TO ELEVEN, AND THAT IS THE CORRECTION, NOT A REGRESSION
   *
   * A ratchet may shrink and may not grow, and this one grew. No code got worse:
   * WP 6.1's scan was wrong in BOTH directions and WP 6.2 re-derived it (§4 D91).
   * The rule the growth would protect — "no NEW chain may break" — is about a
   * commit that breaks a chain, and these two were broken before the scan could
   * see them. Recording that here rather than quietly re-basing the list is the
   * same move `dataPlaneAudit.test.ts`'s writer ratchet made when ITS scan
   * widened (§4 D71: "Corrected figures … 31 writers, 15 attributing, 16 not").
   *
   *   too LOOSE   `order_up_to` passed door 3 on a `MappingWarning` whose text
   *               says the engine replaces it with coverage-κ. A mention is not
   *               a read; the scan accepted the string that says the field is
   *               dropped as proof it is consumed. Both stages join the list.
   *   too NARROW  door 3 read `project_map.py` ALONE, so four fields were
   *               reported "read by nothing" while the legacy engine reads them,
   *               and two routing hints were reported the same way while the
   *               PRODUCT reads them. Every one of the nine still breaks — what
   *               changed is the sentence, and every sentence now names a
   *               different remedy.
   *
   * THE ELEVEN, BY SHAPE (`classifyBreak`):
   *
   *   unread       WAS supplier.material_price — §4 D18 itself, and the ONLY one
   *                where "read by nothing" was literally true. **GONE IN WP 6.2,
   *                and the fix was not to wire it.** The cell was seeded from
   *                `inbound_logistics.unit_price`, which IS a declared engine
   *                requirement and IS what the engine reads, so the number was
   *                right and only the EDIT went nowhere — stored as an override,
   *                hashed into `policy_hash`, consulted by nothing. It is
   *                `readOnly` now, which says "this is the engine's number, change
   *                it in the inbound file", and the chain stops breaking because
   *                a read-only column claims no write path. Master-backing it on
   *                the arc is the end state and needs a write path that does not
   *                exist (`master` is typed to the three item masters with a
   *                single-column `idFrom`).
   *   overridden   plant/supplier.reorder_point — declared in the legacy
   *                `InventoryPolicy` schema and consulted by neither engine:
   *                `engine.py:320` computes `RP = avg_lt · avg_d + ss` itself.
   *                The grid accepts a number that changes no run.
   *   legacy-only  plant/supplier.{order_up_to, review_period_days} — read at
   *                `engine.py:332,323` and by no scsim mapping. §3 freezes that
   *                engine, so these have no route to the strategic one.
   *   app-routing  customer.{primary_source, sourcing_firm},
   *                supplier.primary_source — `project_map.py:826` excludes them
   *                deliberately ("firm-routing hints, never engine params") and
   *                the product reads them. Correct as built; what is missing is
   *                a declaration, so a reader can tell them from a dead field.
   *   no-target    plant.initial_on_hand — §4 D89. STILL HERE ON PURPOSE. This
   *                commit removed the `master:` pointer at
   *                `products.initial_on_hand` (no such column), which fixes the
   *                DISPLAY — the Parameter Sheet no longer says "reaches engine ·
   *                from item master" — and leaves the field bundle-backed and
   *                read by nothing. Fixing the lie is not wiring the field, so
   *                the name stays and `classifyBreak` now reports it under
   *                whichever shape it really is.
   */
  const KNOWN_BREAKS = [
    "customer.primary_source",
    "customer.sourcing_firm",
    "plant.initial_on_hand",
    "plant.order_up_to",
    "plant.reorder_point",
    "plant.review_period_days",
    "supplier.order_up_to",
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

describe("§4 D90 · door 3 is a DECLARATION, not a scan", () => {
  // WP 6.1 found three doors to the engine and said out loud that the third was
  // not a contract: a `.get("<field>")` in `project_map.py` was the only evidence
  // nine grid fields reached the engine at all. §4 D90 deferred the fix on "it
  // needs a session that can run Python", the same premise D94 and D106 were
  // deferred on and which WP 6.2 found false.
  //
  // `POLICY_BUNDLE_KEYS` declares each one now, and these assertions are what stop
  // it becoming a second copy of the mapping rather than the declaration of it.
  const doorDetail = (stage: string, field: string) => {
    const c = chains.find((x) => x.stage === stage && x.field === field);
    expect(c, `no chain for ${stage}.${field}`).toBeTruthy();
    return (c!.hops.find((h) => h.kind === "engine")?.detail ?? "");
  };

  it("no chain reaches the engine on a Python dict read alone", () => {
    // The scan is deliberately still in `engineDoorFor`, AFTER the declaration
    // lookup, so a key nobody declared is reported rather than silently accepted.
    // It must be unreachable: if this fails, `POLICY_BUNDLE_KEYS` has a hole and
    // the bidirectional parity test in scsim did not catch it.
    const scanned = chains
      .filter((c) => c.hops.some((h) => h.kind === "engine" && /only evidence it reaches the engine/.test(h.detail)))
      .map((c) => `${c.stage}.${c.field}`);
    expect(
      scanned,
      "these fields reach the engine with nothing declaring them — door 3 has " +
        "reopened. Declare them in `POLICY_BUNDLE_KEYS` (scsim/scsim/io/project_map.py) " +
        "and regenerate the registry snapshot (§4 D90).",
    ).toEqual([]);
  });

  it("the ten declared keys carry their target and their transform", () => {
    // TEN KEYS, TWELVE CHAINS: `type` and `safety_stock_days` are rendered by
    // both the supplier and the plant stage, which is why the chain count and the
    // key count differ and why D90's "nine" was never wrong.
    //
    // `utilization_cap_pct` is the tenth (WP 9.3 / §4 D167). It was on the
    // parity test's `not_rendered` list — the list of bundle keys that are NOT
    // grid cells — while the arithmetic it performs is half of what the plant
    // stage exists to show: the engine builds a product's weekly capacity as
    // units/day × 7 × utilization, and the grid rendered the first factor only.
    const byDeclaration = chains.filter((c) =>
      /declared policy-bundle key/.test(c.hops.find((h) => h.kind === "engine")?.detail ?? ""));
    expect(byDeclaration.length).toBe(12);
    expect(new Set(byDeclaration.map((c) => c.field)).size).toBe(10);
    for (const c of byDeclaration) {
      const detail = c.hops.find((h) => h.kind === "engine")!.detail;
      // The TARGET is what makes the chain followable; the TRANSFORM is what makes
      // it true (§5 T1 — a number and what happened to it on the way).
      expect(detail, `${c.stage}.${c.field}`).toMatch(/→ \S+/);
      expect(detail, `${c.stage}.${c.field}`).toMatch(/Transform: \S+/);
    }
  });

  it("the keys that land on an ENTITY field say so", () => {
    // `capacity_units_per_day` feeds `Product.production_capacity`, not a policy
    // parameter — which is why door 2 could never have declared it and why adding
    // a Params field would have been the wrong fix.
    const detail = doorDetail("plant", "capacity_units_per_day");
    expect(detail).toMatch(/Product\.production_capacity/);
    expect(detail).toMatch(/ENTITY field, not a policy parameter/);
    // And it says the master shadows it, which is the part a user needs: the cell
    // can be filled and still not be what the run uses.
    expect(detail).toMatch(/shadows/i);
  });

  it("a conditional key says WHEN it is read", () => {
    // Three of the nine are read only under another key's value. A chain that
    // claimed the cell always reaches the engine would be wrong in the direction
    // §4 D18 is — a control whose effect depends on a setting elsewhere.
    expect(doorDetail("plant", "fg_safety_stock_days")).toMatch(/only when/i);
    expect(doorDetail("plant", "service_level_target")).toMatch(/only when/i);
    expect(doorDetail("supplier", "safety_stock_days")).toMatch(/Only when/i);
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
