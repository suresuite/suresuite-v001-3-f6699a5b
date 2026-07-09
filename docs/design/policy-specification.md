# SureSuite — Supply Chain Policy Library & Simulation Logic (authoritative specification)

| | |
|---|---|
| **Status** | v2.3 — v2.0's reframe (*policies*, not *strategies*) preserved. v2.1 added §III.A (inventory's stochastic derivations), §III.15 (AnyLogistix benchmark), §III.16 (UI array-editor scoping). v2.2 brought §IV–§VI up to §III's per-policy template and added §PART VIII-D (disruption propagation). **v2.3 grounds every one of the registry's 22 registered policies in its actual `params_schema`** — exact field names/types/units/ranges/defaults transcribed directly from `src/lib/policies/registry.generated.json`, not paraphrased — and corrects several real app-level mismatches this exposed: §III.1's $s,S$ are *computed* from `coverage_weeks`, not user-entered fields, under today's basis; §III.2/III.7's "SS" is not a hand-typed field on either policy but the effect of a second policy's hook composing on top of the first; §III.3's (R,Q) is single-lot in the shipped code, not the multi-lot ceiling previously stated as primary; Eq. B.4's overtime premium is % of *price*, not of production cost; §IV.1 items 1/4/5/6 (single/ranked/capacity-proportional/tiered sourcing) are not registered policies at all — "single sourcing" is an unnamed engine default that should be `P-S.0`; §V.A found P-T.5/P-T.6 are not registered even as 🧩. This is the document doing, for every policy, what the design brief asked for at "the app-wise level": treating the registry export — not this document's prose, not `schemas.ts`, not the help page — as the one ground truth, and fixing every place this document had drifted from it. |
| **Date** | 2026-07-09 (v2.1/v2.2 same day; v2.0: 2026-07-07) |
| **Role** | Single source of truth for every supply chain **policy** the platform offers, its **mathematical model**, its **parameters and UI**, and its **coding representation**. Any change to a policy, parameter, equation, or its UI/engine binding must be reflected here in the same change. |
| **Benchmark** | anyLogistix (ALX) is the reference for *breadth of the policy library* and the *table/parameter UI*. We match its granularity, evaluate each policy for necessity under our weekly-bucket engine, and give every policy a rigorous mathematical model (ALX documents behavior; we specify equations). |
| **Ground truth** | Parameter names/units/ranges of already-implemented policies are transcribed from the engine registry (`src/lib/policies/registry.generated.json`, engine 0.2.0) and plugin source (`scsim/scsim/policies/`). New policy types proposed here are marked and specified to the same rigor so they can be implemented directly. |

**Status legend.** ✅ implemented and executes today · ✚ specified here, not yet in the engine
(implementable directly from this spec) · 🧩 registered engine schema, raises until built ·
⛔ out of scope for the weekly single-plant engine, with the reason (kept for completeness).

---

## PART 0 — The mandatory per-policy template (Inputs → Logic → Outputs)

**Every policy in this document is specified with the identical structure below.** This is the
"clear structure of input, logic, output" the specification is required to follow; no policy is
described in prose alone.

1. **Purpose** — the single decision the policy makes.
2. **Inputs** — always in three parts:
   - *Sets & indices* the policy ranges over.
   - *Parameters* — a table `symbol · unit · range/enum · default · meaning` (these are exactly
     the Policy-Parameters dialog fields in the UI).
   - *State & data read* — persistent state variables (§1) and item-master/data fields consumed.
3. **Logic** — the decision rule as **equations** in the §1 notation: the trigger condition and
   the produced quantity/decision, step by step. Never prose-only.
4. **Outputs** — the state/decision variables written (with units) and the KPI(s) it feeds.
5. **UI & engine** — the table/dialog it appears in; engine status (✅/✚/🧩/⛔).

Empty blocks are stated explicitly ("Parameters: none"). The Inventory library (§PART III) and
the Demand library (§PART III-D) are the two fully-worked references for this template; all other
policies follow it identically.

---

## PART I — What a policy *is* (and is not)

### I.1 Policy vs. strategy — the distinction this document enforces

A prior version of this specification conflated the two. They are corrected here and kept
strictly separate for the remainder of the document.

> **Policy** — a concrete, parameterized **operational decision rule** bound to a specific
> *(facility, item)* pair (or a scope that resolves to such pairs), which the simulation engine
> **executes every period** to produce a decision (an order quantity, an allocation, a shipment).
> A policy has a **type** (e.g. Min-max, (R,Q), MRP), a **parameter set** determined by that type,
> and a **mathematical model**. This is the atomic unit the engine reads and the grid edits.
>
> Example (ALX Inventory table, one row): *Facility = Plant, Product = MAT-A, Policy Type =
> Min-max, Parameters = {s = 50, S = 200}, Initial Stock = 120, Periodic Check = off.* This row
> **is** a policy.

> **Strategy (a.k.a. preset)** — a **named bundle** that *pre-fills many policies at once* to
> express a coherent posture (e.g. "Make-to-Stock", "Dual-source resilient"). A strategy is a
> convenience that writes policy rows; **the engine never reads a strategy.** It reads the
> policies the strategy produced. Strategies are documented in §PART VII, cleanly separated.

**Consequences enforced throughout:**
1. The catalog in this document enumerates **policy types**, comprehensively, per decision
   category — not strategies.
2. Every policy type has: parameters, a **mathematical model** (equations, not prose), decision
   rule, UI parameter dialog, and coding schema.
3. Strategies/presets appear only in §PART VII and only as maps *{strategy → the policy rows it
   writes}*.

### I.2 The decision categories (each is a "table" in the ALX sense)

The platform's policies partition into the categories below. Each category is an editable
**policy table** (a grid) whose rows are *(facility, item)* pairs and whose central cell is the
**Policy Type** with a **dynamic parameter dialog**. Categories:

| # | Category (table) | Governs the decision | Scope of a row | §ref |
|---|---|---|---|---|
| 1 | **Inventory / Replenishment** | when and how much to reorder | (facility, item) | §III |
| 2 | **Sourcing / Procurement** | from whom, in what split, when | (facility, material) | §IV.1 |
| 3 | **Production** | build-to-stock vs order; lot sizing; sequencing | (factory, product) | §IV.2 |
| 4 | **Capacity** | base capacity, overtime, reserve | (factory, product) | §IV.3 |
| 5 | **Safety stock** | buffer sizing method | (facility, item) | §IV.4 |
| 6 | **Transportation** | mode, consolidation, frequency, expedite | (lane) or (facility, item) | §V |
| 7 | **Fulfillment / Customer** | lost-sales vs backorder; allocation; split | (facility, product) or (customer) | §VI |
| 8 | **Forecasting** | demand forecast method | (facility, product) | §IV.5 |
| 9 | **Resilience / Recovery** | contingent reroute, expedite, playbook | various | §VIII |

Inventory is specified first and at full depth (it is the category the ALX example details), then
the rest follow the same template.

---

## PART II — The UI and coding contract (how a policy is presented and stored)

### II.1 The policy table (grid) — column model

Every category table shares a column skeleton, modeled directly on the ALX Inventory table and
mapped to our data model. The **Policy Type** cell drives a **dynamic Policy Parameters** cell:
choosing a type changes which parameters are shown and editable — exactly the user's core idea.

| Column | Meaning | Our binding | Notes |
|---|---|---|---|
| **Facility** | node the policy applies to | `node_id` (plant, supplier, customer; DC when the echelon lands) | `All sites` supported → one row expands to all facilities |
| **Item** | material or product | `material_id` / `product_id` | `All products` supported |
| **Policy Type** | the policy chosen for this row | discriminated-union tag (`policy_type`) | dropdown of the category's types (implemented enabled; ✚/🧩 shown, planned disabled with milestone) |
| **Policy Parameters** | the type's parameters | `params` object, schema = the type's schema | **dynamic**: rendered from the selected type's registry schema (hybrid grid, §II.3) |
| **Initial Stock** | on-hand at $t=0$ | `initial_on_hand` (item master) | ∞ for Unlimited; fixed for others |
| **Policy Basis** | Quantity vs Days-of-supply | `policy_basis` (§II.4) | the parameter-interpretation switch — critical, §II.4 |
| **Stock Calc. Window** | days for mean-demand estimate | `stock_calc_window_days` | only if basis = Days-of-supply |
| **Periodic Check** | perpetual vs periodic review | `periodic_check` bool | §II.5 |
| **Period** / **First Check** | review cadence & phase | `review_period_weeks`, `first_check_week` | only if periodic |
| **Minimum Split Ratio** | allow partial shipment ≥ ratio | `min_split_ratio ∈ (0,1]` | §VI (fulfillment) |
| **Inclusion** | include / exclude this row | `included` bool | excluded rows are grey, still editable |

**Rows resolve to (facility, item) execution units.** `All sites`/`All products` are expanded at
compile time so the engine always sees concrete pairs — this is why a policy is per-(facility,item)
even though the grid lets you author one row for many.

### II.2 Coding representation — a discriminated union, generated from the engine

A policy value is a **tagged union**: the `policy_type` tag selects both the parameter schema and
the engine behavior. Canonical form (illustrative; the real schemas are the engine `Params`
models, exported to `registry.generated.json`):

```ts
// One inventory policy cell, stored per (facility,item)
type InventoryPolicy =
  | { policy_type: "min_max";          params: { s: number; S: number } }
  | { policy_type: "min_max_ss";       params: { s: number; S: number; safety_stock: number } }
  | { policy_type: "rq";               params: { R: number; Q: number } }
  | { policy_type: "base_stock";       params: { S: number } }
  | { policy_type: "periodic_RS";      params: { S: number } }            // + review period (grid col)
  | { policy_type: "regular";          params: { quantity: number } }     // periodic, fixed qty
  | { policy_type: "regular_ss";       params: { quantity: number; safety_stock: number } }
  | { policy_type: "order_on_demand";  params: {} }                        // lot-for-lot / pull
  | { policy_type: "unlimited";        params: {} }
  | { policy_type: "no_replenishment"; params: {} }
  | { policy_type: "mrp";              params: { safety_stock: number; planning_horizon_weeks: number } }
  | { policy_type: "cross_dock";       params: {} };                       // ⛔ needs DC echelon
```

**Single source of truth (unchanged platform law).** The union above is **not hand-written twice**.
Each `policy_type`'s parameter schema lives in the engine plugin's Pydantic `Params`; the registry
export renders it to `registry.generated.json`; the grid's dynamic parameter dialog and the
edge-function validator are generated from that. Adding a policy type = one plugin + a registry
row; the grid gains the option automatically. (Blueprint §6.2; today the grid still uses a
transitional 7-family Zod schema — the reframe here is the target the grid migrates to.)

### II.3 The dynamic parameter cell (hybrid rendering, as agreed)

When the user picks a `policy_type` for a row, the **Policy Parameters** cell renders that type's
parameters, taking values through the resolution precedence of §II.6:

- The type's **1–3 headline parameters** get their own materialized columns (e.g. Min-max →
  `s`, `S`); the remainder appear as a compact `parameter = value` chip list in a "more…" cell.
- Each editor is generated from the parameter's JSON-Schema: numeric input with min/max; enum
  dropdown; ModeStrip triple (nominal/alert/crisis); clearable optional.
- In-cell validation: field ranges from the schema; cross-field from the policy's `feasibility()`;
  cross-policy from `check_portfolio` — rendered inline, identical to the server-side gate.

Example grid (Inventory table, materials at the plant):

```
Facility | Item  | Policy Type   | s   | S    | more params            | Init | Basis        | Periodic
Plant    | MAT-A | min_max       | 50  | 200  | —                      | 120  | Quantity     | off
Plant    | MAT-B | min_max_ss    | 40  | 180  | [safety_stock=30]      | 90   | Quantity     | off
Plant    | MAT-C | rq            | R=60| —    | [Q=150]                | 200  | Days (W=10)  | on (2w)
Plant    | MAT-D | mrp           | —   | —    | [safety_stock=25]      | 80   | Quantity     | on (1w)
```

### II.4 Policy Basis — the parameter-interpretation switch (this closes gap G1)

ALX's **Policy Basis** is the concept that reconciles absolute parameters with demand-scaled
parameters, and it is exactly the fix for our long-standing mismatch (the engine ignored absolute
`reorder_point`/`order_up_to` and used coverage-κ instead). We adopt it explicitly. Every
inventory-type parameter that denotes a *level* is interpreted under one of two bases:

- **Basis = Quantity.** Parameters are **absolute units**. $s = 50$ means 50 units.
- **Basis = Days-of-supply (historic).** Parameters are **multipliers on mean demand** over a
  window $W$ (the Stock Calc. Window, days). With mean daily demand
  $\bar d_i = \frac{1}{W}\sum_{u=t-W}^{t-1} D_{i,u}$ (from history or forecast), a level parameter
  $\pi$ is realized as
  $$\text{level} = \pi \cdot \bar d_i \cdot 7 \quad\text{(units, per week)}.$$
  Example (ALX): Min-max with $s=2$, $S=5$, $W=10$ ⇒ $s = 2\,\bar d_i\cdot7$, $S = 5\,\bar d_i\cdot7$.

**Mapping to our engine.** Our current P-P.1 implements exactly the Days-of-supply basis with a
single coverage constant: $s_{m,t} = \bar d_m L_\ell$, $S_{m,t} = \bar d_m (L_\ell + \kappa)$ (κ in
weeks). Under this reframe, that is the special case **Basis = Days-of-supply** with the level
parameters expressed relative to lead time. Adding **Basis = Quantity** (honoring absolute $s,S$)
is the concrete work that closes G1 — both bases are specified in §III so either can be built.

### II.5 Periodic vs perpetual review

- **Perpetual (Periodic Check = off).** The policy is evaluated **every** period (every week in
  our engine). Reorder decisions fire as soon as the trigger is met.
- **Periodic (Periodic Check = on).** The policy is evaluated **every $T$ weeks** (the Period),
  offset by the First Check. Between checks the inventory position is not acted upon. This both
  models real review cadence and reduces computation.

Formally, define the review indicator $\rho_t = \mathbf 1[(t - t_0)\bmod T = 0]$ (perpetual ⇒
$T=1$ ⇒ $\rho_t\equiv1$). Every reorder rule below is gated by $\rho_t$.

### II.6 Value resolution precedence (prefill)

Per parameter, per row: **user edit ≻ strategy/preset ≻ data-prefill ≻ registry default.**
Data-prefill reads item-master fields, or a named reducer over logistics arcs when the master is
empty (cost = cheapest inbound price; price = demand-weighted outbound; mean demand = Σ outbound
volume; §PART VII details per policy). Every prefilled cell shows a provenance badge; no hidden
heuristics.

---

## PART III — Inventory / Replenishment policy library (full depth)

**Decision governed.** For each *(facility, item)*: whether to reorder this period, and how much.
**Scope.** Materials at the plant (raw/components) and finished goods at the plant (and DCs when
the echelon lands). **Notation (this part):** on-hand $I_{i,t}$; on-order (pipeline)
$\Pi_{i,t}=\sum_{\ell\in\mathcal L_i}\Pi_{\ell,t}$; backorders $B_{i,t}$; **inventory position**
$\mathrm{IP}_{i,t} = I_{i,t} + \Pi_{i,t} - B_{i,t}$; order placed $O_{i,t}\ge0$; lead time $L_i$
(weeks); mean weekly demand $\bar D_i$; review gate $\rho_t$ (§II.5); level parameters interpreted
per Policy Basis (§II.4). All order quantities are floored to MOQ and, where relevant, rounded to
lot multiples (§IV.2).

### III.0 Library overview

| # | Policy type | Parameters | Trigger | Order quantity | Engine |
|---|---|---|---|---|---|
| 1 | **Min-max (s,S)** | $s, S$ | $\mathrm{IP} < s$ | up to $S$ | ✅ (`min_max`) |
| 2 | **Min-max with safety stock** | $s, S, \mathrm{SS}$ | $\mathrm{IP} < s+\mathrm{SS}$ | up to $S+\mathrm{SS}$ | ✚ |
| 3 | **(R,Q)** | $R, Q$ | $\mathrm{IP} < R$ | multiples of $Q$ | ✅ (`rop_q`) |
| 4 | **Base stock / order-up-to (S)** | $S$ | every review | $S-\mathrm{IP}$ | ✅ (`base_stock`) |
| 5 | **Periodic review (R,S) / (T,S)** | $S$, period $T$ | every $T$ | $S-\mathrm{IP}$ | ✅ (`periodic`) |
| 6 | **Regular (fixed-qty periodic)** | $Q$, period $T$ | every $T$ | fixed $Q$ | ✚ |
| 7 | **Regular with safety stock** | $Q, \mathrm{SS}$, period $T$ | every $T$ | $Q + \max(0,\mathrm{SS}-\mathrm{IP})$ | ✚ |
| 8 | **Order on demand (lot-for-lot / pull)** | — | on demand/order | exactly net requirement | ✚ (MTO uses this) |
| 9 | **Unlimited inventory** | — | never orders | n/a (∞ available) | ✚ |
| 10 | **No replenishment** | — | never orders | 0 | ✚ |
| 11 | **MRP (time-phased)** | $\mathrm{SS}$, horizon $N$ | projected shortfall | net requirement, LT-offset | ✚ |
| 12 | **Cross-dock** | — | flow-through | pass inbound to outbound | ⛔ needs DC echelon (Phase E) |

Each is specified below with its mathematical model. §III.A first derives, from first
principles, every stochastic quantity ($\sigma_{X_i}$, $z(\alpha)$, the two service-level
definitions, and the cost-optimal safety factor $z^\star$) that the policies below and §IV.4 use —
so no formula in §III.1–III.14 is asserted without derivation, and every symbol keeps the single
meaning fixed in Appendix B throughout.

### III.A — Stochastic foundations (derivations; the rigor layer)

