#!/usr/bin/env node
// Replay supabase/migrations/*.sql in filename order into an EFFECTIVE schema
// (Phase 1 / WP 1.1 / blueprint §8.3). Emits build/schema.introspected.json.
//
//   npm run contract:introspect            # write the artifact
//   npm run contract:introspect -- --check # fail (exit 1) if it would change
//
// Mirrors scsim/scripts/gen_docs.py: the artifact is RENDERED from code, never
// hand-edited, and `--check` is the CI gate that fails on drift.
//
// WHY A REPLAY AND NOT A GREP. `CREATE TABLE IF NOT EXISTS` appears for the SAME
// table with DIFFERENT definitions. `20250820145017` and `20250820145155` give the
// four lane tables `plant_id uuid`; `20250820145837` gives them `plant_name text`.
// Under IF-NOT-EXISTS the FIRST to run wins and every later definition is a no-op,
// so the table that exists has `plant_id` — the opposite of what reading the last
// migration would tell you. Every such no-op is recorded in `shadowed` rather than
// dropped, because the divergence is itself a finding (see §16).
//
// Scope: DDL only. Statement kinds the migrations never use are reported in
// `unparsed` instead of being silently ignored — an introspector that quietly
// skips what it cannot read is how a contract ends up describing a schema that
// does not exist.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  splitStatements, splitTopLevel, parenBody, readQualifiedName, renameIdentifier, squash,
  firstNonDefaultAfterDefault, skipQuoted,
} from "./sql-lex.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// OVERRIDABLE SO THE DETECTORS CAN BE TESTED, and for no other reason.
//
// `schema.impossible` grew a third and fourth detector in WP 6.2 (§4 D99), and
// neither fires on this repository's history — which is the right outcome and also
// means neither had ever been exercised. An assertion that has never failed has
// never been tested, so `introspectorImpossibleStatements.test.ts` points these two
// at a fixture directory holding the statements PostgreSQL would reject.
//
// CI and every human invocation pass nothing and get the real paths.
const MIGRATIONS = process.env.CONTRACT_MIGRATIONS_DIR
  ? resolve(process.env.CONTRACT_MIGRATIONS_DIR)
  : join(ROOT, "supabase", "migrations");
const OUT = process.env.CONTRACT_INTROSPECT_OUT
  ? resolve(process.env.CONTRACT_INTROSPECT_OUT)
  : join(ROOT, "build", "schema.introspected.json");

// ─────────────────────────────────────────────────────────────── the schema model

/** @typedef {{name:string, type:string, nullable:boolean, default:string|null,
 *             primary_key:boolean, references:object|null, quoted:boolean,
 *             added_by:string}} Column */

class Schema {
  constructor() {
    this.tables = new Map();      // name -> table
    this.enums = new Map();       // name -> { values, defined_by }
    this.views = new Map();
    this.functions = new Map();   // signature -> { name, args, returns, defined_by }
    this.extensions = new Set();
    this.shadowed = [];           // IF-NOT-EXISTS re-definitions that never ran
    this.unparsed = [];           // DDL this pass could not read — never silent
    this.dropped = [];            // tables dropped after creation
    this.phantom = new Map();     // referenced by DDL, created by no migration
    this.dynamic = [];            // plpgsql this pass could not EVALUATE — see below
    this.impossible = [];         // statements PostgreSQL would REJECT — see CREATE INDEX
  }

  table(name) { return this.tables.get(name); }

  ensure(name, migration) {
    if (!this.tables.has(name)) {
      this.tables.set(name, {
        name,
        schema: "public",
        created_by: migration,
        columns: [],
        constraints: [],
        indexes: [],
        rls: { enabled: false, forced: false, policies: [] },
        replica_identity: null,
        comment: null,
      });
    }
    return this.tables.get(name);
  }
}

// ──────────────────────────────────────────────────────── column & constraint parse

const TABLE_CONSTRAINT = /^(CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\b|FOREIGN\s+KEY\b|CHECK\b|EXCLUDE\b)/i;

/** A column definition: `name type [modifiers...]`, or null if it is a table constraint. */
function parseColumn(def, migration) {
  if (TABLE_CONSTRAINT.test(def)) return null;
  const id = readQualifiedName(def, 0);
  if (!id) return null;
  const rest = def.slice(id.end).trim();

  // The type runs to the first modifier keyword at paren-depth 0.
  const typeMatch = /^((?:[A-Za-z_][\w."\[\] ]*?)(?:\s*\([^)]*\))?(?:\s*\[\s*\])*)\s*(?=$|\b(NOT\s+NULL|NULL|DEFAULT|PRIMARY|UNIQUE|REFERENCES|CHECK|GENERATED|COLLATE|CONSTRAINT)\b)/i.exec(rest);
  const type = squash(typeMatch ? typeMatch[1] : rest.split(/\s+/)[0] || "");
  const mods = typeMatch ? rest.slice(typeMatch[0].length) : "";

  const defMatch = /\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|CONSTRAINT|GENERATED)\b|$)/is.exec(mods);
  const refMatch = /\bREFERENCES\s+([^\s(]+)\s*(?:\(([^)]*)\))?([^,]*)/i.exec(mods);

  const isPk = /\bPRIMARY\s+KEY\b/i.test(mods);
  return {
    name: id.name,
    // §4 D59 — A CHECK WRITTEN INLINE ON A COLUMN IS STILL A CONSTRAINT.
    // This parser read the type, the NOT NULL and the DEFAULT and dropped the
    // rest, so 65 inline CHECKs across the migration history were recorded
    // nowhere. It cost twice: `rehearsal-schema.mjs` rebuilds constraints FROM
    // this artifact, so the rehearsed database did not refuse a value production
    // refuses — an assertion that a bad value is rejected passed against the
    // migration and failed against the artifact; and `generate.mjs` renders a
    // table's CHECK list, so a rule that rejects a user's upload appeared in no
    // document (§5 T1). `20260916000014` walks around it for NEW migrations by
    // writing every CHECK table-level; that is a convention, not a gate, and it
    // does nothing for the 65 already written.
    checks: inlineChecks(mods),
    quoted: id.quoted,
    type: normalizeType(type),
    type_raw: type,
    // PRIMARY KEY implies NOT NULL in Postgres whether or not it is spelled out.
    nullable: !isPk && !/\bNOT\s+NULL\b/i.test(mods),
    default: defMatch ? squash(defMatch[1]) : null,
    primary_key: isPk,
    unique: /\bUNIQUE\b/i.test(mods),
    references: refMatch
      ? {
          // `schema` IS KEPT, and dropping it cost nine foreign keys (§4 D53).
          // `readQualifiedName` has always returned it; only `.name` was read,
          // so `REFERENCES auth.users(id)` was recorded as `users`.
          // `rehearsal-schema.mjs` then qualified the bare name to
          // `public.users`, found no such table, and SKIPPED the key — on every
          // rehearsal this repository has ever run. It is additive on purpose:
          // `table` stays the bare name because the rename and drop trackers
          // below compare against it.
          schema: readQualifiedName(refMatch[1], 0)?.schema ?? null,
          table: readQualifiedName(refMatch[1], 0)?.name ?? squash(refMatch[1]),
          columns: refMatch[2] ? splitTopLevel(refMatch[2]).map((c) => readQualifiedName(c, 0)?.name ?? c) : [],
          on_delete: /\bON\s+DELETE\s+(CASCADE|RESTRICT|SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION)/i.exec(refMatch[3])?.[1]?.toUpperCase().replace(/\s+/g, " ") ?? null,
        }
      : null,
    added_by: migration,
  };
}

/** Lower-case and canonicalise the spellings Postgres treats as synonyms. */
function normalizeType(t) {
  let s = squash(t).toLowerCase().replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")").replace(/\s*,\s*/g, ",");
  const alias = {
    "timestamptz": "timestamp with time zone",
    "timestamp": "timestamp without time zone",
    "int": "integer", "int4": "integer", "int8": "bigint", "int2": "smallint",
    "bool": "boolean", "float8": "double precision", "float4": "real",
    "varchar": "character varying", "char": "character",
    "serial": "serial", "bigserial": "bigserial",
  };
  const base = s.replace(/\(.*$/, "").replace(/\[\s*\]$/, "").trim();
  if (alias[base]) s = s.replace(base, alias[base]);
  return s;
}

/**
 * The inline CHECKs on one column definition, in source order.
 *
 * `CHECK (...)` and `CONSTRAINT <name> CHECK (...)` both count; the name is
 * kept when the migration gave one and left null when it did not, because
 * Postgres invents the same name from the same table and column either way.
 */
function inlineChecks(mods) {
  const out = [];
  let depth = 0;
  let i = 0;
  while (i < mods.length) {
    const c = mods[i];
    if (c === "'") { i = skipQuoted(mods, i, "'"); continue; }
    if (c === '"') { i = skipQuoted(mods, i, '"'); continue; }
    if (c === "(") { depth++; i++; continue; }
    if (c === ")") { depth--; i++; continue; }
    if (depth === 0 && /^[A-Za-z_]/.test(c) && !/[A-Za-z0-9_$]/.test(mods[i - 1] ?? " ")) {
      const named = /^CONSTRAINT\s+/i.exec(mods.slice(i));
      let at = i;
      let name = null;
      if (named) {
        const id = readQualifiedName(mods, i + named[0].length);
        if (id && /^\s*CHECK\b/i.test(mods.slice(id.end))) { name = id.name; at = id.end; }
      }
      const kw = /^\s*CHECK\b/i.exec(mods.slice(at));
      if (kw) {
        const body = parenBody(mods, at + kw[0].length);
        if (body) {
          out.push({ name, definition: `CHECK (${squash(body.body)})` });
          i = body.end + 1;
          continue;
        }
      }
      const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(mods.slice(i));
      i += word ? word[0].length : 1;
      continue;
    }
    i++;
  }
  return out;
}

function parseTableConstraint(def, migration) {
  let name = null;
  let body = def;
  const named = /^CONSTRAINT\s+/i.exec(def);
  if (named) {
    const id = readQualifiedName(def, named[0].length);
    name = id?.name ?? null;
    body = def.slice(id?.end ?? named[0].length).trim();
  }
  const kindMatch = /^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|EXCLUDE)/i.exec(body);
  if (!kindMatch) return null;
  const kind = kindMatch[1].toUpperCase().replace(/\s+/g, " ");
  const cols = kind === "CHECK" || kind === "EXCLUDE"
    ? []
    : (parenBody(body, kindMatch[0].length)?.body ?? "")
        .split(",").map((c) => readQualifiedName(c, 0)?.name).filter(Boolean);
  return { name, kind, columns: cols, definition: squash(body), added_by: migration };
}

