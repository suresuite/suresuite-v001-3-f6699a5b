/**
 * WP 6.2 · §4 D48 + D97 — A STATEMENT PostgreSQL REJECTS ABORTS ITS FILE.
 *
 * A Supabase migration runs in one transaction. If any statement raises, the
 * whole file rolls back and NOTHING in it took effect — yet a static replay
 * records every statement as applied, because a replay cannot execute a
 * definition to find out it is invalid.
 *
 * The introspector has always known ONE way a file can abort: the corroboration
 * test, which asks which of two `CREATE TABLE`s the later INSERTs agree with.
 * **A file that creates no table is invisible to it**, and that is how five
 * migrations went unnoticed:
 *
 *   42703  `20250909153130`  an index on a column its table has never had (D97)
 *   42703  `20250914113723`  the same, on `simulation_jobs(job_id)`      (D97)
 *   42P13  `20250827170942`  `p_user_id` after `p_settings … DEFAULT`    (D48)
 *   42P13  `20250904122241`  `p_user_id` after `p_plant_name … DEFAULT`  (D48)
 *   42P13  `20250904122347`  a retry of the above that repeats the error (D48)
 *
 * ── THE EVIDENCE IS NOT INFERENCE ─────────────────────────────────────────
 *
 * Each has a retry, and the gap is measured in seconds:
 *
 *   `20250827171106` — **84 seconds** after `20250827170942`, re-issuing the
 *     same four tables, triggers, policies and RPC, and carrying the literal
 *     comment `-- FIXED: Put all parameters with defaults at the end`.
 *   `20250909153231` — 61 seconds after `20250909153130`, re-issuing its other
 *     four statements without the two impossible index lines.
 *   `20250914113757` — 34 seconds after `20250914113723`, adding the column the
 *     index needed.
 *
 * The author of each knew. The contract never did.
 *
 * ── WHY IT IS STATIC ──────────────────────────────────────────────────────
 *
 * `contract:rehearse` builds its base from the BASE BRANCH's artifact, so in
 * plain and `--fixtures` mode the artifact under test predates the fix and a SQL
 * assertion has to skip. A skip cannot tell "the base predates the fix" from
 * "the fix broke". This file reads the migrations and the artifact, needs no
 * database, and so has no base to be stale.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  splitStatements, splitTopLevel, parenBody, readQualifiedName, squash,
  firstNonDefaultAfterDefault,
} from "../../../../scripts/data-contract/sql-lex.mjs";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

type Fn = { name: string; signature: string; args: string[]; defined_by: string };
const artifact = JSON.parse(
  readFileSync(join(ROOT, "build", "schema.introspected.json"), "utf8"),
) as { functions: Fn[]; aborted_migrations: { migration: string; why: string }[] };

const files = readdirSync(MIGRATIONS)
  .filter((n) => n.endsWith(".sql"))
  .sort()
  .map((n) => [n, readFileSync(join(MIGRATIONS, n), "utf8")] as const);

const aborted = new Set(artifact.aborted_migrations.map((a) => a.migration));

/** The rule under test, not a re-implementation of it. */
const illegalAt = (args: string[]) => firstNonDefaultAfterDefault(args)?.after ?? null;

