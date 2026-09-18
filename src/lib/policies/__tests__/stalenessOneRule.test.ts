/**
 * WP 4.4 — ONE STALENESS RULE, AS A GATE RATHER THAN AS A GAP CHECK.
 *
 * §11's gap check for this package is "grep for any surviving
 * timestamp-comparison staleness logic". A grep run once is a fact that is true
 * on the day it is run; every previous package that ended with one has watched
 * the thing it measured drift back within two months — which is the lesson §2.1
 * opens with. So the grep is a test.
 *
 * WHAT IT CANNOT DO, said plainly so nobody reads more into a green run than is
 * there: it is a TEXT SCAN over live SQL definitions, and a text scan cannot
 * follow a call. WP 4.3 learned exactly that about `dataPlaneAudit.test.ts` —
 * ten functions attributed their actor through a helper and the scan counted
 * them as debt for a whole package (D78). The behavioural half of this package
 * lives in `supabase/rehearsal/140`, which moves a real project's hash, moves it
 * BACK, and asserts that nothing was rewritten in between. That is the
 * assertion; this file guards against the rule growing a second copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — .mjs helper shared with the data-contract scripts; no types.
import { liveDefinitions } from "../../../../scripts/data-contract/live-sql.mjs";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const MIGRATION = join(MIGRATIONS, "20260917000008_one_staleness_rule.sql");

type LiveDef = { name: string; sql: string };
const live = () => liveDefinitions() as { policies: Map<string, LiveDef>; functions: Map<string, LiveDef> };
const fn = (name: string): LiveDef => {
  const d = live().functions.get(name);
  expect(d, `no live function ${name}()`).toBeDefined();
  return d!;
};

describe("WP 4.4 · the rule exists and is singular", () => {
  it("`freshness_of` is the rule, and it is three-state", () => {
    const body = fn("freshness_of").sql;
    // Not a regex over the prose — the three literal states must be RETURNED.
    for (const state of ["'unknown'", "'fresh'", "'stale'"]) {
      expect(body, `freshness_of does not return ${state}`).toContain(state);
    }
    expect(
      body,
      "freshness_of must compare against current_graph_hash and nothing else",
    ).toContain("current_graph_hash");
  });

  it("`is_stale` DELEGATES rather than restating the comparison", () => {
    const body = fn("is_stale").sql;
    expect(body, "is_stale does not call freshness_of").toContain("freshness_of");
    // The moment it spells the comparison itself there are two rules that agree
    // today and will disagree after the next edit — which is `single-source`
    // (I1) and the defect `columnSpecs.defaultWhenMissing` vs the Zod bundle is
    // (WP 6.2).
    expect(
      body.replace(/--[^\n]*/g, ""),
      "is_stale spells the hash comparison itself — that is a SECOND rule",
    ).not.toMatch(/current_graph_hash/);
  });
});

describe("WP 4.4 · D70 · a read may not rewrite a row", () => {
  it("`expire_agent_proposals` no longer persists grounding drift", () => {
    const body = fn("expire_agent_proposals").sql.replace(/--[^\n]*/g, "");
    expect(
      body,
      "expire_agent_proposals compares a hash again, so a READ writes `expired` " +
        "for drift — one-way, from a page load. That is §4 D70.",
    ).not.toMatch(/current_graph_hash|current_policy_hash/);
    expect(
      body,
      "expire_agent_proposals no longer expires on TTL either — time IS one-way " +
        "and dropping that write over-corrects D70 into a second defect",
    ).toMatch(/expires_at\s*<\s*now\(\)/);
  });

  it("drift is still REPORTED, by a computed column", () => {
    // Un-persisting a state is only correct if the state is still visible;
    // otherwise the package hid the drift rather than un-persisting it.
    const body = fn("proposal_grounding_state").sql;
    expect(body).toContain("freshness_of");
    expect(body, "the computed column must be STABLE, not VOLATILE").toMatch(/STABLE/i);
  });
});

