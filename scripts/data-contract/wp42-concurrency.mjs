#!/usr/bin/env node
/**
 * WP 4.2 · §11's GAP CHECK — two parallel requests on a COLD key must not
 * create two runs.
 *
 * WHY THIS IS NOT IN `supabase/rehearsal/120`. A rehearsal file is ONE
 * transaction, and the question here is what TWO transactions do to each other.
 * Inside a single session the second `analysis_get_or_start` sees the first
 * one's uncommitted row through its own snapshot, so the race it is supposed to
 * exercise cannot happen. §11 asks for concurrency; a single-transaction
 * assertion would answer a different question and report it as this one.
 *
 * THE MECHANISM UNDER TEST is the claim in `analysis_get_or_start`:
 *
 *     INSERT INTO analysis_runs (...) VALUES (...) ON CONFLICT DO NOTHING
 *     RETURNING * INTO v_run;
 *
 * The SELECT above it is NOT a lock and nothing here pretends it is: on a cold
 * key BOTH sessions miss it. What serialises them is `analysis_runs_key_uniq`.
 * Session B's INSERT blocks on A's uncommitted index entry; when A commits, B's
 * `ON CONFLICT DO NOTHING` matches, returns NOTHING rather than raising, and B
 * falls through to re-read the winner's row. A read-then-write with no unique
 * index would produce two runs and two computations of the same analysis —
 * which is the whole defect this package exists to close, arriving through the
 * one door a single-session test cannot watch.
 *
 * Run it against the database `contract:rehearse` leaves behind:
 *
 *     PGHOST=/tmp PGPORT=5433 PGUSER=postgres npm run contract:rehearse
 *     PGHOST=/tmp PGPORT=5433 PGUSER=postgres node scripts/data-contract/wp42-concurrency.mjs
 */
import { spawn, spawnSync } from "node:child_process";

const DB = process.env.REHEARSAL_DB ?? "rehearsal";
const PSQL = ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-A", "-t", "-d", DB];

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const failures = [];
const check = (ok, what, detail) => {
  if (ok) console.log(`  ${green("✓")} ${what}`);
  else { console.log(`  ${red("✗")} ${what}`); console.log(dim(`      ${detail}`)); failures.push(what); }
};

function sql(text) {
  const r = spawnSync("psql", [...PSQL, "-c", text], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql: ${(r.stderr || "").trim()}`);
  return r.stdout.trim();
}

/** A psql running a script asynchronously, so two can overlap in real time. */
function sqlAsync(text) {
  return new Promise((resolve) => {
    const p = spawn("psql", [...PSQL], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const started = Date.now();
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim(), ms: Date.now() - started }));
    p.stdin.end(text);
  });
}

const PROJECT = "00000000-0000-4000-8000-0000000422f0";
const ACTOR = "00000000-0000-4000-8000-0000000422f1";

console.log("\n── WP 4.2 · concurrency on a cold key ─────────────────────────\n");

// The store must exist, or the whole run is a green test that checked nothing —
// this repo's recurring failure mode (§16 · WP 4.1 · B).
try {
  const present = sql(`select to_regproc('public.analysis_get_or_start') is not null`);
  if (present !== "t") {
    console.log(red(`  the analysis store is not in database "${DB}".`));
    console.log(dim("  run `npm run contract:rehearse` first — it leaves the database behind.\n"));
    process.exit(2);
  }
} catch (e) {
  console.log(red(`  cannot reach PostgreSQL database "${DB}": ${e.message}`));
  console.log(dim("  set PGHOST/PGPORT/PGUSER; `npm run contract:rehearse` builds the database.\n"));
  process.exit(2);
}

// AND THE INDEX UNDER TEST IS THE REAL ONE. This guard exists because the first
// run of this script reported TWO runs on one key and looked like a genuine
// defect. It was not: the database still held a MUTANT schema from the previous
// mutation round, where `analysis_runs_key_uniq` had been downgraded to a
// non-unique index on purpose. The script had faithfully measured a mutant and
// would have reported it as the product.
//
// A test that cannot tell which schema it is testing is the same failure mode as
// a scan that finds nothing and passes, so the property the whole file depends
// on is asserted before anything is measured rather than assumed from a
// database that happens to be lying around.
{
  const idx = sql(`
    select i.indisunique::text || ' ' || (i.indpred is not null)::text
      from pg_index i join pg_class c on c.oid = i.indexrelid
     where c.relname = 'analysis_runs_key_uniq'`);
  if (idx !== "true true") {
    console.log(red(`  the key index in database "${DB}" is not the real one (indisunique/partial = ${idx || "absent"}).`));
    console.log(dim("  re-run `npm run contract:rehearse` to rebuild the database before measuring.\n"));
    process.exit(2);
  }
}

// ── a project with real tier-2 rows, so `current_graph_hash` has something to
// hash. A project with no inputs still hashes, but a cold key on an empty
// project would not exercise the same path the analyzers take.
sql(`
  delete from public.analysis_runs where project_id = '${PROJECT}';
  delete from public.projects where id = '${PROJECT}';
  delete from public.approved_users where id = '${ACTOR}';
  delete from auth.users where id = '${ACTOR}';
  insert into auth.users (id, email) values ('${ACTOR}', 'wp42conc@example.invalid');
  insert into public.approved_users (id, email, name, password_hash)
    values ('${ACTOR}', 'wp42conc@example.invalid', 'WP42 concurrency', 'x');
  insert into public.projects (id, name, modeler_id, plant_name)
    values ('${PROJECT}', 'WP42 concurrency', '${ACTOR}', 'WP42C');
  insert into public.suppliers (project_id, supplier_id) values ('${PROJECT}', 'S1');
  insert into public.materials (project_id, material_id, cost) values ('${PROJECT}', 'M1', 10);
  insert into public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id, lead_time, lead_time_unit, volume, unit_price)
    values ('${PROJECT}', 'WP42C', 'S1', 'M1', 7, 'days', 100, 10);
`);

const claim = (kind) => `
  BEGIN;
  SELECT public.analysis_get_or_start(
    '${PROJECT}'::uuid, '${kind}', '{}'::jsonb, 'cc@1', '${ACTOR}'::uuid) ->> 'run_id';
`;

// ── 1 · the overlap, forced rather than hoped for ───────────────────────────
//
// A "fire both and hope they collide" test passes on a machine where they do
// not overlap, which is a green test that checked nothing. Session A holds its
// transaction open across a `pg_sleep`, so B's claim is GUARANTEED to arrive
// while A's index entry is uncommitted — the exact window the race lives in.

const A = sqlAsync(`${claim("concurrent")} SELECT pg_sleep(2); COMMIT;`);
await new Promise((r) => setTimeout(r, 600));           // B arrives mid-window
const B = sqlAsync(`${claim("concurrent")} COMMIT;`);

const [ra, rb] = await Promise.all([A, B]);

check(ra.code === 0, "session A completed its claim", ra.err);
check(rb.code === 0, "session B completed its claim", rb.err);

// B must have WAITED. If it returned immediately it never entered the window,
// and everything below would be asserting about two sequential calls.
check(
  rb.ms >= 1000,
  `session B BLOCKED on A's uncommitted key (${rb.ms} ms)`,
  `B returned in ${rb.ms} ms, so it never overlapped A and this run proves nothing ` +
    `about concurrency. The unique index is what makes B wait.`,
);