describe("WP 6.2 · D48 · the 42P13 rule itself", () => {
  // THE MIGRATIONS DO NOT EXERCISE THIS RULE'S EDGES, and that was found by a
  // mutation SURVIVING: removing the paren-depth guard from the default
  // detector produced a byte-identical artifact, because no parameter in this
  // repository puts a `DEFAULT` or an `=` inside parentheses. A guard nothing
  // exercises is a belief. These cases exercise it directly, so the rule is
  // pinned by more than the shapes that happen to be in the history today.
  it("a legal list — every default at the end — is not flagged", () => {
    expect(illegalAt(["p_a uuid", "p_b text", "p_c text DEFAULT NULL"])).toBeNull();
  });

  it("a plain parameter after a defaulted one is flagged, and named", () => {
    expect(illegalAt(["p_a uuid", "p_b text DEFAULT NULL", "p_c uuid"])).toBe("p_c uuid");
  });

  it("`= expr` is the other spelling of a default", () => {
    expect(illegalAt(["p_a uuid", "p_b text = 'x'", "p_c uuid"])).toBe("p_c uuid");
  });

  it("a DEFAULT inside a call still marks its OWN parameter as defaulted", () => {
    expect(illegalAt(["p_a text DEFAULT coalesce(x, y)", "p_b uuid"])).toBe("p_b uuid");
  });

  it("a parenthesised type is not mistaken for a default", () => {
    expect(illegalAt(["p_a numeric(16, 6)", "p_b text DEFAULT concat(a, b)"])).toBeNull();
  });

  it("a default whose EXPRESSION contains `=` or the keyword is still one default", () => {
    // Not a guard, a shape. The rule scans for either token anywhere in the
    // parameter's text precisely BECAUSE a second occurrence inside the default
    // expression cannot change the answer — the parameter is defaulted either
    // way. Pinned so that re-introducing literal- or depth-tracking has to
    // explain what it is for.
    expect(illegalAt(["p_a uuid", "p_mode text DEFAULT 'a=b'", "p_c uuid"])).toBe("p_c uuid");
    expect(illegalAt(["p_sql text DEFAULT 'x = 1'", "p_b uuid"])).toBe("p_b uuid");
    expect(illegalAt(["p_note text", "p_b uuid"])).toBeNull();
  });

  it("a parameter NAMED like the keyword does not count as defaulted", () => {
    // ONE CASE PER HALF, and getting that wrong is how the suffix guard first
    // survived its mutation: `p_defaulted_at` and `is_default` are both caught
    // by the PRECEDING-character test, because in each the keyword follows an
    // underscore. Only a name that STARTS with it reaches the word boundary.
    expect(illegalAt(["p_defaulted_at timestamptz", "p_b uuid"])).toBeNull();  // prefix half
    expect(illegalAt(["is_default boolean", "p_b uuid"])).toBeNull();          // prefix half
    expect(illegalAt(["default_mode text", "p_b uuid"])).toBeNull();           // suffix half
    expect(illegalAt(["defaults jsonb", "p_b uuid"])).toBeNull();              // suffix half
  });

  it("an OUT or VARIADIC parameter makes the rule decline rather than guess", () => {
    // PostgreSQL exempts OUT parameters. This repository has none, and a rule
    // that guessed at a shape it has never seen would be a false accusation
    // with a migration's blast radius.
    expect(illegalAt(["p_a uuid DEFAULT NULL", "OUT p_b text"])).toBeNull();
    expect(illegalAt(["p_a uuid DEFAULT NULL", "VARIADIC p_b text[]"])).toBeNull();
  });
});

