#!/usr/bin/env node
// Rehearse the NEW migrations in a branch against a real PostgreSQL 16 (D31).
//
//   npm run contract:rehearse                 # the migrations this branch adds
//   npm run contract:rehearse -- --since origin/main
//   npm run contract:rehearse -- --migration supabase/migrations/2026….sql
//   npm run contract:rehearse -- --emit /tmp/base --no-apply   # write the SQL, run nothing
//
// WHAT IT GATES, AND WHAT IT DOES NOT. It applies the migrations a pull request
// ADDS, in order, to the schema the base branch's contract describes. It is not
// a replay of history: 92 of 296 migrations fail on an empty database and always
// will (§16 · WP 2.1 follow-up). The file under review is the file that runs.
//
// It is therefore an EXECUTION gate, not an equivalence proof. A migration that
// passes here can still fail on production for something the artifact does not
// know — a table production has that no migration creates (D43), Supabase's own
// grants, an extension. Those are other gates. What it closes is the class WP
// 2.1 hit four times: an error that only exists at run time.
//
// CONNECTION. Standard libpq environment (PGHOST/PGPORT/PGUSER/PGDATABASE) or
// --database-url. CI uses a `postgres:16` service container; a work-package
// session can point it at a local cluster. It NEVER reaches production: the
// live project is only ever touched by verification-sql.mjs (read-only) and by
// `supabase db push`.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRehearsalSchema } from "./rehearsal-schema.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 || i === args.length - 1 ? fallback : args[i + 1];
};
const opts = (name) =>
  args.reduce((acc, a, i) => (a === name && args[i + 1] ? [...acc, args[i + 1]] : acc), []);

const ROOT = process.cwd();
const MIGRATIONS = "supabase/migrations";
const ARTIFACT = "build/schema.introspected.json";

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/* ───────────────────────── which migrations ───────────────────────── */