describe("WP 4.4 · no surviving timestamp-comparison staleness", () => {
  /**
   * The shapes that mean "is this stale?" answered with a clock. Each is a
   * comparison between two timestamps where at least one side names a
   * calculation or a data change — `updated_at > created_at` on an audit row is
   * not staleness, so the scan looks for the PAIR.
   */
  const CLOCK_STALENESS = [
    /last_data_time\s*[<>]\s*last_calc/i,
    /last_calc\w*\s*[<>]\s*last_data/i,
    /data_last_modified\s*[<>]\s*last_calculated/i,
    /last_calculated\s*[<>]\s*data_last_modified/i,
    /metrics_updated_at\s*[<>]\s*\w*updated_at/i,
    /computed_at\s*[<>]\s*\w*updated_at/i,
  ];

  it("no live SQL function decides freshness from a timestamp comparison", () => {
    const offenders: string[] = [];
    for (const [name, def] of live().functions) {
      const body = def.sql.replace(/--[^\n]*/g, "");
      if (CLOCK_STALENESS.some((re) => re.test(body))) offenders.push(name);
    }
    expect(
      offenders.sort(),
      "these functions still answer 'is this stale?' with a clock. A timestamp " +
        "comparison asks whether a value MOVED, which an UPDATE writing the same " +
        "value answers yes to and a restored backup answers no to (§4 D12). The " +
        "one rule is `freshness_of(recorded_hash, project)`.",
    ).toEqual([]);
  });

  it("`should_recalculate_network_metrics` answers from the hash", () => {
    // It is kept alive only for the window in which the deployed frontend still
    // calls it (WP 5.3 deletes it), so what matters is the ANSWER.
    const body = fn("should_recalculate_network_metrics").sql;
    expect(body, "it does not consult the one rule").toContain("freshness_of");
    expect(
      body.replace(/--[^\n]*/g, ""),
      "`data_last_modified` must return NULL — there is no honest answer to " +
        "'when did the data last change', and inventing one is a fabricated " +
        "source (T1)",
    ).toMatch(/NULL::timestamptz/);
  });

  it("no page decides freshness by comparing two timestamps", () => {
    // COMMENTS ARE STRIPPED FIRST, and the first run of this test is why: it
    // flagged `ProductLevelNetwork.tsx` for a comment explaining the comparison
    // this package REMOVED from it. A scan that cannot tell code from prose
    // punishes the explanation and rewards deleting it, which is the opposite
    // of what a codebase whose migrations argue with themselves should reward.
    // The SQL side already strips `--` for the same reason.
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");

    const pages = readdirSync(join(ROOT, "src", "pages")).filter((f) => f.endsWith(".tsx"));
    const offenders: string[] = [];
    for (const f of pages) {
      const src = stripComments(readFileSync(join(ROOT, "src", "pages", f), "utf8"));
      if (CLOCK_STALENESS.some((re) => re.test(src))) offenders.push(f);
    }
    expect(offenders.sort(), "a page is deciding staleness from a clock").toEqual([]);
  });
});

describe("WP 4.4 · `seeded_from_hash` and the badge", () => {
  it("the migration adds `seeded_from_hash` and does not default it", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS seeded_from_hash text/);
    // A DEFAULT would say every override was seeded from something, which is
    // the silent default `declared-fallback` (I6) forbids — a TYPED override
    // was seeded from nobody's data and does not go stale when the data moves.
    expect(
      sql,
      "seeded_from_hash must not carry a DEFAULT: a typed override has no " +
        "provenance to record and must not be given a fabricated one",
    ).not.toMatch(/seeded_from_hash text[^\n;]*DEFAULT/i);
  });

  it("`project_freshness` reads `current_graph_hash` exactly once", () => {
    const body = fn("project_freshness").sql.replace(/--[^\n]*/g, "");
    const calls = body.match(/current_graph_hash\s*\(/g) ?? [];
    expect(
      calls.length,
      "the report classifies six tables; calling current_graph_hash per table " +
        "rebuilds the eleven-table snapshot six times AND lets a concurrent " +
        "write land between two of them, so the rows would disagree about what " +
        "'now' is — the failure §15 hit reading 1 787 rows in one query and " +
        "1 691 in another",
    ).toBe(1);
  });

  it("it refuses a project the caller cannot reach", () => {
    // SECURITY DEFINER, returning per-table row counts. Unguarded, it reports a
    // dataset's size to anyone who asks.
    expect(fn("project_freshness").sql).toContain("has_project_access");
  });
});
