# Brief — Close the Policies workspace gaps (`/policies`)

> **How to use this file.** Paste the block under **“PROMPT — copy from here”** into a fresh
> session (Fable). It is self-contained: it tells the agent what to read, the guardrails, the exact
> gaps with current-vs-target and acceptance criteria, and the working discipline — so you never
> have to re-explain. Everything it references already exists in the repo.

---

## PROMPT — copy from here ↓

You are closing a set of well-specified UX/engineering gaps in the **SureSuite** Policies workspace
(`/policies`). The analysis is already done — do **not** re-derive it. Read the two canonical
documents first, then execute the tasks below, smallest-risk first, one PR per task.

### 0. Read before writing any code (in this order)
1. `CLAUDE.md` — the standing architectural laws and repo map.
2. `docs/design/next-gen-platform-design.md` — the blueprint. Note **§2.3 gap catalog**,
   **§6.2 registry export = single source of truth for policy schemas**, **§3 engine law**,
   **§13 roadmap/phases**.
3. `docs/design/policy-specification.md` — the **authoritative** policy library & UI contract.
   The grid target lives in **§II.1 (column model)**, **§II.3 (dynamic parameter cell)**,
   **§II.4 (Policy Basis)**, **§II.6 (value resolution + provenance)**, and **§III/§IV** (the
   per-type policy libraries with their parameters).
4. `docs/ux/first-time-user-walkthrough-and-gaps.md` — **§“Scene 6 — reality check & build spec”
   (6.A–6.E)** is the exact scope of this work, with current-vs-target already written.

### Guardrails (do not violate)
- **scsim is the strategic engine.** The legacy `sim-worker/sim_worker/engine.py` is frozen — never
  extend it (blueprint §3).
- **The registry export is the single source of truth for policy schemas**
  (`scsim/scsim/io/registry_export.py` → `src/lib/policies/registry.generated.json`). Never
  hand-write parallel policy schemas; the grid’s dynamic parameters must be **generated** from the
  registry (blueprint §6.2). Today the grid uses a transitional 7-family Zod schema
  (`src/lib/policies/schemas.ts`) — migrating off it is task 6.A.
- **Extend existing artifacts, don’t replace them.** Build on `usePolicies`, `useSimulationRun`,
  the version/hash patterns, and the existing components.
- **Traceability:** every commit/PR references the blueprint section, gap id, and phase, e.g.
  `Phase D / 6.A / §II.3: dynamic policy-type parameter cell`. If you must deviate from a spec,
  update that spec in the **same** PR — code and doc move together.
- Match the surrounding code style (React + Vite + TypeScript + shadcn/ui + Tailwind + Supabase).
- Do **not** put any model identifier in commits, PR bodies, code, or comments.

### Branch & workflow
- Develop on a feature branch per task off the latest default branch. **Never** push to `main`.
- One PR per task (6.A may need to be split — see its note). Keep PRs reviewable.
- After each nontrivial change, **actually exercise the flow** (run the app / the project `verify`
  skill), don’t rely on typecheck alone. State honestly what you verified.
- Do not create a PR until the task’s acceptance criteria are met.

---

### The tasks (do them in this order)

#### 6.E — Run & Job-Queue console  *(do first: smallest, highest-visibility, no backend change)*
**Why it’s first:** the data already exists — `src/hooks/useSimulationRun.tsx` already returns
`history` (last 20 `simulation_runs` rows, live over realtime) and `cancelRun(projectId, runId)`
already cancels **any** run by id. The UI just throws it away and renders only `latestRun` via
`RunProgressPanel`. This is a **UI gap, not a data gap.**
**Current:** `RunValidateStage.tsx` → `RunProgressPanel.tsx` shows one “Latest run” card with a
single Cancel. Queued jobs are invisible; you can only cancel the latest.
**Target:** a **Run Queue console** (design mock: the artifact linked in the PR/handoff):
- A persistent **status hero** with five states — idle · queued · running (n/N) · succeeded
  (fill rate · revenue · engine) · failed (which step + why) — with loud terminal chrome.
