#!/usr/bin/env node
// The data-contract gate (Phase 1 / WP 1.4).
//
//   npm run contract:check
//
// ONE command that reproduces everything CI asserts about the data layer, so a
// contributor does not have to reconstruct the job from a workflow file. It runs
// the gates WP 1.1–1.3 built, then WP 1.4's own five rules:
//
//   R1  every table is either described by a sidecar or listed in coverage.yaml
//   R2  every coverage.yaml entry names a table that exists and has no sidecar
//   R3  the generated contract and pages match what the sources generate
//   R4  no table the code reads is missing its migration, and none is ALTERed
//       without being created
//   R5  a tier-2 table whose only uniqueness is a surrogate key — WARN (WP 2.4)
//   R6  every file:line in PLAN.md §4 resolves and is in bounds
//
// WHY R1 IS THE ONE THAT MATTERS. "Every column of the twelve tables is
// described" is a fact about twelve tables; it says nothing about the seventy
// third. R1 makes the schema itself the checklist: a table added to a migration
// must be described or explicitly deferred with a named work package, and there
// is no third option. That is the rule that would have caught `approved_users` —
// the AUTHENTICATION table — existing in no migration at all.
//
// WHY R4 FIRES ON approved_users. Before this package the introspector reported
// three orphans: tables the code reads that no migration creates. WP 1.4
// reconciled all three (a CREATE TABLE for `approved_users`, a real migration
// for `risk_data`, deletion of the dead `product_code_map` branch), so R4 is
// green — and `git revert` of any one of those three turns it red again. The
// rule is proved by the case, not asserted next to it.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { load } from "js-yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const INTROSPECTED = join(ROOT, "build", "schema.introspected.json");
const COVERAGE = join(HERE, "coverage.yaml");
const PLAN = join(ROOT, "docs", "PLAN.md");

const failures = [];
const warnings = [];
const fail = (rule, msg) => failures.push(`${rule}  ${msg}`);
const warn = (rule, msg) => warnings.push(`${rule}  ${msg}`);

// ───────────────────────────────────────────────────── stage 1: the sub-gates
//
// Run as child processes rather than imported, so each keeps its own exit code
// and its own output. WP 1.3's handoff asked for exactly this: one command that
// runs all four plus the drift comparison, so there is one name to put in CI and
// in CONTRIBUTING.

const SUBGATES = [
  ["introspect.mjs", ["--check"], "the introspected schema matches the migrations"],
  ["validate-sidecars.mjs", [], "the sidecars validate against the schema"],
  ["gen-unit-sql.mjs", ["--check"], "the SQL unit table matches grading.ts"],
  ["verify-introspection.mjs", [], "WP 1.1's exit checks"],
  ["generate.mjs", ["--check"], "the contract and its pages match their sources"],
];

console.log("── data contract ──────────────────────────────────────────────\n");
for (const [script, args, what] of SUBGATES) {
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: "utf8" });
  const label = `${script} ${args.join(" ")}`.trim();
  if (r.status === 0) {
    console.log(`  ✓ ${what}`);
  } else {
    console.log(`  ✗ ${what}`);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    for (const line of out.split("\n")) console.log(`      ${line}`);
    fail("sub-gate", `${label} exited ${r.status}`);
  }
}
console.log("");

if (!existsSync(INTROSPECTED)) {
  console.error("build/schema.introspected.json is missing — run `npm run contract:introspect` first.");
  process.exit(1);
}
const schema = JSON.parse(readFileSync(INTROSPECTED, "utf8"));
const tables = new Map(schema.tables.map((t) => [t.name, t]));

// ───────────────────────────────────────────── R1/R2: nothing is undescribed

const sidecars = new Map();
for (const f of readdirSync(join(ROOT, "supabase", "contract")).filter((f) => f.endsWith(".contract.yaml"))) {
  sidecars.set(f.replace(".contract.yaml", ""), `supabase/contract/${f}`);
}

const coverage = load(readFileSync(COVERAGE, "utf8"));
const deferred = new Map();
for (const group of coverage.deferred ?? []) {
  if (!group.wp || !group.why) fail("R2", `a coverage.yaml group has no wp or no why: ${JSON.stringify(group.tables)}`);
  for (const t of group.tables ?? []) {
    if (deferred.has(t)) fail("R2", `coverage.yaml defers "${t}" twice (WP ${deferred.get(t)} and WP ${group.wp})`);
    deferred.set(t, group.wp);
  }
}

