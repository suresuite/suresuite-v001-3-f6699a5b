#!/usr/bin/env node
// WP 1.1's exit checks, as a script rather than a session transcript.
//
//   npm run contract:verify
//
// The plan's exit checks are assertions about the EFFECTIVE schema, and an
// assertion nobody can re-run is an assertion that rots. Each check below is
// PLAN.md §8 WP 1.1's, verbatim in intent. The orphan check has flipped once:
// WP 1.1 asserted the orphans it expected to find and failed loudly on the third
// (`approved_users`); WP 1.4 reconciled all three, so it now asserts that none
// remain, and the three reconciliations are pinned individually below.
//
// WP 1.4 folded these into `check.mjs`, which runs this script as its first
// stage; they stay here so `npm run contract:verify` remains runnable alone.

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
  "org_capabilities", "role_capabilities", "user_capabilities", "audit_logs",
];
// WP 1.1 expected TWO and found three. WP 1.4 reconciled all three, so the
// assertion is now the opposite one — and it is a stronger check, not a weaker:
// "orphans are exactly X" passes while X sits there unfixed, and this does not.
const EXPECTED_ORPHANS = [];

const results = [];
const check = (label, pass, detail = "") => results.push({ label, pass, detail });
const missing = (names) => names.filter((n) => !T.has(n));

check("the four lane tables are present", missing(LANES).length === 0, missing(LANES).join(", "));
check("the three item masters are present", missing(MASTERS).length === 0, missing(MASTERS).join(", "));
check("supply_chain_data is present", T.has("supply_chain_data"));
check("dataset_versions is present", T.has("dataset_versions"));
// `audit_logs` and not `admin_audit_logs`: WP 2.3 RENAMED the table so the audit
// could carry a `plane` and cover tier transitions, not just admin actions. The
// old name survives as a compatibility VIEW, and a view would satisfy a weaker
// check while the table it reads had been dropped — so this asserts the TABLE.
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
  "no orphans remain — every table the code reads is created by a migration",
  orphans.join(",") === EXPECTED_ORPHANS.join(","),
  orphans.length ? `found ${orphans.join(", ")}` : "",
);

// The three reconciliations of WP 1.4, each pinned by what it was ABOUT rather
// than by the orphan count, so deleting the wrong thing cannot make this pass.
const au = T.get("approved_users");
check(
  "approved_users is created by a migration — a fresh DB can be built from supabase/migrations/ alone",
  Boolean(au?.created_by),
  au ? `created by ${au.created_by}` : "still created by no migration",
);
check(
  "approved_users keeps the shape the ALTERs describe (role is app_role, email unique)",
  au?.columns.find((c) => c.name === "role")?.type === "public.app_role" &&
    au?.natural_key_unique.some((k) => k.columns.join(",") === "email"),
  au ? `role ${au.columns.find((c) => c.name === "role")?.type}` : "absent",
);
const risk = T.get("risk_data");
const riskCols = new Set(risk?.columns.map((c) => c.name) ?? []);
const PROVENANCE = ["source", "vintage", "licence", "refreshed_at"];
check(
  "risk_data carries source, vintage, licence and refreshed_at",
  PROVENANCE.every((c) => riskCols.has(c)),
  PROVENANCE.filter((c) => !riskCols.has(c)).join(", ") || "",
);
check(
  "risk_data's quoted upper-case columns are gone",
  riskCols.has("country") && riskCols.has("risk_class") &&
    !risk?.columns.some((c) => c.quoted || /[A-Z ]/.test(c.name)),
  [...riskCols].filter((c) => /[A-Z ]/.test(c)).join(", ") || "",
);

// A phantom is the class approved_users belonged to: ALTERed and policied by the
// history, created by none of it. Nothing may be left in it.
check(
  "no phantom tables — nothing is ALTERed that was never created",
  schema.counts.phantom_tables === 0,
  schema.phantom_tables.map((p) => p.table).join(", "),
);

// Not a plan exit check, but the introspector's own honesty gate: a statement it
// could not read is a hole in the schema, and a silent hole is the failure mode
// this whole package exists to remove.
check("every DDL statement was read", schema.counts.unparsed_statements === 0,
      `${schema.counts.unparsed_statements} unparsed`);

// Read is not the same as EVALUATED. A migration that builds DDL with
// `EXECUTE format(...)` cannot be replayed statically, and the first version of
// this introspector dropped those fragments without a word — which is how the
// three item masters came to be recorded as having RLS off when
// `20260614000001_item_master.sql` enables it and adds two policies to each.
// The fix is not to evaluate plpgsql; it is to say which objects the answer is
// unknown for. This check asserts the saying still happens.
check(
  "dynamic DDL is recorded rather than dropped",
  Array.isArray(schema.dynamic_ddl) && typeof schema.counts.dynamic_ddl_statements === "number",
  `${schema.counts.dynamic_ddl_statements} EXECUTE fragments · ` +
  `${schema.counts.rls_indeterminate_tables} tables whose RLS the migrations do not settle`,
);
// The other half of the same lesson, and the reason this one is pinned by count:
// these four policies live inside a `DO $$ ... $$` block that OPENS with a
// `-- View policy` comment. The descent used to split the SQUASHED body, where
// the newlines are gone, so `--` ran to the end of the block and swallowed all
// four. The artifact then showed RLS on with no policy — deny-all — which is a
// louder wrong answer than the one it replaced.
check(
  "DO-block DDL after a `--` comment is still read (supply_chain_data_multi_tier)",
  (T.get("supply_chain_data_multi_tier")?.rls.policies.length ?? 0) === 4,
  `${T.get("supply_chain_data_multi_tier")?.rls.policies.length ?? 0} policies`,
);
check(
  "the item masters' RLS is reported as INDETERMINATE, not as off",
  ["materials", "products", "suppliers"].every((n) => T.get(n)?.rls.determinate === false),
  ["materials", "products", "suppliers"]
    .map((n) => `${n}: determinate=${T.get(n)?.rls.determinate}`).join(" · "),
);

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
