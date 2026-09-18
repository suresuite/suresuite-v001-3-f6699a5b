#!/usr/bin/env node
// The LIVE definitions — which CREATE POLICY / CREATE FUNCTION in
// supabase/migrations/ is the one the database actually has.
// (Phase 2 / WP 2.1 / PLAN.md §9.)
//
// WHY THIS EXISTS. `grep -c get_current_user_org() supabase/migrations/` returns
// 221. That number sized WP 2.1 and it is the wrong number to work from: a
// migration directory is an append-only LOG, not a description of a schema. A
// policy is DROPped and re-CREATEd across a dozen files, a function is CREATE OR
// REPLACEd a dozen more times, three migrations rolled back entirely, and one
// DROP TABLE ... CASCADE takes every policy on that table with it. Only the last
// surviving definition of each object is what Postgres is running.
//
// Replaying the log the way `introspect.mjs` replays DDL gives the real figure:
// 122 calls in 102 live objects, out of 222 textual occurrences. The other 100
// are in superseded definitions, and rewriting them would change nothing in any
// database while doubling the diff a reviewer has to read.
//
// Same discipline as the introspector: last-write-wins is EVALUATED, not assumed,
// and aborted migrations come from the introspector's own artifact rather than
// being re-derived here.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitStatements, squash } from "./sql-lex.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const INTROSPECTED = join(ROOT, "build", "schema.introspected.json");

const unquote = (s) => s.replace(/^"(.*)"$/, "$1");
const bare = (s) => unquote(s).replace(/^public\./i, "");

/**
 * The comma-separated argument TYPES of the first `(...)` in `tail`, normalised,
 * or null when there is no argument list at all.
 *
 * Deliberately crude — it compares two spellings of the same signature from the
 * same repository, not arbitrary SQL — and it takes the LAST word of each
 * argument so `p_user_id uuid` and `uuid` compare equal.
 */
