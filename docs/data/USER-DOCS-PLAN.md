# User Documentation for Data — Plan

> **Status:** AUTHORED
> **Replaces:** the legacy help site, archived at `docs/archive/legacy-help-site/`
> **Depends on:** `IMPLEMENTATION-PLAN.md` (the contract), `TRANSPARENCY.md` (the standard)

---

## 1. Why the old site failed

`docBodies.tsx` was 2 781 lines of hand-written JSX with 75 card/badge components.
It failed for five reasons, and each one dictates a rule for the replacement.

### 1.1 It documented names the user never sees

The single most damaging defect. One quantity, three names:

| The user types this in a CSV | It is stored as | The engine calls it | **The old docs showed** |
|---|---|---|---|
| `sell_price` | `products.sell_price` | `Product.unit_price` | `unit_price` |
| `demand_mean` | `products.demand_mean` | `Product.demand_mode` | `demand_mode` |
| `demand_distribution` | `products.demand_distribution` | `Product.demand_model` | `demand_model` |

*(`public/template/products.csv` · `20260614000001_item_master.sql:28-32` ·
`scsim/scsim/entities/network.py:145,151,154`)*

The documentation described the **third** column. A planner holding
`products.csv` could not find a single one of their own headers in it. The
mapping between the three has never been written down anywhere — and that
mapping is precisely what the data contract is.

> **Rule 1 — Document the name the reader typed.** Every field page leads with
> the CSV header and shows the other names as translation, not as the subject.

### 1.2 It was hand-copied from code, so it drifted

`SIM_PARAM_GROUPS` is a transcription of the Pydantic models, maintained by
hand. The engine already renders its own reference from the registry
(`scsim/scripts/gen_docs.py` → `scsim/docs/reference/policies.md`, with a
`--check` CI gate). The hand-written copy was redundant *and* unguarded.

> **Rule 2 — Generated or not published.** If a fact exists in code, the docs
> render it. Anything hand-written must be a fact that exists nowhere else.

### 1.3 It was written for the manuscript, not the reader

Live examples: *"b_p — historical median"*, *"ν — partial-observability
correction: a_p = max{0,(1−ν)·b_p}"*, *"§3.1–3.3"*, *"Root of the SeedSequence
tree (Part VIII)"*, *"MSER-5"*.

Correct for a paper. Useless to someone deciding what to put in a spreadsheet
cell.

> **Rule 3 — Plain language first, notation last.** Symbols and manuscript
> references belong in a collapsed "for researchers" block, never in the
> sentence that explains what a field means.

### 1.4 It was organized by engine entity

Sections were `simulation_settings`, `product`, `customer`, `supplier`. Users do
not touch engine entities. They touch **a file** and **a grid cell**. Neither had
a page.

> **Rule 4 — Organize by what the user touches**, which is the journey their
> data takes — and that journey is exactly the tier sequence of the data spine.

### 1.5 It was grouped by audience

`Overview · For Users · For Modelers · For IT · Reference` forced readers to
self-classify before reading, and every page ended up hedged for a committee.

> **Rule 5 — One page per question, filtered by role.** The capability catalog
> already knows who the reader is (`unified_access_control.sql:38-55`). Filter;
> don't ask.

---

## 2. The organizing principle

> **The documentation structure is the data structure, because the data
> structure is what actually happens to the user's data.**

The spine's tiers are not an implementation detail — they are the user's
journey, in order:

| Tier | What the user experiences | Doc page |
|---|---|---|
| 0 → 1 | "I uploaded a file and you checked it" | Files you upload · What we check |
| 2 | "this is my data" | Field reference · When a value is missing |
| 3 | "you worked something out from it" | What we calculate for you |
| 4 | "these are my decisions" | Where a number came from |
| 5 | "these are my results" | *(covered by existing sim docs)* |
| G | "who can see this" | Who can see your data |

Because both the docs and the data come from one contract, the docs are
**complete by construction**: a field with no documentation fails CI (WP 1.4),
and a documented field that no longer exists fails too.

---

## 3. The seven pages

Route group `Your data`, placed second in the nav — directly after Overview,
before everything written for modelers.

---

### P1 · What happens to your data
**Written once · ~1 page · no dependencies**

The journey, in plain language, with one diagram: you upload → we check it and
show you what we found → you approve → it becomes your project data → the
simulation reads it → results are stamped so they can be reproduced.

States the four promises from `TRANSPARENCY.md` in user language: we never
silently change your numbers; when we fill something in, the cell says so; your
data stays inside your organization; you can export or delete it at any time.

This is the page a new user reads once and a buyer reads before signing.

---

### P2 · The files you upload
**Generated · one card per dataset · needs WP 1.2**

One card per dataset — BOM single, BOM multi, inbound, outbound, the three item
masters, node list, deep-tier nodes/edges. Each card carries:

- what this file is for, in one sentence
- the exact header row, copyable
- three example rows
- a download link to the real template in `public/template/`
- which columns are required and which may be left blank
- **a link to each column's entry in P3**

Generated from the contract's `ingest` block, so the headers shown are the
headers the parser actually accepts. Today's `csv-upload-guide.md` is 34 lines
for thirteen dataset types; this replaces it.

---

### P3 · Field reference
**Generated · one entry per field · needs WP 1.2 + WP 1.3**

The page that has never existed. One entry per field, addressable at a stable
URL (`/docs/data/fields/lead_time`), leading with the name the user typed:

