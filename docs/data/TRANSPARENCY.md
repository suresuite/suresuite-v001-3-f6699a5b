# Data Transparency Standard

> **Status:** AUTHORED · a standard, not a schedule — the WPs that implement it live in `IMPLEMENTATION-PLAN.md`
> **Scope:** every number this product shows any human
> **Baseline:** commit `d3cfc9d`

---

## 0. The rule

> **Every number on screen must answer three questions in one click:
> where did it come from, when was it computed, and what would change it.**

That is a testable standard, not an aspiration. A cell that cannot answer all
three is a defect and gets logged like one.

Two corollaries that do most of the work:

**Transparency is a property of the system, not a document.** A hand-written data
dictionary is wrong within a quarter — that is the entire thesis of the
implementation plan. Every artifact below is **generated from the contract**, or it
does not count as transparency.

**Negative transparency outranks positive transparency.** What we do *not* know
matters more than what we do. Coverage gaps, imputed values, stale derived data,
conflicts between contract and reality, and the known limits of our own hashes —
these are surfaced first and loudest. Most systems hide them. Hiding them is how
trust is lost in one moment rather than earned over many.

---

## 1. What already exists — and it is good

Three foundations are already in the codebase. The work is to extend them, never
to replace them.

| Asset | What it guarantees |
|---|---|
| `src/lib/policies/verifiableExports.ts` | Three XLSX workbooks that make a model version **externally checkable — by a reviewer, an auditor, or an AI — without access to the app.** Policy snapshot stamped with `policy_hash`; dataset = the exact rows `graph_hash` was computed over; run results with the full provenance triple. |
| `supabase/functions/_shared/grading.ts` | **One** grader, consumed by both the browser and the pre-dispatch gate, pinned to `project_map.py` by validation-parity fixtures. The severity law mirrors the engine. |
| `src/components/policies/policyGridUi.tsx` | Per-cell provenance dots — the atom of transparency, already in the grid. |

### The cultural precedent to formalize

`verifiableExports.ts:164` says, of the dataset workbook:

> *"`bomMulti` … is included as an extra sheet: the engine reads it when present, but
> `graph_hash` v1 covers `bom_single_level` only (stated in `_meta`)."*

The export **discloses its own blind spot in its own metadata**. Elsewhere the same
file refuses to overclaim: a stored value equal to the schema default is reported as
`= schema default` because *"storage cannot distinguish the two, and the export says
so honestly."*

**That is the standard.** Everything below is an attempt to make it systematic rather
than a matter of one author's conscience.

---

## 2. The transparency ladder

Five rungs. Each answers a different question, for a different audience, at a
different reading cost. A stakeholder should be able to stop at whichever rung
satisfies them and go deeper without asking anyone.

| # | Artifact | Question it answers | Audience | Cost | State |
|---|---|---|---|---|---|
| 1 | **Provenance dot** | *Is this real data?* | anyone, in passing | 1 second | EXISTS — partly lying (D16, D17) |
| 2 | **Value chain popover** | *Where did THIS number come from?* | user, modeler | 1 click | MISSING |
| 3 | **Project Data Trust Report** | *Is this model built on good data?* | modeler, exec, customer | 1 page | PARTIAL — grading exists, unassembled |
| 4 | **Verifiable export** | *Can I check this without your app?* | auditor, reviewer, AI | 1 download | EXISTS — strong |
| 5 | **Reproducibility record** | *Can I reproduce this figure in two years?* | researcher, regulator | 1 URL | MISSING |

### Rung 1 — The provenance dot *(fix in WP 0.1, complete in WP 6.3)*

Vocabulary after the plan lands:

```
data       from your uploaded file
master     from the item master you edited
contract   asserted from an ERP master record or a contract
estimated  fitted from observations — carries n and window   (Phase 7+)
imputed    a project average standing in — VERIFY
derived    computed by the engine from your other uploads
override   a saved decision
edited     an unsaved edit
default    nothing else existed — the engine's neutral constant
```

Two rules the current implementation breaks and the plan fixes:

- **No dot may claim more than it knows.** A hardcoded `0` must never render as
  "from project data" (D16).
- **A missing value must not render as a real one.** NULL `capacity_per_week` means
  *unlimited*; rendering `0` with no dot is worse than showing nothing (D17).

### Rung 2 — The value chain popover *(WP 6.1 documents it, WP 6.3 ships it)*

Click any cell, get the chain that produced it:

