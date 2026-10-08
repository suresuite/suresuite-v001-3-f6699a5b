# Service-target recommender: proposing policy settings that reach a fill-rate or service-level target

> **Status: PROPOSED. This is the plan for Phase 18.** Owner: Phu Nguyen. Written 2026-10-08.
> It describes a Python engine feature: given a project's data and its supply chain policies,
> it recommends values for the policy parameters so the chain reaches a stated fill rate or
> service level at the lowest inventory cost. If the target cannot be reached, it says why.
> The feature belongs to the engine (SuReSuite Sim, `python-library-plan.md`) and builds on
> Phase 17. The platform (hosted runs, the Lab UI, agents) comes after the library version
> works. Data-layer evidence stays in [`../PLAN.md`](../PLAN.md) §4. This plan cites it by
> D-number only.
>
> Blueprint anchors: §9.1 (a new typed experiment, "Target seeking"), §9.2 (run identity and
> reuse), §9.3 (CRN comparison semantics), §10.1 row 11 (AnyLogistix's safety-stock estimation
> experiment), §11 (later surrogate acceleration), §12 (agents propose, never apply). The plan
> uses these preserved assets: A2 (Pydantic `Params`), A6 (registry export), A7 (keyed seed tree),
> A10 (CRN-paired study machinery), A12 (warm-up and sequential CI), A15 (golden traces).
> WP 18.0 adds a gap row to the blueprint (proposed G22): *the platform can tell a user what
> fill rate a configuration produces, but not which configuration produces the fill rate they
> need.*

---

## 0. How to use this plan

The rules are the same as `python-library-plan.md` §0:

- **One work package = one session = one pull request.** Each WP is sized to finish in about
  80 % of a session, gates included.
- **Start a session with this prompt** (replace `18.n`):

  > Do WP 18.n of `docs/design/service-target-recommender.md`. Read §0–§5 of that plan and
  > the WP 18.n section only, then the files the WP lists under *Read first*. Open other files
  > by section, not whole. Work on a new branch. End with the WP's exit checks green, a
  > `PLAN.md` §16 drift-log entry, and this plan's status table updated.

- **Engine-ledger ritual** (gate `engine-ledger`): every WP that touches the engine's source
  needs a CHANGELOG entry or amendment, rebuilt wheels and a regenerated release report.
  Budget about 10 % of a session for it.
- **Commit convention:** `Phase 18 / WP 18.n / <blueprint ref>: <title>`.
- **Paths.** This plan is written after the rename in WP 17.1, so engine paths are
  `suresuite-sim/suresuite_sim/...`. If WP 17.1 has not merged when a WP here starts, use
  today's `scsim/scsim/...`. WP 17.1's table maps one set of paths to the other.

---

## 1. What we are building

### The question it answers

Today a user can ask *"what fill rate does this configuration give me?"* by running a
simulation. They cannot ask the reverse question: *"what configuration gives me a 95 % fill
rate, and what does it cost?"* To answer it now, they change safety stock or cover weeks by
hand, run again, and repeat. That is slow, the results are noisy, and nobody can tell whether a
cheaper setting would also have reached the target.

The recommender answers the reverse question with the same engine, the same data and the same
statistics a normal run uses.

### What a user does (library first)

```python
import suresuite_sim as sim

proj = sim.load("my_chain/")
sim.levers(proj)                       # the parameters you may let it change, with bounds

rec = sim.recommend(
    proj,
    target=sim.target("fill_rate", at_least=0.95, confidence=0.95),
    levers=["P-P.3.uniform_service_level", "P-P.1.coverage_weeks"],
    minimize="avg_inventory_value",
    budget=sim.budget(evaluations=40, max_replications=200),
)

rec.status        # "met" | "not_reachable" | "not_confirmed"
rec.summary()     # achieved fill rate ± CI, inventory cost vs today, what changed
rec.changes       # per-parameter, per-item diff against the project's current policies
rec.frontier      # inventory cost vs fill rate for every candidate it evaluated
rec.why_not       # when not reachable: what binds (plant capacity, a supplier, …)
rec.apply(proj).save("my_chain_fr95.suresuite")   # a NEW project file; the user decides
```

On the platform the same call runs as a typed experiment in the Simulation Lab (WP 18.9). The
result is a **proposed policy version**. The user saves it like any other version, and a normal
run of the Validated Model confirms it.

