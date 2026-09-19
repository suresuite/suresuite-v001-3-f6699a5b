// Build a runnable PostgreSQL schema from the introspected artifact.
//
// WHY THIS EXISTS (D31). Every migration in this repository has reached
// production as its own first execution: `supabase-migrations.yml` runs
// `db push` on any push touching `supabase/migrations/**`, and nothing else
// anywhere ever executes SQL. `contract:introspect` REPLAYS migrations
// statically — it parses DDL, it does not run it — so `min(uuid)` (42883,
// §16 · WP 2.1 follow-up) passed every gate in the repo and failed on the
// deploy. Four deploys for one file.
//
// A FULL REPLAY IS NOT THE ANSWER and must not be attempted as a gate: 92 of
// the 296 migrations fail on an empty database and always will (§16 · WP 2.1
// follow-up measured it — 42 on `relation does not exist`, 9 on return-type
// changes, 8 on unavailable extensions). Production was built incrementally
// with `migration repair`; the file set has never been applicable from empty.
//
// So the base is not a replay. It is the schema the contract ALREADY KNOWS —
// `build/schema.introspected.json` as of the BASE branch, which is the shape a
// new migration will actually meet. Tables, enums, constraints, indexes,
// policies come straight out of the artifact; functions, views and triggers are
// replayed from the single migration the artifact names as having last defined
// them, so a new migration that CALLS one meets the real body rather than a stub.
//
// What this deliberately does NOT reproduce: `auth.users` rows, Supabase's own
// grants, `storage`, and any extension the runner does not have. Those are
// stubbed in the prelude and named there.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { splitStatements, squash } from "./sql-lex.mjs";

const MIGRATIONS_DIR = "supabase/migrations";

/* ─────────────────────────── the prelude ─────────────────────────── */

// Everything Supabase provides that a migration assumes and a bare PostgreSQL
// 16 does not have. Each stub is named here rather than buried, because a
// rehearsal that passes on a shim Supabase does not have is a rehearsal that
// lies — the same failure mode as §15 measuring the seeded project (D42).
const PRELUDE = `
-- Supabase's three PostgREST roles. Every RLS policy in the schema names one.
DO $prelude$ BEGIN
  CREATE ROLE anon NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $prelude$;
DO $prelude$ BEGIN
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $prelude$;
DO $prelude$ BEGIN
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $prelude$;
DO $prelude$ BEGIN
  CREATE ROLE supabase_admin NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL; END $prelude$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS graphql_public;

-- GoTrue's claim readers. The rehearsal runs as one superuser with no JWT, so
-- these read a settable GUC: a test can impersonate by setting request.jwt.claims
-- exactly the way PostgREST does.
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE AS $prelude$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb)
$prelude$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $prelude$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid
$prelude$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $prelude$
  SELECT coalesce(auth.jwt() ->> 'role', current_setting('role', true))
$prelude$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
  LANGUAGE sql STABLE AS $prelude$
  SELECT auth.jwt() ->> 'email'
$prelude$;

-- auth.users: referenced by foreign keys and by policies. Columns only.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  created_at timestamptz DEFAULT now()
);

-- pgcrypto lives in the extensions schema on Supabase and migrations qualify it
-- both ways. gen_random_uuid() is core since PG13; digest()/crypt() are not.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pg_net and supabase_vault are NOT available to a bare PostgreSQL and are not
-- stubbed: a migration that needs either is out of this rehearsal's reach and
-- the failure should say so rather than pass on a fake.
`;

/* ───────────────────────── migration replay ───────────────────────── */

