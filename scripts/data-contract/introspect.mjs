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
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { splitStatements, splitTopLevel, parenBody, readQualifiedName, squash } from "./sql-lex.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const OUT = join(ROOT, "build", "schema.introspected.json");

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
    const open = s.indexOf(tag);
    const close = s.lastIndexOf(tag);
    if (close > open) {
      for (const inner of splitStatements(s.slice(open + tag.length, close))) {
        const ddl = unwrapPlpgsql(inner);
        if (ddl) apply(schema, ddl, migration, true);
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
    if (name && t.indexes.some((i) => i.name === name)) return; // IF NOT EXISTS
    t.indexes.push({
      name,
      unique,
      columns: cols ? splitTopLevel(cols.body).map((c) => squash(c)) : [],
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
    schema.functions.set(sig, {
      name: id.name,
      signature: sig,
      args: argList,
      returns: returns ? squash(returns[1]) : null,
      security_definer: /\bSECURITY\s+DEFINER\b/i.test(s),
      volatility: /\b(IMMUTABLE|STABLE|VOLATILE)\b/i.exec(s)?.[1]?.toUpperCase() ?? null,
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
    if (id) schema.views.set(id.name, { defined_by: migration, materialized: /MATERIALIZED/i.test(s) });
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
    t.columns.push(col);
    return;
  }
  if ((m = /^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?/i.exec(a))) {
    const id = readQualifiedName(a, m[0].length);
    if (id) t.columns = t.columns.filter((c) => c.name !== id.name);
    return;
  }
  if ((m = /^RENAME\s+COLUMN\s+/i.exec(a)) || (m = /^RENAME\s+(?!TO|CONSTRAINT)/i.exec(a))) {
    const from = readQualifiedName(a, m[0].length);
    const toAt = /\bTO\s+/i.exec(a.slice(from.end));
    const to = toAt && readQualifiedName(a, from.end + toAt.index + toAt[0].length);
    const col = from && t.columns.find((c) => c.name === from.name);
    if (col && to) { col.name = to.name; col.quoted = to.quoted; col.renamed_by = migration; }
    return;
  }
  if ((m = /^RENAME\s+TO\s+/i.exec(a))) {
    const to = readQualifiedName(a, m[0].length);
    if (to) { schema.tables.delete(t.name); t.name = to.name; schema.tables.set(to.name, t); }
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

const argType = (a) => squash(a).replace(/\bDEFAULT\b.*$/i, "").split(/\s+/).slice(-1)[0].toLowerCase();

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
  let schema = replay(files);
  let adopted = resolveShadowed(schema, writeSites);
  for (let round = 0; round < 20; round++) {
    const fresh = [...new Set(adopted.map((a) => a.over))].filter((m) => !aborted.has(m));
    if (fresh.length === 0) break;
    for (const m of fresh) aborted.add(m);
    schema = replay(files, aborted);
    adopted = resolveShadowed(schema, writeSites);
  }
  schema.aborted_migrations = [...aborted].sort().map((m) => ({
    migration: m,
    why: "a later migration's CREATE TABLE is corroborated by every subsequent INSERT while this one's is contradicted — so this file's transaction rolled back and none of its statements took effect",
    tables_it_claimed: tablesClaimedBy(files, m),
  }));

  const tables = [...schema.tables.values()].sort((a, b) => a.name.localeCompare(b.name));
  const known = new Set(tables.map((t) => t.name));
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
  `${result.counts.unparsed_statements} unparsed`,
);
