# The AI Supply-Chain Modeler — collaboration workflow

> How a user and an AI modeling agent build a simulation project together on
> SureSuite. The mechanical substrate is `docs/project-onboarding-guide.md`
> (what must exist and in what order); this document designs the *interaction*:
> what the AI asks, what it validates, what it produces, and where human
> judgment is irreplaceable. Proven once end-to-end on Project TRON - ver2
> (`docs/projects/project-tron-ver2.md`), where the whole loop — data profiling
> → engine mapping → seeding → validated run — was executed by an AI agent with
> the user supplying only the three source artifacts.
>
> Design stance: **the AI automates derivation, validation, and plumbing; the
> user owns intent, exclusions, and acceptance.** Every AI-derived value is
> traceable to a numbered rule; every assumption is surfaced for sign-off, not
> buried.

## The twelve stages

Each stage lists: what the user must supply, what the AI asks, what it
validates, what it produces, and the automation level
(🟢 fully automatable · 🟡 AI drafts / user confirms · 🔴 user decision).

### 1. Requirement gathering 🟡
- **User supplies:** the modeling goal (baseline performance? disruption stress
  test? policy comparison?), the KPI that defines success, decision horizon.
- **AI asks:** Which decisions will this model inform? Which KPI is primary
  (fill rate / revenue / lost sales / resilience)? What granularity of time and
  product is decision-relevant? Is there a paper/spec the model must follow?
- **AI validates:** the goal is expressible with the engine's KPI vocabulary
  and policy catalog (blueprint §5, Appendix A) — names any gap *now*.
- **Artifacts:** a one-page model charter (goal, KPIs, scope, references).

### 2. Data collection 🟡
- **User supplies:** raw exports — products/prices, demand history, BOM,
  sourcing (supplier × material: cost, lead time, MOQ), suppliers. Optional:
  reference results for acceptance.
