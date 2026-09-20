/**
 * WP 6.2 · §4 D53 — A `REFERENCES` KEEPS THE SCHEMA THE MIGRATION WROTE.
 *
 * `readQualifiedName` has always returned `{ schema, name }`. The introspector
 * read only `.name`, so `REFERENCES auth.users(id)` was recorded as `users`.
 * `rehearsal-schema.mjs` then qualified that bare name to `public.users`, found
 * no such table, and SKIPPED the key — on every rehearsal this repository has
 * ever run. Production has all nine. So every behavioural assertion about what
 * happens when a user row disappears was made against a database where nothing
 * happened, because there was no constraint.
 *
 * ── WHY THIS GATE IS STATIC, AND WHY THAT IS NOT A COMPROMISE ─────────────
 *
 * The fix is to the INTROSPECTOR, and `contract:rehearse` builds its base from
 * the BASE BRANCH's artifact — so in plain and `--fixtures` mode the nine keys
 * are legitimately absent until this lands on `main`. Only `--since HEAD` can
 * see the fix. `supabase/rehearsal/170` therefore SKIPS when none of the nine
 * are present, which is honest about a stale base and useless against a
 * regression: SQL cannot tell "the base predates the fix" from "the fix broke".
 *
 * **That was caught by a mutation test, not by reasoning.** Reverting the
 * introspector left `170` green in every mode, because the skip branch fired.
 * This file is what makes that skip safe: it reads the MIGRATIONS and the
 * ARTIFACT, needs no database, and therefore has no base to be stale.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

type Ref = { schema: string | null; table: string; columns: string[] };
type Col = { name: string; references?: Ref | null };
type Table = { name: string; schema: string; columns?: Col[] };

const artifact = JSON.parse(
  readFileSync(join(ROOT, "build", "schema.introspected.json"), "utf8"),
) as { tables: Table[] };

/** Every `REFERENCES <schema>.<table>` the migrations actually write. */
function qualifiedTargetsInMigrations(): Map<string, Set<string>> {
  const bySchema = new Map<string, Set<string>>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(/\bREFERENCES\s+([a-z_][a-z_0-9]*)\.([a-z_][a-z_0-9]*)/gi)) {
      const schema = m[1].toLowerCase();
      const table = m[2].toLowerCase();
      if (!bySchema.has(schema)) bySchema.set(schema, new Set());
      bySchema.get(schema)!.add(table);
    }
  }
  return bySchema;
}

const allRefs = () =>
  artifact.tables.flatMap((t) =>
    (t.columns ?? [])
      .filter((c) => c.references)
      .map((c) => ({ where: `${t.name}.${c.name}`, ref: c.references! })),
  );

describe("WP 6.2 · D53 · the introspector keeps a reference's schema", () => {
  it("there are references to check — an empty artifact makes this vacuous", () => {
    expect(allRefs().length).toBeGreaterThan(50);
  });

  it("every recorded reference carries a schema", () => {
    // The defect stated as its general form. `null` is what a dropped qualifier
    // looks like, and `rehearsal-schema.mjs` turns it into `public.<table>` —
    // right for a `public` reference and silently wrong for any other.
    const bare = allRefs()
      .filter((r) => !r.ref.schema)
      .map((r) => `${r.where} -> ${r.ref.table}`);
    expect(
      bare,
      "these column references record no schema, so the rehearsal will assume " +
        "`public` and skip the key if that is wrong — which is §4 D53 exactly.",
    ).toEqual([]);
  });

  it("a NON-`public` schema the migrations write survives into the artifact", () => {
    // The specific half. `auth` is the one that exists today; the assertion is
    // written over whatever the migrations contain so a second non-public
    // schema is covered on the commit that introduces it.
    const inMigrations = qualifiedTargetsInMigrations();
    const nonPublic = [...inMigrations.keys()].filter((s) => s !== "public");
    expect(nonPublic.length, "no non-public REFERENCES in any migration — this assertion is vacuous").toBeGreaterThan(0);

    for (const schema of nonPublic) {
      const recorded = allRefs().filter((r) => r.ref.schema === schema);
      expect(
        recorded.length,
        `the migrations write \`REFERENCES ${schema}.…\` but the artifact records ` +
          `no reference with schema \`${schema}\`. The qualifier was dropped, and ` +
          `every rehearsal will skip those keys.`,
      ).toBeGreaterThan(0);
    }
  });

  it("the six `auth.users` keys are recorded, by name", () => {
    // Named rather than counted, because a count passes while the wrong six are
    // present. D53 listed NINE; three have gone and each for its own reason, which is
    // why this list is worth reading rather than just updating:
    //
    //   `policy_versions.created_by`      — dropped in JUNE by
    //     `20260613000001_fix_snapshot_created_by.sql`, because the app authenticates
    //     against `approved_users` and the key rejected every snapshot with a real user.
    //     The artifact went on recording it for three months: an inline FK lives on the
    //     COLUMN, not in `constraints`, so the introspector's `DROP CONSTRAINT` handler
    //     could not reach it (§4 D157, closed by teaching it the implicit name).
    //   `ingest_runs.triggered_by_user_id` } re-keyed to `approved_users` by
    //   `ingest_runs.applied_by_user_id`   } `20260919000012`, for the same reason one
    //     package later and with the landing path at stake (§4 D156).
    //
    // So this list shrinking is the repository catching up with the database twice over,
    // not a regression. `rehearsal/170` asserts the same six against `pg_constraint`.
    const got = new Set(
      allRefs()
        .filter((r) => r.ref.schema === "auth" && r.ref.table === "users")
        .map((r) => r.where),
    );
    const want = [
      "experiments.created_by",
      "policy_presets.owner_id",
      "project_erp_links.linked_by_user_id",
      "recovery_playbooks.created_by",
      "scenarios.created_by",
      "simulation_runs.created_by",
    ];
    expect([...got].sort()).toEqual(want);
  });

  it("`rehearsal-schema.mjs` resolves the target from that schema, not from `public`", () => {
    // The consumer half: keeping the schema in the artifact achieves nothing if
    // the base builder still hard-codes `public.`. Asserted against the source
    // because running it needs a database and this gate must not.
    const src = readFileSync(join(ROOT, "scripts", "data-contract", "rehearsal-schema.mjs"), "utf8");
    const target = src.slice(src.indexOf("const target ="), src.indexOf("const target =") + 400);
    expect(
      /c\.references\.schema/.test(target),
      "the base builder no longer reads `references.schema`, so a non-public " +
        "target is qualified to `public.` again and its key is skipped.",
    ).toBe(true);
  });
});
