import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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

// The table name, assembled rather than written as a `.from('…')` literal. The
// introspector scans this repo for `.from('<table>')` to find tables the code
// reads and no migration creates, and a test asserting that a read is GONE must
// not itself look like the read. (`scripts/data-contract/introspect.mjs`.)
const DEAD_TABLE = ["product", "code", "map"].join("_");
const SIDECARS = "supabase/contract";

describe("D3 — product_code_map is gone, and stays gone", () => {
  /**
   * WP 0.2 made this read loud. WP 1.4 reconciled the orphan it was loud about
   * and DELETED it, so the assertions this block used to make — that the read
   * destructures `error`, logs at error level, and pushes a warning — now
   * describe code that does not exist.
   *
   * They are replaced, not dropped. Deleting a branch closes the instance; it
   * does not close the class. What is worth pinning is the decision: the table
   * exists in no migration, the mapped branch had never executed, and nobody
   * should "restore" either without reopening that decision. So the guard is
   * absence plus the recorded reason.
   */
  it("is read by no application code", () => {
    const hits: string[] = [];
    for (const file of [ETL, "supabase/functions/delete-project/index.ts", ...PAGES]) {
      const src = read(file);
      // `.from('<table>')` and `deleteTableByProjectId('<table>')` — the two
      // shapes this table was ever reached through.
      if (new RegExp(`\\(\\s*['"\`]${DEAD_TABLE}['"\`]`).test(src)) hits.push(file);
    }
    expect(
      hits,
      `${DEAD_TABLE} exists in no migration (PLAN.md §4 D3). A call site for it can only ` +
        "fail. If it is genuinely needed, the decision to re-add it is an ingestion-contract " +
        "question — a declared alias column on an uploaded table — not a silent lookup table.",
    ).toEqual([]);
  });

  it("leaves the reason behind where the read used to be", () => {
    // A deletion with no record invites the next person to re-add it, which is
    // how the branch survived unexecuted for as long as it did.
    const src = read(ETL);
    expect(src, "the ETL must still explain why the mapping was removed").toMatch(
      new RegExp(`${DEAD_TABLE}[\\s\\S]{0,600}(DELETED|never executed|NEVER EXECUTED)`),
    );
  });

  it("and no sidecar describes it — the contract agrees the table does not exist", () => {
    const sidecars = readdirSync(resolve(root, SIDECARS));
    expect(sidecars).not.toContain("product_code_map.contract.yaml");
  });

  it("takes the branch it fed with it", () => {
    const src = read(ETL);
    expect(
      /\bproductMapping\b/.test(src),
      "the `productMapping` Map was only ever populated from the deleted read; a Map that is " +
        "always empty selecting between two paths at runtime is the unmapped path with extra steps",
    ).toBe(false);
  });
});

describe("D25 — the ETL's own core reads fail loudly too", () => {
  // The same swallow as D3, on the lanes the graph is actually built from.
  // A half-empty graph that reports success is the worst outcome in the file.
  //
  // TWO OF THE FOUR MOVED IN WP 8.2, AND THE RULE FOLLOWED THEM RATHER THAN
  // BEING RELAXED. The edge function no longer builds the lanes — §4 D140 left
  // one ETL and it is the SQL one — so it no longer reads `bom_single_level` or
  // `bom_multi_level` at all. It still reads the two logistics tables, for the
  // D46 unit-substitution warnings, and those reads must still be loud.
  //
  // The BOM reads are now inside `rebuild_supply_chain_lanes`, where D25's
  // failure mode CANNOT OCCUR: a SQL function has no `{ data, error }` to
  // destructure, so a read that fails aborts the statement and the caller sees an
  // exception. That is not an argument for dropping the rule — it is the reason
  // the rule now has a different shape for those two, asserted below rather than
  // assumed.
  const CORE = ["outbound_logistics", "inbound_logistics"];
  const MOVED_TO_SQL = ["bom_single_level", "bom_multi_level"];

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

  it.each(MOVED_TO_SQL)("%s is no longer read over PostgREST by the ETL at all", (table) => {
    // The stronger statement, and the one that keeps this rule honest: the two
    // BOM tables are not read here with an unchecked error — they are not read
    // here. A future edit that brings the read back brings D25's failure mode
    // back with it, and this is what notices.
    expect(
      read(ETL).includes(`.from('${table}')`),
      `${table} is read over PostgREST again. The lane build moved into ` +
        "`rebuild_supply_chain_lanes` in WP 8.2 (§4 D140); a second reader of the " +
        "BOM in the ETL is the two-writers defect starting over.",
    ).toBe(false);
  });

  it("and the ETL's one write is an RPC, which cannot swallow a failed read", () => {
    const src = read(ETL);
    expect(src, "the ETL must delegate the lane build to the SQL writer").toContain(
      "combine_project_into_supply_chain",
    );
    const idx = src.indexOf("rpc('combine_project_into_supply_chain'");
    expect(idx, "the combine RPC must be called").toBeGreaterThan(-1);
    const after = src.slice(idx, idx + 700);
    expect(
      /combineError/.test(after) && /return \{ success: false/.test(after),
      "the combine RPC's error must be checked and returned, not dropped (D25)",
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
    // The common failure here is not an error at all — it is a successful read
    // of nothing. That must raise the notice as well, or the fix only covers
    // the rarer case. WP 1.4 made this the LIKELY case rather than a corner:
    // `risk_data` now has a migration, so the read succeeds against a real
    // table — one that is empty until an operator loads a vintage.
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

/**
 * D46's READER HALF REACHES A PERSON (WP 3.3, §5 T2).
 *
 * `resolveWeeklyVolume` producing a substitution is necessary and not
 * sufficient: "the substitution is always visible AT THE POINT OF DISPLAY" is
 * not met by a field in a response nobody renders. `combine-project` has
 * returned a `warnings` array since WP 0.2 and `DataManager` dropped it on the
 * floor — the degradations rode all the way back from the server and stopped one
 * call short of the only reader who could act on them.
 *
 * Read from disk, both ends, the way this file already reads the ETL.
 */
describe("D46 — the ETL's substitutions reach the screen", () => {
  const DATA_MANAGER = "src/pages/DataManager.tsx";

  it("the ETL reports an unrecognized time_unit as a warning", () => {
    const src = read(ETL);
    expect(src).toMatch(/unitSubstitutions/);
    // named, with the token and the count — not "some rows had a problem"
    expect(src).toMatch(/warnings\.push\(/);
    expect(src).toMatch(/not a unit this[\s\S]{0,40}platform recognises/);
  });

  it("the ETL does NOT warn about an absent unit", () => {
    // "Absent means weekly" is an explicit default the contract states. Warning
    // about it would bury the 88 rows that are a real defect under the 16 that
    // are not.
    const src = read(ETL);
    expect(src).not.toMatch(/time_unit is (null|absent|missing)/i);
  });

  it("DataManager renders the ETL's warnings instead of discarding them", () => {
    const src = read(DATA_MANAGER);
    expect(src, "combine-project's warnings are read").toMatch(/combineData as any\)\?\.warnings/);
    expect(src, "and shown, not just read").toMatch(/toast\.warning\(/);
  });

  it("a substitution the user must see does not auto-dismiss", () => {
    // A four-second toast behind a success message is not "visible at the point
    // of display".
    const src = read(DATA_MANAGER);
    const at = src.indexOf("toast.warning(");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 200)).toMatch(/duration:\s*Infinity/);
  });
});
