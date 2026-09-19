/**
 * The dual read is not silent about which half answered — §4 D88, WP 6.3.
 *
 * ── WHY THIS IS A DISPLAY TEST AND NOT ONLY A SQL ONE ──────────────────────
 *
 * `supabase/rehearsal/250` proves the RPC returns the right `metrics_source` for
 * five node states against a real database, and mutation-tests five ways of
 * getting it wrong. That is the half a SQL assertion can reach.
 *
 * What it cannot reach is whether a PERSON is told. §5 T2 puts a substitution at
 * the point of display, not in a log — and a screen that rendered a reproducible
 * figure and a legacy one in the same font would be T1 with the source silently
 * removed. That is not hypothetical: §15 run `35399391429` measures 439 of
 * `network_nodes`' 1 824 rows carrying a hash and the rest predating provenance,
 * so EVERY project is currently a mixture.
 *
 * ── WHY THE COLUMNS CANNOT JUST BE DROPPED ─────────────────────────────────
 *
 * The 1 385 legacy rows can never be backfilled: a row written before WP 4.3 has
 * no input hash, and inventing one is the fabricated provenance `declared-fallback`
 * (I6) forbids — a `computed_from_hash` that is confidently wrong is worse than the
 * NULL it replaced. So the mixture is the state for as long as projects go un-re-run,
 * and the sentence this file asserts is the product's only honest account of it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const TABLE = readFileSync(join(ROOT, "src", "components", "NetworkMetricsTable.tsx"), "utf8");
const MIGRATION = readFileSync(
  join(ROOT, "supabase", "migrations", "20260919000002_dual_read_node_metrics.sql"),
  "utf8",
);

/** The component with its comments stripped: what a user can actually be shown. */
const code = TABLE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("§4 D88 · the dual read says which half answered", () => {
  it("the strip left something to read", () => {
    expect(code.length).toBeGreaterThan(1500);
    expect(code).toMatch(/provenanceSummary/);
  });

  it("the RPC returns the provenance, and the component declares it", () => {
    // Both halves of one fact. A migration that returned it and a component that
    // dropped it would type-check and say nothing, which is how `contract` spent a
    // phase as baselined debt (§5.4 A1).
    for (const col of ["metrics_source", "run_id", "computed_from_hash", "hash_is_current"]) {
      expect(MIGRATION, `the RPC does not return ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
      expect(code, `the component does not declare ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("the summary renders whenever the table has rows", () => {
    // Not behind a toggle, not behind a tooltip, not only when something is wrong.
    // A disclosure a user has to find is one most users never see, and the mixture
    // is the normal case rather than the exception.
    expect(code).toMatch(/provenanceSummary\(metrics\) &&/);
    expect(code).toMatch(/\{provenanceSummary\(metrics\)\}/);
  });

  it("a legacy value is described as unknowable, not merely old", () => {
    // "Older" invites the reader to discount it; "nothing can say which data
    // produced them" is the actual claim, and it is why the drop is blocked.
    expect(code).toMatch(/before this project tracked provenance/);
    expect(code).toMatch(/nothing can say which data produced them/);
  });

  it("a stale figure says what to do about it", () => {
    // T3 — a limit stated without a remedy is a disclaimer. The remedy here is
    // specific and available: re-run the analysis.
    expect(code).toMatch(/different version of this dataset/);
    expect(code).toMatch(/re-run the analysis/i);
  });

  it("`unknown` is distinguished from `up to date`", () => {
    // D70's rule, and the reason `hash_is_current` is three-valued. A row with no
    // hash cannot be called current, and calling it stale would report every
    // legacy row as out of date.
    expect(code).toMatch(/cannot tell/i);
    expect(code).toMatch(/not the same as up to date/);
  });

  it("`none` is not reported as zero", () => {
    // §4 D17 in the other direction: sixty suppliers' null capacity rendered as 0.
    // An uncomputed metric is uncomputed.
    expect(code).toMatch(/not computed yet/);
    expect(code).not.toMatch(/\?\?\s*0\b/);
  });

  it("an absent `metrics_source` is treated as `none`, never as `store`", () => {
    // The page renders before the columns land, and a partial payload must not be
    // read as a reproducible answer. `?? 'none'` is the whole of that rule.
    expect(code).toMatch(/metrics_source \?\? 'none'/);
    expect(code).not.toMatch(/metrics_source \?\? 'store'/);
  });

  it("the preference lives in the RPC, so no screen re-implements it", () => {
    // `single-source` (I1). If a page ever picks between the two halves itself,
    // the two implementations will disagree about staleness within a quarter,
    // which is §4 D21 exactly.
    expect(MIGRATION).toMatch(/COALESCE\(\(ar\.metrics ->> 'degree_centrality'\)::numeric/);
    expect(
      code,
      "the component must not choose between the store and the mirror — the RPC has",
    ).not.toMatch(/analysis_results/);
  });
});