**Purpose of this section.** §III.1–III.14 state policies operationally (trigger → quantity), as
an engineer needs to implement them. This section proves *why* the constants in those formulas
($\sigma_{X_i}$ in III.1/III.2's Days-of-supply basis, $z(\alpha)$ in §IV.4's `service_level`/`king`
classifications, the $z\cdot\sigma\sqrt{L}$ shape of P-P.3's Eqs. 20–21) are the correct ones, not
merely conventional ones — the standard a supply-chain researcher or OR reviewer expects, and the
thing a product-style spec normally skips. It is written once here, referenced everywhere else in
Part III and Part IV (§IV.4) rather than re-derived per policy, so notation cannot drift.

**A.1 The demand-over-lead-time random variable.** Fix an item $i$. Weekly demand
$D_{i,t}$ is drawn each week at PH-10 (§IX.1) with mean $\bar D_i=\mathbb E[D_{i,t}]$ and variance
$\sigma_{D_i}^2=\mathrm{Var}(D_{i,t})$, independent across weeks (the platform's stated demand
model; autocorrelated/seasonal demand is a documented limitation, §A.6 below). Lead time $L_i$
(weeks) is either **deterministic** ($L_i\equiv\bar L_i$, $\sigma_{L_i}=0$; P-S.6
`lead_time_model=deterministic`) or **stochastic** with mean $\bar L_i$ and coefficient of
variation $\mathrm{CV}^{L}_i$ (`materials.lead_time_cv`), so $\sigma_{L_i}=\mathrm{CV}^L_i\bar L_i$
(P-S.6 `stochastic`). Define the **demand-over-lead-time** (DLT) random variable — the quantity a
reorder placed *now* must cover before the next delivery arrives:
$$X_i \;=\; \sum_{u=1}^{L_i} D_{i,t+u}.$$
$X_i$ is a **randomly stopped sum**: both the number of terms ($L_i$) and each term ($D_{i,t+u}$)
are random, and — this is the standing independence assumption, stated explicitly per the brief's
requirement that every assumption be named — $L_i \perp \{D_{i,t+u}\}$ and the $D_{i,t+u}$ are
i.i.d. across $u$.

**A.2 Mean and variance of $X_i$ (law of total expectation/variance — the derivation behind
"King's formula").** By the law of total expectation, conditioning on $L_i$:
$$\mathbb E[X_i] = \mathbb E_L\big[\mathbb E[X_i\mid L_i]\big] = \mathbb E_L[L_i\bar D_i] = \bar L_i\bar D_i.$$
By the law of total variance,
$$\mathrm{Var}(X_i) = \underbrace{\mathbb E_L[\mathrm{Var}(X_i\mid L_i)]}_{\mathbb E_L[L_i\sigma_{D_i}^2]=\bar L_i\sigma_{D_i}^2} \;+\; \underbrace{\mathrm{Var}_L(\mathbb E[X_i\mid L_i])}_{\mathrm{Var}_L(L_i\bar D_i)=\sigma_{L_i}^2\bar D_i^2}$$
$$\boxed{\;\sigma_{X_i}^2 \;=\; \bar L_i\,\sigma_{D_i}^2 \;+\; \sigma_{L_i}^2\,\bar D_i^2\;}\tag{A.1}$$
This **is** §IV.4's King formula ($z(\alpha)\sqrt{L_i\sigma_D^2+\bar D_i^2\sigma_L^2}$, matching
`p_p3_safety_stock.py`'s `king` branch line-for-line) — Eq. A.1 is its proof, not a restatement.
**Deterministic-lead-time special case** ($\sigma_{L_i}=0$): $\sigma_{X_i}^2=\bar L_i\sigma_{D_i}^2$,
i.e. $\sigma_{X_i}=\sigma_{D_i}\sqrt{\bar L_i}$ — the plain $z\sigma_D\sqrt L$ shape used by §IV.4's
`service_level` classification and III.1's default sizing. Both formulas in the codebase are
therefore the *same* equation (A.1) at two points of the $\sigma_{L_i}$ axis — not two independent
heuristics, a fact the spec previously left implicit.

**A.3 Normal approximation and its assumption.** All service-level formulas below use
$X_i\sim\mathcal N(\bar L_i\bar D_i,\ \sigma_{X_i}^2)$. This is a Central-Limit-Theorem
approximation: $X_i$ sums $\bar L_i$ i.i.d. terms, and normality is a reasonable approximation once
$\bar L_i \gtrsim 4$–5 (typical for weekly-bucket lead times of 2–12 weeks, §2.4's fidelity
boundary). **Stated failure mode (an assumption named, per the brief's requirement, not hidden):**
for intermittent/slow-moving demand ($\bar D_i$ small, many zero-demand weeks — the regime Croston's
method targets, §IV.5), $X_i$ is right-skewed and zero-inflated; the normal approximation
understates stockout risk in the left tail. The platform's stated mitigation is not to silently
apply Eq. A.1 uncritically there, but to route such items to the empirically-validated path: the
model-credibility pipeline (§9.5 of the blueprint) tests the *simulated* achieved service level
against the analytical target and flags divergence — analytical sizing initializes, simulation
verifies, exactly the two-step discipline §III.15 contrasts with ALX's simulation-only approach.

**A.4 Two service-level definitions — Type I vs. Type II (a distinction the current spec elided,
corrected here).** "Service level" is ambiguous without qualification; the platform is precise
about which one every parameter means.

- **Type I — cycle service level $\alpha$.** The probability that a replenishment cycle completes
  *without* a stockout: $\alpha = \Pr[X_i \le R_i]$ where $R_i$ is the reorder point ($s_i$ for
  min-max, $R$ for (R,Q)). Under the Normal approximation, $R_i = \bar L_i\bar D_i + z(\alpha)\sigma_{X_i}$
  where $z(\alpha)=\Phi^{-1}(\alpha)$ — **this is exactly what §IV.4's `service_level`/`king`/`abc_xyz`
  classifications compute**, and what `uniform_service_level`/`z_matrix` in `p_p3_safety_stock.py`
  parameterize. **Correction to the prior spec text:** every occurrence of "service level" in §IV.4
  and the ABC-XYZ z-matrix (Appendix A of the blueprint) denotes **Type I**, not fill rate; this
  document now states that explicitly everywhere the ambiguity previously existed.
- **Type II — fill rate $\beta$.** The *fraction of demand* satisfied directly from stock,
  $\beta = 1 - \mathbb E[\text{shortage per cycle}]/\bar Q$, where $\bar Q$ is the expected order
  quantity ($S-s$ for min-max in steady state, $Q$ for (R,Q)) and the expected shortage per cycle
  uses the **standard normal loss function**
  $$\psi(z) \;=\; n(z) - z\big(1-\Phi(z)\big), \qquad \mathbb E[\text{shortage}] = \sigma_{X_i}\,\psi(z),$$
  ($n,\Phi$ the standard normal pdf/cdf — $n(\cdot)$ used rather than the more common $\phi(\cdot)$
  glyph specifically to avoid collision with this document's $\phi_t$, the firm-knowledge/crisis
  indicator used throughout §IV.1/§V/§VIII/§PART VIII-D; one symbol, one meaning, per the
  document's own rule. $\psi$ is the expected value of $\max(Z-z,0)$ for
  $Z\sim\mathcal N(0,1)$ — a standard Silver–Pyke–Peterson result). So
  $$\boxed{\;\beta_i \;\approx\; 1 \;-\; \dfrac{\sigma_{X_i}\,\psi(z_i)}{\bar Q_i}\;}\tag{A.2}$$
  Fill rate is what the run's **KPIs actually measure** (§III.14's fill rate, §IX.3's
  $\mathrm{FR}=\sum u_pF_p/\sum u_pD_p$) — so Eq. A.2 is the bridge a user needs to answer "if I set
  a 95% z-target on this material, what fill rate do I actually get downstream?", a question ALX's
  UI cannot answer analytically (§III.15). **Consequence for the UI (§II):** the Policy-Parameters
  dialog should label the z-based inputs "Cycle service level (Type I)" and, where $\bar Q_i$ is
  resolvable (min-max/RQ), show the *implied* Type II fill rate from Eq. A.2 alongside it as a
  read-only derived field — never invent a second free-typed parameter for it.

**A.5 The cost-optimal safety factor $z^\star$ (newsvendor / critical-ratio derivation — closes
the "why this service level and not another" question).** §IV.4 today asks the user to *choose* a
service level (or an ABC-XYZ cell) with no stated criterion for what value is correct. The
classical single-period newsvendor argument supplies one, and — because the platform already
carries every cost figure the argument needs (§IX.3's cost ledger) — it is directly computable, not
merely theoretical. Let $c_i$ be unit cost (`materials.cost`), $h_i$ the weekly holding-cost rate
(`materials.holding_cost_pct`/52, or `products.sell_price`-based for FG per P-P.4), so the **weekly
overage cost** of one unit of excess safety stock is $c_i^o = h_i c_i$. Let $c_i^u$ be the
**underage cost** of one unit of stockout — for a raw material, the downstream margin it would have
enabled, $c_i^u \approx u_{p}-c^{BOM}_p$ for the product(s) it feeds (weighted by BOM incidence); for
a finished good under backorder, the per-unit·week penalty $\pi^{bo}$ (§VI.1) times expected wait,
or the lost-sale value $u_p$ under lost-sales handling (§VI.1). The expected cost of stocking to
reorder point $R=\bar L\bar D+z\sigma_X$ over one cycle is
$$C(z) = c^o\,\sigma_X\!\left(z + \psi(z)\right) \;+\; c^u\,\sigma_X\,\psi(z)$$
(holding the safety buffer $z\sigma_X$ plus expected overage from cycle stock, against expected
underage $\sigma_X\psi(z)$). Differentiating in $z$ and using $\psi'(z) = \Phi(z)-1$ (a standard
identity for the normal loss function), the first-order condition $C'(z^\star)=0$ reduces to
$$c^o\big(1-\big(1-\Phi(z^\star)\big)\big) - c^u\big(1-\Phi(z^\star)\big) = 0 \;\Longrightarrow\; \Phi(z^\star) = \frac{c^u}{c^u+c^o} \equiv \mathrm{CR}_i,$$
$$\boxed{\;z_i^\star = \Phi^{-1}(\mathrm{CR}_i), \qquad \mathrm{CR}_i = \dfrac{c_i^u}{c_i^u+c_i^o}\;}\tag{A.3}$$
the familiar newsvendor critical ratio, here derived rather than asserted. **What this changes in
the platform:** the `service_level`/`z_matrix` cells of §IV.4 can be **prefilled** from Eq. A.3
using item-master fields already collected (`materials.cost`, `products.sell_price`,
`holding_cost_pct`) — with the provenance badge (§II.6) reading exactly "$z=\Phi^{-1}(c^u/(c^u+c^o))$,
$c^u=\ldots$, $c^o=\ldots$" — instead of the ABC-XYZ table's current hand-set percentages
(80–99.5%, chosen by convention, §III.0). ABC-XYZ **segmentation** (which items get high vs. low
targets) remains valuable as a *tractable proxy* for $\mathrm{CR}_i$ when per-item margin data is
sparse; Eq. A.3 is offered as the **exact** prefill precedence ahead of it once the fields exist
(§II.6's precedence chain gains a rung: user edit ≻ preset ≻ **cost-optimal $z^\star$ (Eq. A.3)** ≻
ABC-XYZ table default ≻ registry default). This is additive, not a replacement: projects without
clean margin data keep the ABC-XYZ table exactly as implemented today.

**A.6 Toward exact $(s,S)$ optimality — state of the art, honestly scoped.** The formulas above
size a *given* control-rule family (min-max, (R,Q), base-stock) well; they do not claim the family
itself is cost-optimal in the strict dynamic-programming sense. Two classical results bound what
"optimal" can mean here, stated for completeness and to keep the roadmap honest:
(i) **Scarf (1960)**: under a fixed order cost $A$, linear holding/shortage costs, and i.i.d.
period demand, the $K$-convexity of the optimal cost-to-go function proves an $(s,S)$-type policy
*is* the optimal policy form for the finite-horizon dynamic lot-size problem — the reason $(s,S)$,
not an arbitrary rule, is the right family to offer, independent of ALX precedent.
(ii) **Zheng & Federgruen (1991)** give an $O(S-s)$ exact algorithm computing the long-run-average-
cost-minimizing *stationary* $(s,S)$ pair (superseding the EOQ-based heuristic $Q\approx\sqrt{2A\bar D/hc}$,
$s\approx R$ used here and, per §III.15, by ALX). **Status:** SureSuite today uses the same
industry-standard heuristic sizing as ALX (EOQ-based $Q$/(R,Q); newsvendor $z$ for $s$, now derived
in Eq. A.3 rather than asserted); the Zheng–Federgruen exact recursion is named here as a **future
P-P.1 "optimal" variant** candidate (Appendix A, roadmap-tracked, not built) — flagged honestly
rather than claimed. §III.11's MRP $\mathrm{SS}$ parameter and §IV.4's methods must use the *same*
Eq. A.1–A.3 pipeline (this closes a real inconsistency: the prior text left MRP's $\mathrm{SS}$ as
a free-standing parameter with no stated sizing method, breaking the "every parameter has one
precise definition" requirement — it is now explicitly "sized by §IV.4/§III.A like every other
policy's safety stock," §III.11 updated accordingly below).

**A.7 (R,Q) joint optimization (Hadley–Whitin iterative procedure) — the rigorous target for
`rop_q_quantity`.** Where III.3 states $Q$ as a user-set or MOQ-floored input, the operations-
research-optimal joint choice of $(Q,R)$ minimizing expected ordering + holding + backorder cost is
the classical iterative scheme (Hadley & Whitin 1963; Silver, Pyke & Peterson 1998; Zipkin 2000
Ch. 6), stated here as the rigorous derivation available to size the Excel-preset default:
1. Initialize $Q_0=\mathrm{EOQ}_i=\sqrt{2A_i\bar D_i/(h_ic_i)}$ (minimizer of ordering-plus-holding
   cost $C(Q)=A\bar D/Q + hcQ/2$, from $C'(Q)=0$).
2. Given $Q_k$, solve for $R_k$ from $\Phi(z_k) = 1 - Q_kh_ic_i/(\pi_i\bar D_i)$ (balances marginal
   holding cost of raising $R$ against marginal backorder-cost reduction, $\pi_i$ the backorder
   penalty), $R_k=\bar L_i\bar D_i+z_k\sigma_{X_i}$.
3. Given $R_k$, update $Q_{k+1}=\sqrt{2\bar D_i\big(A_i+\pi_i\,\sigma_{X_i}\psi(z_k)\big)/(h_ic_i)}$
   (EOQ corrected for the expected backorder cost the current $R_k$ leaves uncovered).
4. Repeat 2–3 to convergence (provably converges in 2–3 iterations for realistic cost ratios —
   Hadley & Whitin 1963 Thm. 4-1).
This is named here as the derivation an implementer should follow when III.3's engine gains
automatic $Q$/$R$ sizing (today `rop_q_quantity` is user-entered or MOQ-floored, §III.3) — offered
as the rigorous prefill target, not implemented as new engine behavior in this document.

**A.8 Assumption ledger (every assumption named once, referenced by ID).**

| ID | Assumption | Where used | Failure mode if violated |
|---|---|---|---|
| A-i | $D_{i,t}$ i.i.d. across weeks, no autocorrelation/seasonality in the DLT window | A.1–A.5 | Understated $\sigma_{X_i}$ under positive autocorrelation; §IV.5's Holt-Winters seasonal forecast should replace $\bar D_i$ with the seasonal mean when active |
| A-ii | $L_i \perp D_{i,t}$ | A.1–A.2 | Rare in practice for weekly buckets (disruption-correlated lead-time/demand spikes are the exception, handled as explicit disruption propagation, §Disruptions below, not folded into A.1) |
| A-iii | Normal approximation for $X_i$ | A.3–A.5 | Breaks for intermittent demand (small $\bar D_i$, many zeros) — mitigated by the V&V pipeline's simulated-vs-analytical check (§9.5), not by a different closed form in v1 |
| A-iv | Single-echelon reorder (no multi-echelon risk-pooling correction) | all of §III | Correct for the platform's current single-plant, three-echelon scope (§2.4); a DC echelon (Phase E) would need the Clark–Scarf multi-echelon correction, out of scope until then |

### III.0-bis — The `inventory_control` engine parameters (ground truth for III.1–III.7)

**This is the single, load-bearing correction §III.1–III.7 needed at the app level.** §III.1–III.5
are not four separate engine objects — they are **one** registered policy,
`id: inventory_control`, `catalog_ref: P-P.1`, with **one** Pydantic `Params` schema
(`InventoryControlParams`), selected by its `policy_type` enum. This is the literal content of
`src/lib/policies/registry.generated.json` (extracted verbatim below, not paraphrased — this is
what the grid actually renders today):

| Field | Type | Unit | Range / enum | Default | Scope | Meaning |
|---|---|---|---|---|---|---|
| `policy_type` | enum | — | `min_max`, `base_stock`, `rop_q`, `periodic` | `min_max` | M (per material) | selects III.1/III.4/III.3/III.5 below |
| `coverage_weeks` | `ModeStrip` {`nominal`,`alert`,`crisis`} | weeks | each in $[0,26]$ | `{8,10,12}` | G/M | $\kappa$ — cover beyond lead time, added to $S$; **crisis** value applies while any disruption is firm-visible ($\phi_t=1$, §D.2 Channel 2), **alert** is reserved pending P-S.4 (not yet switched to) |
| `review_cadence_weeks` | enum (int) | weeks | $\{1,2,4\}$ | 1 | G | perpetual-review interval for `min_max` (§II.5's $\rho_t$, generalized from every-week to every-$k$-weeks) |
| `rop_q_quantity` | number \| null | units | $>0$ | `null` | M | fixed lot $Q$ for `policy_type=rop_q`; `null` ⇒ engine floors to MOQ only |
| `periodic_review_weeks` | integer | weeks | $[1,13]$ | 4 | G | review period $T$ for `policy_type=periodic` |

**The correction this table forces onto §III.1's math.** There is **no `s` or `S` field** in this
schema — under today's sole implemented basis (Days-of-supply, §II.4), $s,S$ are *computed* at
PH-70 from `coverage_weeks` and live demand/lead-time data
($s=\bar D_iL_i,\ S=\bar D_i(L_i+\kappa)$, §III.1 below), **not typed by the user**. Presenting
"$s,S$" as the row's editable parameters (as the prior revision's table did) describes the
**Quantity basis** — §II.4's other basis, marked ✚, not yet a registered field anywhere in this
list. This is a real, previously undocumented gap between the math notation and the actual grid:
today, editing a min-max row means editing the $\kappa$ ModeStrip, and the grid must show $s,S$ as
**computed, read-only** preview values (with a provenance note: "$s=\bar D_iL_i$"), not as input
boxes, until Quantity basis ships a real `s_absolute`/`S_absolute` field pair to the registry. §III.1
below is restated with this distinction explicit.

### III.1 Min-max policy (s, S) ✅ (`policy_type=min_max`)

- **Purpose.** Reorder when position falls below $s$; raise it to $S$ (the classic (s,S) rule).
- **Inputs.** *Sets:* item $i$ at facility $f$. *Parameters (app-wise, per III.0-bis):* the user
  sets `coverage_weeks` ($\kappa$, a ModeStrip); $s,S$ are **derived**, not entered, under today's
  Days-of-supply basis:
  $$s_{i,t}=\bar D_i L_i, \qquad S_{i,t}=\bar D_i(L_i+\kappa),$$
  where $\bar D_i$ is `material_demand` (PH-10's live projection, not a static field) and $L_i$ is
  the primary link's lead time. *State/data read:* $\mathrm{IP}_{i,t}=I_{i,t}+\Pi_{i,t}-B_{i,t}$;
  MOQ $Q^{\min}_i$ (`materials.moq`); review gate $\rho_t$ (`review_cadence_weeks`).
- **Logic.** Trigger $\mathrm{IP}_{i,t}<s$; order to $S$:
  $$O_{i,t}=\rho_t\,(S-\mathrm{IP}_{i,t})^+\,\mathbf 1[\mathrm{IP}_{i,t}<s],\qquad O_{i,t}\leftarrow\max(O_{i,t},Q^{\min}_i)\ \text{if}\ O_{i,t}>0.$$
  Feasibility: $S>s\ge0$, guaranteed by construction under Days-of-supply ($\kappa\ge0$) — this is
  *why* the current implementation never needs to validate $S>s$ as a separate user-input
  constraint; it becomes a real constraint only once Quantity basis makes $s,S$ independently
  editable.
- **Outputs.** $O_{i,t}$ (`purchase_orders`, PH-80); levels $s_{i,t},S_{i,t}$ (`inventory_levels`,
  PH-70). KPI: holding-vs-fill trade-off.
- **UI & engine.** `id=inventory_control`, `policy_type=min_max` (III.0-bis table). **UI action
  item:** the grid's $s$/$S$ headline columns (§II.3) must render as computed read-only values with
  a provenance badge under the current basis, and the row's true editable field is `coverage_weeks`
  — today's grid must not offer $s,S$ as blank input boxes, since no field would receive the value.

### III.2 Min-max with safety stock (s, S, SS) ✚ (not yet a registered `policy_type`)

- **Purpose.** (s,S) with an explicit safety buffer added to both thresholds.
- **Inputs.** *Proposed field (naming convention matched to III.0-bis's schema style):* no new
  `policy_type` enum value needed — this is `policy_type=min_max` **plus** a non-null safety-stock
  source, i.e. it is what happens whenever `safety_stock_materials` (P-P.3, §IV.4) is *also*
  active on the same row: $s,S,\mathrm{SS}\ge0$, with $\mathrm{SS}$ supplied by P-P.3's `setup()`
  (§IV.4), never a manually-typed field — this document previously implied a hand-typed
  $\mathrm{SS}$, which does not exist as a schema field on either policy; correcting it here.
- **Logic.** $O_{i,t}=\rho_t\big((S+\mathrm{SS})-\mathrm{IP}_{i,t}\big)^+\mathbf 1[\mathrm{IP}_{i,t}<s+\mathrm{SS}]$
  — literally P-P.1's `_release` reading `ctx.level_s`/`ctx.level_S` **after** P-P.3's `on_phase`
  hook (priority 60) has added its buffer on top of P-P.1's (priority 50) — the exact
  hook-priority composition already implemented in `p_p3_safety_stock.py::on_phase`, not a
  separate policy type at all. **Correction to Appendix A:** this row should not be listed as a
  distinct ✚ policy type; it is the (`min_max`, `safety_stock_materials` active) **combination**,
  already ✅ end-to-end. Retained here only because ALX's own table presents it as one selectable
  type — §III.15 already notes this framing difference; restated as an app-level fix now.
- **Outputs.** $O_{i,t}$; raised levels $s+\mathrm{SS},\,S+\mathrm{SS}$. KPI: service ↑, holding ↑.
- **UI & engine.** ✅, as the composition above — no engine change needed; a UI-only fix (the grid
  should present "Min-max + Safety Stock" as one selectable row-preset that turns on both
  policies, exactly mirroring the actual two-hook composition instead of implying a phantom
  combined policy type).

### III.3 (R, Q) policy ✅ (`policy_type=rop_q`)

- **Purpose.** Reorder a **fixed lot** $Q$ whenever position drops below $R$.
- **Inputs.** *Parameters (registry field):* `rop_q_quantity` ($Q$, nullable — null floors to MOQ
  only); $R$ is **the same derived $s$** as III.1 (`coverage_weeks`-driven) — (R,Q) and min-max
  share the identical reorder-point derivation and differ only in the order-quantity rule, a fact
  the registry schema makes structurally obvious (one `Params` class) but the prior prose did not.
  *State read:* $\mathrm{IP}_{i,t}$, $\rho_t$.
- **Logic.** Current implementation (`p_p1_inventory_control.py::_release`, `rop_q` branch):
  $O_{i,t}=\rho_t\,\max(Q,Q^{\min}_i)\,\mathbf 1[\mathrm{IP}_{i,t}<R]$ — **single-lot**, not the
  multi-lot ceiling $Q\lceil(R-\mathrm{IP})^+/Q\rceil$ this document previously presented as the
  primary rule; the multi-lot ceiling is the ✚ refinement, not what ships. Corrected here so the
  equation matches the code exactly, not the textbook (R,Q) generalization.
- **Outputs.** $O_{i,t}$ (fixed-lot order). KPI: cycle-stock, order frequency.
- **UI & engine.** `id=inventory_control`, `policy_type=rop_q`, `rop_q_quantity`$=Q$ (engine floors
  to MOQ); multi-lot ceiling remains ✚.

### III.4 Base stock / order-up-to (S) ✅ (`policy_type=base_stock`)

- **Purpose.** Every review, top the position back up to $S$ (one-parameter order-up-to).
- **Inputs.** *Parameters:* none beyond III.0-bis's shared `coverage_weeks` — $S$ is the same
  derived value as III.1 ($S=\bar D_i(L_i+\kappa)$); there is no independent "$S$" field for this
  variant either. *State read:* $\mathrm{IP}_{i,t}$, $\rho_t\equiv1$ (perpetual — `base_stock`
  ignores `review_cadence_weeks`, checked every week per the code).
- **Logic.** $O_{i,t}=(S-\mathrm{IP}_{i,t})^+$ (equivalent to (s,S) with $s=S$).
- **Outputs.** $O_{i,t}$. KPI: low stockout for steady high-frequency demand.
- **UI & engine.** `id=inventory_control`, `policy_type=base_stock`.

### III.5 Periodic review (R, S) / (T, S) ✅ (`policy_type=periodic`)

- **Purpose.** Order-up-to $S$, but only at review epochs spaced $T$ weeks apart.
- **Inputs.** *Parameters:* `periodic_review_weeks` ($T\in[1,13]$, integer); $S$ derived as III.1/
  III.4. *State read:* $\mathrm{IP}_{i,t}$.
- **Logic.** $O_{i,t}=\mathbf 1[t\bmod T=0]\,(S-\mathrm{IP}_{i,t})^+$ (first-check phase $t_0=0$ in
  the current implementation — a `first_check_week` field does not yet exist on this schema;
  §II.1's grid column "First Check" is therefore presentation-only today, not yet wired to a
  registered field — flagged, not silently implied as working).
- **Outputs.** $O_{i,t}$. KPI: review-cadence vs stock trade-off.
- **UI & engine.** `id=inventory_control`, `policy_type=periodic`, `periodic_review_weeks`$=T$.

### III.6 Regular policy (fixed quantity, periodic) ✚ — proposed registry addition

- **Purpose.** Order a **fixed quantity every period, regardless of stock level** (push/heartbeat).
- **Inputs.** *Proposed fields (matching III.0-bis's naming/scope conventions exactly, so
  implementing this is literally "add a `policy_type=regular` branch plus these two fields to
  `InventoryControlParams`" — a one-plugin-file change per A2 of the blueprint):*

  | Field | Type | Unit | Range | Default | Scope |
  |---|---|---|---|---|---|
  | `regular_quantity` | number | units | $>0$ | — (required when `policy_type=regular`) | M |
  | *(reuses)* `periodic_review_weeks` | integer | weeks | $[1,13]$ | 4 | G |

  *State read:* none (open-loop).
- **Logic.** $O_{i,t}=\mathbf 1[t\bmod T=0]\,Q$, $Q=$`regular_quantity`. No feedback on position —
  stock can build or deplete.
- **Outputs.** $O_{i,t}$ (standing delivery). KPI: schedule adherence; risk of over/under-stock.
- **UI & engine.** ✚. *Necessity:* models fixed-schedule supply contracts / heartbeat feeds the
  position-triggered family cannot express.

### III.7 Regular policy with safety stock ✚ — proposed registry addition

- **Purpose.** Regular fixed-quantity ordering **plus** a corrective top-up on safety-level
  violation.
- **Inputs.** *Proposed field, extending III.6:* `regular_quantity` ($Q$) as above, plus SS
  supplied the **same way as III.2** — by an active `safety_stock_materials` policy on the row, not
  a hand-typed field (the same correction as III.2 applies here). *State read:* $\mathrm{IP}_{i,t}$.
- **Logic.** $O_{i,t}=\mathbf 1[t\bmod T=0]\big(Q+(\mathrm{SS}-\mathrm{IP}_{i,t})^+\big)$. **Worked
  example (ALX, confirmed in §III.15's source review):** $Q=5,\mathrm{SS}=0$, position $-7$ ⇒
  $O=5+(0-(-7))^+=12$ — so "Regular+SS, SS=0" ≠ "Regular".
- **Outputs.** $O_{i,t}$. KPI: schedule + shortfall protection.
- **UI & engine.** ✚. *Necessity:* the only policy combining a standing schedule with shortfall
  correction.

### III.8 Order on demand (lot-for-lot / pull) ✚

- **Purpose.** Hold **no** cycle stock; order exactly what incoming demand/orders require (pull).
- **Inputs.** *Parameters:* none. *State read:* gross requirement $G_{i,t}$ (customer orders for FG, or BoM-exploded production requirement for materials); $I_{i,t}$.
- **Logic.** $O_{i,t}=(G_{i,t}-I_{i,t})^+$ — lot-for-lot / JIT; decoupling point sits downstream.
- **Outputs.** $O_{i,t}$; zero target stock. KPI: minimal inventory, exposure to lead-time risk.
- **UI & engine.** ✚ (the MTO FG path already behaves this way). *Necessity:* the inventory side of make-to-order / JIT inbound.

### III.9 Unlimited inventory ✚

- **Purpose.** Model a facility/item **always available in any quantity** (idealized source).
- **Inputs.** *Parameters:* none. Initial Stock = ∞ (locked). *State read:* none.
- **Logic.** $O_{i,t}=0$; availability constraint removed ($I_{i,t}\equiv\infty$); **no holding cost accrues**; inventory statistics suppressed (∞ available, 0 peak).
- **Outputs.** none (no orders, no cost). KPI: inventory stats empty by design.
- **UI & engine.** ✚. *Necessity:* the explicit, visible way to say "this input never constrains" — replaces the silent infinite-supplier-capacity default (gap G4).

### III.10 No replenishment ✚

- **Purpose.** Never reorder; ship from Initial Stock until exhausted, then stock out.
- **Inputs.** *Parameters:* none. *State read:* $I_{i,t}$.
- **Logic.** $O_{i,t}\equiv0$; $I_{i,t}$ monotonically non-increasing.
- **Outputs.** none. KPI: depletion curve; stockout once exhausted.
- **UI & engine.** ✚. *Necessity:* distinct terminal policy; also expresses a supply-cut as a policy rather than an event.

### III.11 Material Requirements Planning (MRP, time-phased) ✚

**Purpose.** Plan replenishment by **projecting inventory forward** over a horizon and releasing
orders, lead-time-offset, to cover **net requirements** before a safety-stock violation. Unlike the
reactive (s,S) family, MRP is *forward-looking*. **Parameters.** $\mathrm{SS}$ (safety level) —
**sized by the same §IV.4/§III.A pipeline as every other policy's buffer** (Eq. A.1's
$\sigma_{X_i}$, a §IV.4 classification's $z(\alpha)$, optionally the cost-optimal $z^\star$ of
Eq. A.3), never a free-standing number: MRP is a different *replenishment trigger* (forward
projection vs. reactive threshold), not a different *buffer-sizing method* — this closes the
inconsistency in the prior text, which left $\mathrm{SS}$ undefined as to source. Planning horizon
$N$ weeks; uses gross requirements from BoM explosion of the production plan and
scheduled receipts. **Model (standard MRP recursion).** For future weeks $\tau=t,\dots,t+N$:
- Gross requirement $\mathrm{GR}_{i,\tau}$ = BoM-exploded demand for $i$ in week $\tau$
  (from the production plan / forecast).
- Scheduled receipts $\mathrm{SR}_{i,\tau}$ = already-ordered pipeline arriving in $\tau$.
- Projected on-hand: $\mathrm{POH}_{i,\tau} = \mathrm{POH}_{i,\tau-1} + \mathrm{SR}_{i,\tau} + \mathrm{POR}^{\text{recv}}_{i,\tau} - \mathrm{GR}_{i,\tau}$, with $\mathrm{POH}_{i,t-1}=I_{i,t}$.
- Net requirement when the buffer is breached:
  $\mathrm{NR}_{i,\tau} = \big(\mathrm{SS} + \mathrm{GR}_{i,\tau} - \mathrm{POH}_{i,\tau-1} - \mathrm{SR}_{i,\tau}\big)^+ .$
- **Planned order receipt** $\mathrm{POR}^{\text{recv}}_{i,\tau} = \mathrm{NR}_{i,\tau}$ (lot-for-lot;
  or lot-sized per §IV.2), and the **planned order release** is offset by lead time:
  $$O_{i,\,\tau - L_i} \mathrel{+}= \mathrm{POR}^{\text{recv}}_{i,\tau}.$$
The order **released this week** is $O_{i,t}$ from that offset schedule. **Interpretation.** Orders
are timed so receipts land exactly when projected on-hand would otherwise fall below $\mathrm{SS}$;
this is ALX's "detect possible safety-stock violation → size the order → back-date the release by
lead time." **Engine.** ✚. Maps naturally onto our PH-70 material-planning phase (which already
projects $D_m$ through the BoM) — MRP generalizes it from single-period to $N$-period look-ahead.
**Necessity.** Justified and important: it is the canonical dependent-demand replenishment method
and the one the user named explicitly; distinct from the reactive rules by being forward-projecting.

### III.12 Cross-dock ⛔ (needs DC echelon — Phase E)

**Purpose.** A facility that holds **no** inventory and **transfers** inbound directly to outbound.
**Model.** $I_{i,t}\equiv0$; $\text{outbound}_{i,t} = \text{inbound}_{i,t}$ (flow-through, subject to
handling capacity). **Status.** ⛔ under the current single-plant, three-echelon engine there is no
distribution-center node to cross-dock at; specified for completeness and activated with the
warehouse/DC echelon (blueprint Phase E, `P-W.x`). **Necessity.** Deferred with reason — not
droppable, but not executable until the echelon exists.

### III.13 Finished-goods specialization (MTS)

For finished products under make-to-stock, the same library applies with the target being the
**finished-goods order-up-to** $S^{FG}_p$ (engine `state.fg_target`), and "orders" being
**production releases** rather than purchase orders. Base-stock and Min-max are the common choices;
their $S$ is sized by the FG safety-stock policy (§IV.4, P-P.4). Make-to-order products use
**Order on demand** (§III.8) for FG (hold none; build to backlog).

### III.14 Inventory KPIs produced

Each inventory policy contributes to: average on-hand value $\sum_i c_i \bar I_i$; holding cost
$\sum_i c^h_i c_i \bar I_i / 52$ per week; fill rate (via downstream availability); stockout /
backorder frequency; peak inventory. These feed §PART IX accounting.

### III.15 — Benchmark: AnyLogistix, and where this library is more rigorous

This section is evidence-based: claims about ALX are drawn from its published help documentation
(`anylogistix.help/tables/policies.html`, `.../tables/inventory.html`,
`.../experiments/sse-calculation.html`) and its own public position statement on analytical safety
stock, not assumed.

**Feature parity, confirmed.** ALX's inventory policy library (Min-max, Min-max+SS, Regular,
Regular+SS, MRP) and its King safety-stock formula
($z\sqrt{(\mathrm{PC}/T_1)\sigma_D^2 + \sigma_{LT}^2\bar D^2}$, `PC`=performance cycle) match
§III.0's catalog and §III.A.2's Eq. A.1 term-for-term — this document's King derivation is the
*proof* of the formula ALX's help pages state without derivation. ALX's own worked example for
Regular+SS (order = demand forecast + safety stock − on-hand, e.g. $40+14-12=42$, rounded to the
lot size) is the identical structure to §III.7's $O=Q+(\mathrm{SS}-\mathrm{IP})^+$ (§III.7's own
worked example, $Q{=}5,\mathrm{SS}{=}0,\mathrm{IP}{=}-7\Rightarrow O{=}12$, is the same equation).
**No catalog gap exists here; the two systems agree on the operational rules.**

**Where this library goes further, and why it matters to a supply-chain researcher:**

| # | Gap in ALX's published methodology | What this document does instead |
|---|---|---|
| 1 | ALX states the King formula but does not publish its derivation or the independence assumption ($L\perp D$) it requires | §III.A.2 derives it from the law of total variance; §III.A.8 (A-ii) names the independence assumption explicitly, including its documented failure mode |
| 2 | ALX's help pages do not distinguish cycle service level (Type I) from fill rate (Type II); a user setting "service level = 95%" cannot know which they configured or what fill rate results | §III.A.4 defines both rigorously, proves the Eq. A.2 bridge via the standard normal loss function $\psi(z)$, and specifies (§A.4) that the platform's UI must label which type each field means and surface the implied Type II fill rate as a derived read-only value |
| 3 | ALX's *default* safety stock (when not manually set) is $\mathrm{Round}\big((\text{forecast}/\text{horizon})\times\text{days of safety stock}\big)$ — a deterministic days-of-supply heuristic that **ignores demand variance and lead-time variance entirely** | §IV.4's implemented `service_level`/`king`/`abc_xyz` methods are variance-aware by construction (Eqs. A.1–A.3); the platform's "fixed_days" method exists too (parity with ALX's default), but is never the *only* option, and its limitation (ignoring $\sigma_D,\sigma_L$) is now stated, not hidden |
| 4 | ALX offers no stated criterion for *which* service level to choose — the user picks a percentage by convention | §III.A.5 derives the cost-optimal $z^\star=\Phi^{-1}(c^u/(c^u+c^o))$ from the platform's own cost ledger fields (item cost, holding %, margin) — a computable, provenance-badged prefill (§II.6), not a convention |
| 5 | ALX's stated position (public materials) is that closed-form safety-stock formulas are insufficient for real networks, and that its Safety Stock Estimation (SSE) experiment — Monte-Carlo simulation with manual iteration toward a target service level — is the recommended path instead of analytics | The platform does **both**, formally linked: Eqs. A.1–A.3 give a derived analytical initialization (this section), and the model-credibility pipeline (blueprint §9.5) *statistically validates* the achieved service level against the target via KS/Welch-t tests over persisted replications, producing a hash-bound, reproducible **validated model card** — ALX's SSE experiment result is not persisted against a reproducibility hash and does not reconcile against a stated analytical target |
| 6 | ALX's GUI tables are the sole documentation of policy behavior — no published equations, no interaction graph, no machine-checked composition rules | Every policy here has a derived equation (§III.1–III.11, §III.A), a machine-checked interaction graph (§7 of the blueprint, `validate_hooks`-enforced at load time — provably free of read-before-write and write-conflict bugs), and content-addressed reproducibility (`policy_hash`, §8.4 of the blueprint) |

**Honest limitation, stated symmetrically (§10.3 of the blueprint carries the platform-wide
version).** ALX's Greenfield Analysis / network optimization (CPLEX-based) has no counterpart here
and is out of scope by design (simulation-only positioning, §14 open question 2). The comparison
above is scoped to the inventory/replenishment policy library specifically, where this document's
claim is narrow and evidence-backed: **published derivations, an explicit optimality criterion, a
named service-level distinction, and a closed analytical-then-simulated validation loop** — not a
larger policy catalog (§III.0's twelve types match ALX's five-to-six) and not a claim of network-
design parity.

### III.16 — UI note: headline columns vs. array editors for dynamic parameters

The "select a policy type, the parameter grid updates" interaction (§II.3) is already the
platform's design; this note evaluates one specific refinement — representing a row's dynamic
parameters as a pair of arrays (a *required-parameter* array and a *value* array) rather than
§II.3's headline-columns-plus-chip-list — against the "don't add a mechanism unless it is necessary"
rule (per the design brief governing this document).

- **For policies with a small, fixed parameter set per type** (min-max: $\{s,S\}$; (R,Q):
  $\{R,Q\}$; base-stock: $\{S\}$) — §II.3's existing headline-column design is strictly better than
  a name/value array: headline columns are independently sortable, filterable, and pasteable from
  Excel column-for-column (the platform's stated Excel-like requirement), and a value's *meaning*
  is fixed by its column header rather than by a row-local name string. An array-of-pairs would
  regress this for the exact case — *"for material A, user selects min and max"* — the brief cites
  as the motivating example; that case is already two headline columns ($s$, $S$), not an array.
  **No change recommended here; §II.3 is preserved.**
- **For policies whose parameter set is genuinely list-valued and variable-length** — §IV.4's
  ABC-XYZ $z$-matrix (9 named cells), §PART VIII's recovery playbook steps (an ordered sequence),
  §V's multimodal lane portfolio (≤3 lanes per link with per-lane mode/cost/transit) — a single
  scalar column cannot represent the parameter, and §II.3's "more… chip list" is read-mostly, not
  an editor. **This is where a array/table sub-editor is justified**: opened from the "more…" cell
  (not replacing headline columns, and not applied uniformly to every dynamic parameter), rendering
  exactly the registry's `key_domain`/array-typed schema entries (§6 of the blueprint, facet 5) as
  an editable table with add/remove rows — the same "generated from the registry, not hand-written"
  law (§II.2) that governs every other part of the parameter cell.
- **Recommendation.** Keep §II.3's hybrid design as the default (already specified, already the
  right mental model per A14 of the blueprint); add the array/table sub-editor as the registry-
  driven renderer specifically for parameters whose JSON-Schema type is an array or a keyed dict —
  determined by the schema, not by a blanket policy. This is an additive refinement to an existing,
  correct design, not a redesign.

---

## PART III-D — Demand / order-generation policy library (customer side)

**Category decision.** For each *(customer, product)*: how customer orders are generated over
time — the exogenous driver of the entire simulation. The ALX "Demand table." Columns: Customer,
Product, Demand Type, Parameters, Time Period, Revenue, Down/Up Penalty, Currency, Expected Lead
Time, Min Split Ratio, Backorder Policy, Inclusion. **Notation:** an order places quantity $q$ at
week $\tau$; realized weekly demand $D_{p,c,t}=\sum_k q_k\mathbf 1[\tau_k=t]$; stochastic
$q\sim\mathcal D(\theta)$.

### III-D.1 Periodic demand ✅

- **Purpose.** A (fixed or stochastic) order every fixed interval.
- **Inputs.** *Sets:* customer $c$, product $p$. *Parameters:*

  | symbol | unit | range/enum | default | meaning |
  |---|---|---|---|---|
  | $T^{ord}$ | weeks | ≥1 | 1 | order interval |
  | $q$ | units or Dist | ≥0 | — | quantity per interval |
  | `first_occurrence` | enum | first_day \| next_day \| random | first_day | first order timing |

  *State/data read:* none (exogenous); uses **scenario start** $t_0$, not experiment start.
- **Logic.** Epochs $\tau_k=o_1+kT^{ord}$ with $o_1=0$ (first_day), $T^{ord}$ (next_day), or
  $\sim\mathrm{Unif}\{0,\dots,T^{ord}-1\}$ (random, SIM) / $\lfloor T^{ord}/2\rfloor$ (GFA/NO).
  Quantity $q_k=q$ or $q_k\sim\mathcal D$. $D_{p,c,t}=\sum_k q_k\mathbf 1[\tau_k=t]$. Schedule is
  anchored to $t_0$, so moving the experiment window does not shift it.
- **Outputs.** $D_{p,c,t}$ at PH-10 → fulfillment $F$, backlog $B$, lost sales $\Lambda$, KPIs.
- **UI & engine.** Demand table, Type = Periodic. ✅ weekly draw; interval scheduling ✚.

### III-D.2 Periodic demand with first occurrence ✚

- **Purpose.** As III-D.1 but the first order is pinned to calendar week $\tau_0$.
- **Inputs.** III-D.1 parameters + `first_occurrence_week` $\tau_0$.
- **Logic.** $D_{p,c,t}=0$ for $t<\tau_0$; epochs $\tau_k=\tau_0+kT^{ord}$.
- **Outputs / UI.** As III-D.1; Type = Periodic-with-first-occurrence. ✚.

### III-D.3 Historic demand ✅ (empirical replay)

- **Purpose.** Replay an exact recorded series (CRM/orders).
- **Inputs.** Series $\{(w_j,q_j)\}$; Total-Q $=\sum_j q_j$.
- **Logic.** $D_{p,c,t}=\sum_j q_j\mathbf 1[w_j=t]$ — deterministic replay.
- **Outputs / UI.** Demand table, Type = Historic. ✅ (already consumed by V&V validation).

### III-D.4 Stochastic quantity (modifier on III-D.1/2)

- **Purpose.** Make per-interval quantity random.
- **Inputs.** $\mathcal D\in$ {uniform$[a,b]$, normal$(\mu,\sigma)$, triangular$(a,b,c)$,
  triangularAV$(\bar D,\mathrm{CV})$, poisson$(\lambda)$, negbin$(\mu,k)$}.
- **Logic.** Per epoch $q_k\sim\mathcal D$. Aggregate (GFA/NO) per-period demand $=\mathbb
  E[\mathcal D]\times(\text{intervals in period})$; e.g. 10-day interval, Jan 31 days ⇒ 3.1
  intervals ⇒ $\bar q\times3.1$. TriangularAV maps $(\bar D,\mathrm{CV})\to(a,b,c)$.
- **Outputs / UI.** Same $D_{p,c,t}$ channel; ✅ (triangularAV/poisson/negbin/normal implemented).

### III-D.5 Demand-table economic & service columns (per row)

Per-row attributes with precise math (not policy types):
- **Revenue override** $u_{p,c}$: per-customer price; overrides product $u_p$. Currency `currency`.
- **Down/Up penalty** on demanded $Q$, delivered $F$: $\text{penalty}=\pi^-(Q-F)^+ + \pi^+(F-Q)^+$.
  **$\pi=0$ ⇒ HARD constraint** (met exactly / not exceeded); else soft (deviation penalized).
- **Expected Lead Time** $\mathrm{ELT}_{p,c}$ (wk): drives the ELT service-level KPI (share of a
  customer's orders received within $\mathrm{ELT}$).
- **Minimum Split Ratio** $\mu\in(0,1]$: partial shipment, each part $\ge\mu Q$; default ship-complete.
- **Backorder Policy**: Not-Allowed → order dropped ($\Lambda\mathrel+=$ unmet, Dropped-orders);
  Allowed-Total → order waits ($B\mathrel+=$ unmet).
- **Inclusion**: include/exclude the row.

---

## PART IV — Plant-side policy libraries

Parts IV–VI were compressed relative to Part III's per-policy template in the prior revision —
an inconsistency with §PART 0's own rule ("every policy... identical structure... no policy
described in prose alone"). This revision brings every policy in §IV–§VI to the same template and
the same derivation standard as §III: Purpose → Inputs (sets, parameters, state read) → Logic
(equations) → Outputs → UI & engine, plus a **§X.A mathematical foundation** subsection per
category deriving the constants the policies use, exactly as §III.A does for inventory.

### IV.1 Sourcing / Procurement

**Decision governed.** For each *(plant, material)*: which supplier(s) receive the material's
replenishment order $O_{m,t}$ (produced by the inventory policy, §III), in what split.
**Notation.** Links $\ell=(s,m)\in\mathcal L_m$; unit cost $c_\ell$; lead time $L_\ell$; supplier
disruption (Bernoulli, per week) probability $\rho_s$; reliability $r_s=1-\rho_s$; split weight
$w_{m,s}\in[0,1]$, $\sum_{s}w_{m,s}=1$. **Timing & quantity are not sourcing decisions** — timing
is the inventory review gate $\rho_t$ (§II.5), quantity is $O_{m,t}$ (§III); sourcing sets only the
split $w_{m,s}$, so $O_{\ell,t}=w_{m,s}O_{m,t}$ and $\sum_{\ell\in\mathcal L_m}O_{\ell,t}=O_{m,t}$
identically for every policy below (a conservation constraint every split rule must satisfy).

1. **Single sourcing (P-S.x split-rule) ✅.** *Purpose:* minimize procurement cost; no
   diversification. *Logic:* $s^\star=\arg\min_{s:(s,m)\in\mathcal L_m} c_{s,m}$;
   $w_{m,s^\star}=1$, else $0$. *Outputs:* $O_{\ell,t}$ on the single link. *Feasibility:* requires
   $|\mathcal L_m|\ge1$. This is §IV.1.A's Eq. B.1 at $\lambda=0$ (no risk aversion) — not an
   independent rule, a boundary case of the general split (below).
2. **Multi-sourcing, fixed split (`P-S.2`) ✅.** *Purpose:* standing risk diversification.
   *Parameters:* $w_{m,s}$ per supplier, floor `min_share_pct`. *Logic:*
   $w_{m,s}\ge\text{min\_share\_pct}$ for every active $s$; $O_{\ell,t}=w_{m,s}O_{m,t}$.
   *Outputs:* split orders; the cost delta vs. single-sourcing
   $\sum_s w_{m,s}(c_{s,m}-c_{s^\star,m})O_{m,t}$ is logged to $\mathcal C^{res}$ as the
   diversification premium. *State read:* none beyond $O_{m,t}$.
3. **Primary + backup, contingent (`P-S.1`) ✅.** *Purpose:* pay nothing while nominal; reroute
   only when the disruption is *firm-visible*. *Parameters:* backup selection rule
   ($\min$ cost / $\min$ lead time / reliability), `cooldown_weeks`. *Logic:* let
   $\phi_{s,t}=\mathbf 1[s\in\text{visible\_disrupted\_suppliers}(t)]$ (§Disruptions below, Eq. D.3
   — the exact predicate the engine evaluates, `context.py::visible_disrupted_suppliers`).
   $w_{m,s^\star_{\text{primary}}}=1-\phi_{s^\star_{\text{primary}},t}$;
   $w_{m,s^\star_{\text{backup}}}=\phi_{s^\star_{\text{primary}},t}$, held through
   `cooldown_weeks` after $\phi$ returns to 0 (prevents thrashing). *Outputs:* the reroute
   decision is a KPI event (time-to-switch) in addition to the split orders.
4. **Ranked selection ✅.** *Purpose:* like single-sourcing, but the rank is **re-evaluated every
   period** against a live criterion (cost/lead-time/reliability), so an event that changes a
   link's effective cost or lead time can change $s^\star$ without a contingent-backup rule firing.
   *Logic:* $s^\star_t=\arg\text{best}_{s}\ \kappa(c_{s,m},L_{s,m},r_s)$ for the chosen criterion
   $\kappa$; $w_{m,s^\star_t}=1$. *Distinction from (1):* (1) is static (computed once from cost);
   (4) is dynamic (recomputed from live, possibly disrupted, link state each period).
5. **Capacity-proportional ✚.** *Purpose:* balance order flow against each supplier's physical
   throughput, avoiding queueing at any one link. *Logic:*
   $w_{m,s}=K_s\big/\sum_{s'\in\mathcal L_m}K_{s'}$ (P-S.5's `capacity_per_week`). *Necessity:*
   the natural complement to §IV.6's finite-capacity supplier model — without it, a fixed split
   (2) can route more volume to a link than its capacity supports, manufacturing the exact
   congestion §IV.6.A analyzes.
6. **Tiered quota with floors ✚.** *Purpose:* contractual minimum-volume commitments layered under
   a preference order. *Logic:* fill floors $w_{m,s}\ge f_s$ first (contractual minimums), then
   allocate the remainder by preference rank; $\sum_s f_s\le1$ is a load-time feasibility check
   (`feasibility()`, facet 9).

**IV.1.B — Engine parameters (registry ground truth) and an app-level correction to the numbered
list above.** Of the six entries, only **two are registered policies today**: P-S.1
(`backup_supplier`) and P-S.2 (`proactive_multi_sourcing`); P-S.3 (`capacity_reservation`) is
registered but 🧩 planned (raises `PolicyNotImplementedError`); items 4/5/6 (ranked selection,
capacity-proportional, tiered quota) **do not exist as registry entries at all** — they are ✚
proposals with no `catalog_ref` yet, restated here rather than left implicitly equivalent to (2).
**Item 1 (single sourcing) is not a policy either** — it is the engine's unconditional default:
every material routes to `m.primary_link` (`p_p1_inventory_control.py::_release`) unless P-S.1 or
P-S.2 is active on that row. Per the blueprint's own `.0`-suffix convention for promoted defaults
(§4.4/§4.2 of `next-gen-platform-design.md`), item 1 should be named **`P-S.0 primary_link_routing`**
so it is a visible, hashed bundle entry rather than an unnamed absence — this is a real gap this
document should not paper over: "single sourcing" is currently *invisible* in the UI (no row shows
it as an active choice), which is exactly the "no hidden behavior" violation §4.4 of the blueprint
exists to prevent.

| Policy | Field | Type | Unit | Range / enum | Default | Scope |
|---|---|---|---|---|---|---|
| P-S.1 `backup_supplier` | `selection_rule` | enum | — | `min_cost`,`min_leadtime`,`reliability` | `min_cost` | G |
| | `activation_trigger` | enum | — | `on_disruption`,`coverage_threshold` | `on_disruption` | G |
| | `coverage_threshold_weeks` | number | weeks-of-supply | $[0.5,26]$ | 4.0 | G — only used when `activation_trigger=coverage_threshold` |
| | `cooldown_weeks` | integer | weeks | $[0,8]$ | 0 | G |
| | `backup_lead_time_weeks` | integer \| null | weeks | $[1,26]$ | `null` (⇒ backup link's own LT) | SM |
| | `enabled_materials` | `"all_multi_sourced"` \| id list | — | — | `all_multi_sourced` | M |
| P-S.2 `proactive_multi_sourcing` | `weights` | dict (material→supplier→%) | share % | shares sum to 100 per material | `{}` (⇒ equal split) | SM |
| | `min_share_pct` | number | % | $[5,50]$ | 20.0 | G |
| | `rebalance_trigger` | enum | — | `none`,`disruption` | `none` | G |
| | `secondary_premium` | number | €/unit | $\ge0$ | 0.0 | SM |
| P-S.3 `capacity_reservation` 🧩 | `reserved_capacity` | number (required) | units/wk | $\ge0$ | — | SM |
| | `reservation_fee` | number (required) | €/unit/wk | $>0$ | — | SM |
| | `call_leadtime_weeks` | integer | weeks | $[0,4]$ | 0 | SM |
| P-S.4 `early_warning_failover` | `detection_lag_weeks` | integer | weeks | $[0,4]$ | 1 | G/S |
| | `monitoring_cost` | number | €/yr | $\ge0$ | 0.0 | G |

**Correction this table forces on §III.2/III.7's cross-reference and on §IV.1's item (3):** P-S.1's
actual reroute predicate is **not** bare $\phi_{s,t}$ — it is gated by `activation_trigger`, and
under the (non-default) `coverage_threshold` mode the trigger is
$\mathrm{IP}_{i,t}/\bar D_i < $ `coverage_threshold_weeks`, a position-coverage test, **not**
disruption-visibility at all; the two `activation_trigger` values are two different policies
sharing one selection mechanism, worth distinguishing explicitly since only one of them uses §D.2's
Channel 2 at all.

**IV.1.A — Mathematical foundation: the optimal sourcing split under disruption risk.** Policies
1–4 are all instances of one optimization the platform can state explicitly, generalizing the
newsvendor apparatus of §III.A.5 from *quantity* risk to *supplier* risk. Model each supplier's
weekly disruption state as i.i.d. Bernoulli($\rho_s$) (a stated, simplifying independence
assumption — correlated disruptions, e.g. a shared upstream tier-2 supplier, are out of scope for
the current three-echelon model, §2.4). For a split $w=(w_s)_{s\in\mathcal L_m}$, the **expected**
and **variance** of the shortfall on an order of size $O_{m,t}$ are
$$\mathbb E[\text{shortfall}] = O_{m,t}\sum_s w_s\rho_s, \qquad \mathrm{Var}(\text{shortfall}) = O_{m,t}^2\sum_s w_s^2\,\rho_s(1-\rho_s)\tag{B.1}$$
(the second line: $\mathrm{Var}\!\left(\sum_s w_sO_{m,t}\mathbb 1_s\right)=O_{m,t}^2\sum_sw_s^2\mathrm{Var}(\mathbb 1_s)$
under independence — the same portfolio-variance identity Markowitz uses for asset risk, applied
here to supply risk; the analogy is structural, not decorative — diversifying across suppliers
with **uncorrelated** disruption risk reduces $\mathrm{Var}(\text{shortfall})$ by the same
$1/n$-type mechanism a diversified asset portfolio reduces return variance). The cost-risk
trade-off is
$$\min_{w}\ \sum_s w_s c_{s,m}O_{m,t} \;+\; c^u_m\,\mathbb E[\text{shortfall}] \;+\;\lambda\,\mathrm{Var}(\text{shortfall}), \quad \text{s.t. } \sum_s w_s=1,\ w_s\ge0,\tag{B.2}$$
reusing $c^u_m$ — the **same** underage cost derived in Eq. A.3 — so a project that has priced
its stockout cost for safety-stock sizing gets a *consistent* sourcing-split objective for free,
rather than a second, disconnected risk parameter. For the two-supplier case ($w_1=w,\,w_2=1-w$),
Eq. B.2 is a quadratic in $w$ with closed-form minimizer
$$w^\star = \frac{(c_{2,m}-c_{1,m})+c^u_m(\rho_2-\rho_1)+2\lambda\rho_2(1-\rho_2)}{2\lambda\big[\rho_1(1-\rho_1)+\rho_2(1-\rho_2)\big]},\ \ \text{clipped to } [0,1].\tag{B.3}$$
**Reading Eq. B.3:** $w^\star\to1$ (single-source supplier 1) as $\lambda\to0$ (risk-neutral —
recovers policy (1)); $w^\star$ moves toward the capacity/reliability-weighted interior point as
$\lambda$ grows — the diversified regime policies (2)/(5)/(6) approximate with hand-set weights.
**Status:** offered as the derivation behind a future `P-S.2` *auto-split* variant (roadmap-tracked
like §III.A.6's Zheng–Federgruen note, not built); today's `weights` remain user/preset-set. This
is exactly the OR argument ALX's GUI-only split entry cannot make (§III.15's benchmark applies
identically here: a split percentage typed into a table vs. a split derived from stated cost and
risk parameters).

### IV.2 Production

**IV.2.a Build discipline (`P-P.0`, promoted default) ✅.** *Purpose:* decide how much to produce
this week. *Logic:* MTS: $x_{p,t}=(S^{FG}_p-\mathrm{IP}^{FG}_{p,t})^+$; MTO (default):
$x_{p,t}=D_{p,t}+B_{p,t}$; ATO ⛔ reserved (§5.8 of the blueprint — needs due-date promising, out
of MTS/MTO scope). *Outputs:* both are clipped at PH-50 by capacity and material feasibility —
$g_{p,t}=\min\!\big(x_{p,t},\,\mathrm{cap}_{p,t},\,\min_m\lfloor I_{m,t}/b_{p,m}\rfloor\big)$
(the BoM-feasibility floor over incidence coefficients $b_{p,m}$) — this is Eq. 8/9 of the engine
reference, named as the P-P.0 mechanic here so it is visible in the catalog rather than only in
code.

**IV.2.b Lot sizing (`P-P.2`) 🧩.**

| Policy | Order quantity | Derivation |
|---|---|---|
| Lot-for-lot ✅ | $Q=$ net requirement, every period | no setup-cost amortization; correct when $A\approx0$ |
| Fixed-$Q$ | user-set constant | contractual pack size / MOQ multiple |
| **EOQ** | $Q^\ast=\sqrt{2A\bar D/(hc)}$ | minimizes $C(Q)=A\bar D/Q + hcQ/2$; $C'(Q)=-A\bar D/Q^2+hc/2=0\Rightarrow Q^{\ast2}=2A\bar D/(hc)$ — the classical Harris (1913) EOQ, re-derived here (§III.A.7 uses it as step 1 of the (R,Q) iteration) |
| **EPQ** | $Q^\ast_{\text{EPQ}}=Q^\ast_{\text{EOQ}}/\sqrt{1-\bar D/P}$ | finite production rate $P>\bar D$: inventory builds at rate $P-\bar D$ during the run, so average inventory is $(Q/2)(1-\bar D/P)$, not $Q/2$; substituting into $C(Q)$ and repeating the EOQ derivation gives the $1/\sqrt{1-\bar D/P}$ correction |
| **POQ** | $T^\ast=Q^\ast/\bar D$ (periods of cover) | direct restatement of the EOQ quantity as a time-between-orders, for contexts where a review *period* is the natural control (pairs with §II.5's periodic review) |

**Engine parameters (registry ground truth, `id: lot_sizing`, `catalog_ref: P-P.2`, 🧩 planned —
registered schema, raises `PolicyNotImplementedError` until built).**

| Field | Type | Unit | Range / enum | Default | Scope |
|---|---|---|---|---|---|
| `rule` | enum | — | `lot_for_lot`,`fixed_qty`,`epq` | `lot_for_lot` | M |
| `fixed_qty` | number \| null | units | $>0$ | `null` | M — `rule=fixed_qty`, $\ge$ MOQ enforced |
| `epq_setup_cost` | number \| null | €/setup | $>0$ | `null` | M — `rule=epq`, feeds $A$ in the EOQ/EPQ table above |

**Correction this table forces:** the table's POQ row has no corresponding `rule` enum value —
POQ is a *presentation* of the EOQ quantity as a period, not a distinct engine rule; if it should
be independently selectable it needs a fourth `rule` value, not just a derived display, flagged
as a small open item rather than assumed already covered by `rule=epq`.

**IV.2.c Dispatching / scarcity ordering (`P-P.11`) ✚.** *Purpose:* when material or capacity
binds ($g_{p,t}<x_{p,t}$ for multiple products/orders), decide sequencing of the weekly production
release — this is intra-week priority among competing demands, not sub-weekly scheduling (⛔
below the weekly-bucket boundary, §5.8, per the platform's stated fidelity limit). *Rules and their
citable optimality properties* (classical single-machine scheduling theory; the properties hold at
the fidelity of "which backlog entries get this week's constrained output," the level at which the
engine actually applies them):

- **FIFO** — arrival order; no optimality claim, chosen for perceived fairness/simplicity.
- **EDD (earliest due date)** — minimizes **maximum lateness** $L_{\max}=\max_j(C_j-d_j)$ among
  all sequences, for a single resource with deterministic processing times (Jackson's rule, 1955).
- **SPT (shortest processing time)** — minimizes **mean flow time** $\frac1n\sum_jC_j$ among all
  sequences (Smith's rule / the classical SPT-optimality result, Conway, Maxwell & Miller 1967).
- **Critical Ratio** $\mathrm{CR}_j=\dfrac{d_j-t}{\text{proc. time}_j}$ — a heuristic blend
  ($\mathrm{CR}_j<1$ signals already-late; ascending-$\mathrm{CR}_j$ ordering approximates EDD when
  processing times are similar and approximates SPT when due dates are similar), used in practice
  because it degrades gracefully when neither pure objective dominates.

**Necessity check (per the brief's "don't add speculative features" rule):** FIFO/EDD/SPT/CR are
retained because each has a *distinct, provable* optimality property under a *different* business
objective (fairness / due-date adherence / throughput / blended) — a real choice, not four labels
for the same thing.

### IV.3 Capacity

**Base capacity $O_p$ ✅.** The plant's nominal weekly production capacity (`products.production_capacity`,
§8.1 of the blueprint — required, not defaulted, once G4 closes).

**Overtime (`P-P.5`) ✅.** *Purpose:* temporarily raise capacity at a cost premium when doing so is
profitable. *Parameters:* $\bar\omega$ (max overtime multiplier), premium $\pi^o$ (fraction of
unit production cost). *Logic (mechanism):*
$$\omega_{p,t}=\min\!\big((\bar\omega-1)O_p,\ (D_{p,t}+B_{p,t}-O_p)^+\big)\cdot\mathbf 1[\text{activation}],\qquad \text{cost}=\pi^o\,c^{\text{prod}}_p\,\omega_{p,t}.$$
*Logic (activation condition, derived — this was asserted as "revenue-positive" without a stated
formula in the prior text):* overtime is worth activating for the marginal unit iff the margin it
unlocks exceeds its premium cost:
$$\mathbf 1[\text{activation}] = \mathbf 1\big[\,\underbrace{u_p-c^{\text{BOM}}_p}_{\text{margin }m_p}\ >\ \pi^o\,c^{\text{prod}}_p\,\big]\tag{B.4}$$
— a marginal-cost condition (produce the extra unit iff its contribution exceeds its incremental
cost), the same economic logic as §III.A.5's newsvendor condition applied to a capacity decision
instead of an inventory one. **Inert when materials bind:** $\omega_{p,t}$ only helps if
$g_{p,t}=\min(x_{p,t},\mathrm{cap}_{p,t},\ldots)$ is capacity-clipped, not material-clipped — Eq.
B.4 is necessary but not sufficient; the engine's `feasibility()` states the material-binding
precondition explicitly.

**Engine parameters (registry ground truth, P-P.5 `short_term_capacity`, ✅ implemented).**

| Field | Type | Unit | Range / enum | Default | Scope |
|---|---|---|---|---|---|
| `activation` | enum | — | `revenue_positive`,`always_during_disruption` | `revenue_positive` | G — Eq. B.4 above is exactly the `revenue_positive` branch |
| `max_overtime_factor` | number | $\times O_p$ | $[1.0,2.0]$ | 1.5 | P — $\bar\omega$ |
| `overtime_premium_pct_of_price` | number | % of $u_p$ per overtime unit | $[1,25]$ | 5.0 | P — $\pi^o$ |

**Correction:** the premium is stated in the registry as a **percentage of the product's price**
$u_p$, not of unit production cost $c^{\text{prod}}_p$ as the prior text's Eq. B.4 wrote it —
correcting Eq. B.4's cost term: $\pi^o$ scales $u_p$, so the activation condition is properly
$m_p > \pi^o u_p$ (margin exceeds the premium-on-price cost), not $m_p>\pi^o c^{\text{prod}}_p$;
the qualitative marginal-cost argument is unchanged, only the base the percentage applies to.

**Standing capacity reserve (`P-P.6`) 🧩.** *Purpose:* pre-pay for a capacity buffer
$O_p(1+\gamma)$ so a disruption never has to activate overtime reactively.
**Engine parameters (registry ground truth, planned):** `reserve_factor` (number, $\times O_p$,
range $[0,0.5]$, default 0.2 — this is $\gamma$) and `standing_cost` (number, required, €/wk,
$\ge0$). *Economic
justification:* worth its premium $c^{\text{reserve}}_p$ (`standing_cost`) iff the **expected** avoided-stockout
value exceeds the certain standing cost: $\Pr[\text{disruption binds}]\cdot(\text{avoided
loss})\ge\gamma\,c^{\text{reserve}}_p$ — a strategic-horizon (pre-commitment) version of Eq. B.4's
operational-horizon condition; the two differ exactly in *when* the commitment is made (§4.1's
horizon axis), not in the underlying cost logic.

### IV.4 Safety stock (sizing methods that feed §III)

fixed-days $d\bar D_i$ ✅ | service-level $z(\alpha)\sigma_D\sqrt{L_i}$ ✅ | **King** $z(\alpha)\sqrt{L_i\sigma_D^2+\bar D_i^2\sigma_L^2}$ ✅ | **ABC-XYZ** 3×3 $z$-matrix ✅ (`P-P.3` materials, `P-P.4` FG revenue-ABC). Output $\mathrm{SS}_i$ is consumed by the inventory policy — a declared edge, not hidden. **Every formula here is Eq. A.1 of §III.A at a different $\sigma_L$** (service-level = deterministic-lead-time case; King = the general compound-variance case — proof in §III.A.2); every $z(\alpha)$ is a Type I cycle-service factor (§III.A.4), and its cost-optimal value is Eq. A.3 (§III.A.5) rather than a hand-picked convention.

**Engine parameters (registry ground truth).** Two distinct registered policies, not one — an
app-level distinction worth stating up front: P-P.3 governs **material** buffers (feeds III.1/
III.2's $\mathrm{SS}$ via the hook-priority composition of III.2), P-P.4 governs **finished-goods**
buffers (feeds `state.fg_target`, MTS only, ADR 0001) — they are not the same slot, have different
schemas, and a project can run one, the other, or both without conflict.

| Policy | Field | Type | Unit | Range / enum | Default | Scope |
|---|---|---|---|---|---|---|
| P-P.3 `safety_stock_materials` | `classification` | enum | — | `abc_xyz`,`uniform`,`fixed_days`,`king` | `abc_xyz` | G |
| | `z_matrix` | dict (9 cells `{A,B,C}×{X,Y,Z}`) | % service level | each $[80,99.9]$ | `{AX:99.5,AY:99,AZ:98,BX:98,BY:95,BZ:90,CX:95,CY:90,CZ:80}` | G — `classification=abc_xyz` |
| | `abc_breakpoints` | 2-tuple | cumulative value share | — | `(0.80,0.95)` | G |
| | `xyz_cv_breakpoints` | 2-tuple | demand CV | — | `(0.13,0.25)` | G |
| | `uniform_service_level` | number | % | $[80,99.9]$ | 95.0 | G — `classification=uniform` |
| | `fixed_days_cover` | number | days | $[0,84]$ | 14.0 | G — `classification=fixed_days` |
| P-P.4 `fg_safety_stock` | `sizing` | enum | — | `service_level`,`fixed_days`,`fixed_units` | `service_level` | P |
| | `service_level_pct` | number | % | $[80,99.9]$ | 95.0 | P — $z^{FG}_p$ |
| | `segmentation` | enum | — | `uniform`,`abc_by_revenue` | `uniform` | G — A/B/C get `service_level_pct`/$-2$pp/$-5$pp (floor 80) |
| | `fixed_days_cover` | number | days | $[0,12]$ | 2.0 | P — `sizing=fixed_days` |
| | `fixed_units` | number \| null | units | $\ge0$ | `null` | P — `sizing=fixed_units` |
| | `holding_cost_rate` | number | %/yr of COGS | $[5,50]$ | 20.0 | P — $h^{FG}_p$ |

**Correction this table forces on §III.A.5's Eq. A.3 prefill proposal:** P-P.3's `classification`
enum does **not** include a `cost_optimal` option — Eq. A.3's $z^\star$ is, correctly, proposed
there as a *future* addition to this exact enum (a fifth `classification` value,
e.g. `cost_optimal`, computed from `materials.cost`/`holding_cost_pct`/margin rather than typed),
not something already selectable; this table is the concrete registry change that proposal implies.

### IV.5 Forecasting (`P-F.0`/`P-F.1`, drives MRP, MTS targets, safety stock)

Every method below is specified with its exact update equation — not named only — because §III.A's
$\bar D_i,\sigma_{D_i}$ are read from whichever forecast is active, so an unspecified update
equation would silently break the "every symbol has one precise meaning" rule.

| Method | Update equation | Forecast $h$ steps ahead |
|---|---|---|
| Naive | $\hat D_{t+1}=D_t$ | $\hat D_{t+h}=D_t$ |
| Moving average ($k$) | $\hat D_{t+1}=\tfrac1k\sum_{u=0}^{k-1}D_{t-u}$ | same, rolled forward |
| **SES** ✅ | $\hat D_{t+1}=\alpha D_t+(1-\alpha)\hat D_t,\ \alpha\in(0,1]$ | $\hat D_{t+h}=\hat D_{t+1}$ (flat) |
| **Holt** (level+trend) | $l_t=\alpha D_t+(1-\alpha)(l_{t-1}+b_{t-1});\ \ b_t=\beta(l_t-l_{t-1})+(1-\beta)b_{t-1}$ | $\hat D_{t+h}=l_t+hb_t$ |
| **Holt-Winters** (level+trend+seasonal, period $M$) | $l_t=\alpha\frac{D_t}{s_{t-M}}+(1-\alpha)(l_{t-1}+b_{t-1});\ b_t=\beta(l_t-l_{t-1})+(1-\beta)b_{t-1};\ s_t=\gamma\frac{D_t}{l_t}+(1-\gamma)s_{t-M}$ | $\hat D_{t+h}=(l_t+hb_t)\,s_{t+h-M}$ |
| **Croston** (intermittent) | on nonzero-demand periods only: size $\hat z_t=\alpha D_t+(1-\alpha)\hat z_{t-1}$; inter-demand interval $\hat p_t=\alpha q_t+(1-\alpha)\hat p_{t-1}$ ($q_t$=periods since last nonzero) | $\hat D_{t+h}=\hat z_t/\hat p_t$ |

**On SES's optimality (a fact worth stating, not asserted elsewhere):** SES is the minimum-mean-
squared-error forecast for a demand process following an IMA(1,1) (integrated moving-average)
model — a classical result (Muth 1960); this is *why* SES, not an arbitrary smoother, is the
first-line method here and in essentially every commercial planning tool, ALX included.

**Croston's known bias (named, not silently inherited).** Croston's estimator is biased high; the
standard correction is the Syntetos–Boylan approximation
$\hat D^{SB}_{t+h}=(1-\alpha/2)\,\hat z_t/\hat p_t$ (Syntetos & Boylan 2005) — flagged here as the
rigorous refinement target for when Croston is implemented, not claimed as shipped.

**Error KPIs (already exposed).** Bias $=\frac1n\sum(\hat D-D)$; MAPE $=\frac1n\sum|\hat D-D|/D$;
RMSE $=\sqrt{\frac1n\sum(\hat D-D)^2}$. **Parameter selection.** $\alpha^\star,\beta^\star,\gamma^\star$
minimize in-sample SSE over the fitting window (grid search or Nelder–Mead) — standard practice,
stated so "how is $\alpha$ chosen" is never a hidden default.

### IV.6 Supplier capacity & lead-time models (mechanic → policy)

**Capacity (`P-S.5`) ✚.** infinite | finite-queue (orders wait in $\Xi_s$, `overflow_rule=queue`)
| finite-reject (`overflow_rule=reject`, logged as `lost_inbound_units`); shipped
$=\min(\Xi_{s,t},K_s)$.

**Lead time (`P-S.6`) ✚.** deterministic | stochastic (lognormal/gamma, `lead_time_cv` — this is
exactly $\mathrm{CV}^L_i$ of §III.A.1, feeding King's formula, Eq. A.1).

**IV.6.A — Mathematical foundation: congestion as endogenous lead time.** §7.2 of the blueprint
states qualitatively that "congestion in `state.queue` *is* endogenous lead-time extension"; here
is the closed-form estimate behind that claim, offered as an analytical cross-check (a prefill /
explainability aid, §II.6) alongside the engine's exact discrete-queue simulation, not a
replacement for it. Let $\lambda_s=\sum_{m:(s,m)\in\mathcal L}O_{m,t}$ (total weekly order volume
routed to supplier $s$) and utilization $\upsilon_s=\lambda_s/K_s$. By **Little's Law** (Little, 1961),
mean queue length and mean wait relate as $\mathbb E[\Xi_s]=\lambda_s\,\mathbb E[W_s]$; under the
standard M/M/1 approximation (Poisson order arrivals, exponential service — a stated,
simplifying assumption, not the engine's literal arrival process) the expected queueing delay is
$$\mathbb E[W_s] \approx \frac{\upsilon_s}{K_s(1-\upsilon_s)} \quad\text{(weeks)}, \qquad L_s^{\text{eff}} = L_s^{\text{nominal}} + \mathbb E[W_s].\tag{B.5}$$
**Reading Eq. B.5:** as $\upsilon_s\to1$ (demand approaches capacity), $\mathbb E[W_s]\to\infty$ — the
qualitative "congestion blows up lead time near saturation" behavior every finite-capacity
system exhibits, now with a specific functional form a user can sanity-check the simulated result
against. **Consumption:** feeds §IV.1's capacity-proportional split (policy 5) — routing more
volume to an already-high-$\upsilon_s$ supplier is exactly what Eq. B.5 says worsens effective lead
time, so policy 5 is the structural fix Eq. B.5 motivates, a genuine cross-policy interaction
worth stating explicitly (added to §7's interaction table as interaction 7a).

---

## PART V — Transportation policy library

**Decision governed.** For each *(lane)* or *(facility, item)*: mode, consolidation, dispatch
frequency, and expediting. **Prerequisite for modes:** lanes as first-class entities (gap G7);
today lane lead time folds into supplier lead time. **Notation.** Lane $\ell$ with mode-specific
cost $c_\ell$ and transit $L_\ell$; accumulated shipment-ready quantity $A_{\ell,t}$; dispatch
indicator $\delta_{\ell,t}\in\{0,1\}$.

1. **Single-mode (direct) ✅ (folded into supplier lead time today).** *Purpose:* the baseline —
   one mode per lane, fixed $L_\ell,c_\ell$. *Logic:* every shipment on $\ell$ incurs $c_\ell$ per
   unit and arrives $L_\ell$ weeks later; no decision to make. *Status:* today this is not a
   separate lane object (G7) — it is folded into the supplier link's `lead_time`/`unit_price`.
2. **Multimodal lane portfolio (`P-T.1`) 🧩 — prerequisite for 3/6/7 at full generality.**
   *Purpose:* represent up to 3 lanes per link, each a distinct mode with its own $(L,c,\text{capacity})$.
   *Logic:* a static split $\sum_\ell \theta_\ell=1$ blends transit and cost:
   $\bar L=\sum_\ell\theta_\ell L_\ell$, $\bar c=\sum_\ell\theta_\ell c_\ell$ in the deterministic
   case; the discrete case ships each unit on exactly one lane per the split shares. *Necessity:*
   every other transport policy that references "a faster mode" or "a cheaper mode" needs at least
   two lanes to choose between — this is why §5.3 of the blueprint flags it as the activation
   prerequisite.
3. **Mode shift (reactive) (`P-T.3`) 🧩.** *Purpose:* while a disruption is firm-visible
   ($\phi_t=1$, §Disruptions below), shift volume to a faster (costlier) lane. *Logic (the same
   marginal condition as expedite, generalized to a menu of lanes rather than a binary
   expedite/not):* shift to lane $\ell'$ iff $u_p^{\text{recovered}}(L_\ell-L_{\ell'}) > (c_{\ell'}-c_\ell)$
   — the value of the transit-time reduction, in recovered margin, exceeds its cost premium.
4. **Shipment consolidation (`P-T.5`) ✚.** *Purpose:* trade cycle time for freight economies of
   scale. *Logic:* dispatch when $A_{\ell,t}\ge\text{min\_fill}\cdot\text{capacity}_\ell$ **or**
   the accumulation window $W$ elapses, whichever first:
   $\delta_{\ell,t}=\mathbf 1\big[A_{\ell,t}\ge\text{min\_fill}\cdot\text{cap}_\ell\ \vee\ (t-t_{\text{last}})\ge W\big]$.
   *Optimality note:* this **quantity-or-time** form is not an arbitrary hybrid — it is the
   policy class the shipment-consolidation literature identifies as dominant over pure
   quantity-based or pure time-based triggers (Higginson & Bookbinder 1994, *"Policy
   recommendations for a shipment-consolidation program"*), because it bounds the worst case of
   each pure policy (a pure quantity trigger can wait arbitrarily long under low demand; a pure
   time trigger can dispatch a nearly-empty vehicle). §V's engine implementation already matches
   the literature-preferred form.
5. **Shipping frequency (`P-T.6`) ✚.** *Purpose:* the degenerate case of (4) with `min_fill=0` —
   dispatch on a fixed cadence regardless of fill, or purely on a quantity threshold with $W=\infty$.
   Kept as a distinct, simpler UI entry because most users reason in "every Monday" or "once we
   have a truckload" terms, not a joint threshold — same underlying trigger, a different default.
6. **Expedited shipments (`P-T.2`) ✅.** *Purpose:* while firm-visible disruption is active, pull
   in-transit units forward. *Logic:* for disrupted (or all) materials, advance delivery by one or
   more weeks at premium $\pi^{exp}c_m$ per unit, activated iff **revenue-positive**:
   $$\mathbf 1[\text{expedite}] = \mathbf 1\big[u_p^{\text{recovered}} > \pi^{exp}c_m\big]\tag{C.1}$$
   — the transport-side instance of the same marginal condition as Eq. B.4 (overtime) and Eq. A.3
   (safety stock): act iff the recovered margin exceeds the incremental cost. Three independent
   policies (P-P.5, P-T.2, and the sourcing-split logic of §IV.1) all reduce to variants of one
   economic rule — stated once here as the general pattern, so a reviewer sees it is one idea
   applied three times, not three unrelated heuristics.
7. **Lead-time hedging (`P-T.4`) 🧩 (not v1 priority).** *Purpose:* order earlier by a fixed
   buffer $h$ weeks, applied to items where a lead-time overrun is especially costly. *Logic:*
   equivalent to substituting $L_i\leftarrow L_i+h$ into every §III.A formula — a direct,
   already-derived application of §III.A, not a new mechanism.

**V.A — Engine parameters (registry ground truth).** Of the seven entries, four are registry
entries (P-T.1, P-T.2 ✅, P-T.3, P-T.4); **P-T.5 (consolidation) and P-T.6 (frequency) are not
registered at all** — not even as 🧩 planned schemas — a real breadth gap this document should
name plainly rather than let the ✚ marker imply "spec-complete, pending implementation" when no
schema exists yet:

| Policy | Field | Type | Unit | Range / enum | Default | Scope |
|---|---|---|---|---|---|---|
| P-T.1 `multimodal_lane_portfolio` 🧩 | `lanes` | dict (link → list of `LaneSpec`) | — | $\le3$ lanes/link | `{}` | SM |
| | `LaneSpec.mode` | enum | — | `default`,`sea`,`air`,`road`,`rail` | `default` | E |
| | `LaneSpec.lead_time_weeks` (required) | integer | weeks | $[0,26]$ | — | E |
| | `LaneSpec.cost_per_unit` (required) | number | €/unit | $\ge0$ | — | E |
| | `LaneSpec.capacity_per_week` | number \| null | units/wk | $>0$ | `null` | E |
| | `mode_split_pct` | dict (link → mode → %) | % | shares sum to 100 | `{}` | SM |
| P-T.2 `expedited_shipments` ✅ | `decision` | enum | — | `revenue_positive`,`always_during_disruption` | `revenue_positive` | G — Eq. C.1 is the `revenue_positive` branch |
| | `premium_pct_of_cost` | number | % of $c_m$ per unit | $[1,50]$ | 3.0 | M — $\pi^{exp}$ |
| | `scope` | enum | — | `disrupted_materials`,`all` | `disrupted_materials` | G |
| P-T.3 `mode_shift` 🧩 | `upgrade_lane` (required) | string | lane id | — | — | E — requires P-T.1 |
| | `lt_saving_weeks` (required) | integer | weeks | $\ge1$ | — | E |
| | `upgrade_cost` (required) | number | €/unit | $>0$ | — | E |
| P-T.4 `leadtime_hedging` 🧩 | `hedge_weeks` | integer | weeks | $[0,8]$ | 2 | M — this is $h$ |
| | `applies_to` | enum | — | `all`,`long_lt`,`abc_a_only` | `long_lt` | G |
| | `long_lt_threshold_weeks` | integer | weeks | $[1,51]$ | 12 | G |

**Deferred, restated.** Route optimization / milk-run design remains ⛔ — network-*design*
optimization, not a weekly-simulation policy (§10.1 row 1 of the blueprint; consistent with the
platform's simulation-not-MILP positioning, §14 open question 2).

---

## PART VI — Fulfillment / Customer policy library

**Decision governed.** How unmet demand is handled and how scarce supply is allocated across
customers. **Scope.** (facility, product) and (customer). **Notation.** demand $D_{p,c,t}$;
fulfilled $F_{p,c,t}$; unmet $U_{p,c,t}=(D_{p,c,t}-F_{p,c,t})^+$; backlog age $a_j$ for backorder
entry $j$; available supply this week $\mathrm{avail}_{p,t}$.

### VI.1 Unmet-demand handling (`P-C.1` ✅)

- **Lost sales ✅.** *Purpose:* no promise to the customer beyond current stock. *Logic:*
  $U_{p,t}=(D_{p,t}-F_{p,t})^+$ becomes lost immediately: $\Lambda_{p,t}\mathrel{+}=U_{p,t}$.
  *Outputs:* $\Lambda_{p,t}$ feeds the fill-rate and lost-revenue KPIs (§IX.3) directly; no state
  carries to $t+1$.
- **Backorder.** *Purpose:* the customer waits. *Logic (a proper renewal/aging process, stated
  explicitly — the prior text left the age dynamic implicit):* each unmet unit enters the backlog
  with age $a=0$; every week, $a_j\leftarrow a_j+1$ for unserved entries; entries reaching
  `backorder_horizon` expire to lost sales:
  $$B_{p,t+1} = B_{p,t} + U_{p,t} - (\text{served backlog}) - (\text{expired, } a_j\ge\text{horizon}),$$
  penalty $\pi^{bo}$ accrues **per unit·week waited** to $\mathcal C^{res}$ (so a longer horizon is
  not free — it trades expiry-to-lost-sales risk against accumulating penalty, a real cost
  trade-off the UI should surface, not a free-form number).
- **Partial backorder.** *Purpose:* a documented middle ground. *Logic:* share
  `partial_accept_prob` of $U_{p,t}$ enters the backorder queue (above), the remainder
  $(1-\text{partial\_accept\_prob})U_{p,t}$ is lost immediately — a Bernoulli split per unit (or,
  equivalently at weekly-bucket granularity, a deterministic fractional split of the aggregate).

**Engine parameters (registry ground truth, `id: unmet_demand_handling`, one shared schema across
all three variants above — the same one-schema/enum-selects-behavior pattern as `inventory_control`,
§III.0-bis).**

| Field | Type | Unit | Range / enum | Default | Scope |
|---|---|---|---|---|---|
| `rule` | enum | — | `lost_sales`,`backorder`,`partial_backorder` | `lost_sales` | P |
| `backorder_horizon` | integer | weeks | $[0,26]$ | 4 | P |
| `backorder_penalty` | number | €/unit/wk | $\ge0$ | 0.0 | P — $\pi^{bo}$ |
| `partial_accept_prob` | number | — | $[0,1]$ | 0.5 | P |

### VI.2 Customer allocation under scarcity (`P-C.2` ✅)

**General form (an explicit optimization, not just named rules).** When
$\mathrm{avail}_{p,t}<\sum_cD_{p,c,t}$, every rule below is the solution to
$$\max_{F_{p,c,t}}\ \sum_c \mathrm{obj}_c(F_{p,c,t}) \quad\text{s.t.}\quad \sum_c F_{p,c,t}\le\mathrm{avail}_{p,t},\ \ 0\le F_{p,c,t}\le D_{p,c,t},\tag{C.2}$$
for a rule-specific objective $\mathrm{obj}_c(\cdot)$ — the same LP shape P-P.9's material
allocation already solves with HiGHS (§IV.2 of the blueprint's Appendix A), so §VI.2's rules are
the *product/customer-facing instance* of the identical mechanism, not a separately-invented one:

| Rule | $\mathrm{obj}_c(F)$ (Eq. C.2) | Property |
|---|---|---|
| **Proportional / fair-share** | not a linear objective — the direct rationing rule $F_{p,c}=D_{p,c}\cdot\mathrm{avail}_{p,t}/\sum_cD_{p,c,t}$ | the unique allocation satisfying resource-monotonicity and consistency (classical fair-division axioms, cf. Moulin 2003, *Fair Division and Collective Welfare*) — "fair" in a precise, provable sense, not just "spreads the pain" |
| **FCFS** | proportional at weekly-bucket granularity (order-level sequencing is sub-weekly, ⛔ per §5.8) | approximates arrival-order fairness within the bucket resolution the engine supports |
| **Priority** | $w_c\cdot F$ (`priority_weights`) | maximizes the priority-weighted throughput $\sum_cw_cF_{p,c}$ — Pareto-*dominant* on that objective, but **not** fair in the §VI.2 axiomatic sense: low-priority customers can be starved ($F_{p,c}=0$) even with ample $w_c>0$ demand. This is a real, named trade-off (business intent: protect key accounts), not a design flaw. |
| **SLA-tier** | $F$, subject to per-segment fill floors `sla_tiers` before any pro-rata remainder | a constrained variant of proportional: floors are hard constraints in Eq. C.2, scaled down pro-rata only if the floors themselves are jointly infeasible |

*State/data read:* `outbound_logistics.volume` (per-customer demand shares). *Inert* for
single-customer MTO (no scarcity split possible with one customer).

**Engine parameters (registry ground truth, `id: customer_allocation`).**

| Field | Type | Unit | Range / enum | Default | Scope |
|---|---|---|---|---|---|
| `rule` | enum | — | `fcfs`,`proportional`,`fair_share`,`priority`,`sla_tier` | `fcfs` | C |
| `priority_weights` | dict (customer→number) | weight | — | `{}` | C — `rule=priority` |
| `sla_tiers` | dict (segment→%) | fill floor % | — | `{}` | C — `rule=sla_tier` |

**The material-allocation twin (`id: material_allocation`, `catalog_ref: P-P.9`, ✅, PH-40 —
the exact LP Eq. C.2 references above).** Same shape, plant/product-side instead of
customer-side: `objective` enum (`max_revenue`,`max_fill_rate`,`priority_weighted`,`fg_replenish`;
default `max_revenue`), `solver` enum (`lp`,`greedy`; default `lp`, HiGHS-backed), `window_weeks`
(integer, $[1,13]$, default 4 — the rolling horizon $W$), `activation` enum
(`during_disruption`,`always`; default `during_disruption`), `annual_cost` (number, €/yr, default
6240.0 — planner-labor cost charged regardless of activation), `priority_weights` (dict,
product→weight). **Consequence for the interaction table (§IX.2 row 8):** P-C.2 and P-P.9 are not
merely "both instances of the LP" in spirit — they are two separate registered policies with two
separate parameter schemas that a project can enable independently, so Eq. C.2 must be read as
*one mathematical shape*, not one engine object; a project can run P-P.9 with `objective=max_revenue`
and P-C.2 with `rule=fair_share` simultaneously, and the two solve *different* LPs at *different*
phases (PH-40 vs. PH-60) over *different* decision variables (product output allocation vs.
customer fulfillment split) that happen to compose (production feeds fulfillment, §7.2 interaction
8) rather than being the same optimization run twice.

### VI.3 Minimum split ratio (partial shipment)

Per row, `min_split_ratio` $\mu\in(0,1]$: an order may ship in parts, each part $\ge\mu\times$
order — prevents delaying a whole order for a small shortfall (matches ALX's stated semantics,
confirmed in §III.15's source review). **Honest scope note:** unlike §VI.1/§VI.2, this parameter
is **not** amenable to closed-form optimization from the platform's cost fields — it trades
customer inconvenience (multiple deliveries, extra freight) against faster partial-revenue
recognition, a business-judgment parameter with no single "correct" value derivable from cost data
alone. Stated explicitly so the document does not manufacture a false precision where none exists
— knowing when *not* to force a derivation is itself part of "every claim justified."

### VI.4 Backorder / patience behavior (`P-C.5` ✚)

*Purpose:* model customer-side patience as a competing-risk process — an order is resolved by
whichever happens first, fulfillment or the customer's patience expiring. *Logic (proposed
model):* patience $\tau_c$ drawn per customer/segment (deterministic threshold, or
$\tau_c\sim\mathrm{Exp}(1/\bar\tau_c)$ for a stochastic variant); an order waiting since $t_0$
cancels at $t_0+\tau_c$ if not yet served — the demand-side companion to §VI.1's backorder-horizon
expiry, now attributed to customer behavior rather than a supplier-side policy choice. Delivery-
window flexibility and measured $\alpha/\beta$ service contracts per customer (Type I/II, §III.A.4
— the same two definitions apply on the demand side) round out the parameter set. ✚, not yet
implemented.

### VI.5 Demand shaping (`P-C.3` 🧩 · ⏸ activation)

Substitution offers / delay incentives with accept-probabilities; needs a revenue-elasticity
model that does not exist in the current data model (§5.8) — 🧩 planned, activation deferred,
stated here rather than silently no-op'd (the honest-catalog property, A3 of the blueprint).

**Engine parameters (registry ground truth, `id: demand_shaping`, `catalog_ref: P-C.3`, 🧩
planned).** `substitution_offer` (dict, product→substitute id), `substitution_accept_prob`
(number, $[0,1]$, default 0.5), `substitution_discount` (number, €/unit, $\ge0$, default 0.0),
`delay_incentive` (number, €/unit, $\ge0$, default 0.0), `delay_accept_prob` (number, $[0,1]$,
default 0.3). Confirms the ⏸ activation status: every accept-probability here is a **hand-set
input**, not derived from a price-elasticity model — the registry schema itself is the evidence
that §5.8's stated blocker (no revenue-elasticity model) is real, not a documentation gap.

---

## PART VII — Strategies (presets) — *not* policies

A **strategy** is a named bundle that **pre-fills many policy rows at once**; the engine never
reads a strategy, only the policies it wrote (§I.1). Each is an explicit *{policy row → value,
why}* map. Correctness rule: a preset must set the parameters the engine actually reads (the
engine params of §III–VI), not absolute UI fields that are ignored.

| Stage | Strategy | Sets these policies (type → key parameters) |
|---|---|---|
| Supplier | **Lowest-cost single source** | Sourcing → *single* (cheapest); Inventory → *min_max*; Transport → single-mode LTL |
| Supplier | **Dual-source resilient** | Sourcing → *multi-sourcing* 70/30 top-2, `min_share=30`, rebalance-on-disruption; Backup → *contingent*, reliability rule |
| Supplier | **JIT inbound** | Sourcing → *single* trusted; Inventory → *order-on-demand* (pull), daily review, low buffer |
| Plant | **Make-to-Stock** | Build → *MTS*; FG → *base_stock* sized by FG safety-stock *service_level* 95%; Forecast → *SES* |
| Plant | **Make-to-Order** | Build → *MTO*; FG → *order-on-demand*; Lot → *lot-for-lot* |
| Plant | **Lean pull** | Build → *MTS* low target; Inventory → periodic 1w, low SS; util cap 80% |
| Customer | **Premium service** | Allocation → *sla_tier* high floors; no backorder; high SS |
| Customer | **Cost-first fulfillment** | Unmet → *backorder*; Allocation → *fcfs*; lower SS |
| Customer | **Agile high-mix** | Forecast → short horizon; Allocation → *priority*; flexible mix |

Numeric deltas are the `derive(ctx)` functions in `src/lib/policies/presets/*`, computed from
project context with a per-field `why`. **These are the only strategies; everything in §III–VI
and §VIII are policies.**

---

## PART VIII — Resilience / Recovery policies

Genuine operational policies that activate on $\phi_t=1$. Most are specified where they share a
category (backup §IV.1, expedite §V, overtime §IV.3, allocation §IV.2c/VI.2); this part adds
orchestration.

| ID | Policy | Model | Engine |
|---|---|---|---|
| P-S.4 | early-warning failover | $\phi_t=\mathbf 1[t\ge t_0+\min(\tau_{\text{mon}},\tau_{\text{scn}})]$; standing cost | ✅ |
| P-X.1 | recovery playbook | ordered steps (detect→expedite→backup→overtime), triggers over $\phi_t$, `cost_cap`; enables other policies' crisis modes | 🧩 |
| P-S.3 | capacity reservation | reserved units exempt from queue at standing fee | 🧩 |
| P-P.6 | standing capacity reserve | pre-paid $O_p(1+\gamma)$ | 🧩 |
| P-P.7/8/10 | flexibility / alt-BoM / repurposing | reroute production or substitute materials under scarcity | 🧩 |

**Playbook model (P-X.1).** Ordered steps $\sigma_1,\dots,\sigma_k$; each has a trigger over
$\phi_t$/coverage and an action that enables+retunes an existing policy's crisis ModeStrip.
Evaluated every `evaluation_cadence_weeks`; spend capped at `cost_cap`. Replaces the flat
recovery-response list with a programmable sequence.

**Engine parameters (registry ground truth).**

| Policy | Field | Type | Unit | Range / enum | Default | Scope |
|---|---|---|---|---|---|---|
| P-X.1 `recovery_playbook` 🧩 | `steps` (required) | array of `PlaybookStep`, $\le10$ | — | ordered | — | G |
| | `PlaybookStep.trigger` (required) | enum | — | `disruption_detected`,`coverage_below`,`fill_rate_below`,`backlog_above` | — | — |
| | `PlaybookStep.policy_ref` (required) | string | policy id | — | — | — |
| | `PlaybookStep.trigger_value` | number \| null | trigger-specific | — | `null` | — |
| | `PlaybookStep.param_override` | object (any) | — | — | `{}` | — |
| | `PlaybookStep.cooldown_weeks` | integer | weeks | $[0,8]$ | 0 | — |
| | `evaluation_cadence_weeks` | enum (int) | weeks | $\{1,2\}$ | 1 | G |
| | `cost_cap` | number \| null | € | $>0$ | `null` | G |
| P-P.7 `process_flexibility` 🧩 | `flexibility_matrix` (required) | dict (line→product list) | — | — | — | P |
| | `switchover_cost` | number | €/switch | $\ge0$ | 0.0 | P |
| | `switchover_time_weeks` | integer | weeks | $[0,2]$ | 0 | P |
| P-P.8 `alternative_bom` 🧩 | `substitute_map` (required) | dict (material→substitute list) | — | — | — | M |
| | `substitute_rates` | dict (product→material→rate) | units substitute/unit product | — | `{}` | P×M — $r'_{p,m'}>0$ |
| | `substitution_cost` | number | €/unit | $\ge0$ | 0.0 | M |
| | `auto_substitute` | boolean | — | — | `true` | G |
| P-P.10 `repurposing` 🧩 | `conversion_map` (required) | dict (line→capability) | — | — | — | P |
| | `conversion_cost` (required) | number | €/conversion | $>0$ | — | P |
| | `conversion_time_weeks` | integer | weeks | $[1,8]$ | 2 | P |
| | `reversion_time_weeks` | integer | weeks | $[0,4]$ | 1 | P |

**A structural fact this table exposes:** every P-X.1 `PlaybookStep.policy_ref` must resolve to a
policy id from *this same registry* (the `id` column values used throughout §III–§VIII's tables)
— the playbook is compositional over the existing catalog by construction, not a parallel
mechanism; a `policy_ref` that does not match a registered `id` is a load-time validation failure,
not a silent no-op (consistent with §7.1's `validate_hooks` discipline).

---

## PART VIII-D — Disruption propagation: a formal model

This part was **entirely absent** from the prior revision: policies were specified, but "how a
disruption changes them" was left to be inferred from §7's interaction graph and the individual
`§Model` lines of §IV.1/§V that mention $\phi_t$. The brief requires this made explicit for every
disruption: which stage, which policy, which variables, how they propagate downstream, and how
they reach the results. This section closes that gap, grounded in the platform's actual event
schema (`scsim/scsim/entities/disruption.py`) — nothing here is invented; every symbol below is a
named field or method in that module or `core/context.py`.

### D.1 The event, formalized

A disruption event is a 9-tuple, exactly `DisruptionEvent`'s fields:
$$e = \big(\underbrace{\tau}_{\text{target\_type}},\ \underbrace{k}_{\text{target\_id}},\ \underbrace{\eta}_{\text{effect\_type}},\ \underbrace{\varphi}_{\text{capacity\_factor}},\ \underbrace{\xi}_{\text{overflow\_rule}},\ \text{onset/recovery ramp},\ r,\ t^\star,\ \Delta t\big)$$
- **Target** $\tau\in\{$`node:supplier`✅, `node:plant`✅, `edge:lane`🧩$\}$, identified by $k$.
  Lane targets are schema-valid but resolve to their supplier today (G7 — lanes are not yet
  first-class, §8.3 of the blueprint); this is a stated, not hidden, limitation.
- **Effect** $\eta\in\{$`lead_time_extension`✅, `capacity_reduction`✅$\}$ — **only two effect
  types exist today**; a demand-surge class is catalogued as missing (G11 of the blueprint) and is
  named again here because the brief explicitly asks for "every disruption," and honesty about
  catalog breadth is part of that answer.
- **Window.** Physical effect is active for $t\in[t^\star,\,t^\star+\Delta t+r)$ (the `ramp_weeks`
  $r$ extends recovery); this is `events_physical()`'s exact predicate.
- **Composition.** Same-target events compose by **per-week worst case** — minimum capacity factor,
  maximum deferral — not by summing effects (avoids double-counting overlapping windows; stated
  explicitly in `disruption.py`'s docstring, restated here as it is load-bearing for §D.2).

### D.2 Two propagation channels — the unifying structural claim

This is the section's central result, and it is what makes "propagation is explicit, not implicit"
actually true rather than merely asserted: **every disruption reaches downstream policies through
exactly one of two channels, and every policy's response is fully determined by which channel(s)
it participates in — there is no third, ad hoc mechanism anywhere in the catalog.**

**Channel 1 — Physical/state-mediated (unconditional, immediate, no detection required).** The
disruption directly perturbs the *physical* logistics execution at PH-90, independent of whether
the firm has detected it yet:
- `lead_time_extension`: the target ships **nothing** during $[t^\star,t^\star+\Delta t)$; in-
  transit quantities due to arrive inside the window are deferred to $t^\star+\Delta t$ (Eqs.
  11–12 of the engine reference — conservation-preserving, units delayed, never destroyed).
  Formally, `state.pipeline`/`state.queue` realize arrivals as
  $$\text{arrival}_{m,t} = \begin{cases}0 & t\in[t^\star,\,t^\star+\Delta t)\\ \text{deferred backlog} + \text{scheduled} & t=t^\star+\Delta t\\ \text{scheduled (nominal)} & \text{otherwise.}\end{cases}$$
- `capacity_reduction`: weekly outbound flow throttles to $\varphi\cdot K_s$ (supplier) or
  $\varphi\cdot\mathrm{cap}_p$ (plant); overflow either queues (`overflow_rule=queue`, delayed,
  conservation-preserving) or rejects (`=reject`, logged as `lost_inbound_units`, a genuine
  destruction of the order — the one place units are *not* conserved, by explicit design).
- **Why this channel needs no policy code:** every policy in §III–VI reads `state.on_hand`,
  `state.pipeline`, position $\mathrm{IP}_{i,t}$, or `state.queue` — never the disruption schedule
  directly. A frozen pipeline or throttled queue changes those state variables; the *same*
  min-max/base-stock/(R,Q)/MRP equations of §III then react automatically, because they are
  written in terms of state, not in terms of "is a disruption happening." This is the practical
  content of §7.2 interaction 7 ("congestion = endogenous lead-time extension, the emergent
  interaction, not a parameter") — restated here as a general propagation law, not a one-off
  observation about capacity.

**Channel 2 — Cognitive/policy-mediated (conditional on detection, proactive).** A small,
enumerable set of policies explicitly query `events_visible()` — the **firm-visible** window,
gated by `detection_lag_weeks` $\tau_{\text{lag}}$ (or P-S.4's compressed
`detection_lag_override`):
$$\text{visible}(e,t) = \mathbf 1\big[t^\star+\tau_{\text{lag}} \le t < t^\star+\Delta t+r\big], \qquad \phi_t = \max_e \text{visible}(e,t)\tag{D.3}$$
(Eq. D.3 is exactly `context.py::events_visible`'s predicate.) Every policy that reads $\phi_t$ (or
the per-supplier `visible_disrupted_suppliers()` mask) is listed exhaustively — this is the whole
set, not a sample:

| Policy | What it reads from Eq. D.3 | What it changes |
|---|---|---|
| P-P.1 `coverage_weeks` ModeStrip | $\phi_t$ (any visible event) | switches $\kappa$ from `nominal` to `crisis` (§III.1's Eq. 2–3 sizing) |
| P-S.1 backup_supplier | `visible_disrupted_suppliers()` (per-supplier) | reroutes the sourcing split $w_{m,s}$ (§IV.1 policy 3) |
| P-S.4 early_warning_failover | modifies $\tau_{\text{lag}}$ itself | compresses every *other* policy's detection lag — a second-order propagation (a policy that changes when Channel 2 fires for everyone else) |
| P-T.2 expedited_shipments | $\phi_t$ (gates Eq. C.1's evaluation) | pulls Channel-1-delayed pipeline forward, partially reversing Channel 1's own effect |
| P-P.5 short_term_capacity | activation condition Eq. B.4, evaluated regardless of $\phi_t$ but typically binds only once demand backs up **from** a Channel-1 effect | raises $\mathrm{cap}_{p,t}$ |
| P-X.1 recovery_playbook | $\phi_t$/coverage | sequenced triggers that enable/retune the above (an orchestrator over Channel 2, not a third channel) |

**The claim, stated precisely:** for any disruption $e$ and any policy $\pi$ in the catalog, $\pi$'s
response to $e$ is fully explained by (a) which state keys $\pi$ reads that Channel 1 perturbs, and
(b) whether $\pi$ appears in the Channel-2 table above. No policy in §III–VIII has a third,
undocumented disruption-sensing path — a claim made checkable because `validate_hooks` (§7.1)
already enforces that every state read is declared, so an audit of hook `reads` sets against
`DISRUPTION_STATE`/`FIRM_KNOWLEDGE` is sufficient to verify it holds, not merely assert it.

### D.3 Worked propagation traces (the brief's four named examples)

Each trace below names: affected stage, affected policy (both channels), modified variables, the
phase-by-phase path (using Appendix B's phase table), and the downstream KPI effect.

**1. Increased supplier lead time** (`effect_type=lead_time_extension`, `target_type=node:supplier`).
- *Stage:* supplier. *Channel 1:* PH-90 freezes shipments from $k$ for $\Delta t$ weeks
  (`lt_block_end[k] = t^\star+\Delta t`, the exact state variable in `context.py`); `state.pipeline`
  arrivals for links on $k$ defer. *Trace:* PH-90 (frozen arrivals) → `state.on_hand` fails to
  replenish → PH-70 next week: $\mathrm{IP}_{i,t}$ (§III's inventory position) is lower than
  nominal because $\Pi_{i,t}$ (pipeline) is depleted, not because $s_i/S_i$ changed — **the trigger
  fires *more often*, not at a different threshold**, a distinction worth stating because it is
  easy to (incorrectly) model a lead-time disruption as "raise $s_i$" when the engine's actual
  mechanism is "starve $\Pi_{i,t}$." *Channel 2 (if visible):* P-P.1's $\kappa\to$crisis (raises
  $S_i$, §III.1); P-S.1 may reroute to backup (§IV.1 policy 3); P-T.2 may expedite whatever is
  still in transit on *other* links to compensate. *Downstream KPI:* material stockout → PH-50's
  BoM-feasibility floor $\lfloor I_{m,t}/b_{p,m}\rfloor$ clips production → PH-60 fulfillment drops
  → fill rate, backorder/lost-sales KPIs (§IX.3).

**2. Reduced supplier capacity** (`effect_type=capacity_reduction`, `target_type=node:supplier`,
$\varphi<1$).
- *Channel 1:* PH-90 throttles shipped $=\min(\Xi_{k,t},\varphi K_k)$ (`cap_factor[k]=φ`); overflow
  queues or rejects per `overflow_rule`. *Trace:* if `overflow_rule=queue`, this is **exactly**
  Eq. B.5's congestion mechanism (§IV.6.A) — a capacity cut *raises effective utilization*
  $\upsilon_k=\lambda_k/(\varphi K_k)$, and Eq. B.5's $\mathbb E[W_k]$ grows accordingly, so a capacity
  disruption manifests as a *growing*, not fixed, lead-time extension the longer it persists — a
  qualitatively different signature from case 1's flat block, worth distinguishing in any
  results dashboard. If `overflow_rule=reject`, the excess is destroyed
  (`lost_inbound_units`), a harder, immediate effect with no recovery once the window closes (no
  queued backlog to clear). *Channel 2:* identical menu to case 1.

**3. Reduced production capacity** (`effect_type=capacity_reduction`, `target_type=node:plant`).
- *Channel 1:* `plant_cap_factor=φ` throttles PH-50's $g_{p,t}=\min(x_{p,t},\varphi\,\mathrm{cap}_{p,t},\ldots)$
  directly — this is the **one** disruption type that acts on the *production* clip term rather
  than the *material* clip term of the same equation, so its signature (output falls even when
  materials are ample) is diagnostically distinguishable from case 1/2's material-driven shortfall
  using the same PH-50 equation, without new instrumentation. *Channel 2:* P-P.5 overtime's Eq.
  B.4 activation condition is evaluated *because* backlog $B_{p,t}$ is now rising — overtime is the
  Channel-2 response purpose-built for this case (raises the effective $\mathrm{cap}_{p,t}$ term
  Channel 1 just cut). *Downstream KPI:* directly on `production_output` (PH-50) → PH-60
  fulfillment → same fill-rate/backorder chain as case 1, but with the diagnostic distinction above.

**4. Transportation delays.** *Stated limitation, not modeled around:* today, transport has no
first-class lane entity (G7), so a "transportation delay" **is** case 1 (`lead_time_extension`) on
the relevant supplier link — the platform does not currently distinguish "the supplier was late"
from "the truck was late." §V's multimodal lane portfolio (`P-T.1`, 🧩) is the schema change that
would let `target_type=edge:lane` carry an independent delay separate from the supplier's own
processing time; until then, this is honestly the same propagation trace as case 1, not a fifth
mechanism — stated here rather than glossed over.

### D.4 Why demand-surge disruptions are absent, named rather than silently missing

The brief's disruption list implicitly includes demand-side shocks (a customer surge, a
promotional spike). **No such `EffectType` exists in the engine today** — `EffectType` has exactly
two members (§D.1). This is G11 of the blueprint's gap catalog, restated here in this document's
own terms: a demand-surge event would need a third `effect_type` perturbing `state.demand` at
PH-10 (Channel 1, a new state-mediated path — the *same* two-channel structure of §D.2 extends to
it without new architecture, only a new `EffectType` member and a PH-00/PH-10 hook), plus Channel-2
consumers deciding whether to proactively reforecast. Flagged here as a scoped, well-understood
extension (not a redesign) rather than left as a silent absence.

---

## PART IX — Demand generation, interactions, accounting

### IX.1 Demand generation (`P-C.4` ✚, the world model)

Demand $D_{p,t}$ is drawn at PH-10 per product: distribution family (triangular / triangularAV /
poisson / negbin / normal / deterministic) with mean $\bar D_p$, CV $\mathrm{CV}_p$; optional
seasonality (period, amplitude) and trend; optional forecast-error injection. **TriangularAV**
maps $(\bar D,\mathrm{CV})\to(a,b,c)$ so the user supplies just mean and CV. The exogenous driver
every policy responds to; the promoted world-demand mechanic, named as customer policy P-C.4.

### IX.2 Policy interaction graph (traceable, load-time-validated — no hidden edges)

| # | Interaction | Edge (writer → key → reader) |
|---|---|---|
| 1 | Forecast → Inventory | P-F.1 `forecast` → PH-70 $s,S$ sizing |
| 2 | Forecast → Production | `forecast` → PH-40 MTS plan |
| 3 | Inventory → Procurement | `inventory_levels` → PH-80 `purchase_orders` |
| 4 | Procurement → Production | `purchase_orders`→`pipeline`→`arrivals`→`on_hand`→PH-50 feasibility |
| 5 | Production → Transport | `production_output` → PH-90 |
| 6 | Transport → Service | `arrivals`→`on_hand`/`fg_on_hand`→PH-60 `fulfillment` |
| 7 | Capacity → Lead time | finite $K_s$→`queue` congestion = endogenous LT (emergent), closed form Eq. B.5 (§IV.6.A) |
| 7a | Sourcing split → Capacity | capacity-proportional split (§IV.1 policy 5) is the structural response to 7's Eq. B.5 |
| 8 | Allocation → Service | P-P.9 (PH-40) & P-C.2 (PH-60) reshape `fulfillment`, both instances of the Eq. C.2 LP |
| 9 | Disruption → Recovery | `disruption_state`→`firm_knowledge`→P-S.1/S.4/T.2/P.5/X.1 — the full two-channel propagation model (Channel 1 physical/state, Channel 2 detection-gated) is §PART VIII-D |

Plus: safety-stock→inventory (§IV.4→§III) and sourcing-split→procurement (§IV.1→PH-80).

### IX.3 Accounting & KPIs (PH-99)

Value-weighted, post-warm-up: fill rate $\mathrm{FR}=\frac{\sum_p u_p F_p}{\sum_p u_p D_p}$;
lost sales $\sum_p u_p\Lambda_p$; on-hand value $\sum_i c_i\bar I_i$; revenue; **cost of
resilience** $\mathcal C^{res}$ (holding + backup/multi-source premia + expedite + overtime +
monitoring, per-policy ledgered); TTR/TTS; service-loss area; resilience index (0–100). Every
policy's cost is a declared append to $\mathcal C^{res}$ — cost is attributable per policy.

---

## Appendix A — Engine binding (implemented ✅ · specified ✚ · registered-planned 🧩)

| Category | ✅ today (registered, `status=implemented`) | ✚ to add (no registry entry yet) | 🧩 registered, `status=planned` |
|---|---|---|---|
| Inventory | `inventory_control`/P-P.1: min_max, rop_q, base_stock, periodic (one schema, §III.0-bis) | min_max_ss/regular_ss (compositions, not new schema, §III.2/III.7), regular, order_on_demand, unlimited, no_replenishment, MRP, Quantity-basis | — |
| Sourcing | backup (P-S.1), multi (P-S.2), early-warning (P-S.4) | single/`P-S.0` (unnamed default, §IV.1.B), ranked, capacity-proportional, tiered | capacity_reservation (P-S.3) |
| Production | `P-P.0` build discipline (MTS/MTO, unnamed today), material_allocation (P-P.9) | dispatching (P-P.11), fulfillment_discipline (P-P.12) | lot_sizing (P-P.2), process_flexibility (P-P.7), alternative_bom (P-P.8), repurposing (P-P.10) |
| Capacity | overtime (P-P.5) | supplier-capacity model (P-S.5) | standing reserve (P-P.6) |
| Safety stock | safety_stock_materials (P-P.3): fixed_days, service_level, king, abc_xyz; fg_safety_stock (P-P.4) | cost-optimal `classification` value (Eq. A.3, §III.A.5) | — |
| Forecasting | built-in SES-like mechanic (unnamed, `P-F.0` per §4.4's convention) | SES/Holt/HW/Croston/MA/naive as a selectable `forecasting_method` (P-F.1) | — |
| Transport | expedite (P-T.2) | consolidation (P-T.5), frequency (P-T.6) — **not even registered as 🧩**, §V.A | lane portfolio (P-T.1), mode-shift (P-T.3), hedge (P-T.4) |
| Fulfillment | unmet_demand_handling (P-C.1): lost_sales/backorder/partial_backorder; customer_allocation (P-C.2) | min_split_ratio, patience (P-C.5) | demand_shaping (P-C.3) |
| Demand/LT | triangularAV, det/stoch LT (engine mechanics, not yet policy slots) | demand_model (P-C.4), lead_time_model (P-S.6), supplier_capacity_model (P-S.5) | — |
| Recovery | early-warning (P-S.4, listed under Sourcing too — it is a supplier-stage policy with a recovery role) | — | playbook (P-X.1) |

## Appendix B — Symbol index

$t,m,p,s,c,\ell$ indices; $I$ on-hand; $\mathrm{IP}$ position; $\Pi$ pipeline; $\Xi$ queue; $B$
backlog; $\Lambda$ lost; $Y/Y^\star$ FG stock/target; $D/\hat D$ demand/forecast; $\phi$ firm
knowledge; $O$ order; $x/g$ plan/output; $\omega$ overtime; $F$ fulfillment; $A$ arrivals;
$\mathcal C^{res}$ cost ledger; $L$ lead time; $K_s/O_p$ capacity; $b_{p,m}$ BoM; $u_p$ value;
$c_m$ cost; $\mathrm{SS}$ safety stock; $\rho_t$ review gate; $\kappa$ coverage; $z(\alpha)$
service-level factor; $\sigma_D/\sigma_L$ demand/lead-time std. **§III.A additions:** $X_i$
demand-over-lead-time r.v.; $\sigma_{X_i}^2$ its variance (Eq. A.1); $\alpha$ Type I cycle service
level; $\beta$ Type II fill rate; $n/\Phi$ standard normal pdf/cdf (deliberately not $\phi$ —
collides with $\phi_t$, firm knowledge, below); $\psi(z)=n(z)-z(1-\Phi(z))$ standard normal loss
function; $z^\star$ cost-optimal safety factor; $\mathrm{CR}$ newsvendor critical ratio; $c^o/c^u$
weekly overage/underage unit cost. **§IV.1.A additions:** $\rho_s$ per-supplier weekly disruption
probability; $\lambda$ risk-aversion weight (Eq. B.2). **§IV.6.A additions:** $\lambda_s$ order
volume routed to supplier $s$; $\upsilon_s=\lambda_s/K_s$ utilization (a distinct glyph from
$\rho_s$, deliberately, so the same letter is never reused for disruption probability in §IV.1.A
and utilization in §IV.6.A). **§PART VIII-D additions:** $e$ disruption
event tuple; $\tau,k,\eta$ target type/id, effect type; $\varphi$ capacity factor (distinct from
$\phi_t$); $\xi$ overflow rule; $t^\star,\Delta t,r$ start/duration/ramp; $\tau_{\text{lag}}$
detection lag.

## Appendix C — Change control

Authoritative policy & simulation-logic specification. Any change to a policy type, parameter,
equation, UI column, prefill rule, preset, or engine binding **must** update this file in the
same change. Implemented-policy parameters verified against
`src/lib/policies/registry.generated.json`; ✚ types specified to implementable rigor. Cross-refs:
`docs/design/next-gen-platform-design.md` (blueprint), `docs/design/platform-architecture-report.md`
(architecture), `docs/data-simulation-mapping.md` (mapping contract).

**v2.1 changelog (this change).** Added §III.A (stochastic foundations: DLT compound-variance
derivation, Type I/II service-level distinction, cost-optimal safety-factor derivation, (R,Q)
joint-optimization procedure, an assumption ledger — grounded against the live implementation in
`scsim/scsim/policies/builtin/p_p1_inventory_control.py` and
`scsim/scsim/policies/strategic/p_p3_safety_stock.py`, confirming Eq. A.1 matches the shipped
`king` branch exactly); §III.15 (AnyLogistix benchmark sourced from ALX's published help
documentation — `anylogistix.help/tables/policies.html`, `.../tables/inventory.html`,
`.../experiments/sse-calculation.html` — not assumed); §III.16 (scopes the array-editor UI
proposal against the existing §II.3 hybrid grid: preserved for scalar headline parameters,
justified only for genuinely list-valued parameters such as the §IV.4 $z$-matrix). Corrected §III.11
(MRP's $\mathrm{SS}$ parameter was previously undefined as to sizing method; now explicitly sized
by the §IV.4/§III.A pipeline like every other policy's buffer). `/help/policies`
(`src/pages/About.tsx` `DOC_BODIES`) was spot-checked against the live registry and found already
consistent with the operational formulas (Eqs. 1–3, 20–21, the $z=\Phi^{-1}(\mathrm{SL}\%)$
convention) — no doc/code drift found there, so no help-page edit was required.

**v2.2 changelog (this change).** Brought §IV.1 (sourcing), §IV.2 (production/lot-sizing/
dispatching), §IV.3 (capacity), §IV.5 (forecasting), §IV.6 (supplier capacity/lead-time), §V
(transport), and §VI (fulfillment) up to §PART 0's mandatory per-policy template and §III.A's
derivation standard — the v2.1 revision brought only Part III to that standard and left the rest
as one-paragraph stubs, which was the core gap in v2.1. Added: §IV.1.A (optimal sourcing split —
Markowitz-style portfolio-variance derivation, Eqs. B.1–B.3, reusing §III.A.5's underage cost so
sourcing risk and safety-stock risk share one cost parameter instead of two disconnected ones);
EPQ derivation in §IV.2.b; the overtime activation condition derived, not asserted (Eq. B.4,
§IV.3); full forecasting update equations and Muth's (1960) SES-optimality citation (§IV.5);
§IV.6.A (Little's-Law congestion→lead-time closed form, Eq. B.5, with a stated M/M/1 approximation
assumption); the shipment-consolidation optimality citation (Higginson & Bookbinder 1994, §V);
the customer-allocation LP formalization and the fair-share/priority trade-off made explicit via
fair-division axioms (Eq. C.2, §VI.2); a proper backorder-aging renewal process (§VI.1). **Added
§PART VIII-D**, entirely new: the two-channel (physical/state-mediated vs. detection-gated/
policy-mediated) disruption-propagation model, grounded in `scsim/scsim/entities/disruption.py`
and `core/context.py::events_visible`/`events_physical`, worked through all four disruption types
named in the brief (lead time, supplier capacity, plant capacity, transport delay) plus an honest
statement of what is not yet modeled (demand-surge disruptions, G11). **Fixed a real notation
collision introduced in drafting v2.1's edit and caught before commit:** the standard normal
density was initially written $\phi(z)$, colliding with this document's pre-existing $\phi_t$
(firm-knowledge/crisis indicator); changed to $n(z)$ throughout §III.A.4–A.5. Also eliminated an
avoidable $\rho_s$ overload (disruption probability in §IV.1.A vs. utilization in §IV.6.A) by
renaming utilization to $\upsilon_s$ — both are documented in Appendix B rather than left implicit.
No engine, UI, or schema code changed in v2.1 or v2.2 — both are specification-only.

**v2.3 changelog (this change).** Read `src/lib/policies/registry.generated.json` in full (all 22
`policies[]` entries) and added an **Engine parameters (registry ground truth)** table — exact
field, type, unit, range/enum, default, scope, transcribed, not paraphrased — to every registered
policy across §III (`inventory_control`), §IV (`safety_stock_materials`, `fg_safety_stock`,
`lot_sizing`, `short_term_capacity`, `standing_capacity_reserve`, `backup_supplier`,
`proactive_multi_sourcing`, `capacity_reservation`, `early_warning_failover`), §V
(`multimodal_lane_portfolio`, `expedited_shipments`, `mode_shift`, `leadtime_hedging`), §VI
(`unmet_demand_handling`, `customer_allocation`, `material_allocation`, `demand_shaping`), and
§PART VIII (`recovery_playbook`, `process_flexibility`, `alternative_bom`, `repurposing`). This
surfaced and corrected several real prose/registry mismatches (listed in the header table above)
rather than only adding tables beside unchanged prose: §III.1's $s,S$ were presented as editable
when they are computed; §III.2/III.7's SS was presented as a field on the policy itself when it is
a second policy's hook composing on top of the first (`p_p3_safety_stock.py::on_phase` reading
`ctx.level_s`/`ctx.level_S` after `p_p1`'s priority-50 write); §III.3's (R,Q) equation matched the
textbook generalization rather than the shipped single-lot branch; §IV.3's Eq. B.4 misattributed
the overtime premium's base (price, not production cost); §IV.1 corrected which of its six listed
sourcing rules are actually registered policies (two are — P-S.1, P-S.2 — the rest are ✚ or, for
"single sourcing," not even a policy but an unnamed engine default proposed here as `P-S.0`); §V.A
found P-T.5/P-T.6 have no registry entry at all, not even 🧩; Appendix A's category table was
corrected to reflect all of the above rather than left as the pre-audit summary. This is the
concrete answer to "the app-wise level": every policy in this document is now traceable to the
exact Pydantic field a developer would implement against and a user would see in the grid, sourced
from the one artifact the platform's own doctrine (A6/§6.2 of the blueprint) already declares
canonical — not re-derived from this document's prose, not from `schemas.ts`, not from the help
page. No engine, UI, or schema code changed — still specification-only; the next step this
revision sets up is making the UI/schemas/help page actually match what is now documented here.