// ────────────────────────────────────────────────────────────────── statement apply

function apply(schema, stmt, migration, guarded = false) {
  const s = squash(stmt);

  // ---- DO $$ ... $$ -------------------------------------------------------
  // Supabase migrations wrap idempotent DDL in plpgsql:
  //   DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type ...) THEN CREATE TYPE ...
  // Skipping the block loses every enum and, in this repo, would have reported
  // zero types while four migrations create `public.app_role`. Descend into the
  // body and treat what it contains as GUARDED — the `IF NOT EXISTS` around it
  // gives it first-wins semantics even without the SQL-level clause.
  let doBlock = /^DO\s+(\$[A-Za-z_]*\$)/i.exec(s);
  if (doBlock) {
    const tag = doBlock[1];
    // Split the RAW body, not the squashed one. `squash` collapses newlines, and
    // `splitStatements` strips `--` to end of LINE — so on squashed text a single
    // `-- comment` inside a DO block eats every statement after it, silently.
    // That is not hypothetical: `20250908191450` opens its block with
    // `-- View policy`, and four `CREATE POLICY` statements on
    // `supply_chain_data_multi_tier` vanished. The artifact then said the table
    // had RLS on and no policy at all, which reads as deny-all.
    const raw = String(stmt);
    const open = raw.indexOf(tag);
    const close = raw.lastIndexOf(tag);
    if (close > open) {
      const body = raw.slice(open + tag.length, close);
      // §4 D51 — THE BLOCK IS THE SCOPE, NOT THE SEMICOLON.
      //
      // `splitStatements` cuts at semicolons, and a plpgsql loop binds its
      // variable in the HEADER while the interesting DDL sits in a later
      // fragment. So `20260614000001`'s
      // `FOREACH t IN ARRAY ARRAY['materials','products','suppliers'] LOOP
      //  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t)`
      // carries the three names, and the very next fragment — the one that
      // DROPs and CREATEs `"%1$s_auth_all"` — carries none.
      //
      // The three item masters were therefore marked indeterminate by ACCIDENT:
      // correct, and only because the array literal happened to share a fragment
      // with the ENABLE. Written with the ENABLE outside the loop, all three would
      // have been recorded as determinately policy-less and their generated pages
      // would have said so — which is D51 exactly, on the three tables the policy
      // grid reads.
      //
      // Every name the BLOCK mentions is therefore in scope for every fragment in
      // it that assembles a name through a placeholder. That is the same
      // over-approximation the mentions set already makes, at the scope the loop
      // variable actually has: an over-broad "we cannot tell" is safe, and a
      // narrow one is a false claim about governance.
      const blockLiterals = new Set();
      for (const m of squash(body).matchAll(/'([a-z_][a-z0-9_]*)'/gi)) {
        blockLiterals.add(m[1].toLowerCase());
      }
      for (const inner of splitStatements(body)) {
        const ddl = unwrapPlpgsql(inner);
        if (ddl) { apply(schema, ddl, migration, true); continue; }
        // NOT silent. `unwrapPlpgsql` returning null used to drop the fragment,
        // and the fragments it drops are not all control-flow noise: some are
        // EXECUTE format(...) — DDL assembled at run time, which no static
        // replay can evaluate. `20260614000001_item_master.sql` enables RLS and
        // creates two policies each on `materials`, `products` and `suppliers`
        // that way, inside a FOREACH over an array of table names. Dropping it
        // made the artifact say RLS was OFF on all three item masters, and the
        // generated pages then said so to the reader — a governance claim the
        // migrations do not support in either direction.
        //
        // Recording it does not evaluate it. It marks the tables the block
        // mentions as INDETERMINATE, which is the true answer (§5 T3).
        noteDynamic(schema, migration, inner, blockLiterals);
      }
    }
    return;
  }

  // ---- CREATE TABLE -------------------------------------------------------
  let m = /^CREATE\s+(?:(GLOBAL|LOCAL)\s+)?(?:(TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i.exec(s);
  if (m) {
    const ifNotExists = Boolean(m[3]) || guarded;
    const id = readQualifiedName(s, m[0].length);
    if (!id) return note(schema, migration, s, "CREATE TABLE without a readable name");
    const body = parenBody(s, id.end);
    if (!body) {
      // CREATE TABLE ... AS SELECT / PARTITION OF — not used here, but say so.
      return note(schema, migration, s, "CREATE TABLE with no column list (AS SELECT / PARTITION OF)");
    }
    const existing = schema.table(id.name);
    const parsed = parseBody(body.body, migration, id.name);

    if (existing) {
      // THE HARD PART. Under IF NOT EXISTS this statement is a NO-OP: the table
      // already exists, so none of these columns are created. Record the
      // divergence; do not apply it.
      if (ifNotExists) {
        const diff = diffColumns(existing.columns, parsed.columns);
        schema.shadowed.push({
          table: id.name,
          migration,
          created_by: existing.created_by,
          if_not_exists: true,
          differs: diff.length > 0,
          diff,
          note: diff.length
            ? "NO-OP: the table already existed, so this definition never ran and the columns below are NOT in the database"
            : "NO-OP: identical re-declaration",
        });
        return;
      }
      // Without IF NOT EXISTS this would be an error against a live database.
      return note(schema, migration, s, `CREATE TABLE ${id.name} without IF NOT EXISTS, but the table already exists`);
    }

    const t = schema.ensure(id.name, migration);
    t.columns = parsed.columns;
    t.constraints = parsed.constraints;
    return;
  }

  // ---- ALTER TABLE --------------------------------------------------------
  m = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?/i.exec(s);
  if (m) {
    const id = readQualifiedName(s, m[0].length);
    if (!id) return note(schema, migration, s, "ALTER TABLE without a readable name");
    if (foreignSchema(id)) return;
    const t = schema.table(id.name);
    const actions = splitTopLevel(s.slice(id.end).trim());
    for (const action of actions) {
      if (!t) { note(schema, migration, action, `ALTER TABLE on unknown table "${id.name}"`); continue; }
      applyAlter(schema, t, action, migration, s);
    }
    return;
  }

  // ---- DROP TABLE ---------------------------------------------------------
  m = /^DROP\s+TABLE\s+(IF\s+EXISTS\s+)?/i.exec(s);
  if (m) {
    for (const part of splitTopLevel(s.slice(m[0].length).replace(/\s+(CASCADE|RESTRICT)\s*$/i, ""))) {
      const id = readQualifiedName(part, 0);
      if (!id) continue;
      if (schema.tables.delete(id.name)) {
        schema.dropped.push({ table: id.name, migration, cascade: /\bCASCADE\b/i.test(s) });
        if (/\bCASCADE\b/i.test(s)) dropDependentFks(schema, id.name, migration);
      }
    }
    return;
  }

  // ---- INDEX --------------------------------------------------------------
  m = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(IF\s+NOT\s+EXISTS\s+)?/i.exec(s);
  if (m) {
    const unique = Boolean(m[1]);
    let rest = s.slice(m[0].length);
    let name = null;
    const onAt = /\bON\b/i.exec(rest);
    if (!onAt) return note(schema, migration, s, "CREATE INDEX without ON");
    if (onAt.index > 0) name = readQualifiedName(rest, 0)?.name ?? null;
    const tid = readQualifiedName(rest, onAt.index + onAt[0].length);
    if (!tid) return note(schema, migration, s, "CREATE INDEX without a readable table");
    if (foreignSchema(tid)) return;
    const t = schema.table(tid.name);
    if (!t) return note(schema, migration, s, `CREATE INDEX on unknown table "${tid.name}"`);
    const after = rest.slice(tid.end).replace(/^\s*USING\s+\w+/i, "");
    const cols = parenBody(after, 0);
    const whereMatch = /\bWHERE\b(.+)$/i.exec(after);
    // NULLS NOT DISTINCT (PostgreSQL 15+) sits between the column list and any
    // WHERE, and dropping it is not cosmetic: it is the difference between an
    // index that constrains a null-bearing key and one that constrains every row
    // EXCEPT those. `rehearsal-schema.mjs` rebuilds indexes FROM this artifact,
    // so a clause lost here produces a rehearsed database whose constraint is
    // weaker than the migration's — and the assertion that the constraint bites
    // then passes against the migration and fails against the artifact. That is
    // D60, and the same family as D49 (a rename not followed into an index) and
    // D59 (an inline CHECK never recorded): the introspector is incomplete about
    // one kind of dependent detail at a time.
    // `end` is the index OF the closing paren, so the tail starts one past it.
    const tail = cols ? after.slice(cols.end + 1) : "";
    const nullsNotDistinct = /^\s*NULLS\s+NOT\s+DISTINCT\b/i.test(tail);
    if (name && t.indexes.some((i) => i.name === name)) return; // IF NOT EXISTS
    // AN INDEX ON A COLUMN THE TABLE DOES NOT HAVE IS NOT AN INDEX; IT IS AN
    // ERROR, AND EVERY STATEMENT AFTER IT IN THE FILE NEVER RAN.
    //
    // `IF NOT EXISTS` guards the index NAME, not the column: Postgres raises
    // 42703 and the migration's transaction rolls back. §4 D49 recorded three
    // such indexes as one defect with one cause (a column rename the
    // introspector did not follow), and that cause is right for exactly ONE of
    // them. `supply_chain_data_multi_tier` has never had `material_id` or
    // `higher_level_component_id` in any definition — they are
    // `bom_multi_level`'s columns — so `20250909153130` ABORTED in production,
    // and `20250909153231` is its retry with those two lines removed. Same
    // class as D48, found the same way: by a static replay recording a
    // statement that cannot have run.
    //
    // Recorded, not applied. `build()` treats the file as aborted and replays
    // without it, which is the only state the database can ever have been in.
    const bare = (cols ? splitTopLevel(cols.body).map((c) => squash(c)) : [])
      .filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
    const missing = bare.filter((c) => !t.columns.some((col) => col.name === c));
    if (missing.length) {
      schema.impossible.push({
        migration,
        statement: s.slice(0, 220),
        table: t.name,
        why:
          `CREATE INDEX names ${missing.join(", ")}, which ${t.name} does not have. ` +
          "Postgres raises 42703 and the file's transaction rolls back.",
      });
      return;
    }
    t.indexes.push({
      name,
      unique,
      columns: cols ? splitTopLevel(cols.body).map((c) => squash(c)) : [],
      nulls_not_distinct: nullsNotDistinct,
      predicate: whereMatch ? squash(whereMatch[1]) : null,
      partial: Boolean(whereMatch),
      added_by: migration,
    });
    return;
  }
  m = /^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?/i.exec(s);
  if (m) {
    for (const part of splitTopLevel(s.slice(m[0].length).replace(/\s+(CASCADE|RESTRICT)\s*$/i, ""))) {
      const id = readQualifiedName(part, 0);
      if (!id) continue;
      for (const t of schema.tables.values()) t.indexes = t.indexes.filter((i) => i.name !== id.name);
    }
    return;
  }

  // ---- RLS POLICIES -------------------------------------------------------
  m = /^CREATE\s+POLICY\s+/i.exec(s);
  if (m) {
    const pid = readQualifiedName(s, m[0].length) ?? readPolicyName(s, m[0].length);
    const onAt = /\bON\s+/i.exec(s.slice(pid?.end ?? m[0].length));
    if (!pid || !onAt) return note(schema, migration, s, "CREATE POLICY without a readable name/table");
    const tid = readQualifiedName(s, (pid.end) + onAt.index + onAt[0].length);
    if (tid && foreignSchema(tid)) return;
    const t = tid && schema.table(tid.name);
    if (!t) return note(schema, migration, s, `CREATE POLICY on unknown table "${tid?.name}"`);
    const tail = s.slice(tid.end);
    // §4 D99 · THE FOURTH DETECTOR, AND IT IS DELIBERATELY NARROW.
    //
    // A policy predicate naming a column the table does not have raises 42703 at
    // CREATE time and rolls the file back — D99's third named kind. But a
    // predicate is an EXPRESSION: bare identifiers there may be columns of this
    // table, columns of a table in a sub-SELECT, function names, enum labels or
    // parameters, and a detector that guessed would report a defect on every
    // policy that calls `get_current_user_id()`.
    //
    // So it looks ONLY at references qualified with THIS table's own name —
    // `customers.project_id` inside a policy on `customers`. Those are
    // unambiguous by construction: the qualifier says which relation the column
    // must belong to, so a name that is not a column of it cannot be anything
    // else. Narrow and certain beats broad and wrong, which is the lesson of the
    // three over-claims WP 6.1 caught inside itself.
    const qualified = new Set(
      [...tail.matchAll(new RegExp(`\\b(?:public\\.)?${t.name}\\.([a-z_][a-z0-9_]*)`, "gi"))]
        .map((x) => x[1].toLowerCase()),
    );
    const absent = [...qualified].filter((col) => !t.columns.some((x) => x.name === col));
    if (absent.length) {
      schema.impossible.push({
        migration,
        statement: s.slice(0, 220),
        table: t.name,
        why:
          `CREATE POLICY ${pid.name} qualifies ${absent.map((c) => `${t.name}.${c}`).join(", ")}, ` +
          `which ${t.name} does not have. Postgres raises 42703 and the file's ` +
          "transaction rolls back.",
      });
      return;
    }
    t.rls.policies.push({
      name: pid.name,
      command: /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(tail)?.[1]?.toUpperCase() ?? "ALL",
      roles: /\bTO\s+([\w", ]+?)(?=\s+(?:USING|WITH\s+CHECK)\b|$)/i.exec(tail)?.[1]?.split(",").map((r) => squash(r)) ?? [],
      using: parenBody(tail, /\bUSING\b/i.exec(tail)?.index ?? -1)?.body?.trim() ?? null,
      with_check: parenBody(tail, /\bWITH\s+CHECK\b/i.exec(tail)?.index ?? -1)?.body?.trim() ?? null,
      added_by: migration,
    });
    return;
  }
  m = /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?/i.exec(s);
  if (m) {
    const pid = readPolicyName(s, m[0].length);
    const onAt = /\bON\s+/i.exec(s.slice(pid.end));
    if (!onAt) return;
    const tid = readQualifiedName(s, pid.end + onAt.index + onAt[0].length);
    const t = tid && schema.table(tid.name);
    if (t) t.rls.policies = t.rls.policies.filter((p) => p.name !== pid.name);
    return;
  }

  // ---- FUNCTIONS ----------------------------------------------------------
  m = /^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+/i.exec(s);
  if (m) {
    const id = readQualifiedName(s, m[0].length);
    if (!id) return note(schema, migration, s, "CREATE FUNCTION without a readable name");
    const args = parenBody(s, id.end);
    const argList = args ? splitTopLevel(args.body).map((a) => squash(a)).filter(Boolean) : [];
    const returns = /\bRETURNS\s+((?:SETOF\s+|TABLE\s*\(.*?\)|[\w."\[\] ]+))/is.exec(s.slice(args?.end ?? id.end));
    const sig = `${id.name}(${argList.map(argType).join(", ")})`;

    // A NON-DEFAULTED PARAMETER AFTER A DEFAULTED ONE IS NOT A FUNCTION; IT IS
    // AN ERROR, AND EVERY STATEMENT AFTER IT IN THE FILE NEVER RAN.
    //
    // PostgreSQL raises 42P13 at CREATE time ("input parameters after one with
    // a default value must also have defaults"), so the file's transaction rolls
    // back. This is §4 D48, and it is the same mechanism as D97 on a second
    // statement kind — which is the whole reason `schema.impossible` is a list
    // rather than a special case for indexes.
    //
    // The evidence that this is what happened is not inference: the retry
    // `20250827171106`, 84 seconds later, opens its own copy with
    // `-- FIXED: Put all parameters with defaults at the end`.
    const bad = firstNonDefaultAfterDefault(argList);
    if (bad) {
      schema.impossible.push({
        migration,
        statement: s.slice(0, 220),
        function: sig,
        why:
          `CREATE FUNCTION ${sig} declares "${bad.after}" with no default after ` +
          `"${bad.defaulted}", which has one. PostgreSQL raises 42P13 and the ` +
          "file's transaction rolls back.",
      });
      return;
    }
    schema.functions.set(sig, {
      name: id.name,
      signature: sig,
      args: argList,
      returns: returns ? squash(returns[1]) : null,
      security_definer: /\bSECURITY\s+DEFINER\b/i.test(s),
      volatility: /\b(IMMUTABLE|STABLE|VOLATILE)\b/i.exec(s)?.[1]?.toUpperCase() ?? null,
      // A COMMENT survives a later CREATE OR REPLACE in PostgreSQL, so it must
      // survive one here too — otherwise replacing a function silently erases a
      // comment another migration set, and the artifact stops describing the
      // database (WP 4.2, D73).
      comment: schema.functions.get(sig)?.comment ?? null,
      defined_by: migration,
    });
    return;
  }
  m = /^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?/i.exec(s);
  if (m) {
    const id = readQualifiedName(s, m[0].length);
    if (!id) return;
    const args = parenBody(s, id.end);
    const argList = args ? splitTopLevel(args.body).map((a) => squash(a)).filter(Boolean) : null;
    if (argList) schema.functions.delete(`${id.name}(${argList.map(argType).join(", ")})`);
    else for (const k of [...schema.functions.keys()]) if (schema.functions.get(k).name === id.name) schema.functions.delete(k);
    return;
  }

  // ---- TYPES / VIEWS / EXTENSIONS / COMMENTS ------------------------------
  m = /^CREATE\s+TYPE\s+/i.exec(s);
  if (m) {
    const id = readQualifiedName(s, m[0].length);
    const vals = /\bAS\s+ENUM\s*/i.exec(s);
    if (id && vals) {
      const body = parenBody(s, vals.index + vals[0].length);
      const values = body ? splitTopLevel(body.body).map((v) => squash(v).replace(/^'|'$/g, "")) : [];
      const existing = schema.enums.get(id.name);
      if (existing) {
        // Same first-wins rule as CREATE TABLE IF NOT EXISTS: the re-declaration
        // is a no-op. Record it only when it would have said something different.
        if (existing.values.join(",") !== values.join(",")) {
          schema.shadowed.push({
            type: id.name, migration, created_by: existing.defined_by, if_not_exists: true,
            differs: true, diff: [{ column: null, effective: existing.values.join("|"), shadowed: values.join("|") }],
            note: "NO-OP: the enum already existed; these values were never added",
          });
        }
        return;
      }
      schema.enums.set(id.name, { values, defined_by: migration });
      return;
    }
    return note(schema, migration, s, "CREATE TYPE that is not an ENUM");
  }
  m = /^ALTER\s+TYPE\s+/i.exec(s);
  if (m) {
    const id = readQualifiedName(s, m[0].length);
    const add = /\bADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']*)'/i.exec(s);
    const e = id && schema.enums.get(id.name);
    if (e && add && !e.values.includes(add[1])) e.values.push(add[1]);
    return;
  }
  m = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(s);
  if (m) {
    const id = readQualifiedName(s, m[0].length);
    if (id) {
      const prior = schema.views.get(id.name);
      schema.views.set(id.name, {
        defined_by: migration,
        materialized: /MATERIALIZED/i.test(s),
        // Postgres defaults this OFF, so a view is a potential RLS bypass until an
        // ALTER VIEW says otherwise. Recording false is the honest state, not a gap.
        security_invoker: prior?.security_invoker ?? false,
      });
    }
    return;
  }
  // ALTER VIEW ... SET (option = value). Recorded rather than skipped because ONE
  // of these options decides whether the view can bypass its base tables' RLS:
  // a Postgres view runs as its OWNER unless `security_invoker` is on, so a view
  // that is granted to a role is a way past that role's policies. WP 2.4 found
  // exactly that on `admin_audit_logs` (D37), which is why the contract now holds
  // the answer instead of leaving it to be rediscovered.
  m = /^ALTER\s+VIEW\s+(?:IF\s+EXISTS\s+)?/i.exec(s);
  if (m) {
    const id = readQualifiedName(s, m[0].length);
    const view = id && schema.views.get(id.name);
    if (view) {
      const opts = /\bSET\s*\(([^)]*)\)/i.exec(s);
      if (opts) {
        for (const pair of splitTopLevel(opts[1])) {
          const [k, v] = pair.split("=").map((x) => x.trim());
          if (!k) continue;
          if (/^security_invoker$/i.test(k)) view.security_invoker = !/^(false|off|0)$/i.test(v ?? "true");
          else (view.options ??= {})[k.toLowerCase()] = v ?? null;
        }
      }
      if (/\bOWNER\s+TO\b/i.test(s)) view.owner_changed_by = migration;
    }
    return;
  }
  m = /^DROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?/i.exec(s);
  if (m) { const id = readQualifiedName(s, m[0].length); if (id) schema.views.delete(id.name); return; }
  m = /^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?/i.exec(s);
  if (m) { const id = readQualifiedName(s, m[0].length); if (id) schema.extensions.add(id.name); return; }
  m = /^COMMENT\s+ON\s+(TABLE|COLUMN|VIEW|FUNCTION|INDEX|SCHEMA|TYPE|CONSTRAINT|POLICY|MATERIALIZED\s+VIEW)\s+/i.exec(s);
  if (m) {
    const id = readQualifiedName(s, m[0].length);
    const text = /\bIS\s+'((?:[^']|'')*)'/i.exec(s)?.[1]?.replace(/''/g, "'") ?? null;
    if (m[1].toUpperCase() === "TABLE") { const t = id && schema.table(id.name); if (t) t.comment = text; }
    // FUNCTION comments were parsed and thrown away, so the artifact could not
    // reproduce them and `--since HEAD` built a base whose functions had lost
    // their documentation. That is D52's class — the artifact disagreeing with
    // what the migration did — and WP 4.2's rehearsal is what walked into it
    // (D73). Matched on the signature when the statement spells the arguments,
    // and on the bare name otherwise, which is what `COMMENT ON FUNCTION f` is
    // allowed to say when `f` is not overloaded.
    if (m[1].toUpperCase() === "FUNCTION" && id) {
      const args = parenBody(s, id.end);
      const argList = args ? splitTopLevel(args.body).map((a) => squash(a)).filter(Boolean) : null;
      const sig = argList ? `${id.name}(${argList.map(argType).join(", ")})` : null;
      if (sig && schema.functions.has(sig)) {
        schema.functions.get(sig).comment = text;
      } else {
        for (const fn of schema.functions.values()) if (fn.name === id.name) fn.comment = text;
      }
    }
    return;
  }

  // ---- Statement kinds that do not shape the schema ------------------------
  if (/^(INSERT|UPDATE|DELETE|SELECT|WITH|GRANT|REVOKE|SET|DO|BEGIN|COMMIT|ROLLBACK|ANALYZE|VACUUM|TRUNCATE|REFRESH|NOTIFY|CREATE\s+(OR\s+REPLACE\s+)?TRIGGER|DROP\s+TRIGGER|CREATE\s+SCHEMA|ALTER\s+DEFAULT|ALTER\s+PUBLICATION|CREATE\s+PUBLICATION|ALTER\s+SCHEMA|ALTER\s+FUNCTION|ALTER\s+SEQUENCE|CREATE\s+SEQUENCE|DROP\s+SEQUENCE|ALTER\s+DATABASE|CREATE\s+ROLE|ALTER\s+ROLE|CREATE\s+CAST|DROP\s+TYPE|SECURITY\s+LABEL)\b/i.test(s)) return;

  note(schema, migration, s, "unrecognised DDL");
}

function applyAlter(schema, t, action, migration, whole) {
  const a = squash(action);
  let m;

  if ((m = /^ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?/i.exec(a)) || (m = /^ADD\s+(?=[A-Za-z_"])(?!CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)/i.exec(a))) {
    const col = parseColumn(a.slice(m[0].length), migration);
    if (!col) return note(schema, migration, a, "ADD COLUMN that could not be parsed");
    if (t.columns.some((c) => c.name === col.name)) return; // IF NOT EXISTS
    // An inline CHECK arrives on an ADD COLUMN too (§4 D59): `20250923120308`
    // adds `data_type text NOT NULL DEFAULT 'curated' CHECK (data_type IN (...))`.
    for (const chk of col.checks ?? []) {
      t.constraints.push({
        name: chk.name ?? autoCheckName(t.name, col.name, t.constraints),
        kind: "CHECK", columns: [col.name],
        definition: chk.definition, implicit: true, added_by: migration,
      });
    }
    delete col.checks;
    t.columns.push(col);
    return;
  }
  if ((m = /^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?/i.exec(a))) {
    const id = readQualifiedName(a, m[0].length);
    if (id) {
      t.columns = t.columns.filter((c) => c.name !== id.name);
      // Postgres drops a column's CHECK with the column. Now that an inline
      // CHECK is recorded at all (§4 D59), leaving it behind would describe a
      // constraint on a column that no longer exists — D49's defect, arrived at
      // from the other direction.
      t.constraints = t.constraints.filter(
        (c) => !(c.kind === "CHECK" && c.implicit && c.columns?.length === 1 && c.columns[0] === id.name),
      );
    }
    return;
  }
  if ((m = /^RENAME\s+COLUMN\s+/i.exec(a)) || (m = /^RENAME\s+(?!TO|CONSTRAINT)/i.exec(a))) {
    const from = readQualifiedName(a, m[0].length);
    const toAt = /\bTO\s+/i.exec(a.slice(from.end));
    const to = toAt && readQualifiedName(a, from.end + toAt.index + toAt[0].length);
    const col = from && t.columns.find((c) => c.name === from.name);
    if (col && to) {
      col.name = to.name; col.quoted = to.quoted; col.renamed_by = migration;
      renameInDependents(t, from.name, to.name);
    }
    return;
  }
  if ((m = /^RENAME\s+TO\s+/i.exec(a))) {
    const to = readQualifiedName(a, m[0].length);
    if (!to) return;
    const from = t.name;
    schema.tables.delete(t.name); t.name = to.name; schema.tables.set(to.name, t);

    // AND EVERY FOREIGN KEY THAT POINTED AT THE OLD NAME. Postgres tracks a
    // reference by OID, so production's keys follow the table through a rename
    // without being restated; this artifact records them by NAME, so unless they
    // are rewritten here the contract describes a database that cannot be built.
    //
    // WP 3.1 recorded that gap as D52 and called it harmless "only because this
    // package replaced those policies in the same migration". It was not harmless
    // for one run: `ingest_staged_*.ingest_run_id` kept `REFERENCES erp_sync_runs`,
    // `rehearsal-schema.mjs` skips a reference to a table the artifact does not
    // know, and the rehearsed base therefore had no ON DELETE CASCADE at all.
    // `supabase/rehearsal/050` caught it on `main` — the assertion was right and
    // the artifact was wrong, which is the only way round worth having.
    const ref = new RegExp(`\\bREFERENCES\\s+(public\\.)?"?${from}"?`, "i");
    for (const other of schema.tables.values()) {
      for (const col of other.columns) {
        if (col.references?.table === from) col.references.table = to.name;
      }
      for (const c of other.constraints) {
        if (c.kind === "FOREIGN KEY" && typeof c.definition === "string") {
          c.definition = c.definition.replace(ref, (_all, qual) => `REFERENCES ${qual ?? ""}${to.name}`);
        }
      }
    }
    return;
  }
  if ((m = /^ALTER\s+(?:COLUMN\s+)?/i.exec(a))) {
    const id = readQualifiedName(a, m[0].length);
    const col = id && t.columns.find((c) => c.name === id.name);
    if (!col) return note(schema, migration, a, `ALTER COLUMN on unknown column "${id?.name}"`);
    const tail = a.slice(id.end);
    let t2;
    if ((t2 = /^\s*(?:SET\s+DATA\s+)?TYPE\s+(.+?)(?:\s+USING\b.*)?$/i.exec(tail))) {
      col.type = normalizeType(t2[1]); col.type_raw = squash(t2[1]); col.retyped_by = migration; return;
    }
    if (/^\s*SET\s+NOT\s+NULL\b/i.test(tail)) { col.nullable = false; return; }
    if (/^\s*DROP\s+NOT\s+NULL\b/i.test(tail)) { col.nullable = true; return; }
    if (/^\s*DROP\s+DEFAULT\b/i.test(tail)) { col.default = null; return; }
    if ((t2 = /^\s*SET\s+DEFAULT\s+(.+)$/i.exec(tail))) { col.default = squash(t2[1]); return; }
    return note(schema, migration, a, "ALTER COLUMN action not recognised");
  }
  if ((m = /^ADD\s+/i.exec(a)) && TABLE_CONSTRAINT.test(a.slice(m[0].length))) {
    const c = parseTableConstraint(a.slice(m[0].length), migration);
    if (c) {
      if (c.name && t.constraints.some((x) => x.name === c.name)) return;
      // §4 D99 · THE THIRD DETECTOR. A CONSTRAINT ON A COLUMN THE TABLE DOES NOT
      // HAVE IS NOT A CONSTRAINT; IT IS AN ERROR, AND EVERY STATEMENT AFTER IT IN
      // THE FILE NEVER RAN.
      //
      // D99 names three statement kinds still unwatched, and this is the first of
      // them: `ADD CONSTRAINT … FOREIGN KEY (col)` / `PRIMARY KEY (col)` /
      // `UNIQUE (col)` against a missing column raises 42703 and rolls the file
      // back. `schema.impossible` was built as a LIST precisely so a detector
      // could join it (slice 9's `CREATE INDEX`, slice 10's 42P13), and this is
      // the same shape a third time.
      //
      // It reads the constraint's OWN column list and nothing else. A CHECK's
      // expression and a FOREIGN KEY's target columns are deliberately not
      // examined: the first would need an expression parser and the second names
      // ANOTHER table's columns, which this branch cannot resolve without
      // guessing which side a bare name belongs to (the same limitation
      // `renameInDependents` states about foreign keys).
      const ownCols = c.kind === "CHECK" ? [] : (c.columns ?? []);
      const missing = ownCols.filter((col) => !t.columns.some((x) => x.name === col));
      if (missing.length) {
        schema.impossible.push({
          migration,
          statement: a.slice(0, 220),
          table: t.name,
          why:
            `ALTER TABLE … ADD ${c.kind} names ${missing.join(", ")}, which ${t.name} ` +
            "does not have. Postgres raises 42703 and the file's transaction rolls back.",
        });
        return;
      }
      t.constraints.push(c);
    }
    return;
  }
  if ((m = /^DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?/i.exec(a))) {
    const id = readQualifiedName(a, m[0].length);
    if (!id) return;
    for (const gone of t.constraints.filter((c) => c.name === id.name)) {
      // Clear the column flag the implicit constraint was lifted from, or
      // `natural_key_unique` would keep reporting a key that no longer exists.
      if (gone.implicit && gone.columns.length === 1) {
        const col = t.columns.find((c) => c.name === gone.columns[0]);
        if (col) { if (gone.kind === "UNIQUE") col.unique = false; else col.primary_key = false; }
      }
    }
    t.constraints = t.constraints.filter((c) => c.name !== id.name);
    return;
  }
  if (/^ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(a)) { t.rls.enabled = true; return; }
  if (/^DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(a)) { t.rls.enabled = false; return; }
  if (/^FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(a)) { t.rls.forced = true; return; }
  if ((m = /^REPLICA\s+IDENTITY\s+(\w+)/i.exec(a))) { t.replica_identity = m[1].toUpperCase(); return; }
  if (/^(OWNER\s+TO|SET\s+SCHEMA|VALIDATE\s+CONSTRAINT|CLUSTER\s+ON|SET\s+\()/i.test(a)) return;

  note(schema, migration, a, "ALTER TABLE action not recognised");
}

/**
 * A column RENAME, followed into every dependent object on the same table.
 *
 * §4 D49: `20250822025432` renames `supply_chain_data.plant` to `plant_name`.
 * Postgres rewrites the index entry with the column, so production's index is
 * on `plant_name`; the artifact kept `plant`, and `rehearsal-schema.mjs` then
 * SKIPPED the index with a warning — on every rehearsal this repository has
 * run. Three indexes were wrong that way, across two tables.
 *
 * This is the same fix as the `RENAME TO` branch above, which follows a TABLE
 * rename into foreign keys (D52). Both exist because the artifact records
 * dependents by NAME while Postgres tracks them by OID.
 */
function renameInDependents(t, from, to) {
  for (const idx of t.indexes) {
    idx.columns = (idx.columns ?? []).map((c) => renameIdentifier(c, from, to));
    if (idx.predicate) idx.predicate = renameIdentifier(idx.predicate, from, to);
  }
  for (const c of t.constraints) {
    // A FOREIGN KEY's definition names the TARGET table's columns as well as
    // this one's, and this rewrite cannot tell them apart — so it is left to
    // the column-level `references`, which is keyed by column and unambiguous.
    if (c.kind === "FOREIGN KEY") continue;
    c.columns = (c.columns ?? []).map((x) => (x === from ? to : x));
    if (typeof c.definition === "string") c.definition = renameIdentifier(c.definition, from, to);
    if (c.name === `${t.name}_${from}_key`) c.name = `${t.name}_${to}_key`;
  }
}

/** `DROP TABLE x CASCADE` removes FKs pointing at x, but NOT the columns. */
function dropDependentFks(schema, gone, migration) {
  for (const t of schema.tables.values()) {
    for (const c of t.columns) {
      if (c.references?.table === gone) {
        c.references = null;
        c.fk_dropped_by = `${migration} (DROP TABLE ${gone} CASCADE)`;
      }
    }
    t.constraints = t.constraints.filter(
      (k) => !(k.kind === "FOREIGN KEY" && new RegExp(`\\bREFERENCES\\s+(public\\.)?${gone}\\b`, "i").test(k.definition)),
    );
  }
}

/**
 * Postgres gives a column-level `UNIQUE` / `PRIMARY KEY` an implicit constraint
 * name — `<table>_<column>_key` and `<table>_pkey` — and that name is how
 * migrations drop it. `20250816002505` drops `supply_chain_data_plant_key`
 * ("Allow multiple rows per plant by removing incorrect unique constraint"), so
 * a model that keeps the uniqueness as a flag on the column never sees the drop
 * and reports `supply_chain_data` as one-row-per-plant. Materialise these as
 * named constraints at parse time and the DROP works on them like any other.
 */
function liftImplicitConstraints(table, columns, constraints, migration) {
  for (const c of columns) {
    if (c.primary_key && !constraints.some((k) => k.kind === "PRIMARY KEY")) {
      constraints.push({
        name: `${table}_pkey`, kind: "PRIMARY KEY", columns: [c.name],
        definition: `PRIMARY KEY (${c.name})`, implicit: true, added_by: migration,
      });
    }
    if (c.unique) {
      constraints.push({
        name: `${table}_${c.name}_key`, kind: "UNIQUE", columns: [c.name],
        definition: `UNIQUE (${c.name})`, implicit: true, added_by: migration,
      });
    }
    for (const chk of c.checks ?? []) {
      // `columns` carries the column the CHECK was written ON, which is what a
      // later DROP COLUMN needs in order to take the constraint with it.
      constraints.push({
        name: chk.name ?? autoCheckName(table, c.name, constraints),
        kind: "CHECK", columns: [c.name],
        definition: chk.definition, implicit: true, added_by: migration,
      });
    }
  }
}

/**
 * The name PostgreSQL invents for an unnamed column CHECK: `<table>_<column>_check`,
 * then `_check1`, `_check2` when that is taken.
 *
 * NOT COSMETIC, AND THE FIRST DRAFT LEFT IT null. `ai_chat_events.event_kind`
 * carries an inline CHECK from `20260715000002`, and FIVE later migrations
 * widen its vocabulary with `DROP CONSTRAINT IF EXISTS
 * ai_chat_events_event_kind_check` followed by an `ADD CONSTRAINT` of the same
 * name. A constraint recorded with no name matches no DROP, so the artifact
 * kept the ORIGINAL, NARROWEST version alongside the final one — and the base
 * build failed on the duplicate name, which is the lucky outcome. The unlucky
 * one is a rehearsed database that refuses values production accepts.
 */
function autoCheckName(table, column, constraints) {
  const base = `${table}_${column}_check`;
  if (!constraints.some((c) => c.name === base)) return base;
  for (let n = 1; ; n++) {
    const tried = `${base}${n}`;
    if (!constraints.some((c) => c.name === tried)) return tried;
  }
}

function parseBody(body, migration, table) {
  const columns = [];
  const constraints = [];
  for (const def of splitTopLevel(body)) {
    const col = parseColumn(def, migration);
    if (col) { columns.push(col); continue; }
    const c = parseTableConstraint(def, migration);
    if (c) constraints.push(c);
  }
  // A table-level PRIMARY KEY makes its columns NOT NULL too.
  const pk = constraints.find((c) => c.kind === "PRIMARY KEY");
  if (pk) for (const c of columns) if (pk.columns.includes(c.name)) c.nullable = false;
  liftImplicitConstraints(table, columns, constraints, migration);
  for (const c of columns) delete c.checks;
  return { columns, constraints };
}

function diffColumns(have, would) {
  const byName = new Map(have.map((c) => [c.name, c]));
  const out = [];
  for (const c of would) {
    const cur = byName.get(c.name);
    if (!cur) out.push({ column: c.name, effective: null, shadowed: c.type });
    else if (cur.type !== c.type) out.push({ column: c.name, effective: cur.type, shadowed: c.type });
  }
  for (const c of have) if (!would.some((w) => w.name === c.name)) out.push({ column: c.name, effective: c.type, shadowed: null });
  return out;
}

/** Table names a migration file's CREATE TABLE statements name. */
function tablesClaimedBy(files, name) {
  const sql = files.find(([f]) => f === name)?.[1] ?? "";
  const out = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\s*\.\s*)?([A-Za-z_][\w]*)/gi;
  let m;
  while ((m = re.exec(sql))) out.add(m[1].toLowerCase());
  return [...out].sort();
}

const argType = (a) =>
  squash(a).replace(/\bDEFAULT\b.*$/i, "").trim().split(/\s+/).filter(Boolean).slice(-1)[0]?.toLowerCase() ?? "";

function readPolicyName(s, from) {
  const id = readQualifiedName(s, from);
  if (id) return id;
  const q = /^\s*"((?:[^"]|"")*)"/.exec(s.slice(from));
  return q ? { name: q[1], end: from + q[0].length } : { name: null, end: from };
}

/**
 * Strip the plpgsql scaffolding around DDL inside a DO block and return the
 * bare statement, or null if this fragment carries none. Deliberately narrow:
 * anything that is not plainly CREATE / ALTER / DROP / COMMENT is dropped
 * rather than guessed at.
 */
function unwrapPlpgsql(fragment) {
  let s = squash(fragment)
    .replace(/^BEGIN\b/i, "")
    .replace(/^DECLARE\b[\s\S]*?(?=\bBEGIN\b)/i, "")
    .trim();
  // Consume any number of `IF <cond> THEN` / `ELSIF <cond> THEN` / `ELSE` heads.
  for (;;) {
    const head = /^(IF|ELSIF|ELSEIF)\b/i.exec(s);
    if (head) {
      const then = /\bTHEN\b/i.exec(s);
      if (!then) return null;
      s = s.slice(then.index + then[0].length).trim();
      continue;
    }
    if (/^ELSE\b/i.test(s)) { s = s.replace(/^ELSE\b/i, "").trim(); continue; }
    if (/^END\s+(IF|LOOP|CASE)\b/i.test(s)) { s = s.replace(/^END\s+\w+\b/i, "").trim(); continue; }
    if (/^END\b/i.test(s)) { s = s.replace(/^END\b/i, "").trim(); continue; }
    break;
  }
  return /^(CREATE|ALTER|DROP|COMMENT)\b/i.test(s) ? s : null;
}

/** `storage.objects`, `auth.users`, `vault.secrets` — governed elsewhere. */
const foreignSchema = (id) => id.schema !== null && id.schema !== "public";

/**
 * A plpgsql fragment this pass could not read as DDL.
 *
 * Control flow (`END IF`, `END LOOP`, a bare `END`) is not interesting and is
 * dropped. Anything containing EXECUTE is: it is DDL built at run time, and the
 * only honest thing a static replay can say about the objects it touches is
 * "unknown". Which objects those are is over-approximated deliberately — every
 * string literal and every `public.<name>` in the fragment — because an
 * over-broad "we cannot tell" is safe and a narrow one is a false claim.
 */
function noteDynamic(schema, migration, fragment, blockLiterals = null) {
  const s = squash(fragment);
  if (!/\bEXECUTE\b/i.test(s)) return;   // ordinary control flow
  const mentions = new Set();
  for (const m of s.matchAll(/'([a-z_][a-z0-9_]*)'/gi)) mentions.add(m[1].toLowerCase());
  for (const m of s.matchAll(/\bpublic\.([a-z_][a-z0-9_]*)/gi)) mentions.add(m[1].toLowerCase());
  const hasPlaceholder = /%(?:[0-9]+\$)?[sIL]/.test(s.replace(/%%/g, ""));
  // The enclosing block's own literals, in scope because that is where the loop
  // variable is bound (§4 D51). Only for a fragment that assembles a name — a
  // fragment naming its target outright is not guessing and needs no widening.
  if (hasPlaceholder && blockLiterals) {
    for (const name of blockLiterals) mentions.add(name);
  }
  // §4 D51 — A FORMAT PLACEHOLDER IS WHERE THE OVER-APPROXIMATION CAN FAIL.
  //
  // `mentions` is deliberately over-broad, and the comment above says why: an
  // over-broad "we cannot tell" is safe and a narrow one is a false claim. But
  // over-broad is not the same as never-empty. When the target table arrives
  // through a `%s` / `%I` / `%1$s` placeholder, whether this pass sees the name
  // depends entirely on whether the loop's source literal happens to sit inside
  // the SAME semicolon-delimited fragment. It does for a
  // `FOREACH t IN ARRAY ARRAY['a','b'] LOOP EXECUTE format(…)`; it does NOT for
  // `FOR t IN SELECT tablename FROM …`, and it does not when the array is built
  // one statement earlier.
  //
  // D51 is what the second case costs: the three `erp_staged_*` policies were
  // recorded as determinately absent for the whole of Phase 2 and their generated
  // pages said so — the D40 shape (a published falsehood, CI-gated) pointing the
  // other way. The flag never fired because the names it keys on were `%1$s`.
  //
  // So the placeholder is recorded as a FACT about the fragment, and the count of
  // RLS fragments that resolved no known table is a RATCHET in `contract:check`.
  // A detector that reports beats a resolver that guesses: resolving would mean
  // following renames and then deciding whether a LATER literal statement settled
  // what this one left open, and a wrong answer there is a governance claim.
  schema.dynamic.push({
    migration,
    statement: s.slice(0, 400),
    mentions: [...mentions].sort(),
    touches_rls: /ROW\s+LEVEL\s+SECURITY|\bPOLICY\b/i.test(s),
    // `%s`, `%I`, `%L` and the positional `%1$s` form. `%%` is an escaped percent
    // and names nothing, so it is excluded rather than counted as a placeholder.
    has_format_placeholder: hasPlaceholder,
    // Whether the enclosing block had to supply the names — a fragment that
    // resolved only through its block is one the semicolon scope could not read,
    // which is the shape D51 was.
    named_only_via_block: hasPlaceholder && Boolean(blockLiterals) &&
      ![...s.matchAll(/'([a-z_][a-z0-9_]*)'/gi)].some((m) => schema.tables.has(m[1].toLowerCase())) &&
      ![...s.matchAll(/\bpublic\.([a-z_][a-z0-9_]*)/gi)].some((m) => schema.tables.has(m[1].toLowerCase())),
    why: "plpgsql EXECUTE — DDL assembled at run time; a static replay cannot evaluate it",
  });
}

function note(schema, migration, stmt, why) {
  const phantom = /^(?:ALTER TABLE|CREATE (?:UNIQUE )?INDEX|CREATE POLICY) on unknown table "(.+)"$/.exec(why);
  if (phantom) {
    const name = phantom[1];
    if (!schema.phantom.has(name)) schema.phantom.set(name, []);
    schema.phantom.get(name).push({ migration, statement: squash(stmt).slice(0, 160) });
    return;
  }
  schema.unparsed.push({ migration, why, statement: squash(stmt).slice(0, 220) });
}

// ──────────────────────────────────────────── resolving a shadowed definition
//
// "First wins" is only true of migrations that SUCCEED. A migration runs in one
// transaction: if any statement raises, the whole file rolls back and every
// CREATE TABLE in it is undone — so the NEXT file's `IF NOT EXISTS` is the one
// that creates the table.
//
// This repo has exactly that case, and getting it backwards would build the whole
// contract on a schema that does not exist. `20250820145017` and `20250820145155`
// open with
//     ALTER TABLE public.approved_users
//       ALTER COLUMN role TYPE public.app_role USING (...),
//       ALTER COLUMN role SET DEFAULT 'user'::public.app_role;
// against a column that already carries a text default. Postgres rejects that
// ("default for column cannot be cast automatically"), which is why the very next
// migration, `20250820145652`, opens by dropping the default first — it is a
// retry. Both files therefore aborted, and their lane tables (`plant_id uuid`)
// were never created; `20250820145837`'s (`plant_name text`) were.
//
// Rather than hard-code that conclusion, the resolver asks the migrations
// themselves: WHICH definition do the later writers agree with? Every
// `INSERT INTO <table> (cols)` in the history is a statement about the columns
// that exist. When the shadowed definition is corroborated by those writers and
// the replayed one is contradicted by them, the shadowed definition is adopted
// and the evidence recorded. If the evidence is mixed or absent, nothing is
// adopted and the divergence is left for a human — a guess here is worse than
// an open question.

/** `INSERT INTO [public.]t (a, b, c)` across the whole migration history. */
function collectWriteSites(files) {
  const sites = new Map(); // table -> Map(column -> ["migration"])
  const re = /INSERT\s+INTO\s+(?:public\s*\.\s*)?([A-Za-z_][\w]*)\s*\(([^;()]*)\)/gi;
  for (const [file, sql] of files) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(sql))) {
      const table = m[1].toLowerCase();
      const cols = m[2].split(",").map((c) => squash(c).replace(/^"|"$/g, "").toLowerCase()).filter((c) => /^[a-z_][\w]*$/.test(c));
      if (cols.length === 0) continue;
      if (!sites.has(table)) sites.set(table, new Map());
      const bag = sites.get(table);
      for (const c of cols) {
        if (!bag.has(c)) bag.set(c, []);
        if (!bag.get(c).includes(file)) bag.get(c).push(file);
      }
    }
  }
  return sites;
}

