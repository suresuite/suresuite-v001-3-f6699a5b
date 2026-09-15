#!/usr/bin/env node
// Validate the authored sidecars against contract.schema.json AND against the
// introspected schema (Phase 1 / WP 1.2).
//
//   npm run contract:validate
//
// Two kinds of failure, both fatal:
//   · schema     — the sidecar does not match contract.schema.json
//   · coverage   — a column has no field entry, or a field entry has no column
// The second is the one that matters. A contract that describes eleven of a
// table's twelve columns is not a contract; it is a document that will be wrong
// the first time someone reads it about the twelfth.
//
// WP 1.4's check.mjs extends this to every table, not just the authored twelve.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import Ajv from "ajv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIDECARS = join(ROOT, "supabase", "contract");
const SCHEMA = join(ROOT, "scripts", "data-contract", "contract.schema.json");
const INTROSPECTED = join(ROOT, "build", "schema.introspected.json");

if (!existsSync(INTROSPECTED)) {
  console.error("build/schema.introspected.json is missing — run `npm run contract:introspect` first.");
  process.exit(1);
}

const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
const introspected = JSON.parse(readFileSync(INTROSPECTED, "utf8"));
const TABLES = new Map(introspected.tables.map((t) => [t.name, t]));

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

// The CSV templates the user actually downloads. Every header in one of these is
// a name a user types, so D21 is closed only if every one of them is recorded.
const TEMPLATES = new Map([
  ["inbound_logistics", "inbound_logistic.csv"],
  ["outbound_logistics", "outbound_logistic.csv"],
  ["bom_single_level", "bom_single_level.csv"],
  ["bom_multi_level", "bom_multi_level.csv"],
  ["materials", "materials.csv"],
  ["products", "products.csv"],
  ["suppliers", "suppliers.csv"],
]);
const templateHeaders = (table) => {
  const file = TEMPLATES.get(table);
  if (!file) return null;
  const path = join(ROOT, "public", "template", file);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").split("\n")[0].trim().split(",").map((h) => h.trim()).filter(Boolean);
};

const files = readdirSync(SIDECARS).filter((f) => f.endsWith(".contract.yaml")).sort();
const problems = [];
const summary = [];
const deletionCandidates = [];
const docs = new Map();

for (const file of files) {
  const label = basename(file);
  let doc;
  try {
    doc = load(readFileSync(join(SIDECARS, file), "utf8"));
  } catch (e) {
    problems.push(`${label}: not valid YAML — ${e.message}`);
    continue;
  }

  if (!validate(doc)) {
    for (const err of validate.errors) {
      problems.push(`${label}: schema — ${err.instancePath || "/"} ${err.message}`);
    }
    continue;
  }

  if (`${doc.table}.contract.yaml` !== label) {
    problems.push(`${label}: declares table "${doc.table}" — the filename must match`);
  }

  const table = TABLES.get(doc.table);
  if (!table) {
    problems.push(`${label}: table "${doc.table}" exists in no migration`);
    continue;
  }

  // Coverage, both ways.
  const columns = new Set(table.columns.map((c) => c.name));
  const described = new Set(Object.keys(doc.fields));
  for (const c of columns) if (!described.has(c)) problems.push(`${label}: column "${c}" has no field entry`);
  for (const f of described) if (!columns.has(f)) problems.push(`${label}: field "${f}" describes no column`);

  // Types must be the introspected ones — a sidecar does not get its own opinion.
  for (const c of table.columns) {
    const f = doc.fields[c.name];
    if (f && f.type !== c.type) {
      problems.push(`${label}: "${c.name}" says type "${f.type}"; the migrations say "${c.type}"`);
    }
  }

  // natural_key_unique is copied, not authored.
  const actual = JSON.stringify(table.natural_key_unique.map((k) => k.columns.join("+")).sort());
  const claimed = JSON.stringify((doc.natural_key_unique ?? []).map((k) => k.columns.join("+")).sort());
  if (actual !== claimed) {
    problems.push(`${label}: natural_key_unique is ${claimed}; the migrations say ${actual}`);
  }

  // rls_enabled likewise.
  if (doc.governance.rls_enabled !== undefined && doc.governance.rls_enabled !== table.rls.enabled) {
    problems.push(`${label}: governance.rls_enabled is ${doc.governance.rls_enabled}; the migrations say ${table.rls.enabled}`);
  }

  // D21, enforced rather than asserted: every header of the template the user
  // downloads must be recorded as some field's csv_header. A header the contract
  // does not know is a column the manual cannot lead with.
  const headers = templateHeaders(doc.table);
  const recorded = new Set(Object.values(doc.fields).map((f) => f.ingest.csv_header).filter(Boolean));
  if (headers) {
    for (const h of headers) {
      if (!recorded.has(h)) problems.push(`${label}: template header "${h}" is recorded by no field (D21)`);
    }
  }
  const csvHeaders = recorded.size;
  // An untraced field must say so rather than leaving a silent blank.
  for (const [name, f] of Object.entries(doc.fields)) {
    if (f.engine.consumed_by === null && f.grain !== "metadata" && f.grain !== "identifier" && !f.note) {
      problems.push(`${label}: "${name}" has no engine.consumed_by and no note saying why — a blank is not a trace`);
    }
  }

  // A field the engine does not read and no surface renders is a deletion
  // candidate. This WP lists them; it does not delete them.
  const serverStamped = new Set(
    table.columns.filter((c) => c.default === "now()").map((c) => c.name),
  );
  for (const [name, f] of Object.entries(doc.fields)) {
    // Identifiers and server-stamped audit timestamps are never candidates: they
    // are infrastructure, and listing them buries the fields that are.
    if (f.grain === "identifier" || serverStamped.has(name)) continue;
    if (f.engine.consumed_by === null && f.surfaces.length === 0) {
      deletionCandidates.push(`${doc.table}.${name} — ${f.note ? f.note.split(". ")[0] + "." : "no note"}`);
    }
  }

  docs.set(doc.table, doc);
  summary.push({ table: doc.table, tier: doc.tier, fields: described.size, csvHeaders });
}