const runs = sql(
  `select count(*) from public.analysis_runs
    where project_id = '${PROJECT}' and analysis_kind = 'concurrent'`);
check(
  runs === "1",
  `two parallel requests on a cold key created exactly ONE run (got ${runs})`,
  `${runs} runs exist. Two sessions each computed the same analysis against the same ` +
    `inputs, the same params and the same code — which is the duplicate work the ` +
    `store exists to prevent, and it means the claim is a read-then-write race ` +
    `rather than one INSERT against one unique index.`,
);

const idA = ra.out.split("\n").filter(Boolean).pop();
const idB = rb.out.split("\n").filter(Boolean).pop();
check(
  idA && idB && idA === idB,
  "both sessions were handed the SAME run id",
  `A got ${idA}, B got ${idB}. The loser of the race must be given the winner's run, ` +
    `not a second one and not an error.`,
);

// ── 2 · the loser is not told it has an answer ──────────────────────────────
//
// B lost the race to a claim that was still RUNNING. Reporting that as a cache
// hit would hand a caller a run id with no results behind it.
const hit = sql(`
  select public.analysis_get_or_start(
    '${PROJECT}'::uuid, 'concurrent', '{}'::jsonb, 'cc@1', '${ACTOR}'::uuid) ->> 'cache_hit'`);
check(
  hit === "false",
  "an unfinished claim is NOT reported as a cache hit",
  `cache_hit=${hit} for a run that has not completed.`,
);

// ── 3 · and once it completes, the next request hits ────────────────────────
sql(`
  select public.analysis_complete_run(
    (select id from public.analysis_runs
      where project_id = '${PROJECT}' and analysis_kind = 'concurrent' limit 1),
    '[{"entity_type":"node","entity_id":"S1","metrics":{"degree":1}}]'::jsonb,
    '{"nodes":1}'::jsonb, '[]'::jsonb, '${ACTOR}'::uuid)`);
const hit2 = sql(`
  select public.analysis_get_or_start(
    '${PROJECT}'::uuid, 'concurrent', '{}'::jsonb, 'cc@1', '${ACTOR}'::uuid) ->> 'cache_hit'`);
check(hit2 === "true", "once the winner completes, the next request is a HIT", `cache_hit=${hit2}`);

const finalRuns = sql(
  `select count(*) from public.analysis_runs
    where project_id = '${PROJECT}' and analysis_kind = 'concurrent'`);
check(finalRuns === "1", `still exactly ONE run after four requests (got ${finalRuns})`, "");

console.log("");
if (failures.length) {
  console.log(red(`✗ ${failures.length} concurrency assertion(s) failed\n`));
  process.exit(1);
}
console.log(green("✓ two parallel requests on a cold key create exactly one run\n"));