```
lead_time                                          inbound_logistics

  What it is   How long this supplier takes to deliver this material,
               from order to arrival.
  Unit         WEEKS.  Not days. The time_unit column next to it
               describes the VOLUME period only — it does not apply here.
  Required     Yes.
  If blank     The simulation assumes 2 weeks and flags the row.
  Example      2
  Limits       Rounded to whole weeks, minimum 1, maximum 51.

  Also called  inbound_logistics.lead_time  (stored)
               SupplierLink.lead_time_weeks (simulation)          [expand]
  Used on      Policies → Supplier stage, "Lead time" column       [open]
```

Three things no existing page provides: the **unit stated in capitals where it
is routinely misread**, the **"if blank" line**, and the **three-name
translation** from §1.1.

Generated from `meaning`, `unit`, `ingest`, `substitutions`, `engine` and
`surfaces` in the contract.

---

### P4 · When a value is missing
**Generated · ~1 page · needs WP 1.3**

Every substitution the system can make, in one table, in plain language:

| You leave blank | The simulation uses | Why | Shown in the grid as |
|---|---|---|---|
| `unit_price` | 1.00 € | so the model can run | orange dot — verify |
| `lead_time` | 2 weeks | a neutral default | orange dot — verify |
| `materials.cost` | your cheapest price for that material | derived from your own data | blue dot — derived |
| `capacity_per_week` | unlimited | blank means "no limit", not zero | no dot |

This is the page that turns "the system did something I didn't ask for" into
"the system did the thing it told me it would do". Generated directly from the
`substitutions` blocks, so a fallback that exists in code but not in the
contract cannot be shipped (invariant I6).

---

### P5 · Where a number came from
**Written once · ~1 page · no dependencies**

What the coloured dots mean, in the reader's language rather than ours, and how
to trace any value back to its source. Nine states after WP 6.3; the page shows
each dot beside a one-line explanation and a real screenshot.

Deep-linked from the provenance legend in the grid.

---

### P6 · What we calculate for you
**Generated · ~1 page · needs WP 4.4**

The derived layer, explained without jargon: sourcing shares, network metrics,
supplier rankings. For each — what it is, which of your uploads it is computed
from, and how you can tell whether it is current.

Includes the freshness rule in one sentence: *we recompute when your data
changes, and every page tells you which version of your data it is showing.*

---

### P7 · Who can see your data
**Written once · ~1 page · needs WP 2.2 for accuracy**

Organization, project, roles, export, deletion. Written after Phase 2, because
before then the honest version of this page is uncomfortable — there is no
project-level access control yet, and the page must not claim otherwise.

---

## 4. Rules that apply to all seven

**Deep-linkable.** Every field has a stable URL. The Policies grid column
header, the upload wizard, and validation findings all link into P3 at the exact
field. Documentation the user has to go and find is documentation they will not
read.

**Role-filtered, not audience-grouped.** One set of pages. A modeler additionally
sees the expandable engine-name and distribution blocks; a viewer does not. Driven
by the capability catalog, so the filter cannot drift from the app's own roles.

**Mobile reads the same payload.** One content source rendered by `DocsLayout`,
which already handles both. No second content tree — that duplication is the
defect this whole programme exists to end.

**Every generated page carries its provenance.** A footer line: generated from
contract version X, engine version Y, on date Z. The docs hold themselves to the
standard they describe.

---

## 5. Build order

| WP | Deliverable | Depends on |
|---|---|---|
| **0.3** | Archive the legacy site *(done)*; record what is salvageable | — |
| **5.2a** | P1, P5 — hand-written; un-hide the `/docs` route | nothing |
| **5.2b** | P2, P3, P4 — generated | WP 1.2, 1.3 |
| **5.2c** | P6 | WP 4.4 |
| **5.2d** | P7 | WP 2.2 |
| **6.3** | Deep links from grid → P3; provenance legend → P5 | WP 6.3 |

P1 and P5 are shippable **before Phase 1** — they need no contract, and they are
the two pages a new user most needs. Everything else follows the data.

---

## 6. What was archived, and what survives

Moved to `docs/archive/legacy-help-site/` (git history preserved):

| File | Fate |
|---|---|
| `docBodies.tsx` (2 781 ln) | **Deprecated.** Mine for content, do not revive. |
| `HelpPage.tsx` | **Deprecated.** The new renderer replaces it. |

Kept in `src/`:

| File | Why |
|---|---|
| `src/components/docs/DocsLayout.tsx` | Good chrome — nav, breadcrumbs, pager, search, responsive. Reused as-is. |
| `src/components/docs/registry.ts` | Good *shape* (`slug`, `title`, `summary`, `keywords`, `related`, grouped). Entries get rewritten; the type stays. Becomes generated for the data pages. |

Worth mining from `docBodies.tsx` before it is forgotten — all of it narrative
that exists nowhere else:

- the ACCURATE / Horizon Europe project framing
- the planner workflow and use-cases-by-page walkthroughs
- the glossary
- the stress-test catalogue (ST-1 … ST-7) descriptions

Everything else in it — the policy catalogue, simulation parameters, KPI
definitions, distributions — **already exists in `registry.generated.json`** and
is rendered by `gen_docs.py`. It was a hand-maintained duplicate of a generated
artifact, which is the whole reason it drifted.

`/help` and `/help/:slug` remain routed to `NotFound` (`App.tsx:212-214`) until
WP 5.2a ships P1 and P5.