describe("WP 6.2 · D48 · no recorded function is one PostgreSQL would refuse", () => {
  it("there are functions to check — an empty artifact makes this vacuous", () => {
    expect(artifact.functions.length).toBeGreaterThan(200);
  });

  it("no function in the artifact puts a plain parameter after a defaulted one", () => {
    // The defect in its general form. Recording such a definition publishes an
    // overload that cannot exist, and `rehearsal-schema.mjs` emits it — so the
    // base build prints a 42P13 error that has been dismissed as "historical"
    // since the rehearsal was written.
    const bad = artifact.functions
      .map((f) => ({ f, at: illegalAt(f.args ?? []) }))
      .filter((x) => x.at)
      .map((x) => `${x.f.signature} — "${x.at}" (${x.f.defined_by})`);
    expect(bad, "PostgreSQL raises 42P13 on each of these at CREATE time").toEqual([]);
  });

  it("no CREATE FUNCTION in a NON-aborted migration does either", () => {
    // Asserted over the migrations too, not only the artifact: a definition the
    // parser silently failed to read would pass the assertion above by absence.
    const bad: string[] = [];
    for (const [file, sql] of files) {
      if (aborted.has(file)) continue;
      for (const stmt of splitStatements(sql)) {
        const s = squash(stmt);
        const m = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+/i.exec(s);
        if (!m) continue;
        const id = readQualifiedName(s, m[0].length);
        const args = id && parenBody(s, id.end);
        if (!id || !args) continue;
        const at = illegalAt(splitTopLevel(args.body).map((a) => squash(a)).filter(Boolean));
        if (at) bad.push(`${file}: ${id.name} — "${at}"`);
      }
    }
    expect(
      bad,
      "each of these aborts its file, so NOTHING in it ran — yet the artifact " +
        "records its other statements as applied.",
    ).toEqual([]);
  });

  it("the three 42P13 files are recorded as aborted, with the reason", () => {
    // Named, because the two assertions above are also satisfied by deleting the
    // detector and the three files together.
    for (const file of [
      "20250827170942_78bc79b9-38a6-463c-ad66-88d35ef90356.sql",
      "20250904122241_b65404b9-d4ee-4c58-9518-7a1578f74af8.sql",
      "20250904122347_a28da769-734c-4064-8f24-2b8d60ffffa4.sql",
    ]) {
      const row = artifact.aborted_migrations.find((a) => a.migration === file);
      expect(row, `${file} declares a plain parameter after a defaulted one`).toBeDefined();
      expect(row!.why).toMatch(/42P13/);
    }
  });

  it("the four disruption tables are attributed to the RETRY, not to the file that aborted", () => {
    // The consequence worth stating: `20250827170942` claims to create them and
    // could not have. Every page generated from the artifact named it as their
    // origin — a published falsehood about which migration a reader should go
    // and read (§5 T1).
    const schema = JSON.parse(
      readFileSync(join(ROOT, "build", "schema.introspected.json"), "utf8"),
    ) as { tables: { name: string; created_by: string }[] };
    for (const t of [
      "disruption_scenario_profiles",
      "disruption_scenario_targets",
      "disruption_scenario_effects",
      "disruption_scenario_settings",
    ]) {
      const row = schema.tables.find((x) => x.name === t)!;
      expect(row, `${t} is missing — the retry must still create it`).toBeDefined();
      expect(row.created_by).toBe("20250827171106_00d577a4-5496-4e8d-8775-bbe357746c20.sql");
    }
  });
});

describe("WP 6.2 · D48 · which overload the caller actually reaches", () => {
  // D48's open half: "nothing has ever checked which of the three the callers
  // actually reach." There were never three. One was a phantom, and of the two
  // that exist only one can serve the single call site.
  const overloads = () => artifact.functions.filter((f) => f.name === "create_disruption_scenario_v2");

  it("there are exactly two, and the phantom is not among them", () => {
    expect(overloads().map((f) => f.defined_by).sort()).toEqual([
      "20250827171106_00d577a4-5496-4e8d-8775-bbe357746c20.sql",
      "20250828005114_4c7e88dc-9c73-4538-ab14-fe93b22d07dc.sql",
    ]);
  });

  it("the one call site names arguments only the 13-parameter overload has", () => {
    // PostgREST resolves an RPC by NAMED arguments, so the question is which
    // overload has every name the caller sends. `p_disruption_start` and
    // `p_disruption_end` exist on exactly one.
    const src = readFileSync(join(ROOT, "src", "components", "DisruptionDialog.tsx"), "utf8");
    const at = src.indexOf("create_disruption_scenario_v2");
    expect(at, "the call site moved — re-establish which overload it reaches").toBeGreaterThan(0);
    const call = src.slice(at, src.indexOf("});", at));
    const sent = [...call.matchAll(/^\s*(p_[a-z_]+):/gm)].map((m) => m[1]);
    expect(sent.length).toBeGreaterThan(5);

    const serves = overloads().filter((f) => {
      const names = (f.args ?? []).map((a) => /^([a-z_][a-z0-9_]*)/i.exec(a.trim())?.[1]);
      return sent.every((s) => names.includes(s));
    });
    expect(
      serves.map((f) => f.defined_by),
      "no recorded overload has every argument this call sends, or more than one does — " +
        "either way the caller's target is not the one D48 assumed.",
    ).toEqual(["20250828005114_4c7e88dc-9c73-4538-ab14-fe93b22d07dc.sql"]);
  });
});