```
Lead time · 14 days                                   SUP-07 → MAT-114

  SOURCE      inbound_logistics.lead_time = 2
              ← ingest run #412, inbound_2025-09.csv, row 88
              ← uploaded by j.smith, 12 Sep 2025, approved by m.chen
  UNIT        weeks (fixed — NOT governed by time_unit)
  DISPLAY     × 7 → 14 days
  ENGINE      project_map.py::_duration_to_weeks → round, clamp(1,51) → 2 weeks
  SUBSTITUTED nothing — this is your data
  FRESHNESS   dataset v7 · a91f3c… · current
  CHANGES IF  you re-upload inbound, or edit this cell
```

When a value *was* substituted, the popover says which rung of the chain supplied it
and what it would take to replace it with real data. **The substitution is the most
important thing on the panel, not a footnote.**

### Rung 3 — The Project Data Trust Report *(WP 4.4 + WP 5.2)*

One generated page per project, and its PDF/JSON export. Most of it already exists
inside `grading.ts` — this rung is mostly *assembly*, not new computation.

```
DATA TRUST REPORT · Project TRON ver2 · dataset v7 · a91f3c… · 15 Sep 2026

COVERAGE          how many engine-read values are real
  materials.cost              68 / 94 real · 21 derived · 5 default
  inbound.lead_time           94 / 94 real
  products.sell_price         12 / 40 real · 28 derived        ← weakest
  suppliers.capacity_per_week  0 / 31 set  (unlimited — a choice, not a gap)

BLOCKING          the engine cannot run                          2
  materials.supplier_link      3 BOM materials have no supplier

NEEDS ATTENTION   a neutral constant is standing in              4
  inbound.unit_price           7 arcs priced 0 → engine uses 1.00

DERIVED           computed from your data, not typed             3
  materials.cost               21 materials ← cheapest inbound price

FRESHNESS
  supply_chain_data            current   (a91f3c…)
  network metrics              STALE     computed at 8e21b7… — 3 edits ago
  node prominence              current

INGEST HISTORY    last 5 of 23 runs
  #412  csv   inbound_2025-09.csv   +88 new  ~12 changed  j.smith → m.chen
  #411  mrp   orbit-mrp sync        +0 new   ~340 changed  scheduled → m.chen

KNOWN LIMITS OF THIS REPORT
  · graph_hash v1 covers bom_single_level only — multi-level BOM edits do not
    move the hash (tracked: D11 / WP 4.1)
  · price volatility is not modelled; unit_price is a scalar (engine RFC §10.1)
```

The last block is not optional. **A trust report that does not state its own limits
is marketing.**

### Rung 4 — The verifiable export *(EXISTS — extend in WP 3.3)*

Already shipped and already honest. One structural gap the plan closes:

> Today the dataset workbook starts at **Tier 2**. It can prove *what the engine ran
> on*; it cannot prove *where those rows came from*, because ingestion has no
> provenance yet.

WP 3.3 adds `ingest_run_id` and `source_row_id` to the canonical tables. The export
then extends one rung down — to the uploaded file, the row number, the uploader and
the approver. **Transparency completion is a consequence of the ingestion work, not
a separate project.**

### Rung 5 — The reproducibility record *(Phase 6 · WP 6.3)*

A citable, immutable record for a published figure:

```
SuReSuite Reproducibility Record
  project        TRON ver2
  dataset        v7    graph_hash   a91f3c4e…
  policies       v12   policy_hash  7d2b91a0…
  scenario       supplier-outage-q3   sha  4c8e…
  engine         scsim 1.9.3
  analyses       network_science  code v2.1  input a91f3c4e…
                 combine_etl      code v1.4  input a91f3c4e…
  as_of          2026-09-15T08:12:00Z                      (Phase 7+)
  mapping warnings   4 (2 warn, 2 info) — listed in full
  declared limits    graph_hash v1 scope; steady-state engine
  verify         re-hash the attached dataset workbook → must equal graph_hash
```

Attach it to any exported chart, report or paper appendix. It is the difference
between "our model says" and "this is reproducible."

---

## 3. Transparency is not exposure

A real deployment has multiple organizations and commercially sensitive numbers.
Actual prices, named customers and contracted terms are not public goods.

**The method is always public. The values are governed.**