/**
 * Adopt a shadowed CREATE TABLE when the writers corroborate it and contradict
 * the replayed one. Returns the list of adoptions for the artifact.
 */
function resolveShadowed(schema, writeSites) {
  const adopted = [];
  for (const sh of schema.shadowed) {
    if (!sh.table || !sh.differs) continue;
    const bag = writeSites.get(sh.table);
    if (!bag) continue;
    const shadowOnly = sh.diff.filter((d) => d.effective === null).map((d) => d.column);
    const replayOnly = sh.diff.filter((d) => d.shadowed === null).map((d) => d.column);
    if (shadowOnly.length === 0) continue;

    const corroborates = shadowOnly.filter((c) => bag.has(c));
    const contradicts = replayOnly.filter((c) => bag.has(c));
    if (corroborates.length !== shadowOnly.length || contradicts.length > 0) {
      sh.resolution = {
        adopted: false,
        why: "the writers do not agree unambiguously with either definition",
        writers_name: shadowOnly.filter((c) => bag.has(c)),
        writers_also_name: replayOnly.filter((c) => bag.has(c)),
      };
      continue;
    }
    sh.resolution = {
      adopted: true,
      why: `every later INSERT names ${corroborates.join(", ")} and none names ${replayOnly.join(", ") || "any replayed-only column"}; the migration that would have won aborted`,
      evidence: Object.fromEntries(corroborates.map((c) => [c, bag.get(c)])),
    };
    adopted.push({ table: sh.table, from: sh.migration, over: sh.created_by, columns: sh.diff });
  }
  return adopted;
}