for (const name of tables.keys()) {
  const described = sidecars.has(name);
  const isDeferred = deferred.has(name);
  if (described && isDeferred) {
    fail("R1", `"${name}" has a sidecar AND a coverage.yaml deferral — pick one`);
  } else if (!described && !isDeferred) {
    fail(
      "R1",
      `"${name}" is in the schema, has no sidecar, and is not deferred in coverage.yaml.\n` +
      `        Author supabase/contract/${name}.contract.yaml, or add it to coverage.yaml under the\n` +
      `        work package that will. A table nobody has decided about is how the data layer drifts.`,
    );
  }
}
for (const [name, wp] of deferred) {
  if (!tables.has(name)) fail("R2", `coverage.yaml defers "${name}" (WP ${wp}), which exists in no migration`);
}

// ───────────────────────────────── R4: orphans and phantoms (both must be empty)

for (const o of schema.orphans) {
  fail(
    "R4",
    `"${o.table}" is read by code but created by no migration — ${o.referenced_at.slice(0, 3).join(", ")}` +
    `${o.referenced_at.length > 3 ? ` (+${o.referenced_at.length - 3} more)` : ""}.\n` +
    `        Add the migration or delete the read. A fresh database built from supabase/migrations/\n` +
    `        alone does not have this table, so every one of those call sites fails there.`,
  );
}
for (const p of schema.phantom_tables) {
  fail("R4", `"${p.table}" is ALTERed, indexed or policied by ${p.referenced_by.length} statements and created by none`);
}

// ─────────────────────── R5: natural keys — WARN until WP 3.3 lands them (D5)

// TODO(2026-09-15, WP 2.4): flip this to a failure. WP 3.3 adds the natural-key
// constraints and the upsert that makes them survivable; WP 2.4 generates the RLS
// and key tests from the contract and is where the warning becomes a gate. Until
// 3.3 has landed, failing here would only mean every run of the gate is red for a
// reason no one in this phase is allowed to fix — which is how `npm run lint`
// became unreadable (PLAN.md §16, the WP 1.1 precondition entry).
const surrogateOnly = (t) =>
  t.natural_key_unique.length > 0 &&
  t.natural_key_unique.every((k) => k.columns.length === 1 && k.columns[0] === "id");