### What it is not

- **It does not change data.** Capacities, lead times, demand and costs are data, not
  policies. If only a data change can reach the target, the recommender says so in `why_not`
  and does not edit an item master. This follows `page-equals-run`, where /policies writes no
  master.
- **It does not invent numbers.** Every figure it reports comes from a simulation the user
  can re-run, and reaches the user with its confidence interval (T1, T4).
- **It is not a network optimizer.** It does not do MILP facility location or design (blueprint
  §10.3 keeps that out of scope). It tunes the parameters of policies the project already uses.

---

## 2. How it works

### 2.1 The problem, stated precisely

The recommender solves a constrained simulation-optimization problem:

```
minimize     E[ cost(x) ]                         e.g. average inventory value
subject to   LCB_{1-α}( E[ SL(x) ] ) ≥ target     one-sided lower confidence bound
             x ∈ X                                 lever bounds from the registry
```

- `x` is the vector of lever values (§2.2).
- `SL(x)` is the service metric the target names (§2.3), measured over the analysis window of
  each replication.
- `LCB` is the one-sided lower confidence bound across replications. A candidate counts as
  feasible only when the evidence says it meets the target. Being close on average is not
  enough.
- All candidates in one study use **the same seeds** (CRN, A7). Differences between
  candidates then come from the policies, not from noise. Monotonic comparisons then become
  reliable with far fewer replications.

### 2.2 Levers: the decision variables, declared in the registry

A lever is a policy parameter that the recommender may change. Levers are **declared once, on
the Pydantic field that defines the parameter**. Fields already carry `unit`, `scope` and
`range` in `json_schema_extra`. A lever adds a `tune` block:

```python
uniform_service_level: float = Field(
    95.0, ge=80.0, le=99.9,
    json_schema_extra={"unit": "%", "scope": "G",
                       "tune": {"direction": "+service", "cost": "+holding",
                                "step": 0.5, "space": "z"}},
)
```

- `direction` says which way the lever moves service (a monotonicity assumption, checked at
  run time, §2.4).
- `cost` says which cost it drives.
- `step` is the smallest change worth reporting.
- `space` is the scale the search works on. Example: service-level percent is searched on the
  normal `z` scale, because 99 → 99.9 % is a much bigger move than 90 → 90.9 %.

`registry_export.py` exports the `tune` blocks, so the app's lever picker is generated, never
hand-written (blueprint §6.2). A field without a `tune` block is not a lever.

**v1 levers** (only parameters of policies already **active** in the project's bundle):

| Policy | Lever | Scope |
|---|---|---|
| P-P.3 material safety stock | `uniform_service_level`, the nine `z_matrix` cells, `fixed_days_cover`, `fixed_days_by_material` | global · ABC×XYZ class · material |
| P-P.1 material inventory control | `coverage_weeks` (the nominal strip value), per-material `reorder_point` / `order_up_to` / `coverage_weeks` overrides, `review_cadence_weeks` (discrete 1/2/4) | global · material |
| P-P.4 FG safety stock | `service_level_pct`, `fixed_days_cover` | product |
| FG replenishment (WP 14.4, 16.6) | `fg_base_stock`, `fg_reorder_point`, `fg_cover_days`, as row overrides | product |

Later levers (§7): P-S.2 sourcing shares, P-P.5 overtime factor, P-T.2 expedite trigger, and
activating a policy that is not in the bundle. Each of these changes behaviour structurally,
not just in quantity, and needs its own validation.

**Levers live in policy-snapshot space.** A candidate is the project's policy snapshot with
some values changed: the same object /policies saves. It reaches the engine through the
**same mapper** a normal run uses. This guarantees that what the recommender evaluates is
what a saved version runs (gate `recommendation-equals-run`, §3). For speed, the evaluator may
compile once and patch `Scenario.policies` directly, but only behind a parity test that proves
the two routes give byte-identical results for every lever.

### 2.3 Service metrics a target can name

| Metric | Exists today? | Definition |
|---|---|---|
| `fill_rate` (network, value-weighted) | ✅ KPI dictionary | Σ u·served / Σ u·demand over the window. Never 100 % by default: an empty window is NaN |
| `fill_rate_units` (network) | WP 18.1 | Same formula, unweighted units. A low-value product counts the same as a high-value one |
| `fill_rate_by_product` | WP 18.1 | Unit fill rate per product over the window. Supports targets like "every product ≥ 92 %" |
| `cycle_service_level_by_product` | WP 18.1 | Share of window weeks in which the product had no shortage (α, per period) |

The per-product metrics need an **always-on per-product accumulator**, a length-P vector of
window demand and served units, like the existing capacity-binding accumulator. Today the
per-product matrices exist only under `full_debug`, and the recommender cannot afford
`full_debug`. This is an additive engine change with a version bump (WP 18.1).

Target forms: `at_least` on a network metric; `every_product_at_least`; or
`classes={"A": 0.98, "B": 0.95, "C": 0.90}` per ABC class. A per-product target is the
conjunction of P constraints, and the LCB is Bonferroni-corrected across them, so "every product
meets it" holds jointly at the stated confidence. The report states the correction (T3).

### 2.4 The search, cheapest step first

```
1  analytic seed      closed-form inventory theory per item       → x0, and a predicted SL
2  bracket + bisect   one scalar θ moves all levers together      → the cheapest feasible θ*
3  marginal descent   per lever group: buy service where it's     → lower cost, still feasible
                      cheapest, sell it where it's least needed     (WP 18.7)
4  confirm            fresh, independent seeds at full protocol   → the reported result
```

**Step 1: analytic seed (no simulation).** For each item, classic single-echelon formulas give a
starting point. Each item's demand mean and CV (per row, WP 14.1), lead-time mean and CV (P-S.6,
WP 16.1) and review period feed:

