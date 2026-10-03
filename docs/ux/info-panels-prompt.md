# Prompt — make every (i) info panel useful

> **Status: AUTHORED.** A ready-to-paste task prompt for a Claude Code session.
> Copy everything under "The prompt" into a new session on this repository.

---

## The prompt

### 1. What we want

Every **(i)** button in SuReSuite should answer, in a few seconds and in plain
language, the question a user has when they click it:

> **"What is this, what does it do to my simulation, and what happens if I leave it empty?"**

Today many panels don't answer it. Example: on **Supply chain policies →
Customer → Demand mode (forecast / model)** the panel shows

```
reaches engine
DEFAULT   —
SOURCE    demand
WHAT IT MEANS   No spec description for this parameter yet.
```

The user learns nothing. "DEFAULT —" hides what an empty cell actually does,
and "SOURCE demand" is an internal group name, not a source a user would
recognise.

Your job is to fix this for **every (i) in the app**, starting with the pages
users open most.

### 2. Who reads the panels

Supply chain planners and researchers. They know what a reorder point or a
lead time is. They don't know our code, our work packages (WP …), our defect
numbers (D…), or names like `row_demand_mode`. Write for them.

### 3. Scope, in order

Finish each part completely before starting the next.

| Part | Page | What has an (i) or needs one |
|---|---|---|
| **A** | **Supply chain policies** (`/policies`) | Every grid column in every stage (Supplier, Focal plant, Customer, Run & validate). The setup bar (model version, planning unit, stage cards). The colour legend above the grid (from project data, imputed average, derived fallback, saved override, edited). The project-level cards (e.g. Customer allocation rule). |
| **B** | **Simulation lab** (`/simulation-lab`) | Every scenario field, disruption field, experiment setting, run status, KPI and result chart. Many of these explain themselves today only through a hover `title=`. Give each one the same (i) treatment. |
| **C** | **Every other page** | Project manager / data upload, network pages, trust report, admin. Make a list first, then fill it in. |

**Facts measured on `main` (2026-10-03), so you don't start from zero:**

- The policy panel is `src/components/policies/ParameterSheet.tsx`. It opens
  from the column header in `StagePolicyTable.tsx`.
- Its text comes from **one catalog**: `PARAM_META` in
  `src/lib/policies/paramMeta.ts`. The placeholder sentence is that file's
  fallback when a column has no entry.
- The grid's columns are the `col("…")` calls in
  `src/lib/policies/columnSpecs.ts`: **44 columns, and 21 have no entry**:
  `backorder_allowed`, `coverage_weeks`, `fg_base_stock`, `fg_cover_days`,
  `fg_initial_on_hand`, `fg_policy`, `fg_reorder_point`, `fulfillment_mode`,
  `lead_time_days`, `max_backorder_days`, `row_demand_distribution`,
  `row_demand_max`, `row_demand_mean`, `row_demand_min`, `row_demand_mode`,
  `row_demand_variation`, `row_forecast`, `row_priority`,
  `sla_fill_floor_pct`, `utilization_cap_pct`, and the internal
  `__inv_params`. Check whether `__inv_params` is ever shown to a user before
  you write an entry for it.