// ────────────────────────────────────────────────── tables the code reads but no
//                                                    migration creates (orphans)

const CODE_ROOTS = ["src", "supabase/functions", "sim-worker", "scsim", "scripts"];
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|py)$/;
const SKIP_DIR = /node_modules|\.git|dist|build|__pycache__|\.venv|docs\/archive/;
// A TEST is not a consumer. `loudFailure.test.ts` names `product_code_map` in a
// string in order to assert that the ETL no longer reads it — so counting test
// files here makes a table an orphan BECAUSE it was correctly removed, and the
// better the regression guard, the louder the false positive. Orphan detection
// asks "does running code read a table no migration creates?"; a source-level
// assertion about running code is not running code.
const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.(ts|tsx|js|jsx|mjs|py)$|(^|\/)tests?\//;

function walkCode(dir, out = []) {
  if (!existsSync(dir) || SKIP_DIR.test(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP_DIR.test(p)) continue;
    if (statSync(p).isDirectory()) walkCode(p, out);
    else if (CODE_EXT.test(p)) out.push(p);
  }
  return out;
}

/**
 * Tables the application code reads. Scanned over the WHOLE file, not line by
 * line: `supabase.storage\n  .from('avatars')` is a bucket, and a line-local
 * test cannot see the `storage` two lines up. A bucket or another schema's
 * table is not an orphan — counting it as one would send WP 1.4 writing
 * migrations for objects that must not live in `public`.
 */