- for a β (fill-rate) target, the normal loss function, G(z) = (1 − β)·μ_R / σ_{L+R};
- for an α target, z = Φ⁻¹(α).

The result is mapped into each lever's units (z → service-level %, safety stock + cycle stock →
cover weeks). The seed ignores capacity, shared materials, BOM coupling and disruptions, so it
is only a starting point. The report shows the gap between the analytic prediction and the
simulated result, because that gap measures how much the network interactions matter (T3).

**Step 2: one-dimensional root finding.** The levers move together along one path
`x(θ) = seed shifted by θ on each lever's search space`. Service is expected to be
non-decreasing in θ. The search first brackets θ, doubling the step until the upper end is
feasible or every lever is at its bound. Then it bisects. At each probe it adds replications in
batches until the decision is clear (LCB ≥ target means feasible, UCB < target means
infeasible) or it hits the replication cap. This reuses the sequential-CI rule A12 already
implements. The search stops when the bracket's service width falls below an indifference zone
δ (default 0.2 percentage points).

*Monotonicity check:* at each probe, the CRN-paired difference SL(θ_hi) − SL(θ_lo) must not be
significantly negative. If it is (for example, with lumpy MRP lots or an `rop_q` lot size), the
search falls back to a coarse grid on θ, and the report says so.

**Step 3: marginal descent (WP 18.7, multi-lever).** Moving all levers together is safe, but it
over-stocks items that did not need it. Starting from θ*, a greedy marginal-analysis loop runs
over **lever groups**: ABC×XYZ cells by default (nine groups), product families, or single items
when the network has at most 50 and the user opts in. Each step evaluates CRN-paired one-step
moves and applies the best ratio:

- *remove* stock where the service lost per unit of cost saved is smallest, while the solution
  stays feasible, or
- *swap* stock from such a group to the group with the largest service gained per unit of cost.

The loop stops when no move improves cost at constant feasibility, or when the evaluation budget
is spent. This is the standard heuristic for multi-item service-constrained stocking, and it
needs no gradient. A constrained Bayesian optimizer is the planned upgrade for many continuous
levers (§7, ties into blueprint §11).

**Step 4: confirmation, which removes the winner's curse.** Picking the cheapest candidate that
passed on a given seed set is biased toward candidates that were lucky on those seeds. The
chosen candidate is therefore **re-run on an independent seed stream** (a separate key in the
seed tree, never shared with the search) at the Validated Model's full replication count.
**The confirmation run's confidence interval is the result reported to the user.**

- If the confirmation misses the target, the recommender takes one step up along θ and confirms
  again.
- If that also misses, the status is `not_confirmed` and the report shows both runs.

### 2.5 When the target cannot be reached

If every lever is at its upper bound and the UCB is still below the target, the status is
`not_reachable`. The report then gives:

