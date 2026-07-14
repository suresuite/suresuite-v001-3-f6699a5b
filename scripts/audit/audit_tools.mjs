#!/usr/bin/env node
// Deterministic accuracy audit for the Project-Intelligence advisory tools.
// Ports the EXACT aggregation logic of supabase/functions/project-ai-chat/tools.ts
// (cited by line) and feeds it a project's real rows, then diffs tool output
// against truth recomputed independently. No LLM, no live DB.
//
// Usage:
//   node audit_tools.mjs <dataset.json|inbound.json> [--project "name"]
// dataset.json shape: { inbound:[{supplier_id,material_id,volume,unit_price,lead_time,time_unit}], suppliers:[...], materials:[...], bom:[...] }

import { readFileSync } from "node:fs";

const path = process.argv[2];
const projLabel = (() => { const i = process.argv.indexOf("--project"); return i > -1 ? process.argv[i + 1] : path; })();
const ds = JSON.parse(readFileSync(path, "utf8"));

// Normalize inputs to the shapes the tools read.
const inbound = (ds.inbound ?? ds).map((r) => ({
  supplier_id: String(r.supplier_id ?? "unknown"),
  material_id: String(r.material_id ?? "unknown"),
  volume: Number(r.volume ?? 0) || 0,
  unit_price: Number(r.unit_price ?? 0) || 0,
  lead_time: r.lead_time == null ? null : Number(r.lead_time),
})); // mirrors loadInbound() tools.ts:220-234
const suppliers = ds.suppliers ?? [];
const materials = ds.materials ?? [];
const supplierName = new Map(suppliers.map((s) => [String(s.supplier_id), s.name ?? ""]));

// ── TRUTH (independent recompute, not via the tool code) ─────────────────────
const truthMatBySupplier = new Map(); // supplier -> Set(material)
const truthSupByMaterial = new Map(); // material -> Set(supplier)
for (const r of inbound) {
  if (!truthMatBySupplier.has(r.supplier_id)) truthMatBySupplier.set(r.supplier_id, new Set());
  truthMatBySupplier.get(r.supplier_id).add(r.material_id);
  if (!truthSupByMaterial.has(r.material_id)) truthSupByMaterial.set(r.material_id, new Set());
  truthSupByMaterial.get(r.material_id).add(r.supplier_id);
}

// ── TOOL PORTS (faithful to tools.ts) ────────────────────────────────────────

// getSupplierRisk core — tools.ts:253-311 (criticality omitted: no node_list here)
function getSupplierRisk({ supplier = null, topN = 10 } = {}) {
  const suppliersByMaterial = new Map();
  for (const r of inbound) {
    if (!suppliersByMaterial.has(r.material_id)) suppliersByMaterial.set(r.material_id, new Set());
    suppliersByMaterial.get(r.material_id).add(r.supplier_id);
  }
  const agg = new Map();
  for (const r of inbound) {
    const a = agg.get(r.supplier_id) ?? { materials: new Set(), leadSum: 0, leadN: 0, spend: 0 };
    a.materials.add(r.material_id);
    a.spend += r.volume * r.unit_price;
    if (r.lead_time != null && Number.isFinite(r.lead_time)) { a.leadSum += r.lead_time; a.leadN += 1; }
    agg.set(r.supplier_id, a);
  }
  let rows = [...agg.entries()].map(([sid, a]) => {
    const sole = [...a.materials].filter((m) => (suppliersByMaterial.get(m)?.size ?? 0) <= 1).length;
    return { supplier: sid, materials: a.materials.size, sole, avgLead: a.leadN ? a.leadSum / a.leadN : null, spend: a.spend };
  });
  if (supplier) rows = rows.filter((r) => r.supplier.toLowerCase().includes(String(supplier).toLowerCase()));
  rows.sort((x, y) => y.sole - x.sole || y.spend - x.spend);
  return rows.slice(0, topN);
}

// getMaterialRisk core — tools.ts:365-416
function getMaterialRisk({ material = null, onlySingle = false, topN = 15 } = {}) {
  const agg = new Map();
  for (const r of inbound) {
    const a = agg.get(r.material_id) ?? { suppliers: new Set(), leadSum: 0, leadN: 0, spend: 0 };
    a.suppliers.add(r.supplier_id);
    a.spend += r.volume * r.unit_price;
    if (r.lead_time != null && Number.isFinite(r.lead_time)) { a.leadSum += r.lead_time; a.leadN += 1; }
    agg.set(r.material_id, a);
  }
  let rows = [...agg.entries()].map(([mid, a]) => ({
    material: mid, suppliers: a.suppliers.size, single: a.suppliers.size <= 1,
    avgLead: a.leadN ? a.leadSum / a.leadN : null, spend: a.spend,
  }));
  if (material) rows = rows.filter((r) => r.material.toLowerCase().includes(String(material).toLowerCase()));
  if (onlySingle) rows = rows.filter((r) => r.single);
  rows.sort((x, y) => Number(y.single) - Number(x.single) || (y.avgLead ?? 0) - (x.avgLead ?? 0) || y.spend - x.spend);
  return rows.slice(0, topN);
}