for (const [name, path] of [...sidecars].sort()) {
  const doc = load(readFileSync(join(ROOT, path), "utf8"));
  if (doc.tier !== "2") continue;
  const t = tables.get(name);
  if (!t) continue; // R1/validate already reported it
  if (t.natural_key_unique.length === 0) {
    warn("R5", `"${name}" is tier 2 and has NO uniqueness at all — not even a primary key`);
  } else if (surrogateOnly(t)) {
    warn(
      "R5",
      `"${name}" is tier 2 and its only uniqueness is the surrogate \`id\` (D5). ` +
      `The grain implies ${doc.natural_key_intended ? `\`${doc.natural_key_intended.join(" + ")}\`` : "a key the sidecar has not stated"}; ` +
      "re-uploading the same file duplicates every row.",
    );
  }
}

// ───────────────────── R6: PLAN.md §4 is the only authority — so it must resolve

const SKIP_DIR = /node_modules|\.git|\/dist\b|__pycache__|\.venv|\/build\/|docs\/archive/;
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (SKIP_DIR.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(relative(ROOT, p));
  }
  return out;
}
const repoFiles = walk(ROOT);
const resolveCitation = (cited) => {
  const exact = repoFiles.filter((f) => f === cited || f.endsWith("/" + cited));
  if (exact.length) return exact;
  // §4 elides migration timestamps (`item_master.sql` for
  // `20260614000001_item_master.sql`), which is right — the timestamp is noise
  // to a reader and the suffix is unique.
  const base = cited.split("/").pop();
  return repoFiles.filter((f) => f.split("/").pop().endsWith(base));
};

const planLines = readFileSync(PLAN, "utf8").split("\n");
const secStart = planLines.findIndex((l) => l.startsWith("## 4. Confirmed defects"));
const secEnd = planLines.findIndex((l) => l.startsWith("## 5. The transparency standard"));
if (secStart < 0 || secEnd < 0) fail("R6", "PLAN.md §4 could not be located — the section headings moved");

const CITATION = /([\w./-]+\.(?:ts|tsx|py|sql))\s*:\s*(\d+(?:[-,]\d+)*)/g;
const PATHISH = /[\w./-]+\.(?:ts|tsx|py|sql)/;
// Words too common to anchor anything. A token that means "a value" cannot
// distinguish one line from another.
const STOP = new Set([
  "null", "true", "false", "default", "data", "type", "name", "value", "this",
  "from", "with", "that", "only", "then", "when", "where", "text", "uuid",
  "numeric", "select", "insert", "table", "json", "case", "else",
]);

const anchor = { inRange: 0, elsewhere: [], none: 0, shared: 0, historical: 0 };
for (let i = secStart; i >= 0 && i < secEnd; i++) {
  const row = planLines[i];
  const cites = [...row.matchAll(CITATION)];
  if (!cites.length) continue;
  const spans = [...row.matchAll(/`([^`]+)`/g)].map((x) => x[1]).filter((s) => !PATHISH.test(s) && !s.includes("/"));
  const tokens = new Set();
  for (const s of spans) {
    for (const t of s.split(/[^A-Za-z0-9_]+/)) {
      if (t.length >= 4 && /[A-Za-z]/.test(t) && !/^\d/.test(t) && !STOP.has(t.toLowerCase())) tokens.add(t);
    }
  }

  for (const m of cites) {
    const at = `PLAN.md:${i + 1}`;
    const candidates = resolveCitation(m[1]);
    if (candidates.length === 0) {
      fail("R6", `${at} cites \`${m[0]}\` — no such file in the repo`);
      continue;
    }
    if (candidates.length > 1) {
      fail("R6", `${at} cites \`${m[0]}\`, which matches ${candidates.length} files (${candidates.join(", ")}) — qualify the path`);
      continue;
    }
    const file = candidates[0];
    const src = readFileSync(join(ROOT, file), "utf8").split("\n");
    const nums = m[2].split(/[-,]/).map(Number);
    const lo = Math.min(...nums), hi = Math.max(...nums);
    if (lo < 1 || hi > src.length) {
      fail("R6", `${at} cites \`${m[0]}\` but ${file} has ${src.length} lines — the citation is stale`);
      continue;
    }

    // The anchor check below is REPORTED, never enforced, and the reason is
    // measured rather than assumed: §4's rows attach their prose to the DEFECT,
    // not to each citation, so a row with three citations has one pool of tokens
    // between them and a row describing a line by its behaviour ("`resolveField`'s
    // `> 0` test") anchors on a token that legitimately sits seven lines above.
    // Both produce false positives, and a gate that cries wolf is the gate people
    // learn to ignore — which is what `npm run lint` became here.
    // Making it enforceable needs per-citation anchors in §4; PLAN.md §9 WP 2.4
    // owns that, and this report is the backlog it works from.
    if (/\bwas\b[^|]*$/.test(row.slice(0, m.index))) { anchor.historical++; continue; }
    if (cites.length > 1) { anchor.shared++; continue; }
    const whole = src.join("\n");
    const base = file.split("/").pop().replace(/\.(ts|tsx|py|sql)$/, "");
    const usable = [...tokens]
      .filter((t) => !base.includes(t) && !t.includes(base))
      .map((t) => ({ t, n: whole.split(t).length - 1 }))
      .filter((a) => a.n >= 1 && a.n <= 8);
    if (!usable.length) { anchor.none++; continue; }
    const range = src.slice(lo - 1, hi).join("\n");
    if (usable.some((a) => range.includes(a.t))) { anchor.inRange++; continue; }
    anchor.elsewhere.push(
      `${at} \`${m[0]}\` → ${file}:${lo}-${hi}; ` +
      usable.map((a) => `\`${a.t}\` is at :${src.findIndex((l) => l.includes(a.t)) + 1}`).join(", "),
    );
  }
}

// ──────────────────────────────────────────────────────────────────── report

const covered = [...sidecars.keys()].length;
console.log(`  R1  ${covered} tables described · ${deferred.size} deferred with a named work package · ${tables.size} in the schema`);
console.log(`  R4  ${schema.orphans.length} orphans · ${schema.phantom_tables.length} phantom tables`);
console.log(
  `  R6  §4 citations: ${anchor.inRange} anchored in range · ${anchor.elsewhere.length} anchored elsewhere · ` +
  `${anchor.none} with no usable anchor · ${anchor.shared} sharing a row · ${anchor.historical} historical ("was …")`,
);
if (anchor.elsewhere.length) {
  console.log(`\n  §4 citations whose own token sits on a different line — REPORTED, not enforced (WP 2.4):`);
  for (const e of anchor.elsewhere) console.log(`    · ${e}`);
}
if (warnings.length) {
  console.log(`\n  ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`    ⚠ ${w}`);
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} failure(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    "\nDo not weaken a rule to make it pass. If a rule cannot pass, say so in PLAN.md §16\n" +
    "and leave the rule alone — a gate that has been relaxed to go green measures nothing.",
  );
  process.exit(1);
}
console.log(`\n✓ the data contract holds${warnings.length ? ` (${warnings.length} warning(s) above)` : ""}`);