- **the highest service level reached**, with its CI, and the inventory it costs;
- **what binds**, read from KPIs the engine already measures: `products_capacity_bound` and
  `suppliers_capacity_bound` (the share of window weeks in which plant or supplier capacity
  binds), `lost_inbound_units`, and lead-time-driven lateness under MRP. Example: *"Plant
  capacity binds in 34 % of weeks for P3. Inventory levers cannot raise fill rate above
  93.1 %. Raising P3's capacity is a data change."*
- **no partial result presented as success.** Gate `no-silent-shortfall` (§3) enforces this.

### 2.6 Statistics and protocol

- **Warm-up and replications** come from the Validated Model's protocol on the platform, or from
  the project's settings in the library. Candidates do not re-detect warm-up, because that would
  make comparisons unfair. At confirmation, MSER-5 runs on the recommended configuration. If it
  detects a longer transient than the adopted warm-up, the report warns.
- **Scenario.** v1 evaluates one scenario: the baseline without events, or one named
  stress scenario. "Meet 95 % in normal operation **and** 85 % under a six-week outage of S2"
  is a robust target (WP 18.10).
- **Required data.** The recommender refuses to run on a project where the required-data gate
  reports blocking substitutions, and warns about non-blocking ones. Tuning a model built on
  substituted defaults gives a precise answer to the wrong question.

### 2.7 Compute and reuse

- **Cost preview before running:** evaluations × replications × horizon. At the engine's
  measured ~0.33 s per replication at manuscript scale (blueprint R4), 40 evaluations × 60
  replications take about 13 minutes on one core. The library parallelizes candidates over local
  processes (`workers=n`). The platform shards them across workers (§9.4).
- **Inside a study** each candidate is keyed by a digest of (policy snapshot, seeds, scenario).
  A repeated probe is a lookup, not a run.
- **Across studies on the platform** each candidate is a RunKey (§9.2), so a candidate another
  study or user already ran is reused, and quota (WP 10.7) is charged only for new compute.

### 2.8 What a recommendation carries

A `Recommendation` is a reproducible record (T4):

- `status`, the target spec, the lever spec, the objective;
- the baseline: dataset hash, policy hash, scenario, and engine build (`code_version`);
- `changes`: every lever value that differs from the baseline, per entity, with the before and
  after values;
- `confirmation`: KPIs with CIs from the independent-seed run, plus the cost change against the
  baseline run on the same seeds (CRN-paired);
- `frontier`: every evaluated candidate's (cost, service, CI), so the user can see what 1 more
  point of fill rate costs;
- `trace`: the search path (step, candidate digest, decision, reason);
- `why_not` and the warnings (non-monotone lever, warm-up, analytic-vs-simulated gap, the
  multiple-comparison correction);
- the recommender's version, which is `ENGINE_VERSION`, because the recommender lives in the
  engine.

Same inputs and same root seed give a byte-identical recommendation. A golden test pins this.

---

## 3. Rules that keep it honest, as named gates

| Gate name | Invariant | Enforced by (lands in) |
|---|---|---|
| `levers-from-registry` | A lever exists only as a `tune` block on a `Params` field. The app's lever list is generated from the registry export. A hand-written lever list fails | registry snapshot test + a TS generated-module check (WP 18.2) |
| `recommendation-equals-run` | A recommendation's confirmation KPIs equal those of an ordinary run of the recommended policy snapshot with the same seeds, byte for byte. The recommender evaluates what a saved version runs | `test_recommendation_equals_run.py` on the bundled example (WP 18.4), and on the platform path (WP 18.8) |
| `no-silent-shortfall` | `status = "met"` only when the confirmation LCB ≥ target. Every other outcome names the highest service level reached and what binds | unit tests over the status function plus a not-reachable golden case (WP 18.4) |
| `recommendation-is-a-proposal` | Nothing the recommender produces writes a policy version, a master or a run. A recommendation reaches the platform only as a candidate the user saves through the normal path | platform tests (WP 18.8, 18.9), consistent with blueprint §12's guardrail |
| `engine-ledger` *(existing)* | The recommender is engine code, so every change to it follows the ritual | existing CI |