- A **job list** rendered from `useSimulationRun().history`: per row — type (`Single`/`×N`), a
  status **pill** (queued/running/done/failed/cancelled, icon **and** label, not colour alone), a
  **segmented replication progress bar** (one cell per replication) + `n / N`, engine
  (server/browser), started time, and the **result** (primary KPI ± CI · revenue) or the **error
  line**. Queued rows show queue position.
- Per-row actions: **Cancel** (queued/running, wire to existing `cancelRun`; browser runs →
  `cancelBrowserRun()`), **View** (done → scroll to inspection), **Retry** (failed).
- Toolbar: status **tally**, a **filter** (All/Active/Done/Failed), **Cancel all active** (confirm),
  **Clear finished**.
**Files:** `src/components/policies/RunValidateStage.tsx`,
`src/components/sim/RunProgressPanel.tsx`, `src/hooks/useSimulationRun.tsx`.
**Done when:** launching two runs shows two jobs; a queued job is visible with its position; I can
cancel a specific queued job and the running one independently; the tally + filter work; nothing
regressed in the existing single/multi run panels. No backend change required for this cut.

#### 6.D — Model version history: export, delete, notes
**Current:** `src/components/policies/PolicyVersionBar.tsx` supports Save (single **Label** only),
History list, Select, Load. No export, no delete, no notes.
**Target:** on each history entry add **Export** (download the policy bundle — reuse the exporter in
`src/lib/policies/excel.ts`), **Delete** (with confirm; guard against deleting a version a run/model
card is bound to — warn instead), and a **Notes** free-text field on save/edit (persisted on the
version record, **separate** from the label). Extend the `PolicyVersion` type + the save/list RPCs
(add a `notes` column via a Supabase migration in `supabase/migrations/`; add a delete RPC).
**Files:** `PolicyVersionBar.tsx`, `src/hooks/usePolicies.*`, `src/lib/policies/excel.ts`,
`supabase/migrations/` (new migration).
**Done when:** I can attach notes to a saved version and see them in history; export a version to a
file; delete a version (with confirm + the bound-version guard).

#### 6.B — Per-parameter transparency
**Current:** the grid shows good **data provenance** (corner dots: from-data / imputed / derived /
override / edited) but nothing about **what a policy/parameter is**. `SCSIM_VISIBLE_FIELDS` in
`src/lib/policies/schemas.ts` hides non-consumed fields/families with only a small badge.
**Target:** a per-policy/per-parameter **transparency side-sheet** generated from the schema/registry:
each parameter’s **symbol · unit · range · default · meaning** (verbatim from the
`policy-specification.md` tables), the **decision-rule/formula** the policy runs (spec §III/§IV), and
an explicit **“consumed by engine ✅ / stored-only 🧩”** flag per parameter. Keep the existing
provenance dots.
**Files:** `src/lib/policies/columnSpecs.ts`, `src/lib/policies/schemas.ts`,
`src/lib/policies/registryAccess.ts`, `src/lib/policies/fieldStatus.ts`, a new side-sheet component.
**Done when:** clicking a parameter (or a “?” affordance) opens its meaning/unit/range/formula and
its engine-consumed status, sourced from the spec/registry (no hand-typed duplication).

