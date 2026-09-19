/**
 * A1 — the provenance vocabulary, held against §5.4 — WP 6.3.
 *
 * ── WHY A VOCABULARY NEEDS A GATE ──────────────────────────────────────────
 *
 * §5.4 names ten provenance states and the union carried eight. `contract` was in
 * the `PROVENANCE` record and not in the type — TypeScript said so, and
 * `typecheck-baseline.json` recorded it as debt rather than a defect, so the state
 * that exists to make a substitution VISIBLE (§4 D17) was itself invisible to the
 * type system for a whole phase.
 *
 * That is D101's shape on a vocabulary: the same list authored twice — once as
 * prose in §5.4, once as a union in `policyGridUi.tsx` — with nothing comparing
 * them. This file is the comparison.
 *
 * ── THE ONE DELIBERATE OMISSION ────────────────────────────────────────────
 *
 * `estimated` is in §5.4 and NOT in the union. §14 reserves it for the
 * observations track: a value fitted from recorded history, carrying an n, a
 * window and a fit quality. Nothing produces one today, and a state in the union
 * with no producer is a dot the grid could never draw — a promise, not a
 * vocabulary, which is what `seeded_from_hash` cost when a column nothing filled
 * was shipped as provenance.
 *
 * So the omission is asserted rather than tolerated: the test names it, requires
 * §14 to still reserve it, and requires that nothing has quietly started
 * producing it. The day an estimator lands, this file is what tells the author to
 * add the state.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROVENANCE } from "@/components/policies/policyGridUi";

const ROOT = join(__dirname, "..", "..", "..", "..");
const PLAN = readFileSync(join(ROOT, "docs", "PLAN.md"), "utf8");
const GRID_UI = readFileSync(
  join(ROOT, "src", "components", "policies", "policyGridUi.tsx"),
  "utf8",
);

/** §5.4's own list, parsed from the plan rather than retyped here. */
function vocabularyFromPlan(): string[] {
  // "**A1 vocabulary** after the plan lands:\n`data · master · … · default`."
  const m = /\*\*A1 vocabulary\*\*[^`]*`([^`]+)`/.exec(PLAN);
  expect(m, "§5.4's A1 vocabulary line was not found in PLAN.md").toBeTruthy();
  return m![1]
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The union's members, read off the type declaration. */
function unionMembers(): string[] {
  const start = GRID_UI.indexOf("export type Provenance =");
  expect(start, "the Provenance union was not found").toBeGreaterThan(-1);
  const decl = GRID_UI.slice(start, GRID_UI.indexOf(";", start));
  return [...decl.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/** States §5.4 names that have no producer yet, and why each is allowed. */
const RESERVED: Record<string, RegExp> = {
  // §14's observations track. The reservation is quoted from the plan so a
  // deleted reservation fails here rather than silently licensing the omission.
  estimated: /`estimated` \/ `contract` provenance states/,
};

describe("A1 · the provenance vocabulary (§5.4)", () => {
  const planStates = vocabularyFromPlan();
  const union = unionMembers();

  it("§5.4 still declares a vocabulary to check against", () => {
    // Without this, a renamed heading makes every assertion below vacuous — D57's
    // failure mode, and the reason every derived list in this repository asserts
    // that its source was found.
    expect(planStates.length).toBeGreaterThanOrEqual(10);
    expect(planStates).toContain("data");
    expect(planStates).toContain("default");
  });

  it("the union declares no state §5.4 does not name", () => {
    const extra = union.filter((s) => !planStates.includes(s));
    expect(
      extra,
      "the grid can draw a dot the transparency standard does not define. Either " +
        "add the state to §5.4 with what it means, or stop producing it — a dot " +
        "whose meaning is only in code is a number with no source (T1).",
    ).toEqual([]);
  });

  it("every §5.4 state is in the union, or is RESERVED with its reason", () => {
    const missing = planStates.filter((s) => !union.includes(s));
    for (const s of missing) {
      const reservation = RESERVED[s];
      expect(
        reservation,
        `§5.4 names the provenance state "${s}" and the union does not carry it, ` +
          "and it is not on the reserved list. Either implement it or record the " +
          "reservation — an undeclared gap between the standard and the code is " +
          "exactly what §4 D101 is.",
      ).toBeTruthy();
      expect(
        PLAN,
        `"${s}" is reserved, and the plan no longer says so. A reservation that ` +
          "outlives its own record is an omission with an alibi.",
      ).toMatch(reservation!);
    }
    // And the reserved list may not grow silently either: exactly one state is
    // allowed to be absent today.
    expect(missing).toEqual(["estimated"]);
  });

  it("nothing produces a state the union does not carry", () => {
    // The failure this catches is the one that actually happened: `contract` was
    // returned by the resolver, rendered by the legend, and absent from the type.
    // A producer outside the union is a dot whose meaning nothing defines.
    const produced = new Set(Object.keys(PROVENANCE));
    const undeclared = [...produced].filter((s) => !union.includes(s));
    expect(
      undeclared,
      "`PROVENANCE` gives these states a colour and a title and the union does not " +
        "declare them. That is how `contract` spent a phase as baselined type debt.",
    ).toEqual([]);
  });

  it("every state in the union has a colour and a title, or declares why not", () => {
    for (const s of union) {
      expect(PROVENANCE[s as keyof typeof PROVENANCE], `no PROVENANCE entry for "${s}"`).toBeTruthy();
      const entry = PROVENANCE[s as keyof typeof PROVENANCE];
      expect(entry.title.length, `"${s}" has no title — a dot with no hover text`).toBeGreaterThan(4);
    }
    // `default` is the one state with NO colour, and that is the design: a bundle
    // default draws no dot, because the absence of a dot is what "nothing claimed
    // anything about this" looks like. Asserted so a later edit cannot give it one
    // without meeting this sentence.
    expect(PROVENANCE.default.color).toBeNull();
    const coloured = union.filter((s) => PROVENANCE[s as keyof typeof PROVENANCE].color !== null);
    expect(coloured.length).toBe(union.length - 1);
  });

  it("`contract` is a state about EMPTINESS, and says so", () => {
    // §4 D17: sixty of sixty suppliers had a null capacity and the grid rendered
    // `0` with no dot — the exact inverse of "NULL = ∞", silently, on every row.
    // This state exists so an empty cell can show the schema's declared meaning
    // instead of a made-up number, so its title has to be about empty.
    expect(PROVENANCE.contract.title).toMatch(/empty/i);
    expect(PROVENANCE.contract.color).not.toBeNull();
  });
});