The gates follow the repository's single-source rule (`single-source`, I1). The service metric
definitions are authored once in the KPI dictionary. The levers are authored once on the
fields. The recommendation schema is authored once as a Pydantic model, which the platform's
tables and UI are generated from.

---

## 4. Status and sequence

| WP | Title | Size | Depends on | Owner step | Status |
|---|---|---|---|---|---|
| 18.0 | Wire the plan in, record the decisions | S | — | 👤 decisions R1–R5 (§5) | ⬜ |
| 18.1 | Per-product service KPIs in the engine | M | 17.1 | — | ⬜ |
| 18.2 | Lever catalog: `tune` blocks and their export | M | 17.1 | — | ⬜ |
| 18.3 | Target spec, evaluator and the statistics | M | 18.1, 18.2 | — | ⬜ |
| 18.4 | Search v1: seed · bracket/bisect · confirm · why-not | L | 18.3 | — | ⬜ |
| 18.5 | `sim.recommend` in the front door; tutorial | M | 18.4, 17.4 | — | ⬜ |
| 18.6 | Validation study, published and CI-checked | M | 18.4 | — | ⬜ |
| 18.7 | Multi-lever marginal descent and the frontier | L | 18.4 | — | ⬜ |
| 18.8 | Platform: studies table, worker job, quota | L | 18.5 | — | ⬜ |
| 18.9 | Simulation Lab: "Reach a service target" | L | 18.8 | — | ⬜ |
| 18.10 | Robust (multi-scenario) targets; agent tool | L | 18.7, 18.9 | 👤 agent stage gate | ⬜ |

**Critical path to a usable library feature:** 18.0 → 18.1 ∥ 18.2 → 18.3 → 18.4 → 18.5
(five sessions after WP 17.1). **To the platform:** add 18.8 → 18.9. 18.6 and 18.7 can run in
parallel after 18.4.

Sizes: **S** ≈ 30–40 % of a session, **M** ≈ 50–65 %, **L** ≈ 70–80 % with a named split point.

---

## 5. Decisions

| # | Decision | State |
|---|---|---|
| R1 | Which service metrics a target may name | **Open, needed by 18.1.** Recommended: the existing value-weighted `fill_rate`, plus unit fill rate and α cycle service level per product (§2.3). Also pin whether the engine's fill-rate numerator counts only demand served in its own week or also later backlog clearing. The KPI dictionary must say so before anyone targets it |
| R2 | Target statistic | **Open.** Recommended: the mean with a one-sided 95 % LCB. The alternative, "at least p % of replications reach the target", is a chance constraint. Offer it later as `kind="quantile"` |
| R3 | Default objective | **Open.** Recommended: minimize average inventory value (`avg_on_hand_value + avg_fg_value`). It is easy to explain and measured directly. `cost_of_resilience` is the alternative, for disruption studies |
| R4 | Lever scope in v1 | **Open.** Recommended: only the parameters of policies already active. No policy activation and no data changes (§2.2) |
| R5 | Where it lives | **Open.** Recommended: in SuReSuite Sim, free, because the methods stay open (`python-library-plan.md` §1, Horizon Europe open science). The platform adds hosted compute, the Lab UI, the record store and agents |
| R6 | Default lever granularity | Recommended: one scalar θ (v1). Then ABC×XYZ groups (18.7). Single items only as an opt-in for networks with at most 50 items |
| R7 | Starting point on the platform | Recommended: a Validated Model is required (its protocol fixes warm-up and replications). Exploratory models may run a study, but the result is labeled exploratory, as runs are (WP 10.5) |

---

## 6. Work packages

### WP 18.0: Wire the plan in, record the decisions · S

**Read first.** This plan; blueprint §2.3, §9.1 and §13 Phase C; `PLAN.md` §17 and the last
two §16 entries.

**Do.**
1. Blueprint: add G22 (proposed) to §2.3, a "Target seeking (proposed)" row to §9.1's table, and
   the gap-index entry in Appendix C. Each points here.
2. `PLAN.md`: add a short §28 "Phase 18: service-target recommender" that points here, a row in
   §17, and a §16 entry.
3. Record the owner's answers to R1–R5 in §5.

**Don't.** Change code. **Exit.** `npm run check:docs` · `npm run contract:check`.

### WP 18.1: Per-product service KPIs in the engine · M