#### 6.A — Migrate the grid to the “Policy Type → dynamic parameters” model  *(largest — split into PRs)*
**Current:** `src/components/policies/StagePolicyTable.tsx` + `src/lib/policies/columnSpecs.ts`
render a **flat spreadsheet**: one fixed column per flattened field in coloured family bands, with
per-cell `visibleWhen` gating that greys inapplicable cells to `—`. There is **no Policy Type cell**
driving a parameter set; the per-type policy library (spec §III inventory ×12, §IV sourcing /
production / capacity) is not selectable; the column headings are flattened field names, not the
spec’s model.
**Target (spec §II.1–§II.3):** the ALX-style table:
`Facility | Item | Policy Type | Policy Parameters | Initial Stock | Policy Basis | Periodic Check | …`
where the **Policy Type** dropdown drives a **dynamic Policy Parameters** cell **generated from the
selected type’s schema in `registry.generated.json`** — the type’s 1–3 headline params get their own
columns (e.g. `min_max → s, S`; `rop_q → R, Q`), the rest render as a compact `param = value` chip
list. Each editor comes from the parameter’s JSON-Schema (numeric min/max, enum dropdown, optional),
with inline validation from the policy’s `feasibility()` / portfolio check. Preserve the existing
**provenance dots**, the **Excel round-trip**, and the value-resolution precedence
(`user edit ≻ preset ≻ data-prefill ≻ registry default`, spec §II.6). Add the structural columns
(Initial Stock, **Policy Basis** §II.4, Periodic Check / Period).
**Suggested PR split:**
1. Registry access layer: read policy types + their param schemas from `registry.generated.json`
   (extend `registryAccess.ts`), with types.
2. A reusable **dynamic parameter renderer** (schema → inputs) + the Policy Type column, behind the
   existing grid for one category (start with **Inventory / supplier stage**).
3. Roll out to the remaining categories; add Policy Basis + Initial Stock + Periodic columns.
4. Retire the transitional flat columns for migrated categories; keep provenance + Excel working.
**Files:** `StagePolicyTable.tsx`, `columnSpecs.ts`, `registryAccess.ts`,
`registry.generated.json` (read-only source), `schemas.ts` (transitional).
**Done when:** choosing a policy type changes which parameters are shown/editable (one column shows
the params the type needs, the adjacent column(s) let me set them); the inventory/sourcing library
is selectable; headings match spec §II.1; provenance + Excel + prefill still work; the engine still
receives valid policy values (verify a run end-to-end).

#### 6.C — Richer run visualisation (engine + UI)  *(do last; touches the engine)*
**Current:** the engine persists only **four aggregate weekly series** on
`run_replications.time_series` (`fill_rate, backlog_units, on_hand_value, revenue_value`).
`RunValidateStage.tsx` (`EngineOutputSummary`, `WeeklySeriesChart`) can only chart those; there is no
per-material vs finished-goods inventory, no FG production output over time, and the financial
statement is scalar.
**Target:** (1) **engine/worker** — persist additional weekly series (per-echelon inventory:
material vs FG; production output; per-cost-component) on `run_replications.time_series` (extend
**scsim** + the worker’s ProgressFn/persistence — obey the engine law; do not touch the frozen legacy
engine). (2) **UI** — add an **indicator picker** to the run panels so single-run inspection can plot
per-material / per-product / financial trajectories, not just four aggregates.
**Files:** `scsim/…` (series emission), `sim-worker/sim_worker/…` (persistence),
`supabase/migrations/` if the series schema changes, `RunValidateStage.tsx` (picker + charts).
**Done when:** after a single run I can pick “material inventory”, “FG inventory”, “FG output”, or a
cost line and see its weekly trajectory with the warm-up cut; the aggregates still work.

---

### Sequencing & PRs
Order: **6.E → 6.D → 6.B → 6.A (split) → 6.C.** One PR per task (6.A multiple). Each PR: reference
the blueprint §, gap id, and phase in the title/body; include what you verified by running the app;
update `docs/ux/first-time-user-walkthrough-and-gaps.md` (tick the Scene 6 checklist) and, for 6.A,
`docs/design/policy-specification.md` if you deviate. Ask before any large architectural change or
if a spec is ambiguous — don’t guess.

### Out of scope / do not
- Don’t touch the frozen legacy engine. Don’t hand-write policy schemas. Don’t redesign other pages
  (Data Manager, network views, Simulation Lab) in these PRs. Don’t change auth/roles. Don’t open a
  PR before acceptance criteria are met.

## PROMPT — copy to here ↑