- **AI asks:** only for what §1 of the onboarding guide requires and the goal
  needs — with the *reason* attached ("supplier disruption analysis needs
  per-arc lead times; capacity cuts additionally need finite supplier
  capacities").
- **AI validates:** completeness against the required-inputs table; column
  semantics and units confirmed, not guessed ("`LT_wk` — weeks, correct?").
- **Artifacts:** data inventory with row counts and coverage matrix.

### 3. Model interpretation 🟡
- **AI does:** reads the methodology (paper, SOP, or interview answers) and
  maps every element onto engine concepts, citing both sides (e.g. "your
  min/max rule Eqs. 2–4 = engine `min_max` with κ = 8 wks coverage").
- **AI asks:** the questions the document leaves open — unmet demand: lost or
  backordered? supplier selection when costs tie? what does a zero consumption
  rate mean in your BOM?
- **AI validates:** every methodology element has an engine home; anything
  inexpressible is declared a platform gap with an extension proposal (mapping
  contract §9) — **never** silently approximated.
- **Artifacts:** methodology-to-engine mapping table; gap list.

### 4. Network construction 🟢
- **AI does:** profiles the raw data (per-product demand statistics, BOM
  coverage, arc hygiene), derives the six datasets by explicit numbered rules,
  generates the dataset artifact with an audit report (TRON's
  `build_dataset.py` is the template).
- **AI validates:** referential integrity; every BOM material sourced; costs,
  rates, lead times inside engine ranges; sentinel values detected and ruled
  out; when a reference exists, entity sets and moments assert-match it.
- **User confirms 🔴:** exclusions (test articles, sentinel-LT materials,
  degenerate products) — these change what the model *is*.
- **Artifacts:** `dataset.json` + rule log + reconciliation report.

### 5. Policy definition 🟡
- **AI does:** drafts the seven policy families from the methodology mapping
  (stage 3) and the closest preset; explains each parameter's engine effect.
- **AI asks:** service-level targets, holding-cost basis, sourcing strategy
  intent (single / multi / primary-backup), resilience levers on or off for
  the baseline.
- **AI validates:** the draft against the registry export (the single source
  of policy schemas); flags parameters the engine consumes at project scope
  only.
- **Artifacts:** `policy_defaults` payload + rationale per family.

### 6. Assumption validation 🔴
- **AI does:** compiles *every* derivation rule, default, exclusion, and
  approximation into one numbered table (the TRON record's §4 is the shape),
  each row with its basis and its blast radius.
- **User does:** signs off row by row — this is the stage where silent
  modeling errors die.
- **Artifacts:** the assumption register (goes into `docs/projects/<name>.md`).

### 7. Parameter verification 🟢
- **AI does:** cross-checks seeded values against sources (spot samples +
  aggregate moments); renders the Data map view: every master field either
  explicit or intentionally defaulted.
- **Pass condition:** the §8.1 gate returns no blocks and nothing warn-level
  that data could fix; economics resolve from masters, not fallbacks.

### 8. Simulation configuration 🟡
- **AI does:** drafts scenarios — horizon, replications, CRN, warm-up mode,
  seed, stopping rule — from the methodology; places disruption events
  **relative to steady-state onset and inside the KPI analysis window**
  (the TRON lesson: absolute weeks do not transfer between implementations).
- **AI asks:** replication budget vs precision target (offers the adequacy
  math n* = (z·s/(ε·x̄))²); which stress scenarios matter first.
- **Artifacts:** `scenarios` rows (baseline + named stress tests).

### 9. Model validation 🟡
- **AI does:** local canonical-path run first (seconds, no infrastructure);
  then the seeded, deployed run via the e2e verifier. Compares steady-state
  KPIs against the reference (moments, warm-up shape, disruption response
  magnitudes); runs the platform's V&V pipeline (warm-up detection,
  replication adequacy, KS/Welch tests where empirical series exist).
- **AI validates mechanically:** zero warn-level mapping entries; policy-hash
  round-trip; engine-version pin; scenarios measurably bite.
- **User does 🔴:** face validity ("does 0.98 fill rate match how this chain
  behaves?") and the **Adopt** action — the model-validation card
  (credibility badge) is a user assertion, never auto-asserted (blueprint A3).
- **Artifacts:** validation report + the persisted `model_validations` card.

### 10. Scenario generation 🟡
- **AI does:** proposes the experiment frame from the goal — disruption sweeps
  (location × start × duration), policy levers (backup supplier, expedite,
  multi-sourcing), demand sensitivity — mapped to what the experimentation
  layer supports today; ranks by information value.
- **User does:** picks and prioritizes; owns cost/duration trade-offs.
- **Artifacts:** scenario set in the Simulation Lab, each inheriting the
  validated warm-up + replication settings automatically.

### 11. Result verification 🟡
- **AI does:** sanity-invariants (fill rate + loss shares ≈ 1, revenue ≈
  demand-weighted price, CI half-widths vs adequacy targets), cross-scenario
  consistency (monotonicity where expected), flags anomalies with drill-downs
  to the weekly series; drafts the interpretation.
- **User does:** accepts the interpretation; decides what feeds decisions.

### 12. Documentation generation 🟢
- **AI does:** writes `docs/projects/<name>.md` (model, artifacts, assumption
  register, deviations, validation evidence), updates the blueprint if the
  platform was extended (same-PR rule), and keeps commit traceability
  (`Phase X / GY / §Z`).

## Automation map

| Stage | Level | The human-judgment core |
|---|---|---|
| 1 Requirements | 🟡 | what the model is *for* |
| 2 Data collection | 🟡 | access, provenance |
| 3 Interpretation | 🟡 | ambiguity resolution |
| 4 Network construction | 🟢 | exclusions sign-off 🔴 |
| 5 Policies | 🟡 | strategy intent |
| 6 Assumptions | 🔴 | row-by-row sign-off |
| 7 Parameter verification | 🟢 | — |
| 8 Sim configuration | 🟡 | precision vs budget |
| 9 Model validation | 🟡 | face validity + Adopt 🔴 |
| 10 Scenarios | 🟡 | prioritization |
| 11 Results | 🟡 | decision uptake |
| 12 Documentation | 🟢 | — |

**Where the manual work went (TRON evidence):** stages 4, 7, 12 — historically
days of spreadsheet surgery — were fully automated (profiling, 10 derivation
rules, reference reconciliation, seeding, e2e verification, docs). The user's
time concentrated where it is irreplaceable: exclusions, assumptions,
acceptance.

**Accuracy safeguards that make the automation safe:**
1. Reference reconciliation is an *assertion*, not a report.
2. Every derived value traces to a numbered rule; no silent fixes.
3. The engine's mapping-warning stream is the runtime tripwire — warn-level
   entries fail verification.
4. The local canonical-path run catches modeling errors (e.g. events outside
   the analysis window) before any infrastructure is involved.
5. Platform gaps are extended through the typed contract, never papered over
   with distorted data.
