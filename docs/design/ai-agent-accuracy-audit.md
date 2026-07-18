# AI Project-Intelligence — accuracy audit

Companion to `docs/design/ai-agents.md` §19 (conversation coverage & grounding).
Validates how often the advisory assistant (Layer A, ai-agents.md §2) is
grounded-correct vs. over-claiming, on **real modeler projects**. No LLM and no
live DB are needed for the deterministic tier; the live spot-audit (ver1 / AA
ver3) needs read-only access to the modeler's own database.

Status: **TRON ver2 complete** (deterministic tier). TRON ver1 and AA ver3
pending read-only live access.

**Post-H1 update (ai-agents.md §24.3 H1, this repo):** the §19.3 coverage
tools landed and the audit was re-run on the same dataset —
`scripts/audit/report_Project_TRON_ver2.md` now shows **OK: 12 · PARTIAL: 0 ·
GAP: 0** with every new relation/detail tool matching recomputed truth
(`get_supplier_materials("10")` enumerates exactly the 187 true materials;
none of the five incident ids appears). The audit script exits non-zero if
any I1–I10 family regresses to GAP/PARTIAL or a tool-vs-truth diff appears,
so the closure is CI-checkable. The findings below are preserved as the
pre-H1 record of the incident.

## Method — a three-way oracle

For a fixed question battery (intents I1–I13, ai-agents.md §19.2), compare:

1. **Truth** — recomputed directly from project tables (`inbound_logistics`,
   `bom_multi_level`, masters). The deterministic answer.
2. **Tool output** — what the shipped `tools.ts` handler returns for the project.
3. **LLM claim** — what the assistant *says* (the prose outside the typed `parts`).

Truth≠Tool ⇒ a **tool bug**. Tool≠Claim ⇒ a **faithfulness / over-claim bug**
(the reported incident is this one). Plus a **capability-coverage map**: which
intent families have a grounded tool at all — a family with no tool is a
fabrication risk by construction.

Two tiers, extending ai-agents.md §7.4:

- **Tier 1 — deterministic** (this document, TRON ver2): tool output vs truth +
  coverage map. Runs offline from `scripts/tron_ver2/dataset.json`, the same rows
  the seed loads into `inbound_logistics`.
- **Tier 2 — model-scored** (nightly / pre-flag): real questions, real model, the
  **entity-fabrication check** (every id/name in a reply must appear in that
  turn's tool results; target 0). This is the tier that catches the incident.

Reproduce the deterministic tier:

```
node scripts/audit/audit_tools.mjs scripts/tron_ver2/dataset.json --project "Project TRON - ver2"
```

---

## Project TRON - ver2 — results

**Dataset:** 60 suppliers · 560 materials · 560 inbound arcs. The project is
**1:1 single-sourced** (560 materials / 560 arcs) — every material has exactly
one supplier, so every "who supplies material X?" has exactly one correct answer.

### 1. Incident reproduction — "what does supplier 10 supply?"

| Fact | Value |
|---|---|
| Supplier 10 name | TTI INC (EUR) (FR) |
| Materials supplier 10 **actually** supplies (truth) | **187** |
| `get_supplier_risk` #Materials for 10 (tool) | 187 — ✅ tool matches truth |
| Supplier 10's rank | **#1 by sole-source exposure (187/187) and #1 by spend** |

The five IDs the assistant attributed to supplier 10:

| Claimed material | Exists in project? | **Actually** supplied by | Belongs to supplier 10? |
|---|---|---|---|
| 007507784A | yes | 41679 (MICROTEC (FR)) | **NO** |
| 007507785A | yes | 41679 (MICROTEC (FR)) | **NO** |
| 007507786A | yes | 41679 (MICROTEC (FR)) | **NO** |
| 007507787A | yes | 41679 (MICROTEC (FR)) | **NO** |
| 007507788A | yes | 41679 (MICROTEC (FR)) | **NO** |

All five are supplied by **supplier 41679**, not 10, and none appears in the
first page `list_project_entities` would return. The attribution is **ungrounded
by construction**: no advisory tool maps a supplier to its materials. The
policies page (which reads the same `inbound_logistics` via `useStageRows` /
`get_supply_chain_data`) is correct; the assistant over-claimed. Not a data-sync
drift; not a tool bug.

### 2. Capability coverage map

Grounded **OK: 5 · PARTIAL: 2 · GAP: 5** of 12 probed intents.

| User question | Intent family | Tool that applies | Grounded |
|---|---|---|---|
| What does supplier 10 supply? | I3 supplier→materials | — none — | ❌ GAP *(the incident)* |
| How many materials does supplier 10 supply? | supplier→material count | `get_supplier_risk` | ✅ (187) |
| Who supplies material 001409784A? | I4 material→suppliers | `get_material_risk` | ⚠️ count only, not identity |
| Is 001409784A single-sourced? | single-source flag | `get_material_risk` | ✅ |
| List our suppliers / materials | I1 enumerate | `list_project_entities` | ✅ |
| Top suppliers by spend | I7 spend rank | `get_procurement_spend` | ✅ |
| Which supplier is riskiest? | I7 risk rank | `get_supplier_risk` | ✅ |
| What products use material X? | I5 BOM | — none — | ❌ GAP |
| Lead time / price / MOQ for material X? | I2 entity detail | `get_material_risk` (partial) | ⚠️ avg-lead only |
| What policy is set for supplier 10? | I8 policy read | — none — | ❌ GAP |
| Is my model validated / run-ready? | I9 readiness | — none — | ❌ GAP |
| What did my last run show? | I10 run results | — none — | ❌ GAP |

### 3. Correctness where a tool applies (spot checks vs truth)

- `get_supplier_risk` top-3 by sole-source: **10** (187/187), **965** (115/115), **542** (86/86) — matches truth.
- `get_procurement_spend` ranks by spend (ver2 has unit prices); top-3: **10** (49,639), **24439** (31,039), **965** (26,969).
- `get_material_risk("001409784A")`: suppliers=1, single-source=Yes — matches truth (1). ✅

**Conclusion.** The tools compute correctly where they apply. Every failure is a
**capability gap** (no grounded tool for the asked relation) that the model fills
by over-claiming. Fix = the read-tool gaps (ai-agents.md §19.3) + the faithfulness
grammar (§19.4) + the entity-fabrication gate (§19.7). Prompt wording alone
cannot fix a missing capability.

---

## Project TRON - ver1 — pending

_Requires read-only access to the modeler's live database (this project is not
seeded in the repo). Same battery, same three-way oracle._

## Project AA - ver3 — pending

_Requires read-only access to the modeler's live database. Same battery._

### What the live spot-audit needs

Least-privilege, read-only. Either a Supabase **Management API token + project
ref** (SELECT-only, the pattern the seed script already uses via
`DIAG_MANAGEMENT_TOKEN`) or a read-only Postgres connection. The audit only ever
runs SELECTs against `projects`, `inbound_logistics`, `bom_multi_level`,
`suppliers`/`materials`, `policy_defaults`/`policy_overrides`, `model_validations`,
and `simulation_runs`. It never writes.
