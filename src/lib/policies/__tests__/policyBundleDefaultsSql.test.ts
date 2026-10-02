/**
 * PLAN.md §23 WP 13.4 · §4 D204 (a) — the policy snapshot stores the defaults the
 * page shows.
 *
 * The page parses every stored family through the Zod bundle (`DEFAULT_BUNDLE`);
 * the snapshot a run binds is built in SQL and now merges the stored values over
 * `public.policy_bundle_defaults()`. SQL cannot import TypeScript, so that function
 * carries a GENERATED literal (`scripts/gen-policy-bundle-defaults.mts`) — and this
 * is the gate that keeps it equal to the bundle the page renders. Change a Zod
 * default without regenerating the migration and the page and the run disagree
 * again, which is exactly D204 (a).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_BUNDLE } from "../schemas";

const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "supabase", "migrations");

function latestLiteral(): { file: string; json: unknown } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let hit: { file: string; json: unknown } | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const m = /FUNCTION public\.policy_bundle_defaults\(\)[\s\S]*?SELECT '([\s\S]*?)'::jsonb;/.exec(sql);
    if (m) hit = { file: f, json: JSON.parse(m[1].replace(/''/g, "'")) };
  }
  expect(hit, "no migration defines public.policy_bundle_defaults()").not.toBeNull();
  return hit!;
}

describe("§4 D204 (a) — the snapshot's defaults are the page's", () => {
  it("public.policy_bundle_defaults() is exactly the Zod DEFAULT_BUNDLE", () => {
    const { file, json } = latestLiteral();
    expect(
      json,
      `${file}'s literal differs from DEFAULT_BUNDLE — regenerate it with ` +
        "`npx tsx scripts/gen-policy-bundle-defaults.mts` in a new migration",
    ).toEqual(JSON.parse(JSON.stringify(DEFAULT_BUNDLE)));
  });

  it("the snapshot builder merges the stored families OVER those defaults", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    let body = "";
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), "utf8");
      const at = sql.lastIndexOf("FUNCTION public._build_policy_snapshot(p_project_id uuid)");
      if (at >= 0) body = sql.slice(at, sql.indexOf("$$;", sql.indexOf("$$", at) + 2));
    }
    for (const fam of ["sourcing", "inventory", "transport", "fulfillment", "production", "recovery", "demand"]) {
      expect(body, `${fam} is copied raw again`).toContain(
        `_resolve_policy_family(v_def -> '${fam}'`,
      );
    }
  });
});
