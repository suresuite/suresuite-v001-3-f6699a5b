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
import { readFileSync } from "node:fs";
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