/** Every migration file, in lexical (= deploy) order. */
export function migrationFiles(root = ".") {
  const dir = path.join(root, MIGRATIONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Pull out of `sql` every statement whose leading keywords match `re`.
 * Statements are lexed, never split on `;` — a dollar-quoted function body is
 * full of semicolons and a naive split cuts every one of them in half.
 */
function statementsMatching(sql, re) {
  return splitStatements(sql).filter((s) => re.test(squash(s)));
}

/* ───────────────────────────── emitters ───────────────────────────── */

const q = (name) => (/^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name}"`);

function emitEnums(artifact) {
  const out = [];
  for (const [name, def] of Object.entries(artifact.enums || {})) {
    const values = def.values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
    out.push(`CREATE TYPE public.${q(name)} AS ENUM (${values});`);
  }
  return out;
}

function emitTables(artifact) {
  // Columns and NOT NULL only. Defaults come after the functions, because a
  // default may call one (`gen_random_uuid()` is core; `public.<f>()` is not).
  const out = [];
  for (const t of artifact.tables) {
    const cols = t.columns.map((c) => {
      const bits = [`  ${q(c.name)} ${c.type_raw || c.type}`];
      if (!c.nullable) bits.push("NOT NULL");
      return bits.join(" ");
    });
    out.push(`CREATE TABLE IF NOT EXISTS ${q(t.schema)}.${q(t.name)} (\n${cols.join(",\n")}\n);`);
  }
  return out;
}

function emitDefaults(artifact) {
  const out = [];
  for (const t of artifact.tables) {
    for (const c of t.columns) {
      if (!c.default) continue;
      out.push(
        `ALTER TABLE ${q(t.schema)}.${q(t.name)} ALTER COLUMN ${q(c.name)} SET DEFAULT ${c.default};`,
      );
    }
  }
  return out;
}

function emitConstraints(artifact, warn) {
  const known = new Set(artifact.tables.map((t) => `${t.schema}.${t.name}`));
  const out = [];
  // KEYS FIRST, ACROSS ALL TABLES. A foreign key needs its target's unique
  // constraint to exist already, and the artifact lists tables alphabetically —
  // `ai_chat_events` references `proposals`, which sorts after it.
  const isKey = (c) => c.kind === "PRIMARY KEY" || c.kind === "UNIQUE";
  for (const pass of [isKey, (c) => !isKey(c)]) {
    for (const t of artifact.tables) {
      for (const c of (t.constraints || []).filter(pass)) {
        // The PRIMARY KEY the introspector marks `implicit` came from a column
        // modifier; either way it is one ADD here. A constraint written as a
        // bare column modifier has no name in the artifact because it has none
        // in the migration either — Postgres invents the same one it invented
        // there.
        const named = c.name ? `CONSTRAINT ${q(c.name)} ` : "";
        out.push(`ALTER TABLE ${q(t.schema)}.${q(t.name)} ADD ${named}${c.definition};`);
      }
    }
  }
  // Column-level REFERENCES, last: every key they could point at now exists.
  // Skipped when the target is not a table this artifact knows — `auth.users`
  // is in the prelude, anything else would be a genuine hole and is left as one
  // rather than silently invented.
  for (const t of artifact.tables) {
    for (const c of t.columns) {
      if (!c.references) continue;
      // §4 D53 — the schema the migration actually wrote, when the artifact
      // kept it. `public` is the fallback for an unqualified reference, not a
      // guess applied to everything: applying it to `auth.users` is what
      // skipped nine keys on every rehearsal ever run.
      const target = c.references.schema
        ? `${c.references.schema}.${c.references.table}`
        : c.references.table.includes(".")
          ? c.references.table
          : `public.${c.references.table}`;
      if (!known.has(target) && target !== "auth.users") {
        // NOT SILENT. A skipped foreign key is a cascade the rehearsed database
        // does not have, and the first time it happened — `ingest_staged_*`
        // still pointing at `erp_sync_runs` after WP 3.1's rename — the base
        // built cleanly, said nothing, and a behavioural assertion found it on
        // `main`. The skip itself is still right; inventing a key would be
        // worse. Saying nothing about it was not.
        warn(
          `foreign key ${t.name}.${c.name} -> ${target} skipped: the artifact has no such table. ` +
          "The rehearsed database has no ON DELETE behaviour for that column.",
        );
        continue;
      }
      const cols = (c.references.columns || ["id"]).map(q).join(", ");
      const onDelete = c.references.on_delete ? ` ON DELETE ${c.references.on_delete}` : "";
      out.push(
        `ALTER TABLE ${q(t.schema)}.${q(t.name)} ADD CONSTRAINT ` +
          `${q(`${t.name}_${c.name}_fkey`)} FOREIGN KEY (${q(c.name)}) ` +
          `REFERENCES ${target}(${cols})${onDelete};`,
      );
    }
  }
  return out;
}

function emitIndexes(artifact, warn) {
  const out = [];
  for (const t of artifact.tables) {
    const columns = new Set(t.columns.map((c) => c.name));
    for (const idx of t.indexes || []) {
      // An index the artifact records on a column the table no longer has.
      // `supply_chain_data.plant` was RENAMEd to `plant_name` in
      // 20250822025432 and the introspector kept the index's old column name —
      // Postgres renames the index entry with the column, so production has no
      // such index and neither should the rehearsal. Reported, not invented.
      const bare = idx.columns.filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
      const missing = bare.filter((c) => !columns.has(c));
      if (missing.length) {
        warn(
          `index ${idx.name} on ${t.name} names ${missing.join(", ")}, which the table ` +
            `does not have (added_by ${idx.added_by}) — skipped`,
        );
        continue;
      }
      // Emitted verbatim. An index column may be an expression, a sort
      // direction (`created_at DESC`) or an already-quoted identifier, and
      // wrapping any of those in quotes turns it into a column name that does
      // not exist.
      const cols = idx.columns.join(", ");
      const where = idx.predicate ? ` WHERE ${idx.predicate}` : "";
      // NULLS NOT DISTINCT decides whether the index constrains a key column's
      // null rows at all, so rebuilding without it produces a database whose
      // constraint is WEAKER than the migration's — and an assertion that the
      // constraint bites then passes in the fresh modes and fails against the
      // artifact. That is the third rehearsal mode's whole purpose (D60).
      const nulls = idx.nulls_not_distinct ? " NULLS NOT DISTINCT" : "";
      out.push(
        `CREATE ${idx.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${q(idx.name)} ` +
          `ON ${q(t.schema)}.${q(t.name)} (${cols})${nulls}${where};`,
      );
    }
  }
  return out;
}

function emitRls(artifact) {
  const out = [];
  for (const t of artifact.tables) {
    const rls = t.rls || {};

    // ENABLING RLS AND CREATING POLICIES ARE TWO DECISIONS, AND THIS USED TO MAKE THEM
    // ONE (§4 D134). A single `if (!rls.enabled) continue` skipped a table's POLICIES
    // as well as its `ENABLE ROW LEVEL SECURITY` — so for a table whose RLS state the
    // introspector cannot determine (`rls.determinate: false`, which it defaults to
    // `enabled: false`), every policy the artifact records was silently dropped from
    // every rehearsed database. `materials`, `products` and `suppliers` are exactly
    // that case, and the consequence is that an assertion about one of their policies
    // could not fail: the policy was not there to be wrong.
    //
    // PostgreSQL is happy to hold a policy on a table with RLS disabled — it simply
    // does not enforce it — so creating them unconditionally is strictly more faithful
    // to the artifact, and the `enabled` flag now governs only the ALTER it describes.
    if (rls.enabled) {
      out.push(`ALTER TABLE ${q(t.schema)}.${q(t.name)} ENABLE ROW LEVEL SECURITY;`);
      if (rls.forced) out.push(`ALTER TABLE ${q(t.schema)}.${q(t.name)} FORCE ROW LEVEL SECURITY;`);
    }

    for (const p of rls.policies || []) {
      const to = p.roles && p.roles.length ? ` TO ${p.roles.map(q).join(", ")}` : "";
      const bits = [
        `CREATE POLICY ${q(p.name)} ON ${q(t.schema)}.${q(t.name)}`,
        `  FOR ${p.command || "ALL"}${to}`,
      ];
      // The introspector stores `true` for an absent clause. USING on INSERT and
      // WITH CHECK on SELECT/DELETE are both syntax errors, so each clause is
      // emitted only where Postgres accepts it.
      const cmd = (p.command || "ALL").toUpperCase();
      if (cmd !== "INSERT" && p.using) bits.push(`  USING (${p.using})`);
      if ((cmd === "INSERT" || cmd === "UPDATE" || cmd === "ALL") && p.with_check)
        bits.push(`  WITH CHECK (${p.with_check})`);
      out.push(bits.join("\n") + ";");
    }
  }
  return out;
}

/* ─────────────── functions, views and triggers: replayed ─────────────── */

function readMigration(root, file) {
  const p = path.join(root, MIGRATIONS_DIR, file);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/**
 * Replay each function from the migration the artifact says last defined it.
 * A stub would type-check and then lie: WP 2.1's failure was INSIDE a body.
 */
function emitFunctions(artifact, root, warn) {
  const out = [];
  const byFile = new Map();
  for (const fn of artifact.functions || []) {
    if (!fn.defined_by) continue;
    if (!byFile.has(fn.defined_by)) byFile.set(fn.defined_by, []);
    byFile.get(fn.defined_by).push(fn);
  }
  // Migration order, so a function defined in terms of an earlier one lands after it.
  for (const file of [...byFile.keys()].sort()) {
    const sql = readMigration(root, file);
    if (sql === null) {
      warn(`function source missing: ${file}`);
      continue;
    }
    const creates = statementsMatching(sql, /^CREATE (OR REPLACE )?FUNCTION\b/i);
    for (const fn of byFile.get(file)) {
      const match = creates.filter((s) =>
        new RegExp(`^CREATE (OR REPLACE )?FUNCTION\\s+(public\\.)?"?${fn.name}"?\\s*\\(`, "i").test(
          squash(s),
        ),
      );
      if (!match.length) {
        warn(`no CREATE FUNCTION for ${fn.name} in ${file}`);
        continue;
      }
      // A file may define two overloads of the same name; take them all.
      for (const s of match) out.push(asReplace(s, "FUNCTION") + ";");
    }
  }
  const emitted = dedupeKeepLast(out);

  // THE COMMENTS, AFTER EVERY BODY (D73). A `COMMENT ON FUNCTION` may live in a
  // different migration from the `CREATE`, so it cannot be replayed from the
  // defining file the way the body is — it is carried in the artifact and
  // emitted here, once every function exists. Without this the reconstructed
  // base had functions with no documentation, and an assertion about a
  // deprecation comment failed in `--since HEAD` alone: the mode that builds
  // the shape `main` meets after the merge, which is the mode D52 was added for.
  for (const fn of artifact.functions || []) {
    if (!fn.comment) continue;
    const args = (fn.args || []).join(", ");
    emitted.push(
      `COMMENT ON FUNCTION public.${fn.name}(${args}) IS '${String(fn.comment).replace(/'/g, "''")}';`,
    );
  }
  return emitted;
}

function emitViews(artifact, root, warn) {
  const out = [];
  const entries = Object.entries(artifact.views || {});
  entries.sort((a, b) => String(a[1].defined_by).localeCompare(String(b[1].defined_by)));
  for (const [name, def] of entries) {
    const sql = readMigration(root, def.defined_by);
    if (sql === null) {
      warn(`view source missing: ${def.defined_by} (${name})`);
      continue;
    }
    const creates = statementsMatching(
      sql,
      new RegExp(`^CREATE (OR REPLACE )?(MATERIALIZED )?VIEW\\s+(public\\.)?"?${name}"?\\b`, "i"),
    );
    if (!creates.length) {
      warn(`no CREATE VIEW for ${name} in ${def.defined_by}`);
      continue;
    }
    out.push(asReplace(creates[creates.length - 1], "VIEW") + ";");
    if (def.security_invoker)
      out.push(`ALTER VIEW public.${q(name)} SET (security_invoker = true);`);
  }
  return out;
}

/**
 * Triggers are the one thing the artifact does not record, and they are exactly
 * where a run-time error hides — WP 2.3's audit is twelve tables of them. So
 * they are scanned out of the migration set directly, last definition wins.
 */
function emitTriggers(root, files) {
  const byKey = new Map();
  // IN STATEMENT ORDER, not CREATEs then DROPs. Nearly every migration here
  // writes `DROP TRIGGER IF EXISTS x` immediately BEFORE `CREATE TRIGGER x`, so
  // reading all the CREATEs of a file and then all its DROPs deletes exactly the
  // triggers the file installs — which is how the audit triggers vanished from
  // the first version of this base and D45's proof had nothing to fire.
  for (const file of files) {
    const sql = readMigration(root, file);
    if (sql === null) continue;
    for (const s of splitStatements(sql)) {
      const flat = squash(s);
      const created = flat.match(
        /^CREATE (?:OR REPLACE )?(?:CONSTRAINT )?TRIGGER\s+"?([A-Za-z0-9_]+)"?\s+.*?\bON\s+("?[A-Za-z0-9_]+"?(?:\."?[A-Za-z0-9_]+"?)?)/i,
      );
      if (created) {
        const table = created[2].includes(".") ? created[2] : `public.${created[2]}`;
        byKey.set(`${table}:${created[1]}`, { name: created[1], table, sql: s });
        continue;
      }
      // A migration that drops a trigger and never recreates it must not leave
      // it behind.
      const dropped = flat.match(
        /^DROP TRIGGER (?:IF EXISTS )?"?([A-Za-z0-9_]+)"?\s+ON\s+("?[A-Za-z0-9_]+"?(?:\."?[A-Za-z0-9_]+"?)?)/i,
      );
      if (dropped) {
        const table = dropped[2].includes(".") ? dropped[2] : `public.${dropped[2]}`;
        byKey.delete(`${table}:${dropped[1]}`);
      }
    }
  }
  const out = [];
  for (const t of byKey.values()) {
    out.push(`DROP TRIGGER IF EXISTS ${q(t.name)} ON ${t.table};`);
    out.push(t.sql + ";");
  }
  return out;
}

/**
 * GRANT and REVOKE, in migration order, every one of them.
 *
 * Not in the artifact either, and without them the rehearsal cannot ask the
 * only question that matters about a view or a policy: what does a given ROLE
 * see? `SET ROLE authenticated; SELECT … FROM v_admin_user_usage` answers
 * "permission denied for view" on a base that has the view and not its grant —
 * which looks like a failing assertion and is a missing shim.
 *
 * Applied in order rather than deduplicated: a GRANT followed by a REVOKE is
 * two facts, and keeping only the last occurrence of each statement text would
 * silently reorder them.
 */
function emitGrants(root, files) {
  // SUPABASE'S BOOTSTRAP GRANT COMES FIRST, and leaving it out was a real bug
  // in this file: without it a `SET ROLE authenticated` assertion answers
  // "permission denied for table approved_users" on a database where production
  // would have answered with rows. A rehearsal stricter than production is as
  // misleading as one more permissive — it just fails in the other direction.
  //
  // Supabase's project bootstrap grants the three PostgREST roles full table
  // access in `public` and relies on RLS for the actual rule, which is why D28
  // is about POLICIES and not about grants. Reproducing it is what makes "what
  // does this role see?" a question this database can answer.
  const out = [
    "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;",
    "GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;",
    "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;",
  ];
  for (const file of files) {
    const sql = readMigration(root, file);
    if (sql === null) continue;
    for (const s of statementsMatching(sql, /^(GRANT|REVOKE)\b/i)) {
      // Grants to roles Supabase defines and this rehearsal does not are the
      // caller's problem to notice, not this function's to guess at.
      out.push(s + ";");
    }
  }
  return out;
}

/** `CREATE FUNCTION` → `CREATE OR REPLACE FUNCTION`, so a re-definition is not 42723. */
function asReplace(stmt, kind) {
  const re = new RegExp(`^CREATE\\s+${kind}\\b`, "i");
  return re.test(stmt.trimStart()) ? stmt.replace(re, `CREATE OR REPLACE ${kind}`) : stmt;
}

function dedupeKeepLast(statements) {
  const seen = new Map();
  statements.forEach((s, i) => seen.set(squash(s), i));
  return statements.filter((s, i) => seen.get(squash(s)) === i);
}

/* ───────────────────────────── assembly ───────────────────────────── */

/**
 * THREE FILES, NOT ONE, AND THE SPLIT IS THE POINT.
 *
 * `structure` and `rules` are derived from the ARTIFACT, which is itself gated
 * (`contract:introspect -- --check` fails when it drifts from the migrations).
 * They must apply whole, in one transaction: a failure there is a defect in
 * this generator, and the runner says so rather than blaming the migration.
 *
 * `replay` is historical migration TEXT, and history is known not to be
 * replayable — 92 of 296 files fail on an empty database (§16 · WP 2.1
 * follow-up). It is applied statement by statement and its failures are
 * REPORTED, not fatal. They are real findings about the repository's past
 * (`create_disruption_scenario_v2` in `20250827170942` puts a parameter with no
 * default after one that has a default — 42P13, which means that migration
 * aborted in production too), and they are not the pull request's fault.
 *
 * @param {object} artifact  a parsed build/schema.introspected.json
 * @param {string} root      repo root, for reading the migrations it replays
 * @returns {{structure: string, replay: string, rules: string, warnings: string[]}}
 */
export function buildRehearsalSchema(artifact, root = ".") {
  const warnings = [];
  const warn = (m) => warnings.push(m);
  const files = migrationFiles(root);

  const section = (title, statements) =>
    statements.length ? [`\n-- ── ${title} (${statements.length}) ──`, ...statements] : [];

  const header = [
    "-- GENERATED by scripts/data-contract/rehearsal-schema.mjs — do not edit.",
    `-- base artifact: ${artifact.last_migration || "(unknown)"} · ` +
      `${artifact.counts?.tables ?? "?"} tables`,
    // Per FILE, not once: each phase is its own psql session and `SET` does not
    // survive one. The migrations under review are applied WITHOUT it, because
    // production's `db push` does not have it either.
    "SET check_function_bodies = off;",
  ];
  const join = (parts) => parts.join("\n") + "\n";

  return {
    structure: join([
      ...header,
      PRELUDE,
      ...section("enums", emitEnums(artifact)),
      ...section("tables", emitTables(artifact)),
    ]),
    replay: join([
      ...header,
      "-- Replayed from the migrations the artifact names. Best effort, by design.",
      ...section("functions", emitFunctions(artifact, root, warn)),
      ...section("views", emitViews(artifact, root, warn)),
      ...section("triggers", emitTriggers(root, files)),
      ...section("grants", emitGrants(root, files)),
    ]),
    rules: join([
      ...header,
      ...section("column defaults", emitDefaults(artifact)),
      ...section("constraints", emitConstraints(artifact, warn)),
      ...section("indexes", emitIndexes(artifact, warn)),
      ...section("row level security", emitRls(artifact)),
    ]),
    warnings,
  };
}