| Always visible to anyone with access to the page | Governed per field by capability |
|---|---|
| that a field exists | its value |
| its meaning, unit and grain | |
| which source classes may assert it | |
| every substitution rule that could apply | |
| whether *this* value was substituted, and by which rule | |
| when it was computed and from which hash | |
| the known limits of the computation | |

A user who cannot see a supplier's price can still see **that** a price exists, that
it came from an ERP master record on 12 September, and that no substitution was
applied. That is enough to trust the model without breaching the contract.

This is only enforceable because the contract carries `governance.read` per field
(WP 1.2) and the resolver knows project role (WP 2.2). Transparency and
confidentiality are the same mechanism pointed in two directions.

**Export is itself a governed action.** The `export` capability already exists in the
catalog (`unified_access_control.sql:53`). A dataset workbook contains every price
on the network — exporting it must check that capability and write an audit row
(WP 2.3), or rung 4 becomes an exfiltration path.

---

## 4. How each audience is served

| Audience | Enters at | Gets |
|---|---|---|
| **End user** | rung 1–2, in the grid | why this number, and what to fix |
| **Modeler** | rung 3, per project | coverage, blockers, staleness, ingest history |
| **Executive / customer** | rung 3, PDF | one page: is this built on good data, and where is it weak |
| **Researcher** | rungs 4–5 | the workbooks plus a citable record |
| **Auditor / IT** | rung 5 + audit log | who changed what, when, from which file, under which grant |
| **Another system** | public API | the same contract, machine-readable |
| **The team** | `docs/data/` in git | generated tables, lineage, this standard |

### Channels

- **In-app** — primary. Transparency belongs where the number is, not in a PDF
  somebody has to request.
- **Export** — XLSX (exists), PDF trust report, JSON for machines. All via
  `report-render`, which already issues 60-minute signed URLs from a non-public
  bucket.
- **Public API** — the same contract served machine-readable, so an auditor or an
  integration reads the same truth the UI does.
- **`/docs` in-app** — the generated data dictionary (WP 5.2), role-filtered by the
  capability catalog.
- **Git** — `docs/data/`, generated and CI-gated.

---

## 5. The five commitments

These belong in `CLAUDE.md` alongside the invariants, and in the public-facing
statement. Each is a claim we can be held to.

**T1 · No number without a source.** Every displayed value resolves to data, a
named substitution rule, or an explicit default. There is no fourth option, and the
UI never renders a value whose origin it cannot name.

**T2 · Substitution is always visible.** When the system supplies a value the user
did not, it says so at the point of display — not in a log, not in a tooltip nobody
opens. A fallback absent from the contract may not exist in code (invariant I6).

**T3 · We publish our own blind spots.** Every report and export states the known
limits of its own computation. The `graph_hash` v1 disclosure is the precedent.

**T4 · Reproducible or not published.** Any figure leaving the system carries the
dataset, policy, scenario and engine versions that produced it, and the attached
data re-hashes to the stated hash.

**T5 · Transparency survives handover.** The artifacts are generated and CI-gated,
so they stay true when the people who built them have moved on. A transparency
feature that depends on someone remembering to update it is not one.

---

## 6. Where this lands in the plan

No new phase. Transparency is nearly free once the contract exists — the cost is
in *deciding* it is non-negotiable, which is now done.

| WP | Transparency addition | Cost |
|---|---|---|
| 0.1 | Stop the provenance dot lying about hardcoded constants (T1) | in scope already |
| 1.2 | `governance.read` per field — the basis of §3 | in scope already |
| 3.3 | `ingest_run_id` + `source_row_id` on canonical tables — extends rung 4 down to the source file | in scope already |
| 2.3 | Audit export as a governed action | +0.5 day |
| 4.4 | Freshness surfaced per page; assemble the Trust Report from `grading.ts` | +1 day |
| 5.2 | `/docs` data dictionary, role-filtered | in scope already |
| 6.1 | The chain each popover renders — documenting it *is* building it | in scope already |
| 6.3 | Value chain popover · Trust Report PDF · Reproducibility record | +2 days |

**≈ 3.5 days of additional work.** The rest is a consequence of the plan as written.

### Acceptance test for the whole standard

> Hand a stakeholder a number from the Supplier grid and a laptop. Without help,
> and without app access beyond the export, they can trace it to a row in a named
> file uploaded by a named person on a named date — or find the named rule that
> produced it in the absence of data.

If that test passes, the standard holds. If it does not, transparency is a claim
rather than a property, and the gap goes in the drift log like any other defect.
