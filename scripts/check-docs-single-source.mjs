#!/usr/bin/env node
// Single-source gate for DATA-LAYER facts (invariant I1).
//
// docs/data/IMPLEMENTATION-PLAN.md §4 is the only authority for file:line
// evidence about the data chain — CSV parse, ingest, ETL, the policy grid, the
// engine mapping and the migrations. Two rules:
//
//   1. Only allow-listed files may cite data-layer evidence at all.
//   2. An allow-listed DERIVED file may not hold a fact the plan lacks —
//      a cache that outlives its source is how docs drift (D21, D22).
//
// Deliberately NOT in scope: docs about other subjects that happen to cite code
// (the UI consistency audit, the mobile parity plan, the AI-agent design). They
// own their own evidence; this gate is about the data layer only.
//
// Run: npm run check:docs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PLAN = "docs/data/IMPLEMENTATION-PLAN.md";

/** Source files whose line numbers are data-layer facts the plan owns. */
const DATA_LAYER = [
  "UploadWizard", "ingest-inbound-logistics", "ingest-outbound-logistics",
  "ingest-bom-multi-level", "combine-project", "projectLanes", "useStageRows",
  "useItemMasters", "effectiveEconomics", "grading.ts", "resolveEffective",
  "columnSpecs", "StagePolicyTable", "policyGridUi", "verifiableExports",
  "project_map.py", "datamap.py", "network.py", "enums.py", "engine.py",
  "item_master", "dataset_versions", "unified_access_control",
  "super_admin_phase1", "erp_connector", "ProductLevelNetwork",
  "FirmLevelNetwork", "ProcessLevelNetwork", "delete-project",
];

const CITATION = /\b([\w./-]+\.(?:ts|tsx|py|sql))\s*:\s*(\d+(?:[-,]\d+)*)/g;
const isDataLayer = (f) => DATA_LAYER.some((n) => f.includes(n));

/** file → { why, derived } — derived files must hold no fact the plan lacks. */
const ALLOWED = new Map([
  [PLAN, { why: "the single source — §4 owns all data-layer evidence", derived: false }],
  ["docs/data/PROMPTS.md", {
    why: "derived view: caches §4 evidence so a cold session need not dig",
    derived: true,
  }],
  ["docs/design/ai-agents.md", {
    why: "owns the AI-agent subject; cites the usage-log migration for that reason",
    derived: false,
  }],
  ["docs/mobile-ux-demo-parity-plan.md", {
    why: "owns the mobile-UI subject; its network-page citations are layout, not data",
    derived: false,
  }],
  ["docs/archive/legacy-help-site/README.md", {
    why: "archived record of why the legacy site was retired; frozen",
    derived: true,
  }],
]);

const SKIP = /node_modules|\/tables\/|\.generated\./;
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".md")) out.push(relative(ROOT, p));
  }
  return out;
}

const plan = readFileSync(join(ROOT, PLAN), "utf8");
const unlisted = [];
const orphans = [];

for (const file of walk(join(ROOT, "docs"))) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const facts = [...new Set(
    [...text.matchAll(CITATION)]
      .filter((m) => isDataLayer(m[1]))
      .map((m) => `${m[1]}:${m[2]}`),
  )];
  if (facts.length === 0) continue;

  const rule = ALLOWED.get(file);
  if (!rule) {
    unlisted.push({ file, facts });
    continue;
  }
  if (rule.derived) {
    for (const f of facts) {
      const bare = f.split("/").pop();
      if (!plan.includes(f) && !plan.includes(bare)) orphans.push({ file, fact: f });
    }
  }
}

const ok = unlisted.length === 0 && orphans.length === 0;
if (ok) {
  console.log("✓ single source holds");
  console.log(`  ${PLAN} §4 is the authority for data-layer evidence.`);
  for (const [f, r] of ALLOWED) if (r.derived) console.log(`  ${f} — ${r.why}; no orphan facts.`);
  process.exit(0);
}

if (unlisted.length) {
  console.log("✗ data-layer evidence in files that may not carry it:\n");
  for (const u of unlisted) {
    console.log(`  ${u.file}`);
    console.log(`    ${u.facts.slice(0, 8).join(", ")}${u.facts.length > 8 ? " …" : ""}`);
  }
  console.log("\n  Fix: cite the plan by D-number instead, or allow-list the file with a reason.\n");
}
if (orphans.length) {
  console.log("✗ facts held ONLY by a derived file — the plan is incomplete:\n");
  for (const o of orphans) console.log(`  ${o.fact}  (only in ${o.file})`);
  console.log("\n  Fix: add the evidence to the plan's §4 defect table.\n");
}
process.exit(1);