- Many columns already explain themselves in **code comments** and in
  `nullMeans` titles inside `columnSpecs.ts` (e.g. `fg_base_stock`: *"Empty —
  S is derived: one week of the projected demand"*). That is your best
  first-draft source, but you still have to verify it (step 4).
- The engine registry (`src/lib/policies/registry.generated.json`, generated
  from `scsim/scsim/io/registry_export.py`) has `description` fields for
  entities, pipeline phases, policies and stress tests. Reuse them. Don't
  copy them by hand into a second place.
- Simulation lab has no shared info catalog yet. Its explanations are
  scattered `title=` strings across `src/components/sim/*`.

### 4. The rule that matters most: every sentence must be true

An (i) is a promise about what the engine does. **A wrong (i) is worse than an
empty one.** For each entry:

1. **Read the code that uses the value.** That's the scsim mapper and engine
   (`scsim/scsim/io/project_map.py`, `scsim/scsim/policies/`,
   `scsim/scsim/core/phases.py`) and, for columns backed by an item master,
   the resolver in `src/lib/policies/`. Find out what the engine does when the
   value is set, and what it does when it's empty.
2. **Check what the spec says** in `docs/design/next-gen-platform-design.md`
   (§5 + Appendix A, the policy catalog) and `docs/PLAN.md` §23–§24 (row
   overrides, demand-driven planning).
3. **If the code and the docs disagree, the code wins for the (i) text.**
   Write the disagreement down in your final report. Don't silently "fix"
   either one.
4. **If you can't tell what something does, don't guess.** Write
   `TODO(confirm): <your question>` in the entry and list it in your report.
   We'll answer it.
5. **A panel that says "not simulated" or "stored only" must be correct.**
   Those badges come from `fieldEngineStatus` and the column's flags, not
   from your prose. Never write prose that contradicts the badge.

### 5. What every panel shows: the template

Use the same sections, in the same order, everywhere. Leave out a section only
when it truly doesn't apply. Never leave a section with a dash and no
explanation.

| # | Section | Rule | Example (Demand mode) |
|---|---|---|---|
| 1 | **Title** | The user-facing name, as it appears in the column header. | Demand mode |
| 2 | **In one line** | One sentence, at most 25 words, no symbols. This is what most users will read. | Chooses whether this row's demand comes from your uploaded forecast or from a statistical model. |
| 3 | **What it does in the simulation** | 1–3 sentences: what the engine does with the value, week by week. Name the decision it changes (order size, production, allocation…). | *(to be verified in code)* |
| 4 | **If you leave it empty** | The exact behaviour. Replaces "DEFAULT —". When the empty value is derived, say from what. | *(e.g. "Uses the forecast if this row has one uploaded, otherwise the model.", verify first)* |
| 5 | **Options** (choices only) | One line per choice: what it does. | `forecast` — … · `model` — … |
| 6 | **Unit & allowed values** | Unit plus range, in user words ("days, 0 or more"). | — (a choice, no unit) |
| 7 | **Where the value comes from** | In user words, the order the engine reads: *your edit on this row → the uploaded data (name the file/table the user knows) → the project default → the built-in default.* Replaces the internal "SOURCE demand". | Your edit on this row → … |
| 8 | **Example** | One short worked example with numbers when it helps. | Optional |
| 9 | **Technical details** (collapsed by default) | Symbol, formula, policy ID (`P-C.x`), spec reference. Keep what `PARAM_META` already has. | P-C.?, §… |

**Writing rules**

- Plain English, short sentences, active voice. "The engine orders…", not
  "Orders are placed by…".
- No internal vocabulary in sections 1–8: no WP numbers, D-numbers, table
  names, field names, `snake_case`, "tier", "sidecar", "override chain". The
  technical section can have them.
- Use the units the page shows (it follows the planning unit: day / week /
  month).
- Same word for the same thing everywhere. If the column says "Backorder", the
  panel doesn't say "back-order" or "deferred fulfilment".
- No emoji or check-mark glyphs in source (`docs/mobile-ui-spec.md` §3.5 is
  enforced by `npm run audit:ui`).

### 6. How to build it: one catalog, no copies

This repository has a hard rule (CLAUDE.md, gate `single-source`): **every fact
is written once.** So:

- **Policies:** extend `PARAM_META` in `paramMeta.ts` with the new sections
  (`summary`, `whenEmpty`, `sourceOrder`, `example`). Update
  `ParameterSheet.tsx` to render the template above, with "Technical details"
  collapsed. Where a column already has a `nullMeans.title`, read section 4
  from it. Don't write it twice.
- **Simulation lab and other pages:** create one catalog (e.g.
  `src/lib/help/infoCatalog.ts`) and **one** reusable `<InfoButton id="…">`
  component that opens the same style of side sheet. Move the existing
  `title=` explanations into the catalog instead of duplicating them. Where
  the registry already has a `description`, read it from the registry instead
  of copying it.
- **Add a gate so this can't regress:** a test that fails when any column in
  `columnSpecs.ts` (and any `InfoButton` id) has no catalog entry, or when an
  entry is missing the "In one line" or "If you leave it empty" section.
  After that, the "No spec description for this parameter yet." fallback
  should be unreachable. Keep it only as a safety net that the test proves is
  never hit.

### 7. How to work

1. **Inventory first, then stop.** Produce a table with one row per (i) that
   exists or should exist (page · element · current text · what's missing ·
   which code you'll read to verify it). Put it in your report and **wait for
   approval before writing text.**
2. Write Part A. Show 5 representative panels (one per stage plus one choice
   field) as screenshots: run the app and capture with Playwright. Wait for
   feedback on the tone before finishing the rest of Part A.
3. Then Part B, then Part C, each in its own commit or PR.
4. Before every push run `npm run lint` (typecheck, `check:docs`,
   `audit:ui`, eslint) and `npm test`, and report the results as printed.
5. Commit message convention:
   `Phase N / WP N.M / <blueprint ref>: <title>`. Ask which phase/WP to use
   if it isn't obvious.

### 8. What "done" means

- [ ] Every (i) in the scoped pages opens a panel with at least "In one
      line", "What it does in the simulation" and "If you leave it empty".
- [ ] No panel shows "No spec description for this parameter yet.", a bare
      "—" default, or an internal group name as its source.
- [ ] Every sentence is backed by code you read. Disagreements and
      `TODO(confirm)` items are listed in the report.
- [ ] The coverage test exists and passes. Removing one catalog entry makes it
      fail (try it once and say so).
- [ ] `npm run lint` and `npm test` pass.
- [ ] Final report: the inventory table with each row's status, before/after
      screenshots of the Demand mode panel, the list of open questions.
