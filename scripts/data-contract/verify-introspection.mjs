#!/usr/bin/env node
// WP 1.1's exit checks, as a script rather than a session transcript.
//
//   npm run contract:verify
//
// The plan's exit checks are assertions about the EFFECTIVE schema, and an
// assertion nobody can re-run is an assertion that rots. Each check below is
// PLAN.md §8 WP 1.1's, verbatim in intent; the orphan check is expected to
// report the third orphan this WP found (see §16) and fails loudly rather than
// being softened to match what is there.
//
// WP 1.4 folds these into `check.mjs`; until then this is the gate.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACT = join(ROOT, "build", "schema.introspected.json");

if (!existsSync(ARTIFACT)) {
  console.error("build/schema.introspected.json is missing — run `npm run contract:introspect` first.");
  process.exit(1);
}
const schema = JSON.parse(readFileSync(ARTIFACT, "utf8"));
const T = new Map(schema.tables.map((t) => [t.name, t]));

const LANES = ["inbound_logistics", "outbound_logistics", "bom_single_level", "bom_multi_level"];
const MASTERS = ["materials", "products", "suppliers"];
const GOVERNANCE = [
  "organizations", "organization_members", "capabilities",
  "org_capabilities", "role_capabilities", "user_capabilities", "admin_audit_logs",
];
const EXPECTED_ORPHANS = ["product_code_map", "risk_data"];

const results = [];
const check = (label, pass, detail = "") => results.push({ label, pass, detail });
const missing = (names) => names.filter((n) => !T.has(n));

check("the four lane tables are present", missing(LANES).length === 0, missing(LANES).join(", "));
check("the three item masters are present", missing(MASTERS).length === 0, missing(MASTERS).join(", "));
check("supply_chain_data is present", T.has("supply_chain_data"));
check("dataset_versions is present", T.has("dataset_versions"));
check("the governance tables are present", missing(GOVERNANCE).length === 0, missing(GOVERNANCE).join(", "));

const keys = T.get("inbound_logistics")?.natural_key_unique ?? [];
check(
  "inbound_logistics has no unique constraint beyond id — confirms D5",
  keys.length > 0 && keys.every((k) => k.columns.length === 1 && k.columns[0] === "id"),
  keys.map((k) => `${k.source}(${k.columns.join(",")})`).join(" · "),
);

const weighted = T.get("supply_chain_data")?.columns.find((c) => c.name === "weighted");
check("supply_chain_data.weighted is numeric(16,6)", weighted?.type === "numeric(16,6)", weighted?.type ?? "column absent");

const orphans = schema.orphans.map((o) => o.table).sort();
check(
  `orphans are exactly ${EXPECTED_ORPHANS.join(" + ")}`,
  orphans.join(",") === EXPECTED_ORPHANS.join(","),
  `found ${orphans.join(", ")}`,
);

// Not a plan exit check, but the introspector's own honesty gate: a statement it
// could not read is a hole in the schema, and a silent hole is the failure mode
// this whole package exists to remove.
check("every DDL statement was read", schema.counts.unparsed_statements === 0,
      `${schema.counts.unparsed_statements} unparsed`);

let failed = 0;
console.log("WP 1.1 exit checks — build/schema.introspected.json\n");
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`  ${r.pass ? "✓" : "✗"} ${r.label}${r.detail ? `\n      ${r.detail}` : ""}`);
}
console.log(
  `\n  ${schema.counts.tables} tables · ${schema.counts.functions} functions · ` +
  `${schema.counts.enums} enums · ${schema.counts.shadowed_definitions} shadowed definitions · ` +
  `${schema.counts.aborted_migrations} aborted migrations · ${schema.counts.orphans} orphans`,
);
if (failed) {
  console.error(`\n${failed} check(s) failed. Do not weaken a check to make it pass — record the finding in PLAN.md §16.`);
  process.exit(1);
}
console.log("\n✓ all exit checks pass");