**Read first.** `kpi/definitions.py`, `kpi/compute.py`, the capacity-binding accumulator in
`core/engine.py` (`_CapacityBindingAccumulator`), `WeeklyTrace` in `core/context.py`.

**Do.**
1. An always-on per-product accumulator over the analysis window (demand units, served units,
   and shortage weeks), with no `full_debug` dependency.
2. KPIs `fill_rate_units` (network), plus `fill_rate_by_product` and
   `cycle_service_level_by_product`. These are a per-entity block on `ScenarioResult`, beside the
   capacity-binding block, not flat replication keys.
3. KPI dictionary entries per R1, and the generated docs.
4. Ritual: version bump. The new KPIs are additive, so check whether any frozen digest moved. If
   none did, the entry is `identical`.

**Exit.** Golden digests are unchanged, or the entry lists exactly the runs that moved. A test
checks that per-product fill rates weighted by value reproduce the network `fill_rate`. A
performance guard shows less than 3 % slowdown per replication.

### WP 18.2: Lever catalog: `tune` blocks and their export · M

**Read first.** `policies/base.py` (`PolicyParams`), the four policies in §2.2's table,
`io/registry_export.py`.

**Do.**
1. A `tune` schema (direction, cost, step, space, discrete values), validated when the registry
   loads.