function findCodeTableRefs() {
  const refs = new Map(); // table -> ["file:line"]
  const patterns = [
    /\.from\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/gi,
    /\bfrom_\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/gi,
    /\.table\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/gi,
  ];
  // The 120 characters before `.from(` — enough for `admin.schema("vault")` or a
  // `supabase.storage` split across lines, short enough not to catch the
  // previous statement.
  const NOT_PUBLIC = /(?:\bstorage|\.schema\(\s*['"`][^'"`]+['"`]\s*\))\s*\.?\s*$/;
  const SELF = join("scripts", "data-contract");

  for (const root of CODE_ROOTS) {
    for (const file of walkCode(join(ROOT, root))) {
      if (file.includes(SELF)) continue; // this generator's own prose
      if (TEST_FILE.test(relative(ROOT, file))) continue; // an assertion, not a consumer
      const text = readFileSync(file, "utf8");
      const lineAt = (idx) => text.slice(0, idx).split("\n").length;
      for (const re of patterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          const before = text.slice(Math.max(0, m.index - 120), m.index);
          if (NOT_PUBLIC.test(before)) continue;
          const name = m[1].toLowerCase();
          if (!refs.has(name)) refs.set(name, []);
          refs.get(name).push(`${relative(ROOT, file)}:${lineAt(m.index)}`);
        }
      }
    }
  }
  return refs;
}

// ───────────────────────────────────────────────────────────────────────── main

function replay(files, skip = new Set()) {
  const schema = new Schema();
  for (const [f, sql] of files) {
    if (skip.has(f)) continue; // the transaction rolled back: nothing in it ran
    for (const stmt of splitStatements(sql)) {
      try { apply(schema, stmt, f); }
      catch (e) { note(schema, f, stmt, `threw: ${e.message}`); }
    }
  }
  return schema;
}

function build() {
  const names = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const files = names.map((f) => [f, readFileSync(join(MIGRATIONS, f), "utf8")]);
  const writeSites = collectWriteSites(files);

  // Iterate to a fixed point. Excluding an aborted file promotes the NEXT
  // definition, which may itself be a retry that also aborted — `20250820145155`
  // is a byte-for-byte retry of `20250820145017` and fails for the same reason.
  // Each round adopts at most the files the writers contradict, so it terminates.
  const aborted = new Set();
  const why = new Map();          // migration -> the reason it aborted
  let schema = replay(files);
  let adopted = resolveShadowed(schema, writeSites);

  // TWO KINDS OF ABORT, AND THE ORDER BETWEEN THEM IS LOAD-BEARING.
  //
  // (a) The corroboration test: of two CREATE TABLEs for one table, the later
  //     INSERTs agree with one and contradict the other.
  // (b) A statement PostgreSQL REJECTS: a CREATE INDEX on a column the table
  //     does not have (42703 — `IF NOT EXISTS` guards the index NAME, not the
  //     column), or a CREATE FUNCTION whose input parameters put a defaulted one
  //     before a plain one (42P13). Either way the file's transaction rolls back
  //     and nothing in it ran.
  //
  // (b) MUST NOT BE READ BEFORE (a) HAS SETTLED, and the first draft of this
  // did, which is how it accused `20260916000018` — WP 3.3's seven unique
  // indexes, the whole of `natural-key` (I4) — of aborting. It reads
  // `inbound_logistics(plant_name, …)`, and in a replay where `20250820145017`
  // has not yet been excluded `inbound_logistics` still carries that file's
  // `plant_id`. The index was right; the schema it was judged against was the
  // one that never existed. Settle (a) first, then judge (b) against the
  // corrected shape, and re-settle (a) in case excluding a file moved it.
  for (let outer = 0; outer < 20; outer++) {
    let moved = false;
    for (let round = 0; round < 20; round++) {
      const fresh = [...new Set(adopted.map((a) => a.over))].filter((m) => !aborted.has(m));
      if (fresh.length === 0) break;
      for (const m of fresh) {
        aborted.add(m);
        why.set(m, "a later migration's CREATE TABLE is corroborated by every subsequent INSERT while this one's is contradicted — so this file's transaction rolled back and none of its statements took effect");
      }
      moved = true;
      schema = replay(files, aborted);
      adopted = resolveShadowed(schema, writeSites);
    }
    const rejected = [...new Set(schema.impossible.map((i) => i.migration))].filter((m) => !aborted.has(m));
    if (rejected.length === 0) { if (!moved) break; continue; }
    for (const m of rejected) {
      aborted.add(m);
      why.set(m, schema.impossible.find((i) => i.migration === m).why + " Nothing else in the file ran either.");
    }
    schema = replay(files, aborted);
    adopted = resolveShadowed(schema, writeSites);
  }
  schema.aborted_migrations = [...aborted].sort().map((m) => ({
    migration: m,
    why: why.get(m),
    tables_it_claimed: tablesClaimedBy(files, m),
  }));

  const tables = [...schema.tables.values()].sort((a, b) => a.name.localeCompare(b.name));
  const known = new Set(tables.map((t) => t.name));

  // Mark every table whose RLS a dynamic block touched. `rls.determinate` is the
  // field the contract reads: false means "the migrations do not say", which is
  // a different statement from `enabled: false` and must never be rendered as it.
  for (const t of tables) t.rls.determinate = true;
  for (const d of schema.dynamic) {
    if (!d.touches_rls) continue;
    for (const name of d.mentions) {
      const t = schema.tables.get(name);
      if (!t) continue;
      t.rls.determinate = false;
      (t.rls.indeterminate_from ??= []).push(d.migration);
    }
  }
  for (const t of tables) {
    if (t.rls.indeterminate_from) t.rls.indeterminate_from = [...new Set(t.rls.indeterminate_from)].sort();
  }

  // §4 D51 · THE FRAGMENTS THAT MARKED NOTHING.
  //
  // A dynamic fragment that TOUCHES RLS and resolves to zero known tables has
  // marked nothing indeterminate — so the schema's RLS story for whatever it
  // targets is whatever OTHER statements happened to say, with nothing recording
  // that a run-time statement also had an opinion. That is the silence D51 is,
  // and it is stated here rather than guessed at.
  //
  // Each entry says whether a format placeholder is involved, because that
  // distinguishes the two ways it happens: a placeholder means the name was
  // assembled and this pass could not see the source; no placeholder means the
  // fragment genuinely named nothing this schema has, which today is the
  // `erp_staged_*` case — those three names were RENAMED away by WP 3.1, which
  // also rewrote their policies as four literal statements and dropped the
  // dynamic ones by their old names, so nothing is unknown about them any more.
  schema.rls_dynamic_unresolved = schema.dynamic
    .filter((d) => d.touches_rls)
    .filter((d) => !d.mentions.some((name) => schema.tables.has(name)))
    .map((d) => ({
      migration: d.migration,
      has_format_placeholder: d.has_format_placeholder,
      mentions: d.mentions,
      statement: d.statement.slice(0, 200),
    }))
    .sort((a, b) => a.migration.localeCompare(b.migration));
  for (const v of schema.views.keys()) known.add(v);

  const codeRefs = findCodeTableRefs();
  const orphans = [...codeRefs.entries()]
    .filter(([t]) => !known.has(t))
    .map(([table, sites]) => ({ table, referenced_at: sites.sort(), note: "read by code; created by no migration" }))
    .sort((a, b) => a.table.localeCompare(b.table));

  return {
    $generator: "scripts/data-contract/introspect.mjs",
    $doc: "EFFECTIVE schema replayed from supabase/migrations/*.sql in filename order. Generated — do not edit; `npm run contract:introspect -- --check` fails on drift.",
    migrations_found: names.length,
    migrations_applied: names.length - schema.aborted_migrations.length,
    first_migration: names[0] ?? null,
    last_migration: names[names.length - 1] ?? null,
    counts: {
      tables: tables.length,
      views: schema.views.size,
      enums: schema.enums.size,
      functions: schema.functions.size,
      shadowed_definitions: schema.shadowed.length,
      phantom_tables: schema.phantom.size,
      unparsed_statements: schema.unparsed.length,
      dynamic_ddl_statements: schema.dynamic.length,
      rls_indeterminate_tables: tables.filter((t) => t.rls.determinate === false).length,
      rls_dynamic_unresolved: schema.rls_dynamic_unresolved.length,
      orphans: orphans.length,
      aborted_migrations: schema.aborted_migrations.length,
    },
    tables: tables.map((t) => ({
      ...t,
      columns: t.columns,
      natural_key_unique: naturalKeys(t),
    })),
    views: Object.fromEntries([...schema.views.entries()].sort()),
    enums: Object.fromEntries([...schema.enums.entries()].sort()),
    functions: [...schema.functions.values()].sort((a, b) => a.signature.localeCompare(b.signature)),
    extensions: [...schema.extensions].sort(),
    dropped_tables: schema.dropped,
    aborted_migrations: schema.aborted_migrations,
    shadowed: schema.shadowed,
    orphans,
    phantom_tables: [...schema.phantom.entries()]
      .map(([table, refs]) => ({
        table,
        note: "migrations ALTER / index / add policies to this table but no migration CREATEs it",
        referenced_by: refs,
      }))
      .sort((a, b) => a.table.localeCompare(b.table)),
    unparsed: schema.unparsed,
    dynamic_ddl: schema.dynamic,
    rls_dynamic_unresolved: schema.rls_dynamic_unresolved,
  };
}

/** Every uniqueness guarantee the table actually has, from any source. */
function naturalKeys(t) {
  const keys = [];
  for (const c of t.constraints) {
    if (c.kind !== "PRIMARY KEY" && c.kind !== "UNIQUE") continue;
    keys.push({
      source: c.implicit ? `column ${c.kind}` : `${c.kind} constraint`,
      columns: c.columns,
      name: c.name,
    });
  }
  for (const i of t.indexes) {
    if (!i.unique) continue;
    keys.push({
      source: i.partial ? "partial UNIQUE index" : "UNIQUE index",
      columns: i.columns, name: i.name,
      ...(i.predicate ? { predicate: i.predicate } : {}),
    });
  }
  return keys;
}

const args = process.argv.slice(2);
const result = build();
const json = JSON.stringify(result, null, 2) + "\n";

if (args.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
  if (current !== json) {
    console.error("SCHEMA DRIFT: build/schema.introspected.json is stale — run `npm run contract:introspect` and commit.");
    process.exit(1);
  }
  console.log(`✓ introspected schema matches the migrations (${result.counts.tables} tables, ${result.migrations_applied} migrations)`);
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);
console.log(
  `✓ ${relative(ROOT, OUT)} — ${result.counts.tables} tables, ${result.counts.functions} functions, ` +
  `${result.counts.shadowed_definitions} shadowed definitions, ${result.counts.aborted_migrations} aborted, ` +
  `${result.counts.orphans} orphans, ` +
  `${result.counts.unparsed_statements} unparsed, ` +
  `${result.counts.dynamic_ddl_statements} dynamic (${result.counts.rls_indeterminate_tables} tables' RLS indeterminate)`,
);