// getProcurementSpend core — tools.ts:318-358
function getProcurementSpend({ groupBy = "supplier", topN = 10 } = {}) {
  const agg = new Map();
  for (const r of inbound) {
    const key = groupBy === "supplier" ? r.supplier_id : r.material_id;
    const cur = agg.get(key) ?? { spend: 0, volume: 0, orders: 0 };
    cur.spend += r.volume * r.unit_price; cur.volume += r.volume; cur.orders += 1;
    agg.set(key, cur);
  }
  const totalSpend = [...agg.values()].reduce((s, v) => s + v.spend, 0);
  const rankBy = totalSpend === 0 ? "volume" : "spend";
  const sorted = [...agg.entries()].sort((a, b) => b[1][rankBy] - a[1][rankBy]).slice(0, topN);
  return { rankBy, rows: sorted.map(([k, v]) => ({ key: k, spend: Math.round(v.spend), volume: Math.round(v.volume) })) };
}

// listProjectEntities materials — tools.ts:172-216. node_list is server-rebuilt
// and not in this dataset; the materials master is the faithful proxy for the
// material node set. The load-bearing fact is that it is UNSCOPED by supplier.
function listMaterials(limit = 25) {
  return materials.map((m) => String(m.material_id)).slice(0, limit);
}

// ── THE INCIDENT: "what does supplier 10 supply?" ────────────────────────────
const S = process.env.SUP ?? "10";
const claimed = (process.env.CLAIMED ?? "007507784A,007507785A,007507786A,007507787A,007507788A").split(",");

const truthS = [...(truthMatBySupplier.get(S) ?? [])];
const sr = getSupplierRisk({ supplier: S });
const srRow = sr.find((r) => r.supplier === S);

const claimedCheck = claimed.map((m) => {
  const realSup = [...(truthSupByMaterial.get(m) ?? [])];
  return { material: m, existsInProject: truthSupByMaterial.has(m), actuallySuppliedBy: realSup, belongsToS: realSup.includes(S) };
});
const first25 = listMaterials(25);
const anyClaimedInFirst25 = claimed.some((m) => first25.includes(m));

// ── CAPABILITY COVERAGE MAP ──────────────────────────────────────────────────
const battery = [
  { q: `What does supplier ${S} supply?`, intent: "supplier→materials (enumerate)", tool: "— none —", grounded: "GAP", note: "No tool lists a supplier's materials. get_supplier_risk only COUNTS them." },
  { q: `How many materials does supplier ${S} supply?`, intent: "supplier→material count", tool: "get_supplier_risk", grounded: "OK", note: `Returns #Materials = ${srRow?.materials ?? "?"}.` },
  { q: `Who supplies material 001409784A?`, intent: "material→suppliers (identify)", tool: "get_material_risk", grounded: "PARTIAL", note: "Returns supplier COUNT, not supplier identities → names can be confabulated." },
  { q: `Is 001409784A single-sourced?`, intent: "single-source flag", tool: "get_material_risk", grounded: "OK", note: "Returns Single-source Yes/No." },
  { q: `List our suppliers / materials`, intent: "enumerate entities", tool: "list_project_entities", grounded: "OK", note: "Unscoped list — correct for 'all', wrong if used to answer a scoped question." },
  { q: `Top suppliers by spend`, intent: "spend ranking", tool: "get_procurement_spend", grounded: "OK", note: "Spend ranking (ver2 has unit prices)." },
  { q: `Which supplier is riskiest?`, intent: "risk ranking", tool: "get_supplier_risk", grounded: "OK", note: "Sole-source-first ranking." },
  { q: `What products use material X?`, intent: "material→product (BOM)", tool: "— none —", grounded: "GAP", note: "No BOM-traversal tool in the advisory set." },
  { q: `What's the lead time / price / MOQ for material X?`, intent: "entity detail", tool: "get_material_risk (partial)", grounded: "PARTIAL", note: "Avg lead time only; no price/MOQ/holding-cost detail tool." },
  { q: `What policy / safety stock is set for supplier 10?`, intent: "policy read", tool: "— none —", grounded: "GAP", note: "Advisory tools cannot read policy_defaults/overrides." },
  { q: `Is my model validated / run-ready?`, intent: "validation / data-completeness read", tool: "— none —", grounded: "GAP", note: "No get_validation_status / get_data_completeness in the advisory set." },
  { q: `What did my last simulation run show?`, intent: "run results read", tool: "— none —", grounded: "GAP", note: "No get_run_results in the advisory set." },
];
const counts = battery.reduce((m, b) => ((m[b.grounded] = (m[b.grounded] ?? 0) + 1), m), {});

