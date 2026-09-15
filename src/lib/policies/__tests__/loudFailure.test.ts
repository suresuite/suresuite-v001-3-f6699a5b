import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * D3 / D4 / D25 — a failed read must be LOUD.
 *
 * WP 0.2 closed the third Phase 0 Critical: `product_code_map` and `risk_data`
 * were read, their errors discarded, and the result rendered as though the data
 * had simply said nothing. An empty risk map reads as "every node is Unknown";
 * an empty product mapping reads as "nothing joins". Both are answers the user
 * has no reason to doubt, and both are wrong.
 *
 * The WP's other two exit checks became unit tests (`laneVolumes.test.ts`).
 * This one did not — it was recorded in §16 as passing on a reading of the
 * code, with no gate under it. The Phase 0-1 boundary review added this file,
 * because a Critical whose fix nothing pins is a Critical that comes back.
 *
 * These are source-level assertions, following `unitTableParity.test.ts`: the
 * behaviour lives in an edge function and two large page components, and this
 * repo has no DOM test tooling (no jsdom, no testing-library). A source
 * assertion cannot prove the notice paints. It can prove the error is captured,
 * routed to state, and rendered — i.e. that no one has quietly restored the
 * swallow, which is the regression this guards against.
 */

const root = resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const ETL = "supabase/functions/combine-project/index.ts";
const PAGES = ["src/pages/ProductLevelNetwork.tsx", "src/pages/FirmLevelNetwork.tsx"];

describe("D3 — product_code_map fails loudly", () => {
  it("captures the error rather than destructuring only { data }", () => {
    const src = read(ETL);
    const idx = src.indexOf(".from('product_code_map')");
    expect(idx, "the product_code_map read must still exist").toBeGreaterThan(-1);
    // Same scan-back-to-this-read's-own-binding rule as the D25 block below.
    const open = src.slice(0, idx).lastIndexOf("const {");
    const pattern = src.slice(open, src.indexOf("}", open) + 1);
    expect(
      /\berror\s*:/.test(pattern),
      `the read must destructure \`error\`, not just \`data\` (D3) — got ${pattern}`,
    ).toBe(true);
  });

  it("logs the failure and rides it back to the caller as a warning", () => {
    const src = read(ETL);
    expect(src).toMatch(/if\s*\(\s*productCodeMapError\s*\)/);
    expect(src, "the failure must be logged at error level, not swallowed").toMatch(
      /productCodeMapError\s*\)\s*\{[\s\S]{0,400}console\.error/,
    );
    expect(src, "and must reach the response as a warning (§5 T2)").toMatch(
      /productCodeMapError\s*\)\s*\{[\s\S]{0,900}warnings\.push/,
    );
  });
});

describe("D25 — the ETL's own core reads fail loudly too", () => {
  // The same swallow as D3, on the lanes the graph is actually built from.
  // A half-empty graph that reports success is the worst outcome in the file.
  const CORE = ["outbound_logistics", "inbound_logistics", "bom_single_level", "bom_multi_level"];

  it.each(CORE)("%s is read with its error checked", (table) => {
    const src = read(ETL);
    const idx = src.indexOf(`.from('${table}')`);
    expect(idx, `${table} must still be read`).toBeGreaterThan(-1);
    // Scan back only as far as THIS read's own destructuring pattern. A fixed
    // window is wrong here: these reads sit next to each other, so a window
    // wide enough to hold one read's `const { … }` also holds its neighbour's
    // error binding and the assertion passes on the wrong statement.
    const before = src.slice(0, idx);
    const open = before.lastIndexOf("const {");
    expect(open, `${table} must be read into a destructuring binding`).toBeGreaterThan(-1);
    const pattern = src.slice(open, src.indexOf("}", open) + 1);
    expect(
      /\berror\s*:/.test(pattern),
      `${table}'s own read must destructure \`error\`, not just \`data\` (D25) — got ${pattern}`,
    ).toBe(true);
  });
});

describe("D4 — risk_data is missing on screen, not silently", () => {
  it.each(PAGES)("%s captures the risk_data error into state", (page) => {
    const src = read(page);
    expect(src, "the risk_data read must still exist").toMatch(/\.from\('risk_data'\)/);
    expect(src, "the read's error must be bound").toMatch(/riskError/);
    expect(
      src,
      "a failed read must set the notice's reason, not just console.warn",
    ).toMatch(/if\s*\(\s*riskError\s*\)\s*\{[\s\S]{0,300}setRiskDataError/);
  });

  it.each(PAGES)("%s treats an empty result as a missing source too", (page) => {
    const src = read(page);
    // `risk_data` has no migration, so the common failure is not an error at
    // all — it is a successful read of nothing. That must raise the notice as
    // well, or the fix only covers the rarer case.
    expect(src).toMatch(/setRiskDataError\(\s*['"`]The risk_data table returned no rows\./);
  });

  it.each(PAGES)("%s renders RiskDataNotice when the reason is set", (page) => {
    const src = read(page);
    expect(src).toMatch(/import\s*\{\s*RiskDataNotice\s*\}/);
    expect(
      src,
      "the notice must be rendered under the error state, not merely imported",
    ).toMatch(/riskDataError\s*&&\s*\(?\s*\n?\s*<RiskDataNotice/);
  });

  it("clears the notice when the risk map does load", () => {
    // Negative half of the contract: a notice that never clears is noise, and
    // noise gets ignored, which returns us to a silent failure by another route.
    for (const page of PAGES) {
      const src = read(page);
      // The clearing call is a ternary with nested parens, so scan forward from
      // each setRiskDataError( rather than trying to span it in one regex.
      const clears = [...src.matchAll(/setRiskDataError\(/g)].some((m) =>
        /:\s*null\s*\)/.test(src.slice(m.index!, m.index! + 200)),
      );
      expect(clears, `${page} must clear the notice once risk data loads`).toBe(true);
    }
  });
});
