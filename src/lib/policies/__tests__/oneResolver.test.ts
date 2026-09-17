/**
 * WP 6.2 · THE PROVENANCE LADDER EXISTS ONCE, AND STAYS THAT WAY.
 *
 * `StagePolicyTable.tsx` (desktop grid) and `MobileStagePolicyList.tsx` (the
 * mobile list) both have to answer, per cell, "what value is this and where did
 * it come from". Until this package the desktop renderer carried a VERBATIM copy
 * of `resolveEffective.ts::resolveCell` — `masterSet`, `derivedVal`,
 * `liveDefault`, the whole `edited → imputed → fromData → derivedFallback →
 * fromOverride → suggested → default` ladder — and each copy carried a comment
 * telling the next reader to change both. It had been that way since WP 0.1.
 *
 * WHY A GATE AND NOT A NOTE. The plan already ran this experiment. §4 D26: two
 * implementations of the D1 prefill rule, `isPrefillPersistable` and
 * `prefillSourceFor`, both imported, both unit-tested, one of them never called.
 * Both suites stayed green while only one function ran, so the tests were
 * evidence of nothing and the next edit to "the rule" had even odds of landing on
 * the dead copy. A comment did not prevent that; nothing was watching.
 *
 * WHAT THIS ASSERTS. Not "the file is short" and not a token count — either would
 * fail on an innocent edit and teach people to edit the test. It asserts the two
 * renderers OBTAIN their provenance from the shared resolver, and that neither
 * rebuilds the ladder inline. A renderer that needs something `ResolvedCell` does
 * not expose should add a field to `ResolvedCell`, which is how the desktop grid
 * got `cellValue` / `liveDefault` / `edited` — not re-derive it locally, which is
 * how the copy started.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const RENDERERS = [
  "src/components/policies/StagePolicyTable.tsx",
  "src/components/policies/MobileStagePolicyList.tsx",
];
const src = Object.fromEntries(
  RENDERERS.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]),
);

/** The rungs of the ladder, each as it is written in `resolveCell`. */
const LADDER = [
  /const\s+derivedFallback\s*=/,
  /const\s+fromOverride\s*=/,
  /const\s+suggested\s*=/,
  /const\s+(prov|provenance)\s*:\s*Provenance\s*=/,
];

describe("WP 6.2 · one resolver", () => {
  it("both renderers call the shared `resolveCell`", () => {
    for (const [file, text] of Object.entries(src)) {
      expect(
        /\bresolveCell\s*\(/.test(text),
        `${file} does not call resolveCell — it is resolving cells some other way`,
      ).toBe(true);
    }
  });

  it("neither renderer rebuilds the provenance ladder inline", () => {
    for (const [file, text] of Object.entries(src)) {
      const rebuilt = LADDER.filter((re) => re.test(text)).map((re) => String(re));
      expect(
        rebuilt,
        `${file} declares its own provenance ladder. The desktop grid carried a ` +
          `verbatim copy of resolveCell for six phases and both copies said "change ` +
          `both" — §4 D26 is what that costs when one copy goes dead. Add a field to ` +
          `\`ResolvedCell\` instead of re-deriving it here.`,
      ).toEqual([]);
    }
  });

  it("the ladder is present in the one place it belongs", () => {
    // Guards the assertion above from passing because the rungs were renamed.
    const resolver = readFileSync(join(ROOT, "src/lib/policies/resolveEffective.ts"), "utf8");
    for (const re of LADDER) {
      expect(re.test(resolver), `${re} is gone from resolveEffective.ts — the gate above is now vacuous`).toBe(true);
    }
  });
});

/**
 * THE SAME DEFECT, ONE FLOOR DOWN (§4 D26, D93).
 *
 * "May the prefill persist this row×field?" also existed twice — this rule in
 * `resolveEffective.ts`, and `prefillSelect.ts`'s `prefillSourceFor` /
 * `isPrefillable`, imported by `StagePolicyTable` and never called. They had
 * already drifted on a case each was tested for: an edit of an imputed average is
 * persisted by one and refused by the other, and `policyPrefill.test.ts` asserted
 * the answer of the copy that never ran.
 *
 * The scan is over `src/lib/policies` rather than the whole tree because that is
 * where a policy rule belongs; a copy smuggled into a component is caught by the
 * renderer gate above, which requires the resolver to be CALLED.
 */
describe("WP 6.2 · one prefill rule", () => {
  const DIR = join(ROOT, "src/lib/policies");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));

  it("exactly one module defines the prefill predicate", () => {
    const decl = /export function (prefillSourceFor|isPrefillPersistable|isPrefillable)\b/g;
    const owners = files.filter((f) => decl.test(readFileSync(join(DIR, f), "utf8")));
    expect(
      owners,
      "the prefill rule is defined in more than one module. That is exactly how " +
        "§4 D26 happened: two implementations, both unit-tested, one never called, " +
        "and they disagreed on whether an edit of an imputed average is persisted.",
    ).toEqual(["resolveEffective.ts"]);
  });

  it("and the rule it defines still checks `__imputed` BEFORE the draft", () => {
    // The order IS the behaviour, and it is the exact point the two copies
    // disagreed on. A refactor that hoists the draft test above the imputed test
    // silently adopts the dead copy's answer.
    const src = readFileSync(join(DIR, "resolveEffective.ts"), "utf8");
    const body = src.slice(src.indexOf("export function prefillSourceFor"));
    const imputed = body.indexOf("__imputed");
    const draft = body.indexOf("draft !== undefined");
    expect(imputed).toBeGreaterThan(-1);
    expect(draft).toBeGreaterThan(-1);
    expect(
      imputed < draft,
      "`prefillSourceFor` now tests the draft before `__imputed`, so the prefill " +
        "freezes an edited estimate — the behaviour of the copy deleted in WP 6.2.",
    ).toBe(true);
  });
});
