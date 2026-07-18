# Accuracy audit — Project TRON - ver2
Deterministic tier (tool-grounding + capability coverage). Generated 2026-07-18.

**Dataset:** 60 suppliers · 560 materials · 560 inbound arcs.

## 1. Incident reproduction — "what does supplier 10 supply?"

| Fact | Value |
|---|---|
| Supplier 10 name | TTI INC (EUR) (FR) |
| Materials supplier 10 ACTUALLY supplies (truth) | **187** |
| get_supplier_risk #Materials for 10 (tool) | 187 |
| Tool vs truth on the count | ✅ match |

**The 5 IDs the assistant attributed to supplier 10:**

| Claimed material | Exists in project? | ACTUALLY supplied by | Belongs to supplier 10? |
|---|---|---|---|
| 007507784A | yes | 41679 (MICROTEC (FR)) | **NO** |
| 007507785A | yes | 41679 (MICROTEC (FR)) | **NO** |
| 007507786A | yes | 41679 (MICROTEC (FR)) | **NO** |
| 007507787A | yes | 41679 (MICROTEC (FR)) | **NO** |
| 007507788A | yes | 41679 (MICROTEC (FR)) | **NO** |

- None of the claimed IDs belongs to supplier 10. All are supplied by another supplier.
- Are any of them in the first 25 rows list_project_entities would return? **no** — so they were not even a plausible unscoped tool slice; the attribution WAS ungrounded by construction (pre-H1: no supplier→material tool existed).

**Post-H1 closure (ai-agents.md §19.3 / §24.3 H1):** `get_supplier_materials("10")` now answers this from inbound_logistics:

| Check | Result |
|---|---|
| Tool enumeration vs truth (187 vs 187, ids set-equal) | ✅ match |
| Truncation note (top_n=50) | `supplier 10 supplies 187 materials; showing top 50.` |
| Any incident id in the tool's supplier-10 list | ✅ none |

## 2. Capability coverage map (the root cause, generalized)

Grounded OK: 12 · PARTIAL: 0 · **GAP: 0** (of 12 probed intents)

| User question | Intent | Tool that applies | Grounded | Note |
|---|---|---|---|---|
| What does supplier 10 supply? | I3 supplier→materials (enumerate) | `get_supplier_materials` | ✅ OK | Enumerates all 187 materials (= truth 187); truncation note carries the true total. THE incident closer. |
| How many materials does supplier 10 supply? | supplier→material count | `get_supplier_risk` | ✅ OK | Returns #Materials = 187. |
| Who supplies material 001409784A? | I4 material→suppliers (identify) | `get_material_suppliers` | ✅ OK | Names the actual supplier(s): 10 (truth: 10). |
| Is 001409784A single-sourced? | single-source flag | `get_material_risk` | ✅ OK | Returns Single-source Yes/No. |
| List our suppliers / materials | I1 enumerate entities | `list_project_entities` | ✅ OK | Unscoped list — correct for 'all', wrong if used to answer a scoped question. |
| Top suppliers by spend | I7 spend ranking | `get_procurement_spend` | ✅ OK | Spend ranking (ver2 has unit prices). |
| Which supplier is riskiest? | I7 risk ranking | `get_supplier_risk` | ✅ OK | Sole-source-first ranking. |
| What products use material X? | I5 material→product (BOM) | `get_bom_relations` | ✅ OK | Traverses bom_multi_level both directions (higher_level_component_id walk, useStageRows parent/leaf logic). |
| What's the lead time / price / MOQ for material X? | I2 entity detail | `get_entity_detail` | ✅ OK | Verbatim master values (cost/MOQ/holding/lead-time dist) — never imputed. |
| What policy / safety stock is set for supplier 10? | I8 policy read | `get_policy_config` | ✅ OK | Exposed §5 read (personaTools.ts); default-vs-override named; pinned by cov-06 + pc-* suite. |
| Is my model validated / run-ready? | I9 validation / data-completeness read | `get_validation_status + get_data_completeness` | ✅ OK | Exposed §5 reads; pinned by cov-07 + vv-*/ds-* suites. |
| What did my last simulation run show? | I10 run results read | `get_run_results` | ✅ OK | Exposed §5 read; persisted rows only; pinned by cov-08 + vv-* suite. |

## 3. Where a tool DOES apply, is it correct? (spot checks vs truth)

- **get_supplier_risk** top-3 by sole-source exposure: 10 (187 sole / 187 mats); 965 (115 sole / 115 mats); 542 (86 sole / 86 mats)
- **get_procurement_spend** ranks by *spend*; top-3 suppliers: 10 (49639); 24439 (31039); 965 (26969)
- **get_material_risk("001409784A")**: suppliers=1, single-source=Yes — truth suppliers=1. ✅ match

## 4. H1 relation/detail tools vs truth (ai-agents.md §19.3)

- **get_supplier_materials("10")**: 187 materials, set-equal to truth (187) → ✅ match; incident-id leakage: none ✅
- **get_material_suppliers("001409784A")**: [10] vs truth [10] → ✅ match
- **get_bom_relations** (sample 001407706A ↑ / XPF0001202 ↓): parents ✅ match; components ✅ match (156 edges vs ≥ 156 direct)
- **get_entity_detail("001409784A")**: cost=1.220453 moq=5712 holding=0.2 dist=deterministic — verbatim master row → ✅ match

**Finding (post-H1):** every probed I1–I10 intent is grounded (12/12 OK, 0 GAP, 0 PARTIAL) and the new tools match recomputed truth — the §19.2 target column is achieved on this dataset. The residual guarantee (a model ignoring the tools) is held by the §22.3 pre-send verifier, pinned by cov-01…cov-12.