2. `tune` blocks on the v1 levers.
3. `registry_export` emits them, and the app's generated registry module carries them.
4. `sim.levers(project)` lists the levers usable *for this project* (active policies only,
   with each lever's current value and bounds).
5. A path helper reads and writes a lever's value in **policy-snapshot space**.

**Exit.** Registry snapshot test. The generated-module check. The `levers-from-registry` test,
which fails on a lever name that is not declared on a field. Ritual: metadata only, entry
`identical`.

### WP 18.3: Target spec, evaluator and the statistics · M

**Do.**
1. Pydantic `TargetSpec`, `LeverSpec`, `Budget` and `Recommendation` models: the single source
   for the record (§2.8).
2. `Evaluator`: candidate snapshot → mapper → `run_scenario`, with fixed CRN seeds, sequential
   replication batches and an in-study cache keyed by candidate digest.
3. Feasibility decision (LCB/UCB), the Bonferroni correction for per-product targets, and the
   CRN-paired difference test (reusing the engine's `stats` package).
4. The compile-once fast path behind a parity test.

**Exit.** Unit tests with a fake evaluator (a known monotone function plus noise), so the
statistics are tested in milliseconds. The parity test on the bundled example.

### WP 18.4: Search v1: seed, bracket/bisect, confirm, why-not · L

**Do.** Steps 1, 2 and 4 of §2.4, plus §2.5. The analytic seed (normal loss function, α and β
forms) mapped into lever units. Bracketing and bisection on θ with the monotonicity check and
the grid fallback. Independent-seed confirmation with one step-up retry. Status assignment and
`why_not` built from the capacity-binding KPIs.

**Split point.** Seed plus bisection pushed and tested; confirmation and why-not as a follow-up.

**Exit.**
- **Golden A:** on a single-item base-stock network with normal demand and a fixed lead time,
  the recommendation lands within δ of the analytic β answer.
- **Golden B:** on a network whose plant capacity binds, the status is `not_reachable` with the
  correct binding reason.
- **Determinism:** the same inputs and seed give a byte-identical record.
- The `recommendation-equals-run` and `no-silent-shortfall` tests pass.

### WP 18.5: `sim.recommend` in the front door, and a tutorial · M

**Do.** The public calls `sim.levers`, `sim.target`, `sim.budget`, `sim.recommend` and
`Recommendation.apply/summary/to_excel`. Progress callbacks and `workers=n` process parallelism.
Cost preview. A keyless tutorial on the bundled example ("from 88 % to 95 % fill rate: what it
costs"). Add the new names to `__all__` and the API snapshot gate (WP 17.8).

**Exit.** Tutorial executes in CI; API snapshot updated; `suresuite` (the paid client)
`kpi_display` reads the new KPI names from the engine rather than restating them.

### WP 18.6: Validation study, published and CI-checked · M

**Do.** `docs/research/service-target-recommender.md`, generated by a study script and
byte-compared in CI, the same way `mrp-vs-reorder-point.md` is (`plan-from-demand`).

1. Analytic recovery across a grid of CVs and lead times.
2. Brute force: on a three-item network, a full grid compared with the recommender's cost and
   feasibility, and the evaluations each used.
3. The winner's curse: how often the search-seed pick fails confirmation, with and without step 4.

**Exit.** The script's `--check` runs in `scsim-tests.yml`, and the report states its own limits
(T3).

### WP 18.7: Multi-lever marginal descent and the frontier · L

**Do.** Step 3 of §2.4 over lever groups. A budget-aware stopping rule. The cost/service
frontier assembled from every evaluated candidate. The final pick among the last k candidates by
CRN-paired comparison.

**Exit.** On the WP 18.6 brute-force network, cost lands within a stated tolerance of the grid
optimum, and the study report gains a section on it.

### WP 18.8: Platform studies table, worker job and quota · L

**Do.**
1. Tables `recommendation_studies` (spec, status, record) and `recommendation_candidates` (study
   × candidate digest → RunKey and KPIs), each with a sidecar, audit triggers, RLS, natural keys
   and generated docs (gates `table-covered`, `audit-actor`, `natural-key`).
2. One insert path, an RPC that reserves quota for the budget's maximum and settles to the actual
   (the `run_usage` ledger, WP 10.7).
3. A worker job kind `recommendation.run` (a typed job family, §9.4). The worker is the only
   writer (A11). Each candidate is a RunKey, so the cache applies.
4. A behavioural rehearsal file for the insert path and the quota.

**Exit.** `contract:check`, `contract:rehearse` (all three ways), `npm test`, and R17 if an edge
function is touched.

### WP 18.9: Simulation Lab card "Reach a service target" · L

**Do.**
1. A card in the Lab's left column beside stress tests. A detail sheet with the target form, a
   lever picker generated from the registry, and the cost preview.
2. Progress, and a result view: status, confirmation CI, a changes table, the frontier chart and
   why-not.
3. **"Save as a new policy version"** through the normal save path (`recommendation-is-a-proposal`),
   then a prompt to run the Validated Model on it.
4. Mobile layout per `docs/mobile-ui-spec.md`.

**Exit.** `npm run lint` (typecheck, check:docs, audit:ui, eslint) · `npm test` ·
`page-equals-run` unchanged.

### WP 18.10: Robust targets and the agent tool · L

**Do.** A target over a set of scenarios (all must meet, or a weighted set). The B2/B4 agent
tool `propose_service_target_study`, which produces a proposal card through the proposal fabric
(`ai-agents.md`) and never dispatches without approval.

---

## 7. Later, not yet sessions

- **More levers:** P-S.2 sourcing shares, P-P.5 overtime, P-T.2 expedite trigger, and policy
  activation as a structural lever, each with its own validation.
- **Constrained Bayesian optimization** (GP surrogates of cost and service, constrained expected
  improvement) for more than about 10 continuous levers. It shares machinery with the blueprint
  §11 surrogate registry and obeys that section's validity scoping.
- **Data-change "what-ifs"** (capacity, a second supplier) as a separate experiment that
  produces a proposed *dataset* change through the ingestion path. It never edits a master from
  the recommender.
- **Multi-stage** service targets once WP 14.7 lifts the single production stage.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Noise near the target gives a false "met" | One-sided LCB, sequential replications near the boundary, and independent-seed confirmation (§2.4 step 4) |
| A lever is not monotone (MRP lot lumpiness, `rop_q`, review cadence) | Paired monotonicity check at each probe, a grid fallback, and a warning in the record |
| Inventory levers are inert because capacity binds | `not_reachable` with the binding reason (§2.5), never a forced recommendation |
| Value-weighted fill rate hides poor service on low-value products | Unit and per-product metrics (WP 18.1). The report shows the worst product even for a network target |
| Too many levers (1 000 materials) | Lever groups by default (R6). Per-item levers only as an opt-in for small networks |
| Compute cost and quota | Cost preview, in-study and RunKey reuse, process and worker parallelism, a budget cap that is a hard stop |
| Warm-up changes under the new policies | A warm-up check at confirmation, with a warning (§2.6) |
| Users read a recommendation as certain truth | Every figure carries its CI and seed set. The status vocabulary has no "approximately met". The result is a proposal, confirmed by an ordinary run |
| Engine churn makes old recommendations stale | The record binds the engine build. On the platform a recommendation on a withdrawn or superseded build is labeled, the same as a run |