function git(...a) {
  return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
}
function gitOk(...a) {
  const r = spawnSync("git", a, { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * The migrations this branch adds, relative to `since`.
 *
 * ADDED files only. A MODIFIED migration is a file production has already run,
 * and re-running it here would be a replay of history rather than a rehearsal
 * of new work — the thing this gate is explicitly not. R4 and the introspector
 * already refuse a silently edited migration.
 */
function newMigrations(since) {
  const base = gitOk("merge-base", since, "HEAD") || since;
  const diff = gitOk("diff", "--name-only", "--diff-filter=A", `${base}..HEAD`, "--", MIGRATIONS);
  if (diff === null) return null;
  return diff.split("\n").filter((f) => f.endsWith(".sql")).sort();
}

/* ─────────────────────────── the base schema ─────────────────────────── */

/**
 * The artifact as of the base branch — the shape a new migration actually
 * meets. Reading HEAD's artifact instead would hand the migration a database
 * that already contains everything it is about to create, which is the one
 * reading that cannot fail.
 */
function baseArtifact(since) {
  const fromBase = gitOk("show", `${gitOk("merge-base", since, "HEAD") || since}:${ARTIFACT}`);
  if (fromBase) return { json: JSON.parse(fromBase), source: `${since} (merge-base)` };
  const local = readFileSync(path.join(ROOT, ARTIFACT), "utf8");
  return { json: JSON.parse(local), source: `${ARTIFACT} (working tree — no base revision found)` };
}

/* ───────────────────────────── psql ───────────────────────────── */

function psqlEnv() {
  const url = opt("--database-url", process.env.DATABASE_URL || null);
  const env = { ...process.env, PGOPTIONS: "-c client_min_messages=warning" };
  return { url, env };
}

function psql(fileOrSql, { isFile = true, db = null, single = true, stopOnError = true } = {}) {
  const { url, env } = psqlEnv();
  const a = ["-v", `ON_ERROR_STOP=${stopOnError ? 1 : 0}`, "-X", "-q"];
  if (single) a.push("--single-transaction");
  if (url) a.push(url);
  if (db) a.push("-d", db);
  a.push(isFile ? "-f" : "-c", fileOrSql);
  return spawnSync("psql", a, { env, encoding: "utf8" });
}

function psqlScalar(sql, db) {
  const { url, env } = psqlEnv();
  const a = ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"];
  if (url) a.push(url);
  if (db) a.push("-d", db);
  a.push("-c", sql);
  const r = spawnSync("psql", a, { env, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/* ───────────────────────────── main ───────────────────────────── */

function main() {
  const since = opt("--since", process.env.REHEARSE_SINCE || "origin/main");
  const explicit = opts("--migration");
  const emitTo = opt("--emit", null);
  const apply = !flag("--no-apply");

  console.log(bold("\n── migration rehearsal (PLAN.md §4 D31) ───────────────────────\n"));

  const { json: artifact, source } = baseArtifact(since);
  console.log(`  base schema   ${source}`);

  const files = explicit.length ? explicit : newMigrations(since);
  if (files === null) {
    console.log(red(`\n  cannot diff against ${since} — fetch it, or pass --migration explicitly`));
    process.exit(2);
  }

  const base = buildRehearsalSchema(artifact, ROOT);
  for (const w of base.warnings) console.log(dim(`  ⚠ ${w}`));

  const work = mkdtempSync(path.join(tmpdir(), "rehearsal-"));
  const dir = emitTo || work;
  mkdirSync(dir, { recursive: true });
  const phases = [
    { name: "structure", file: path.join(dir, "01-structure.sql"), sql: base.structure, strict: true },
    { name: "replay", file: path.join(dir, "02-replay.sql"), sql: base.replay, strict: false },
    { name: "rules", file: path.join(dir, "03-rules.sql"), sql: base.rules, strict: true },
  ];
  for (const p of phases) writeFileSync(p.file, p.sql);
  console.log(
    `  base SQL      ${dir} · ` +
      phases.map((p) => `${p.name} ${p.sql.split("\n").length}L`).join(" · "),
  );

  // A branch with no new migrations still gets a database: the behavioural
  // assertions below run against the BASE, and D45 is a claim about what the
  // base already does. Skipping them on a docs-only pull request would make the
  // proof arrive only on the days it is least likely to be read.
  if (!files.length) {
    console.log(dim("  rehearsing    no new migrations in this branch — base only"));
  } else {
    console.log(`  rehearsing    ${files.length} new migration(s):`);
    for (const f of files) console.log(`                  ${path.basename(f)}`);
  }

  if (!apply) {
    console.log(dim("\n  --no-apply: schema emitted, nothing executed\n"));
    process.exit(0);
  }

  // A named, dropped-and-recreated database, so a re-run is never contaminated
  // by the one before it.
  const db = opt("--db", "rehearsal");
  console.log(bold(`\n  building ${db} …`));
  for (const stmt of [`DROP DATABASE IF EXISTS ${db}`, `CREATE DATABASE ${db}`]) {
    const r = psql(stmt, { isFile: false, single: false });
    if (r.status !== 0) {
      console.log(red(`\n  cannot reach PostgreSQL: ${(r.stderr || r.error?.message || "").trim()}`));
      console.log(dim("  set PGHOST/PGPORT/PGUSER or --database-url; CI uses a postgres:16 service\n"));
      process.exit(2);
    }
  }

  for (const phase of phases) {
    const r = psql(phase.file, { db, single: phase.strict, stopOnError: phase.strict });
    if (phase.strict && r.status !== 0) {
      // A strict phase failing is a defect in THIS generator or in the
      // artifact, never in the migration under review. Saying which is the
      // difference between a usable gate and a flaky one.
      console.log(red(`\n  ✗ the base schema (${phase.name}) did not apply — not the migration's fault`));
      console.log(indent(r.stderr));
      console.log(dim(`  the generated base is at ${phase.file}\n`));
      process.exit(3);
    }
    if (!phase.strict) {
      const errs = String(r.stderr || "")
        .split("\n")
        .filter((l) => /\bERROR:/.test(l));
      if (errs.length) {
        console.log(
          dim(`  ⚠ ${errs.length} historical definition(s) do not replay — reported, not fatal:`),
        );
        for (const e of errs.slice(0, 10)) console.log(dim(`      ${e.trim()}`));
        if (errs.length > 10) console.log(dim(`      … and ${errs.length - 10} more`));
      }
    }
  }
  const tables = psqlScalar(
    "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
    db,
  );
  const fns = psqlScalar(
    "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",
    db,
  );
  const pols = psqlScalar("select count(*) from pg_policies where schemaname='public'", db);
  console.log(green(`  ✓ base applied · ${tables} tables · ${fns} functions · ${pols} policies`));

  let failed = 0;
  for (const f of files) {
    const name = path.basename(f);
    const r = psql(path.resolve(ROOT, f), { db });
    if (r.status === 0) {
      console.log(green(`  ✓ ${name}`));
    } else {
      failed++;
      console.log(red(`  ✗ ${name}`));
      console.log(indent(r.stderr));
    }
  }

  if (failed) {
    console.log(
      red(bold(`\n✗ ${failed} migration(s) fail at RUN TIME.\n`)) +
        "  This is the error production would have shown on deploy. Fix the file;\n" +
        "  a static replay cannot see it (PLAN.md §4 D31).\n",
    );
    process.exit(1);
  }
  if (files.length)
    console.log(green(bold(`\n✓ ${files.length} migration(s) apply cleanly to the base schema`)));

  failed += runAssertions(db);
  if (failed) process.exit(1);
  console.log("");
}

/* ─────────────────────── behavioural assertions ─────────────────────── */

/**
 * `supabase/rehearsal/*.sql`, each run against the rehearsed database.
 *
 * WHY THESE EXIST, AND WHY HERE. `dataPlaneAudit.test.ts` reads the migration
 * TEXT and asserts every tier 2/3/4 table has its three triggers. That is a
 * structural gate and it passed the whole time production was writing ZERO
 * data-plane audit rows (D45) — 18 rows, all `plane='admin'`. The gap between
 * "the trigger is declared" and "the trigger fires" needs a database, and until
 * D31 there was no database to put it in.
 *
 * Each file runs inside ONE transaction that is then ROLLED BACK, so an
 * assertion can insert whatever it needs and the next one still meets a clean
 * database. A file signals failure the only way SQL can: `RAISE EXCEPTION`.
 */
function runAssertions(db) {
  const dir = path.join(ROOT, "supabase", "rehearsal");
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  if (!files.length) return 0;

  console.log(bold(`\n  behaviour, on that database (${files.length} assertion file(s)):`));
  let failed = 0;
  for (const f of files) {
    const { url, env } = psqlEnv();
    const a = ["-v", "ON_ERROR_STOP=1", "-X", "-q"];
    if (url) a.push(url);
    a.push("-d", db, "-c", "BEGIN", "-f", path.join(dir, f), "-c", "ROLLBACK");
    const r = spawnSync("psql", a, { env, encoding: "utf8" });
    if (r.status === 0) {
      const said = String(r.stdout || "").trim();
      console.log(green(`  ✓ ${f}`) + (said ? dim(`  ${said.split("\n").pop()}`) : ""));
    } else {
      failed++;
      console.log(red(`  ✗ ${f}`));
      console.log(indent(r.stderr));
    }
  }
  if (failed) console.log(red(bold(`\n✗ ${failed} behavioural assertion(s) failed\n`)));
  return failed;
}

const indent = (s) =>
  String(s || "")
    .trimEnd()
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n");

main();