function argTypesOf(tail) {
  const open = tail.indexOf("(");
  if (open === -1) return null;
  let depth = 0, close = -1;
  for (let i = open; i < tail.length; i++) {
    if (tail[i] === "(") depth++;
    else if (tail[i] === ")") { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close === -1) return null;
  const body = tail.slice(open + 1, close).trim();
  if (!body) return "";
  return body
    .split(",")
    .map((a) => squash(a).replace(/\bDEFAULT\b[\s\S]*$/i, "").trim().split(/\s+/).pop())
    .map((t) => (t ?? "").toLowerCase().replace(/^public\./, ""))
    .join(",");
}

/**
 * Replay every migration in filename order and return the definitions that
 * survive.
 *
 * @returns {{policies: Map<string, {table:string, name:string, migration:string, sql:string}>,
 *            functions: Map<string, {name:string, migration:string, sql:string}>,
 *            triggers: Map<string, {table:string, name:string, migration:string, sql:string}>,
 *            textualCallSites: number}}
 */
export function liveDefinitions() {
  const aborted = new Set(
    JSON.parse(readFileSync(INTROSPECTED, "utf8")).aborted_migrations.map((a) => a.migration),
  );
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  const policies = new Map();   // "table::policy name" -> record
  // "name" -> record. ARGS ARE STILL IGNORED IN THE KEY, and the comment that
  // used to sit here said "this repo never overloads". **It does, nine times**
  // (§4 D100): `create_project` carries six live overloads, `update_project`
  // five, and `create_disruption_scenario_v2` two. So this map holds ONE body
  // per name — the last CREATE wins — and a rule scoped to it reads that body
  // and no other.
  //
  // What is fixed below is the worse half. A `DROP FUNCTION` naming a SPECIFIC
  // signature used to delete the name outright, so five live functions vanished
  // from this map altogether: `create_disruption_scenario_v2` — which writes
  // four tier-4 tables — plus `get_network_nodes`, `_edges` and `_summary`, and
  // `http_post`. Every rule scoped to these functions was blind to them,
  // `dataPlaneAudit.test.ts`'s writer scan included. That is D78's shape on a
  // different axis: the scan could not see what it was not looking at.
  const functions = new Map();
  // TRIGGERS are replayed here and NOWHERE ELSE. `introspect.mjs` has
  // `CREATE TRIGGER` on its ignore list by design — it builds a COLUMN schema —
  // so "does this table have an audit trigger?" had no source in the contract at
  // all, and `governance.audited` was a hand-maintained boolean nothing could
  // check. It drifted the moment WP 2.3 shipped: twelve tables gained three
  // triggers each and all twelve sidecars still said `audited: false`, which the
  // generated pages published as "Tier transitions audited: no". Giving the fact
  // a source is what lets `contract:check` R9 compare the two.
  const triggers = new Map();   // "table::trigger name" -> record
  let textualCallSites = 0;

  for (const file of files) {
    if (aborted.has(file)) continue;
    for (const raw of splitStatements(readFileSync(join(MIGRATIONS, file), "utf8"))) {
      const head = squash(raw);
      textualCallSites += (raw.match(/get_current_user_org\(\)/g) ?? []).length;
      let m;

      if ((m = /^CREATE\s+POLICY\s+("[^"]*"|[a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_."]+)/i.exec(head))) {
        const table = bare(m[2]), name = unquote(m[1]);
        policies.set(`${table}::${name}`, { table, name, migration: file, sql: raw });
      } else if ((m = /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("[^"]*"|[a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_."]+)/i.exec(head))) {
        policies.delete(`${bare(m[2])}::${unquote(m[1])}`);
      } else if ((m = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z0-9_."]+)/i.exec(head))) {
        const name = bare(m[1]);
        functions.set(name, { name, migration: file, sql: raw });
      } else if ((m = /^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/i.exec(head))) {
        // A DROP that names an argument list removes ONE overload. Deleting the
        // whole name here is what made five live functions invisible (D100), so
        // a signature-qualified DROP only removes the stored record when that
        // record is the overload being dropped. An unqualified DROP still
        // removes the name, because PostgreSQL only accepts one when the name
        // is unambiguous.
        const name = bare(m[1]);
        const held = functions.get(name);
        const dropArgs = argTypesOf(head.slice(m[0].length));
        if (!held || dropArgs === null || argTypesOf(held.sql.slice(held.sql.toLowerCase().indexOf(name) + name.length)) === dropArgs) {
          functions.delete(name);
        }
      } else if ((m = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+("[^"]*"|[a-zA-Z0-9_]+)\s+(?:BEFORE|AFTER|INSTEAD\s+OF)\s+[\s\S]*?\sON\s+([a-zA-Z0-9_."]+)/i.exec(head))) {
        const table = bare(m[2]), name = unquote(m[1]);
        triggers.set(`${table}::${name}`, { table, name, migration: file, sql: raw });
      } else if ((m = /^DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?("[^"]*"|[a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_."]+)/i.exec(head))) {
        triggers.delete(`${bare(m[2])}::${unquote(m[1])}`);
      } else if ((m = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/i.exec(head))) {
        // CASCADE or not, the policies and triggers go with the table.
        const table = bare(m[1]);
        for (const key of [...policies.keys()]) {
          if (key.startsWith(`${table}::`)) policies.delete(key);
        }
        for (const key of [...triggers.keys()]) {
          if (key.startsWith(`${table}::`)) triggers.delete(key);
        }
      }
    }
  }
  return { policies, functions, triggers, textualCallSites };
}

/**
 * Tables that have a LIVE data-plane audit trigger — the source of truth for
 * each sidecar's `governance.audited`. WP 2.3's triggers all call
 * `audit_tier_write`, which is the one function that writes an audit row on a
 * tier transition; a trigger that does anything else (`set_project_defaults`,
 * `updated_at` stamps) is not auditing and must not be counted as such.
 *
 * @returns {Map<string, string[]>} table -> the names of its audit triggers
 */
export function auditedTables() {
  const { triggers } = liveDefinitions();
  const byTable = new Map();
  for (const t of triggers.values()) {
    if (!/audit_tier_write\s*\(/i.test(t.sql)) continue;
    if (!byTable.has(t.table)) byTable.set(t.table, []);
    byTable.get(t.table).push(t.name);
  }
  for (const names of byTable.values()) names.sort();
  return byTable;
}

/** Live objects whose definition still mentions the text-org function. */
export function liveTextOrgCallers() {
  const { policies, functions, textualCallSites } = liveDefinitions();
  const keep = (map) =>
    new Map([...map].filter(([, v]) => /get_current_user_org\(\)/.test(v.sql)));
  return { policies: keep(policies), functions: keep(functions), textualCallSites };
}

/** Count of `get_current_user_org()` occurrences in the live set. */
export function liveCallCount() {
  const { policies, functions } = liveTextOrgCallers();
  let n = 0;
  for (const v of [...policies.values(), ...functions.values()]) {
    n += (v.sql.match(/get_current_user_org\(\)/g) ?? []).length;
  }
  return n;
}