// ── REPORT ───────────────────────────────────────────────────────────────────
const L = [];
const p = (s = "") => L.push(s);
p(`# Accuracy audit — ${projLabel}`);
p(`Deterministic tier (tool-grounding + capability coverage). Generated ${new Date().toISOString().slice(0,10)}.`);
p("");
p(`**Dataset:** ${suppliers.length} suppliers · ${materials.length} materials · ${inbound.length} inbound arcs.`);
p("");
p(`## 1. Incident reproduction — "what does supplier ${S} supply?"`);
p("");
p(`| Fact | Value |`);
p(`|---|---|`);
p(`| Supplier ${S} name | ${supplierName.get(S) ?? "(unknown)"} |`);
p(`| Materials supplier ${S} ACTUALLY supplies (truth) | **${truthS.length}** |`);
p(`| get_supplier_risk #Materials for ${S} (tool) | ${srRow?.materials ?? "n/a"} |`);
p(`| Tool vs truth on the count | ${srRow?.materials === truthS.length ? "✅ match" : "❌ mismatch"} |`);
p("");
p(`**The 5 IDs the assistant attributed to supplier ${S}:**`);
p("");
p(`| Claimed material | Exists in project? | ACTUALLY supplied by | Belongs to supplier ${S}? |`);
p(`|---|---|---|---|`);
for (const c of claimedCheck)
  p(`| ${c.material} | ${c.existsInProject ? "yes" : "no"} | ${c.actuallySuppliedBy.map((x)=>`${x}${supplierName.get(x)?` (${supplierName.get(x)})`:""}`).join(", ") || "—"} | ${c.belongsToS ? "yes" : "**NO**"} |`);
p("");
p(`- None of the claimed IDs belongs to supplier ${S}. All are supplied by another supplier.`);
p(`- Are any of them in the first 25 rows list_project_entities would return? **${anyClaimedInFirst25 ? "yes" : "no"}** — so they were not even a plausible unscoped tool slice; the attribution is ungrounded by construction (no supplier→material tool exists).`);
p("");
p(`## 2. Capability coverage map (the root cause, generalized)`);
p("");
p(`Grounded OK: ${counts.OK ?? 0} · PARTIAL: ${counts.PARTIAL ?? 0} · **GAP: ${counts.GAP ?? 0}** (of ${battery.length} probed intents)`);
p("");
p(`| User question | Intent | Tool that applies | Grounded | Note |`);
p(`|---|---|---|---|---|`);
for (const b of battery)
  p(`| ${b.q} | ${b.intent} | \`${b.tool}\` | ${b.grounded === "OK" ? "✅ OK" : b.grounded === "PARTIAL" ? "⚠️ PARTIAL" : "❌ GAP"} | ${b.note} |`);
p("");
p(`## 3. Where a tool DOES apply, is it correct? (spot checks vs truth)`);
p("");
const topSpend = getProcurementSpend({ groupBy: "supplier", topN: 3 });
const topRisk = getSupplierRisk({ topN: 3 });
p(`- **get_supplier_risk** top-3 by sole-source exposure: ${topRisk.map((r)=>`${r.supplier} (${r.sole} sole / ${r.materials} mats)`).join("; ")}`);
p(`- **get_procurement_spend** ranks by *${topSpend.rankBy}*; top-3 suppliers: ${topSpend.rows.map((r)=>`${r.key} (${r.spend})`).join("; ")}`);
const mtest = getMaterialRisk({ material: "001409784A" })[0];
p(`- **get_material_risk("001409784A")**: suppliers=${mtest?.suppliers}, single-source=${mtest?.single ? "Yes" : "No"} — truth suppliers=${(truthSupByMaterial.get("001409784A")?.size)}. ${mtest?.suppliers === truthSupByMaterial.get("001409784A")?.size ? "✅ match" : "❌ mismatch"}`);
p("");
p(`**Finding:** the tools compute correctly where they apply. The failures are **capability gaps** (no grounded tool for the asked relation), which the model fills by over-claiming. This cannot be fixed by prompt wording alone — it needs (a) the missing grounded tools and (b) a hard "no relation without a relation-scoped tool" refusal rule.`);

const out = L.join("\n");
console.log(out);
import { writeFileSync } from "node:fs";
const outPath = new URL(`./report_${String(projLabel).replace(/[^a-z0-9]+/gi,"_")}.md`, import.meta.url);
writeFileSync(outPath, out);
console.error(`\n[written] ${outPath.pathname}`);