// Pinned by name, because these are the fields the plan's exit checks name and
// the ones later packages change. A pin that only exists in a session transcript
// is not a pin — WP 1.2's §16 entry claimed this one existed a package early.
const PINNED = [
  // WP 1.3 (D9): was `fixed` and fixed by OMISSION — the engine read a unit no
  // column supplied. `weeks` stays because that is what NULL still means.
  ["inbound_logistics", "lead_time", { unit: "weeks", unit_source: "column", unit_column: "lead_time_unit" }],
  ["inbound_logistics", "lead_time_unit", { unit: null, unit_source: "none" }],
  // WP 1.3 step 4 — the load-bearing line. An estimator that fits a distribution
  // to an engineering fact produces a number with error bars around something
  // that has none, and the error bars get believed.
  ["bom_single_level", "consumption_rate", { estimable_from: [] }],
  ["bom_multi_level", "consumption_rate", { estimable_from: [] }],
  ["materials", "moq", { estimable_from: [] }],
  ["suppliers", "capacity_per_week", { estimable_from: [] }],
  // WP 1.3 step 5 — price has no variability field anywhere in scsim. Recording
  // a hybrid here would describe a capability the engine does not have.
  ["materials", "cost", { hybrid: null }],
  ["products", "sell_price", { hybrid: null }],
  ["inbound_logistics", "unit_price", { hybrid: null }],
  ["outbound_logistics", "unit_price", { hybrid: null }],
];
for (const [table, fieldName, expected] of PINNED) {
  const doc = docs.get(table);
  const f = doc?.fields?.[fieldName];
  if (!f) { problems.push(`pinned: ${table}.${fieldName} has no field entry`); continue; }
  for (const [key, want] of Object.entries(expected)) {
    const got = key === "hybrid" || key === "estimable_from" ? f.resolution?.[key] : f[key];
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`pinned: ${table}.${fieldName}.${key} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  }
}

console.log("WP 1.2 — sidecar validation\n");
for (const s of summary) {
  console.log(`  ✓ ${s.table.padEnd(30)} tier ${String(s.tier).padEnd(4)} ${String(s.fields).padStart(2)} fields  ${s.csvHeaders} CSV headers`);
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
// WP 1.2's gap check, printed every run so it cannot quietly go stale.
if (deletionCandidates.length) {
  console.log(`\n  Deletion candidates — no engine.consumed_by and no surface (${deletionCandidates.length}).`);
  console.log("  LISTED, NOT DELETED: surfaces[] is empty everywhere until WP 5.1 fills it, so");
  console.log("  'no surface' currently means 'not yet recorded', not 'not rendered'.\n");
  for (const c of deletionCandidates) console.log(`    · ${c}`);
}
console.log(`\n✓ ${summary.length} sidecars validate; every column of each is described`);
