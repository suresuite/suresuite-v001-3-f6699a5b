# SuReSuite — Supply Chain Policy Library & Simulation Logic (authoritative specification)

| | |
|---|---|
| **Status** | v2.0 — reframed: *policies* (operational decision rules), not *strategies*; comprehensive per-category policy library with mathematical models and the UI/coding contract. |
| **Date** | 2026-07-07 |
| **Role** | Single source of truth for every supply chain **policy** the platform offers, its **mathematical model**, its **parameters and UI**, and its **coding representation**. Any change to a policy, parameter, equation, or its UI/engine binding must be reflected here in the same change. |
| **Benchmark** | anyLogistix (ALX) is the reference for *breadth of the policy library* and the *table/parameter UI*. We match its granularity, evaluate each policy for necessity under our weekly-bucket engine, and give every policy a rigorous mathematical model (ALX documents behavior; we specify equations). |
| **Ground truth** | Parameter names/units/ranges of already-implemented policies are transcribed from the engine registry (`src/lib/policies/registry.generated.json`, engine 0.2.1) and plugin source (`scsim/scsim/policies/`). New policy types proposed here are marked and specified to the same rigor so they can be implemented directly. |

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

> **Implementation status (Phase D / 6.A).** The **Inventory** category has migrated to this model
> on the supplier and focal-plant stages: a **Policy Type** cell (`inventory.type`, labelled from the
> registry library — Min-max (s,S) / Base stock (S) / (R,Q) / Periodic review (T,S)) drives which
> level/lot parameters are editable (`s = reorder_point`, `S = order_up_to`, `Q = rop_q_quantity`,
> `T = review_period_days`), alongside the structural columns **Policy Basis** (`inventory.basis`),
> **Initial Stock** (item-master `initial_on_hand`) and Periodic Check (the periodic_review type +
> its period). Realized as a **presentation reframe over the existing transitional bundle**
> (persistence, provenance, Excel round-trip and resolution precedence unchanged), not a storage
> migration to the tagged union above. Deviation from the literal target, bridged when the engine
> work lands: `project_map._map_policies` passes only `inventory.type → policy_type` today, so
> `basis`, `s, S, R, Q` and the review period are **stored + versioned but not yet consumed** — the
> engine sizes levels from coverage-κ until the **Quantity basis** (§II.4, ✚) and the basis/level
> pass-through land; the per-parameter side-sheet (6.B) discloses each parameter's consumed vs
> stored-only status (`SCSIM_VISIBLE_FIELDS`, the parity contract with `project_map`, is unchanged).
> The registry access layer `src/lib/policies/registryPolicyTypes.ts` exposes the registry-faithful
> engine params (`coverage_weeks`, `periodic_review_weeks`) too, so the two framings converge with no
> schema re-write. The remaining categories (sourcing/fulfillment/…) still use the flat family columns.

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
inventory-type parameter that denotes a *level* is interpreted under one of **three** bases (the
third added for our research models):

- **Basis = Quantity.** Parameters are **absolute units**. $s = 50$ means 50 units.
- **Basis = Days-of-supply (historic).** Parameters are **multipliers on mean demand** over a
  window $W$ (the Stock Calc. Window, days). With mean daily demand
  $\bar d_i = \frac{1}{W}\sum_{u=t-W}^{t-1} D_{i,u}$ (from history or forecast), a level parameter
  $\pi$ is realized as
  $$\text{level} = \pi \cdot \bar d_i \cdot 7 \quad\text{(units, per week)}.$$
  Example (ALX): Min-max with $s=2$, $S=5$, $W=10$ ⇒ $s = 2\,\bar d_i\cdot7$, $S = 5\,\bar d_i\cdot7$.
- **Basis = Forward-visible schedule** *(added for research models).* Coverage windows applied to
  **forward-visible demand summed over the window**, requiring a **demand-visibility horizon**
  $\tau^\ast$ (a *customer-stage* input, §III-D.6). For material $m$, lead time $T_s$, protective
  period $\kappa$: $s_m[t]=\sum_{\tau=t}^{t+T_s}\hat D_m[\tau]$, $S_m[t]=\sum_{\tau=t}^{t+T_s+\kappa}\hat D_m[\tau]$
  ($T_s{+}\kappa\le\tau^\ast$), with $\hat D_m[\tau]=\sum_p\hat D_p[\tau]\,r_{p,m}$ (BoM-exploded
  forward demand). Windows are **inclusive** at both ends ($T_s{+}1$ resp. $T_s{+}\kappa{+}1$
  terms, the paper's convention), so stationary demand collapses to
  $\bar D_m\,(T_s{+}1)$ / $\bar D_m\,(T_s{+}\kappa{+}1)$ — Days-of-supply plus exactly one
  boundary term; non-stationary demand differs trajectory-by-trajectory. **This is the WSC-2026
  MTO inventory formula.** *Stage ownership:* a two-stage contract — the **customer** supplies
  $\tau^\ast$ and the forward order book (§III-D.6); the **focal plant** consumes it in material
  inventory control (§III.1). Selectable only when a customer policy provides
  $\tau^\ast\ge T_s+\kappa$; MTO-only (MTS material demand is forecast-projected, §3.3).

**Mapping to our engine.** P-P.1 implements the basis switch as the `basis` parameter
(`days_of_supply` default | `forward_visible`). **Days-of-supply** ✅ is the single-coverage
special case: $s_{m,t}=\bar D_m L_\ell$, $S_{m,t}=\bar D_m(L_\ell+\kappa)$, from the *stationary*
material-demand mechanic. **Forward-visible schedule** ✅ sums the customer's committed order book
(pre-drawn world demand schedule, exposed by P-C.6 §III-D.6) via
`ctx.forward_material_demand` — reproduces the WSC-2026 MTO model trajectory-exactly, not merely
in expectation (golden test #6, `scsim/tests/test_forward_visibility.py`). Feasibility gates:
requires P-C.6; MTO-only; $\max_m T_s+\kappa_{crisis}\le\tau^\ast$; integral $\kappa$. MOQ
flooring, the review gate $\rho_t$, and P-P.3 safety-stock stacking apply identically under
either basis (PH-80 is untouched). The remaining ✚ addition is **Quantity** (honor absolute
$s,S$ → closes G1). All three bases are specified so any can be built.

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
empty (cost = volume-weighted inbound price, the cheapest quote only when no lane carries a
volume; price = demand-weighted outbound; mean demand = Σ outbound volume; §PART VII details per
policy). Every prefilled cell shows a provenance badge; no hidden
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

Each is specified below with its mathematical model.

### III.1 Min-max policy (s, S) ✅

- **Purpose.** Reorder when position falls below $s$; raise it to $S$ (the classic (s,S) rule).
- **Inputs.** *Sets:* item $i$ at facility $f$. *Parameters:*

  | symbol | unit | range | default | meaning |
  |---|---|---|---|---|
  | $s$ | units or day-mult | $0\le s<S$ | — | reorder point |
  | $S$ | units or day-mult | $>s$ | — | order-up-to level |
  | `basis` | enum | days_of_supply \| forward_visible | days_of_supply | Policy Basis (§II.4) under which $s,S$ are realized |

  *State/data read:* $\mathrm{IP}_{i,t}=I_{i,t}+\Pi_{i,t}-B_{i,t}$; MOQ $Q^{\min}_i$; review gate $\rho_t$.
- **Logic.** Trigger $\mathrm{IP}_{i,t}<s$; order to $S$:
  $$O_{i,t}=\rho_t\,(S-\mathrm{IP}_{i,t})^+\,\mathbf 1[\mathrm{IP}_{i,t}<s],\qquad O_{i,t}\leftarrow\max(O_{i,t},Q^{\min}_i)\ \text{if}\ O_{i,t}>0.$$
  Under Days-of-supply basis, $s,S$ are converted via §3.4 first. Feasibility: $S>s\ge0$.
- **Outputs.** $O_{i,t}$ (purchase order / production release, PH-80); levels $s_{i,t},S_{i,t}$ (PH-70). KPI: holding-vs-fill trade-off.
- **UI & engine.** `P-P.1 policy_type=min_max`; today Days-of-supply with $s=\bar D_iL,\ S=\bar D_i(L+\kappa)$; Quantity basis ✚.

### III.2 Min-max with safety stock (s, S, SS) ✚

- **Purpose.** (s,S) with an explicit safety buffer added to both thresholds.
- **Inputs.** *Parameters:* $s,S,\mathrm{SS}\ge0$. *State read:* $\mathrm{IP}_{i,t}$, $Q^{\min}_i$, $\rho_t$; $\mathrm{SS}$ may instead be supplied by a §IV.4 method (which overrides the manual value).
- **Logic.** $O_{i,t}=\rho_t\big((S+\mathrm{SS})-\mathrm{IP}_{i,t}\big)^+\mathbf 1[\mathrm{IP}_{i,t}<s+\mathrm{SS}]$. Everything shifts up by $\mathrm{SS}$ (more average stock, higher service).
- **Outputs.** $O_{i,t}$; raised levels $s+\mathrm{SS},\,S+\mathrm{SS}$. KPI: service ↑, holding ↑.
- **UI & engine.** ✚ (fuses P-P.1 with the P-P.3 buffer into one selectable type).

### III.3 (R, Q) policy ✅

- **Purpose.** Reorder a **fixed lot** $Q$ whenever position drops below $R$.
- **Inputs.** *Parameters:* $R$ (reorder point), $Q\ge Q^{\min}_i$ (lot). *State read:* $\mathrm{IP}_{i,t}$, $\rho_t$.
- **Logic.** Multi-lot to clear the deficit: $O_{i,t}=\rho_t\,Q\big\lceil (R-\mathrm{IP}_{i,t})^+/Q\big\rceil\mathbf 1[\mathrm{IP}_{i,t}<R]$; single-lot variant $O_{i,t}=\rho_t Q\,\mathbf 1[\mathrm{IP}_{i,t}<R]$. Position saw-tooths in $[R-\!\text{demand},\,R+Q]$.
- **Outputs.** $O_{i,t}$ (fixed-lot order). KPI: cycle-stock, order frequency.
- **UI & engine.** `P-P.1 policy_type=rop_q`, `rop_q_quantity`$=Q$ (engine floors to MOQ); multi-lot ceiling ✚.

### III.4 Base stock / order-up-to (S) ✅

- **Purpose.** Every review, top the position back up to $S$ (one-parameter order-up-to).
- **Inputs.** *Parameters:* $S$. *State read:* $\mathrm{IP}_{i,t}$, $\rho_t$.
- **Logic.** $O_{i,t}=\rho_t\,(S-\mathrm{IP}_{i,t})^+$ (equivalent to (s,S) with $s=S$).
- **Outputs.** $O_{i,t}$. KPI: low stockout for steady high-frequency demand.
- **UI & engine.** `P-P.1 policy_type=base_stock`.

### III.5 Periodic review (R, S) / (T, S) ✅

- **Purpose.** Order-up-to $S$, but only at review epochs spaced $T$ weeks apart.
- **Inputs.** *Parameters:* $S$; period $T$ (grid column), first check $t_0$. *State read:* $\mathrm{IP}_{i,t}$.
- **Logic.** $O_{i,t}=\mathbf 1[(t-t_0)\bmod T=0]\,(S-\mathrm{IP}_{i,t})^+$. Between reviews position drifts down with demand.
- **Outputs.** $O_{i,t}$. KPI: review-cadence vs stock trade-off.
- **UI & engine.** `P-P.1 policy_type=periodic`, `periodic_review_weeks`$=T$.

### III.6 Regular policy (fixed quantity, periodic) ✚

- **Purpose.** Order a **fixed quantity every period, regardless of stock level** (push/heartbeat). Requires Periodic Check on.
- **Inputs.** *Parameters:* $Q$ (quantity), period $T$, first check $t_0$. *State read:* none (open-loop).
- **Logic.** $O_{i,t}=\mathbf 1[(t-t_0)\bmod T=0]\,Q$. No feedback on position — stock can build or deplete.
- **Outputs.** $O_{i,t}$ (standing delivery). KPI: schedule adherence; risk of over/under-stock.
- **UI & engine.** ✚. *Necessity:* models fixed-schedule supply contracts / heartbeat feeds that the position-triggered family cannot express.

### III.7 Regular policy with safety stock ✚

- **Purpose.** Regular fixed-quantity ordering **plus** a corrective top-up on safety-level violation.
- **Inputs.** *Parameters:* $Q,\mathrm{SS}$, period $T$. *State read:* $\mathrm{IP}_{i,t}$.
- **Logic.** $O_{i,t}=\mathbf 1[(t-t_0)\bmod T=0]\big(Q+(\mathrm{SS}-\mathrm{IP}_{i,t})^+\big)$. **Worked example (ALX):** $Q=5,\mathrm{SS}=0$, position $-7$ ⇒ $O=5+(0-(-7))^+=12$ — so "Regular+SS, SS=0" ≠ "Regular".
- **Outputs.** $O_{i,t}$. KPI: schedule + shortfall protection.
- **UI & engine.** ✚. *Necessity:* the only policy combining a standing schedule with shortfall correction.

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

- **Purpose.** Plan replenishment by **projecting inventory forward** over a horizon and releasing
orders, lead-time-offset, to cover **net requirements** before a safety-stock violation
(forward-looking, unlike the reactive (s,S) family).
- **Inputs.** *Parameters:* $\mathrm{SS}$ (safety level), planning horizon $N$ weeks. *State/data:*
  on-hand $I_{i,t}$; gross requirements from BoM explosion of the production plan/forecast;
  scheduled receipts (pipeline $\Pi$); lead time $L_i$.
- **Logic (standard MRP recursion).** For future weeks $\tau=t,\dots,t+N$:
- Gross requirement $\mathrm{GR}_{i,\tau}$ = BoM-exploded demand for $i$ in week $\tau$
  (from the production plan / forecast).
- Scheduled receipts $\mathrm{SR}_{i,\tau}$ = already-ordered pipeline arriving in $\tau$.
- Projected on-hand: $\mathrm{POH}_{i,\tau} = \mathrm{POH}_{i,\tau-1} + \mathrm{SR}_{i,\tau} + \mathrm{POR}^{\text{recv}}_{i,\tau} - \mathrm{GR}_{i,\tau}$, with $\mathrm{POH}_{i,t-1}=I_{i,t}$.
- Net requirement when the buffer is breached:
  $\mathrm{NR}_{i,\tau} = \big(\mathrm{SS} + \mathrm{GR}_{i,\tau} - \mathrm{POH}_{i,\tau-1} - \mathrm{SR}_{i,\tau}\big)^+ .$
- **Planned order receipt** $\mathrm{POR}^{\text{recv}}_{i,\tau} = \mathrm{NR}_{i,\tau}$ (lot-for-lot;
  or lot-sized per §IV.2), and the **planned order release** is offset by lead time:
  $$O_{i,\,\tau - L_i} \mathrel{+}= \mathrm{POR}^{\text{recv}}_{i,\tau}.$$
  The order **released this week** is $O_{i,t}$ from that offset schedule — timed so receipts land
  exactly when projected on-hand would otherwise fall below $\mathrm{SS}$ (ALX's "detect violation →
  size the order → back-date by lead time").
- **Outputs.** $O_{i,t}$ (lead-time-offset planned release); the projected schedule. KPI: fewer
  stockouts than reactive rules at equal buffer, at the cost of forecast dependence.
- **UI & engine.** ✚. Maps onto PH-70 (which already projects $D_m$ through the BoM); MRP
  generalizes it from single-period to $N$-period look-ahead. *Necessity:* the canonical
  dependent-demand method; distinct from reactive rules by being forward-projecting.

### III.12 Cross-dock ⛔ (needs DC echelon — Phase E)

- **Purpose.** A facility that holds **no** inventory and **transfers** inbound directly to outbound.
- **Inputs.** *Parameters:* none. *State/data:* inbound flow, handling capacity.
- **Logic.** $I_{i,t}\equiv0$; $\text{outbound}_{i,t}=\text{inbound}_{i,t}$ (flow-through, capped by handling capacity).
- **Outputs.** pass-through shipments; no holding cost. KPI: throughput, no inventory stats.
- **UI & engine.** ⛔ — no distribution-center node exists in the single-plant engine; specified for
  completeness, activated with the warehouse/DC echelon (blueprint Phase E, `P-W.x`).

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

### III-D.6 Forward delivery schedule (demand visibility) ✅ `P-C.6` — *customer stage*

- **Purpose.** Let a customer commit **future** orders over a visibility horizon, so the focal
  plant can plan procurement against a known forward order book (the WSC-2026 assumption).
- **Inputs.** *Sets:* customer $c$, product $p$. *Parameters:*

  | symbol | unit | range | default | meaning |
  |---|---|---|---|---|
  | $\tau^\ast$ (`visibility_horizon`) | weeks | ≥1 | 52 | how far ahead the forward schedule is known |
  | $\{\tilde D_{p,c}[t{+}k]\}_{k=0}^{\tau^\ast}$ | units | ≥0 | — | committed forward quantities (deterministic schedule) or a forward-generating rule |

  *State/data read:* the demand-generation policy (III-D.1–4) may *produce* the forward schedule
  stochastically; here it is exposed forward rather than only at realization.
- **Logic.** At week $t$ the plant sees $\tilde D_{p,c}[t..t{+}\tau^\ast]$. Realized demand
  $D_{p,c}[t]=\tilde D_{p,c}[t]$ is served this week; the tail $\tilde D_{p,c}[t{+}1..t{+}\tau^\ast]$
  drives material planning. Forward material demand $\hat D_m[\tau]=\sum_p(\sum_c\tilde D_{p,c}[\tau])\,r_{p,m}$
  feeds the **Forward-visible coverage basis** (§II.4) consumed by plant inventory control (§III.1).
- **Outputs.** the forward demand tensor $\tilde D_{p,c}[t..t{+}\tau^\ast]$ (a customer-stage output
  read by the focal plant). KPI: enables MRP/coverage sizing to a committed book rather than a mean.
- **UI & engine.** ✅ engine (`forward_visibility`, P-C.6, ANTICIPATION, PH-10 resident); UI ✚.
  *Engine binding:* the world demand schedule is pre-drawn for the full horizon plus a
  `settings.visibility_horizon` forward tail (realized demand is bit-identical to per-week
  draws — an information lever, never a world change); P-C.6 publishes $\tau^\ast$ as
  `ctx.visibility_horizon` (param override, default = the settings value, never beyond it) and
  the plant reads BoM-exploded window sums through `ctx.forward_material_demand`. *Necessity:*
  this is the customer-side half of the Forward-visible basis; without it, only Quantity /
  Days-of-supply bases are available, and the WSC-2026 MTO model cannot be reproduced
  trajectory-exactly. *Stage boundary:* the customer **owns** $\tau^\ast$ and the schedule; the
  plant only **reads** it — a clean cross-stage contract, no hidden coupling.

---

## PART IV — Plant-side policy libraries

### IV.1 Sourcing / Procurement

**Category decision.** For each *(plant, material)*: which supplier link(s) receive the material's
replenishment order $O_{m,t}$ (set by the inventory policy, §III), in what split $w_{m,s}$. Common
output for all types: $O_{\ell,t}=w_{m,s}\,O_{m,t}$ with $\sum_{\ell\in\mathcal L_m}O_{\ell,t}=O_{m,t}$.
**Timing and quantity are not sourcing decisions** (timing = review gate $\rho_t$; quantity = $O_{m,t}$).

#### IV.1.1 Single sourcing ✅

- **Purpose.** Send 100% of a material's order to one supplier (the cheapest, by default).
- **Inputs.** *Parameters:* primary $s^\star$ (default = $\arg\min_\ell c_\ell$). *State/data:* $O_{m,t}$; link costs $c_\ell$.
- **Logic.** $w_{m,s^\star}=1$, $w_{m,s}=0$ otherwise ⇒ $O_{\ell^\star,t}=O_{m,t}$.
- **Outputs.** $O_{\ell^\star,t}$ (PH-80). KPI: lowest purchase cost, single-point exposure.
- **UI & engine.** ✅ (engine default primary = min-cost link).

#### IV.1.2 Multi-sourcing, fixed split ✅ `P-S.2`

- **Purpose.** Split the standing order across several suppliers by fixed shares (diversification).
- **Inputs.** *Parameters:* $\{w_{m,s}\}$ ($\sum_s w_{m,s}=1$, each $\ge$ `min_share_pct`∈[5,50]%); `secondary_premium` $\pi_s$; `rebalance_trigger`∈{none,disruption}. *State/data:* $O_{m,t}$, $\phi_t$; inbound `volume` (prefills shares).
- **Logic.** $O_{\ell,t}=w_{m,s}O_{m,t}$. If `disruption` and $s$ firm-visibly disrupted ($\phi_t{=}1$): $w_{m,s}\!\to\!0$, redistribute pro-rata (respecting `min_share_pct`). Premium $\sum_{s\ne s^\star}(c_\ell-c_{\ell^\star}+\pi_s)O_{\ell,t}\to\mathcal C^{res}$.
- **Outputs.** One $O_{\ell,t}$ per link; premium to cost ledger. KPI: resilience vs premium cost.
- **UI & engine.** ✅ `P-S.2` (PH-80). *Was unreachable from UI — gap G3; the grid exposes it.*

#### IV.1.3 Primary + backup (contingent) ✅ `P-S.1`

- **Purpose.** Use the primary normally; reroute to a backup only when the primary is disrupted or coverage runs low.
- **Inputs.** *Parameters:* `activation_trigger`∈{on_disruption,coverage_threshold}; $\theta$ `coverage_threshold_weeks`∈[0.5,26]; `selection_rule`∈{min_cost,min_leadtime,reliability}; $L_{s'}$ backup lead time; `cooldown_weeks`∈[0,8]; `enabled_materials`. *State/data:* $\phi_t$, $\mathrm{pos}_{m,t}$, $\hat D^{\mathrm m}_{m,t}$; prices, $r_s$.
- **Logic.** Engage iff $[\text{on\_disruption}\wedge\phi_t{=}1\wedge s^\star \text{ disrupted}]\vee[\text{coverage}\wedge \mathrm{pos}_{m,t}/\hat D^{\mathrm m}_{m,t}<\theta]$. On engage, move $O_{\ell^\star,t}$ to backup $\ell'=\arg\min\{c_\ell\mid L_\ell\mid -r_s\}$; arrives at $t+L_{s'}$; premium to $\mathcal C^{res}$; hold `cooldown_weeks` after $\phi_t{\to}0$.
- **Outputs.** Rerouted $O_{\ell',t}$; premium to ledger. KPI: availability protection, contingent cost.
- **UI & engine.** ✅ `P-S.1` (PH-80). Composes with IV.1.2 (`check_portfolio` warns on overlap).

#### IV.1.4 Ranked selection ✅

- **Purpose.** Always source 100% from the best link under a single criterion.
- **Inputs.** *Parameters:* `selection_rule`∈{min_cost,min_leadtime,reliability}. *State/data:* $c_\ell,L_\ell,r_s$.
- **Logic.** $s^\star=\arg\min_\ell\{c_\ell\}$ / $\arg\min_\ell\{L_\ell\}$ / $\arg\max_s\{r_s\}$; then as single sourcing.
- **Outputs.** $O_{\ell^\star,t}$. KPI: optimizes the chosen dimension.
- **UI & engine.** ✅ (P-S.1 `selection_rule` reused for standing choice).

#### IV.1.5 Capacity-proportional ✚

- **Purpose.** Spread the order across suppliers in proportion to their capacity.
- **Inputs.** *Parameters:* none. *State/data:* $K_s$ per link.
- **Logic.** $w_{m,s}=K_s/\sum_{s'\in\mathcal L_m}K_{s'}$; $O_{\ell,t}=w_{m,s}O_{m,t}$.
- **Outputs.** $O_{\ell,t}$ per link. KPI: load-balanced sourcing, less queue congestion.
- **UI & engine.** ✚ (needs finite $K_s$, §IV.6). *Necessity:* the natural split when suppliers differ in size.

#### IV.1.6 Tiered quota with floors ✚

- **Purpose.** Primary quota with contractual minimum volumes guaranteed to secondary sources.
- **Inputs.** *Parameters:* tier shares $\{w_{m,s}\}$, per-source floors $\underline O_{m,s}$. *State/data:* $O_{m,t}$.
- **Logic.** Assign floors first: $O_{\ell,t}=\max(\underline O_{m,s},\,w_{m,s}O_{m,t})$; residual to primary; renormalize if $\sum>O_{m,t}$.
- **Outputs.** $O_{\ell,t}$. KPI: honors minimum-purchase contracts.
- **UI & engine.** ✚. *Necessity:* models take-or-pay / minimum-commitment supply agreements.

### IV.2 Production

#### IV.2.a Build discipline (MTS / MTO / ATO)

- **Purpose.** For each *(factory, product)*: decide the weekly build quantity $x_{p,t}$.
- **Inputs.** *Parameters:* discipline ∈ {MTS, MTO, ATO}; MTS uses $S^{FG}_p$ (from §IV.4). *State/data:* FG position $\mathrm{IP}^{FG}_{p,t}=Y_{p,t}+\text{WIP}-B_{p,t}$; demand $D_{p,t}$, backlog $B_{p,t}$; capacity $\text{cap}_{p,t}$ (§IV.3); on-hand $I_{m,t}$, BoM $b_{p,m}$.
- **Logic.** MTS: $x_{p,t}=(S^{FG}_p-\mathrm{IP}^{FG}_{p,t})^+$ ✅. MTO: $x_{p,t}=D_{p,t}+B_{p,t}$ ✅ (default). ATO ⛔ reserved. Then **execution clip** at PH-50: $g_{p,t}=\min\!\big(x_{p,t},\ \text{cap}_{p,t},\ \min_m\lfloor I_{m,t}/b_{p,m}\rfloor\big)$.
- **Outputs.** $x_{p,t}$ (PH-40 `production_plan`), $g_{p,t}$ (PH-50 `production_output`); consumes $b_{p,m}g_{p,t}$ of each material. KPI: fill rate, WIP, capacity/material utilization.
- **UI & engine.** ✅ (the P-P.0 greedy-plan mechanic, named as a selectable discipline). Products mix MTS/MTO (decoupling per product, ADR 0001).

#### IV.2.b Lot sizing (modifier on the release quantity) 🧩 `P-P.2`

- **Purpose.** Convert a net requirement $\mathrm{NR}$ into a released lot.
- **Inputs.** *Parameters:* rule ∈ {lot_for_lot, fixed_qty, EOQ, EPQ, POQ}; $A$ setup/ordering cost, $P$ production rate, $T$ POQ periods, $c^h,c$. *State/data:* $\mathrm{NR}$, $\bar D$, MOQ.
- **Logic.** lot_for_lot: lot $=\mathrm{NR}$ ✅. fixed_qty: $Q$ (≥MOQ). EOQ: $Q^\ast=\sqrt{2A\bar D/(c^h c)}$. EPQ: $Q^\ast/\sqrt{1-\bar D/P}$. POQ: cover $T$ periods of demand. All floored to MOQ.
- **Outputs.** the released lot (feeds $O_{i,t}$ / $x_{p,t}$). KPI: setup vs holding trade-off.
- **UI & engine.** 🧩 `P-P.2` (schema registered). lot-for-lot is the ✅ weekly default.

#### IV.2.c Dispatching / sequencing under scarcity ✚ `P-P.11`

- **Purpose.** When capacity or material cannot serve all backlog, decide the service order.
- **Inputs.** *Parameters:* rule ∈ {FIFO, EDD, SPT, CR}; due dates / priority tiers. *State/data:* backlog set, $\text{cap}_{p,t}$, material availability.
- **Logic.** Order backlog by rule — FIFO (arrival), EDD (earliest due), SPT (shortest processing), CR ($=\frac{\text{time to due}}{\text{processing time}}$, smallest first) — serve until capacity/material exhausted.
- **Outputs.** the served subset (shapes $g_{p,t}$ / $F_{p,t}$). KPI: due-date performance, lateness.
- **UI & engine.** ✚ `P-P.11` (weekly-bucket priority). Sub-weekly machine scheduling ⛔ (fidelity boundary).

#### IV.2.d Material allocation under scarcity ✅ `P-P.9` — *focal plant*

- **Purpose.** When materials cannot cover all products' plans, decide **how much of each product
  to actually build** — a constrained allocation of scarce materials across products.
- **Inputs.** *Parameters:* `objective`∈{max_revenue, max_fill_rate, priority_weighted,
  fg_replenish, **min_unmet**}; `solver`∈{lp, greedy}; `window_weeks` $W$∈[1,13] (rolling horizon,
  default 4); `activation`∈{during_disruption, always}; `annual_cost` (planner labor, €6240);
  `priority_weights`. *State/data read:* product plans $Q_p[t]$ (from §IV.2.a), on-hand $I_m[t]$,
  BoM $r_{p,m}$, capacity $O_p$, prices $u_p$, $\phi_t$.
- **Logic.** Solve, over the rolling window, for realized build $R_p[t]\le Q_p[t]$:
  $$\begin{aligned}
  \textstyle\max/\min\ & \Phi(R)\ \ \text{per \texttt{objective}}
  &&\hspace{-2em}\text{(e.g. }\max\sum_p u_p R_p;\ \ \boxed{\min\sum_p (Q_p[t]-R_p[t])}\text{ = \texttt{min\_unmet}}\text{)}\\
  \text{s.t.}\ & \textstyle\sum_p R_p[t]\,r_{p,m}\le I_m[t] && \forall m\quad(\text{material availability})\\
  & R_p[t]\le O_p[t],\quad R_p[t]\le Q_p[t] && \forall p\quad(\text{capacity, plan})\\
  & R_p[t]\in\mathbb N_0 && \forall p.
  \end{aligned}$$
  `min_unmet` (Paper 2's objective) $=\min\sum_p(Q_p-R_p)$ is the unweighted dual of `max_fill_rate`;
  `max_revenue` weights the shortfall by $u_p$. HiGHS LP solver (`greedy` = revenue-ranked heuristic,
  the R3 fallback). Activates only while $\phi_t{=}1$ under `during_disruption`.
- **Outputs.** $R_p[t]$ = the feasible build (reshapes `production_plan`); planner cost to $\mathcal C^{res}$.
- **UI & engine.** ✅ `P-P.9` (PH-40). *Was implemented but undocumented as an entry and unreachable
  from the UI (gap G3)* — now specified. **`min_unmet` is the ✚ objective needed to reproduce Paper 2's LP.**

### IV.3 Capacity

#### IV.3.1 Fixed base capacity ✅

- **Purpose.** Cap weekly output at a fixed rate. **Inputs.** *Parameters:* $O_p$ (`products.production_capacity`). **Logic.** $\text{cap}_{p,t}=O_p$. **Outputs.** the PH-50 clip. **UI & engine.** ✅ (data; default $\max(2\bar D_p,1000)$ if unset — see §IV.6 for why this must be made explicit).

#### IV.3.2 Overtime / short-term flex ✅ `P-P.5`

- **Purpose.** Grant temporary extra capacity when it is worth paying for.
- **Inputs.** *Parameters:* $\bar\omega$ `max_overtime_factor`∈[1,2], $\pi^o$ `overtime_premium_pct_of_price`∈[1,25]%, `activation`∈{revenue_positive, always_during_disruption}. *State/data:* $D_{p,t},B_{p,t},O_p$, $\phi_t$, $u_p$.
- **Logic.** $\omega_{p,t}=\min\!\big((\bar\omega-1)O_p,\ (D_{p,t}+B_{p,t}-O_p)^+\big)\mathbf 1[\text{activation}]$; activation = revenue_positive (only if $u_p(1-\pi^o)>0$ and unmet demand exists) or during $\phi_t{=}1$. Cost $\pi^o u_p\omega_{p,t}\to\mathcal C^{res}$.
- **Outputs.** $\omega_{p,t}$ (PH-40) lifting $\text{cap}_{p,t}=O_p+\omega_{p,t}$. KPI: recovered fill vs overtime cost.
- **UI & engine.** ✅ `P-P.5`. **Key result:** *inert when materials, not machines, bind* — raising the cap does nothing if $\min_m\lfloor I_m/b_{p,m}\rfloor$ is binding.

#### IV.3.3 Standing capacity reserve 🧩 `P-P.6`

- **Purpose.** Pre-pay a permanent capacity cushion. **Inputs.** *Parameters:* $\gamma$ `reserve_factor`∈[0,0.5], `standing_cost` €/wk. **Logic.** $\text{cap}_{p,t}=O_p(1+\gamma)$ always; cost accrues weekly. **Outputs.** raised cap. **UI & engine.** 🧩 `P-P.6`.

### IV.4 Safety stock (sizing methods that feed §III)

**Common output.** Each method computes a buffer $\mathrm{SS}_i$ that inventory policies (§III.2/7/11) and FG targets add to reorder points/levels — a declared upstream edge, not a hidden coupling.

#### IV.4.1 Fixed days of cover ✅

- **Inputs.** *Parameters:* $d$ (`fixed_days_cover` days ∈[0,84]). *State/data:* $\bar D_i$. **Logic.** $\mathrm{SS}_i=(d/7)\bar D_i$. **Outputs.** $\mathrm{SS}_i$. **Engine.** ✅ `fixed_days`.

#### IV.4.2 Service level (z-based) ✅

- **Inputs.** *Parameters:* $\alpha$ `uniform_service_level`∈[80,99.9]%. *State/data:* $\sigma_D=\mathrm{CV}_i\bar D_i$, $L_i$. **Logic.** $\mathrm{SS}_i=z(\alpha)\,\sigma_D\sqrt{L_i}$, $z(\alpha)=\Phi^{-1}(\alpha)$. **Outputs.** $\mathrm{SS}_i$. **Engine.** ✅ `uniform`.

#### IV.4.3 Demand + lead-time variability (King) ✅

- **Inputs.** *Parameters:* $\alpha$. *State/data:* $\sigma_D$, $\sigma_L$ (lead-time std, §IV.6), $\bar D_i$, $L_i$. **Logic.** $\mathrm{SS}_i=z(\alpha)\sqrt{L_i\sigma_D^2+\bar D_i^2\sigma_L^2}$ — correct when lead time is itself stochastic. **Outputs.** $\mathrm{SS}_i$. **Engine.** ✅ `king`.

#### IV.4.4 ABC-XYZ matrix ✅ (`P-P.3` materials, `P-P.4` FG)

- **Inputs.** *Parameters:* `abc_breakpoints` (A≤80%, B≤95% cumulative value), `xyz_cv_breakpoints` (X≤0.13, Y≤0.25), `z_matrix` (9 cells → service level). *State/data:* annual value $c_i\bar D_i$ (rank→ABC), $\mathrm{CV}_i$ (→XYZ).
- **Logic.** Classify item into an ABC×XYZ cell; read $\alpha_{cell}$ from `z_matrix`; then $\mathrm{SS}_i=z(\alpha_{cell})\sigma_D\sqrt{L_i}$. FG (P-P.4): $S^{FG}_p=\bar D_pL^{prod}_p+z^{FG}_p\sigma_{D_p}\sqrt{L^{prod}_p}$; `abc_by_revenue` segmentation (A=set SL, B−2pp, C−5pp, floor 80).
- **Outputs.** per-item $\mathrm{SS}_i$ / $S^{FG}_p$. KPI: differentiated service, targeted holding.
- **Engine.** ✅ `abc_xyz`. FG requires `products.sell_price` (revenue ranking).

### IV.5 Forecasting ✚ (drives MRP, MTS targets, safety stock)

- **Purpose.** For each *(facility, product)*: produce the demand forecast $\hat D_{p,t}$.
- **Inputs.** *Parameters:* method ∈ {naive, moving_average, SES, Holt, Holt-Winters, Croston}; smoothing $\alpha,\beta,\gamma\in(0,1)$; window $k$; season length $M$. *State/data:* demand history $\{D_{p,u}\}_{u<t}$.
- **Logic (update equations).**
  - naive: $\hat D_{t+1}=D_t$.
  - moving average: $\hat D_{t+1}=\frac1k\sum_{u=0}^{k-1}D_{t-u}$.
  - SES: $\hat D_{t+1}=\alpha D_t+(1-\alpha)\hat D_t$.
  - Holt: $\ell_t=\alpha D_t+(1-\alpha)(\ell_{t-1}+b_{t-1})$; $b_t=\beta(\ell_t-\ell_{t-1})+(1-\beta)b_{t-1}$; $\hat D_{t+h}=\ell_t+hb_t$.
  - Holt-Winters: add seasonal $s_t=\gamma(D_t-\ell_t)+(1-\gamma)s_{t-M}$; $\hat D_{t+h}=\ell_t+hb_t+s_{t-M+h}$.
  - Croston (intermittent): separately smooth nonzero sizes $\hat z_t$ and inter-arrival gaps $\hat n_t$; $\hat D_t=\hat z_t/\hat n_t$.
- **Outputs.** $\hat D_{p,t}$ (PH-10 `forecast`); error KPIs bias/MAPE/RMSE.
- **UI & engine.** ✚ `P-F.1` (promoted from the PH-10 built-in). *Necessity:* SES robust default; Holt/HW for trend/seasonality (needs calendar entity); Croston for spare-parts demand.

### IV.6 Supplier capacity & lead-time models (mechanic → policy)

#### IV.6.1 Supplier capacity model ✚ `P-S.5`

- **Purpose.** Set how a supplier's weekly capacity limits shipments.
- **Inputs.** *Parameters:* mode ∈ {infinite, finite_queue, finite_reject}. *State/data:* $K_s$ (`suppliers.capacity_per_week`), queue $\Xi_{s,t}$, inbound orders.
- **Logic.** infinite: $K_s=\infty$ (default). finite: shipped$_{s,t}=\min(\Xi_{s,t},K_s)$; residual re-queues (finite_queue) or is dropped (finite_reject → lost-inbound). Congestion in $\Xi_s$ **is** endogenous lead-time extension.
- **Outputs.** shipped units → $A_{\ell,t}$ (PH-90); queue carry-over. KPI: effective lead time, lost-inbound.
- **UI & engine.** ✚ `P-S.5`. *Necessity:* required for any capacity/disruption analysis to bind — replaces the silent infinite-capacity default (gap G4) with a named choice.

#### IV.6.2 Lead-time model ✚ `P-S.6`

- **Purpose.** Set whether link lead time is fixed or random.
- **Inputs.** *Parameters:* dist ∈ {deterministic, lognormal, gamma}; $L_\ell$ mean, `lead_time_cv`. *State/data:* order ship events.
- **Logic.** deterministic: arrival at $t+L_\ell$. stochastic: sample $\tilde L\sim\text{dist}(L_\ell,\sigma_L)$ at ship time, arrival at $t+\lceil\tilde L\rceil$; $\sigma_L=\text{cv}\cdot L_\ell$.
- **Outputs.** arrival week per shipment → $\Pi,A$. KPI: lead-time variability → pairs with King SS (§IV.4.3).
- **UI & engine.** ✚ `P-S.6` (`materials.lead_time_dist`, `lead_time_cv`).

---

## PART V — Transportation policy library

**Category decision.** For each *(lane)* / *(facility, item)*: mode, consolidation, dispatch
frequency, and expediting. **Prerequisite for modes:** lanes as first-class entities (gap G7);
today lane lead time folds into supplier lead time.

#### V.1 Single-mode (direct) ✅

- **Purpose.** One transport mode per lane, fixed transit and cost. **Inputs.** *Parameters:* mode, cost/unit, transit $L_\ell$. **Logic.** shipments move at $L_\ell$, cost per unit. **Outputs.** $A_{\ell,t}$ at $t+L_\ell$. **Engine.** ✅ (folded into supplier lead time).

#### V.2 Multimodal lane portfolio 🧩 `P-T.1`

- **Purpose.** Split a link's flow across ≤3 lanes/modes. **Inputs.** *Parameters:* `lanes` (≤3/link), `mode_split_pct` (Σ=100). *State/data:* per-lane $L,c$,capacity. **Logic.** flow $\times$ share per lane; effective lead time/cost = share-weighted blend; per-lane capacity caps. **Outputs.** per-lane $\Pi,A$. **Engine.** 🧩 `P-T.1` (activate first — prerequisite for modes).

#### V.3 Mode shift (reactive) 🧩 `P-T.3`

- **Purpose.** Under disruption, shift a lane to a faster mode. **Inputs.** *Parameters:* `upgrade_lane`, `lt_saving_weeks`, `upgrade_cost`. *State/data:* $\phi_t$. **Logic.** while $\phi_t{=}1$ (revenue-positive), move flow to the faster lane, lead time $-$`lt_saving_weeks`, cost $+$`upgrade_cost`/unit. **Outputs.** compressed $\Pi$; cost to ledger. **Engine.** 🧩 (needs P-T.1).

#### V.4 Shipment consolidation ✚ `P-T.5`

- **Purpose.** Hold shipments until a truck is economically full. **Inputs.** *Parameters:* `min_fill`%, window $W$. *State/data:* accumulated units per lane. **Logic.** dispatch when accumulated$_{\ell,t}\ge\text{min\_fill}\cdot\text{capacity}$ **or** $W$ weeks elapsed; else hold. **Outputs.** batched dispatch (adds up to $W$ weeks latency, cuts freight cost). KPI: freight cost vs cycle time. **Engine.** ✚ `P-T.5`.

#### V.5 Shipping frequency ✚ `P-T.6`

- **Purpose.** Set dispatch cadence. **Inputs.** *Parameters:* mode ∈ {fixed_weekly, quantity_threshold}; threshold $\bar q$. **Logic.** fixed_weekly: dispatch every week; quantity_threshold: dispatch when accumulated $\ge\bar q$. **Outputs.** dispatch schedule. **Engine.** ✚ `P-T.6`.

#### V.6 Expedited shipments ✅ `P-T.2`

- **Purpose.** Pay premium freight to pull in-transit units forward during disruption.
- **Inputs.** *Parameters:* $\pi^{exp}$ `premium_pct_of_cost`∈[1,50]%, `scope`∈{disrupted_materials,all}, `decision`∈{revenue_positive,always_during_disruption}. *State/data:* $\phi_t$, pipeline $\Pi_{\ell,t}$, backlog, $u_p,c_m$.
- **Logic.** while $\phi_t{=}1$, for in-scope materials, pull pipeline forward ≥1 week at cost $\pi^{exp}c_m$/unit, when revenue-positive (recovered $u_p>\pi^{exp}c_m$).
- **Outputs.** advanced $\Pi\to A$; premium to $\mathcal C^{res}$. KPI: TTR reduction vs expedite cost.
- **UI & engine.** ✅ `P-T.2` (PH-90).

#### V.7 Lead-time hedging 🧩 `P-T.4`

- **Purpose.** Order early by a time buffer for long-lead/critical items. **Inputs.** *Parameters:* `hedge_weeks`, `applies_to`∈{all,long_lt,abc_a_only}, `long_lt_threshold_weeks`. **Logic.** release orders `hedge_weeks` earlier than the policy dictates (time buffer instead of unit buffer). **Outputs.** earlier $O_{i,t}$. **Engine.** 🧩 `P-T.4`.

**Necessity.** Modes/consolidation/frequency are justified once lanes are first-class;
**route optimization / milk-run design is ⛔** (network-design, not weekly simulation).

---

## PART VI — Fulfillment / Customer policy library

**Decision governed.** How unmet demand is handled and how scarce supply is allocated across
customers. **Scope.** (facility, product) and (customer).

### VI.1 Unmet-demand handling ✅ `P-C.1`

- **Purpose.** Decide what happens to demand that stock cannot serve this week.
- **Inputs.** *Parameters:* `rule`∈{lost_sales, backorder, partial_backorder}; `backorder_horizon`∈[0,26] wk; $\pi^{bo}$ `backorder_penalty` €/unit/wk; `partial_accept_prob`∈[0,1]. *State/data:* served $F_{p,t}$, demand $D_{p,t}$, backlog $B_{p,t}$.
- **Logic.** Unmet $U_{p,t}=(D_{p,t}-F_{p,t})^+$.
  - lost_sales: $\Lambda_{p,t}\mathrel+=U_{p,t}$ (unmet gone).
  - backorder: $B_{p,t+1}=B_{p,t}+U_{p,t}-(\text{served backlog})$; entries older than `backorder_horizon` expire → lost; penalty $\pi^{bo}\,B_{p,t}\to\mathcal C^{res}$ each week.
  - partial_backorder: share `partial_accept_prob` of $U$ waits (backordered), remainder lost.
- **Outputs.** `state.backlog` $B$, `state.lost_sales` $\Lambda$ (PH-60); penalty to ledger. KPI: fill rate, lost-sales value, backorder cost.
- **UI & engine.** ✅ `P-C.1` (PH-60). lost_sales is the manuscript default.

### VI.2 Customer allocation under scarcity ✅ `P-C.2`

- **Purpose.** When supply $<$ demand, decide which customers get served first.
- **Inputs.** *Parameters:* `rule`∈{fcfs, proportional, fair_share, priority, sla_tier}; `priority_weights` per customer; `sla_tiers` (segment→fill-floor %). *State/data:* per-customer demand $D_{p,c,t}$ (from `outbound_logistics.volume`), available supply.
- **Logic.** Available $V_{p,t}$ to split:
  - fcfs / proportional / fair_share (coincide at weekly buckets): $F_{p,c}=D_{p,c}\cdot V_{p,t}/\sum_{c'}D_{p,c'}$ (pro-rata).
  - priority: serve customers by `priority_weights` descending until $V_{p,t}$ exhausted.
  - sla_tier: first guarantee each segment its floor $\text{sla}_{seg}\cdot D_{p,c}$; if infeasible scale floors down pro-rata; distribute residual pro-rata.
- **Outputs.** per-customer $F_{p,c,t}$ (reshapes `fulfillment`); per-segment fill KPIs.
- **UI & engine.** ✅ `P-C.2` (PH-60). Requires ≥2 customers; inert for single-customer MTO. `revenue_max` needs per-customer pricing (deferred → maps to priority with a warning).

### VI.3 Minimum split ratio (partial shipment) ✚

- **Purpose.** Allow an order to ship in parts rather than wait for full availability.
- **Inputs.** *Parameters:* $\mu$ `min_split_ratio`∈(0,1]. *State/data:* order size $Q$, available $V$.
- **Logic.** if $\mu$ set and $V\ge\mu Q$: ship $\min(V,Q)$ now (each part $\ge\mu Q$), remainder per backorder policy; else ship-complete (default).
- **Outputs.** partial $F$; reduced delay. KPI: on-time-in-part vs order integrity.
- **UI & engine.** ✚ (ALX semantics; applies to both facility and customer rows).

### VI.4 Backorder / patience behavior ✚ `P-C.5`

- **Purpose.** Model customer patience and delivery-window flexibility.
- **Inputs.** *Parameters:* patience window (weeks) → cancellation; α/β service targets. *State/data:* $B_{p,c,t}$ age.
- **Logic.** backordered demand older than the patience window cancels (→ lost); measure realized α (cycle service) and β (fill rate) against per-customer targets.
- **Outputs.** cancellations, measured service contract. KPI: α/β attainment.
- **UI & engine.** ✚ (demand-side companion to P-C.1).

### VI.5 Demand shaping 🧩 `P-C.3`

- **Purpose.** Move demand (substitution/delay) instead of fighting supply.
- **Inputs.** *Parameters:* `substitution_offer` (product→substitute), `substitution_accept_prob`, `substitution_discount`; `delay_accept_prob`, `delay_incentive`.
- **Logic.** offer substitute/delay; accepted share reroutes demand at a discount/incentive cost.
- **Outputs.** reshaped demand; incentive cost. **UI & engine.** 🧩 `P-C.3` — needs a revenue-elasticity model; activation deferred (no-op today).

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

Operational policies that activate on firm knowledge $\phi_t{=}1$. Backup sourcing (§IV.1.3),
expedite (§V.6), overtime (§IV.3.2), and allocation (§IV.2c/VI.2) are specified in their
categories; this part specifies detection and orchestration.

#### VIII.1 Early-warning failover ✅ `P-S.4`

- **Purpose.** Invest in monitoring so a disruption becomes firm-visible sooner.
- **Inputs.** *Parameters:* $\tau_{\text{mon}}$ `detection_lag_weeks`∈[0,4]; `monitoring_cost` €/yr. *State/data:* disruption state $\delta_t$, event start $t_0$, scenario lag $\tau_{\text{scn}}$.
- **Logic.** $\phi_t=\mathbf 1[t\ge t_0+\min(\tau_{\text{mon}},\tau_{\text{scn}})]$ during the event; standing cost `monitoring_cost`/52 to $\mathcal C^{res}$ weekly.
- **Outputs.** `firm_knowledge` $\phi_t$ (PH-20) — the gate every reactive policy reads. KPI: value of a week of warning.
- **UI & engine.** ✅ `P-S.4`.

#### VIII.2 Recovery playbook 🧩 `P-X.1`

- **Purpose.** Sequence, trigger, and budget recovery actions instead of firing them all at once.
- **Inputs.** *Parameters:* ordered `steps` $\sigma_1,\dots,\sigma_k$; `evaluation_cadence_weeks`∈{1,2}; `cost_cap` €. *State/data:* $\phi_t$, coverage, spend to date.
- **Logic.** every `evaluation_cadence_weeks`, evaluate each step's trigger (over $\phi_t$/coverage); a fired step **enables and retunes** an existing policy's crisis ModeStrip (e.g. detect→expedite→backup→overtime); stop firing once cumulative spend hits `cost_cap`.
- **Outputs.** activations of other policies' crisis modes; spend to ledger. KPI: budgeted TTR.
- **UI & engine.** 🧩 `P-X.1`. Replaces the flat recovery-response list with a programmable sequence.

#### VIII.3 Capacity reservation 🧩 `P-S.3`

- **Purpose.** Reserve supplier capacity, callable on short notice.
- **Inputs.** *Parameters:* $R_{s,m}$ `reserved_capacity` units/wk; `reservation_fee` €/unit/wk; `call_leadtime_weeks`∈[0,4].
- **Logic.** reserved units are exempt from the supplier queue $\Xi_s$: a call ≤$R_{s,m}$ ships within `call_leadtime_weeks` regardless of congestion; standing fee $R_{s,m}\cdot$fee weekly to ledger.
- **Outputs.** guaranteed capacity floor; fee. **UI & engine.** 🧩 `P-S.3`.

#### VIII.4 Standing capacity reserve 🧩 `P-P.6`

- **Purpose.** Pre-pay a permanent production cushion. **Inputs.** $\gamma$ `reserve_factor`∈[0,0.5], `standing_cost` €/wk. **Logic.** $\text{cap}_{p,t}=O_p(1+\gamma)$ always; weekly cost. **Outputs.** raised cap. **Engine.** 🧩 `P-P.6`.

#### VIII.5 Process flexibility / alternative BoM / repurposing 🧩 `P-P.7/8/10`

- **Purpose.** Reroute production or substitute materials under scarcity. **Inputs.** flexibility/substitution maps, switchover/conversion costs and times. **Logic.** when a line or material is constrained, switch a flexible line to another product (P-P.7), substitute an alternative material at rate $r'_{p,m'}$ (P-P.8), or convert a line's capability (P-P.10), each at its cost/time. **Outputs.** rerouted production. **Engine.** 🧩 `P-P.7/8/10`.

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
| 7 | Capacity → Lead time | finite $K_s$→`queue` congestion = endogenous LT (emergent) |
| 8 | Allocation → Service | P-P.9 (PH-40) & P-C.2 (PH-60) reshape `fulfillment` |
| 9 | Disruption → Recovery | `disruption_state`→`firm_knowledge`→P-S.1/S.4/T.2/P.5/X.1 |

Plus: safety-stock→inventory (§IV.4→§III) and sourcing-split→procurement (§IV.1→PH-80).

### IX.3 Accounting & KPIs (PH-99)

Value-weighted, post-warm-up: fill rate $\mathrm{FR}=\frac{\sum_p u_p F_p}{\sum_p u_p D_p}$;
lost sales $\sum_p u_p\Lambda_p$; on-hand value $\sum_i c_i\bar I_i$; revenue; **cost of
resilience** $\mathcal C^{res}$ (holding + backup/multi-source premia + expedite + overtime +
monitoring, per-policy ledgered); TTR/TTS; service-loss area; resilience index (0–100). Every
policy's cost is a declared append to $\mathcal C^{res}$ — cost is attributable per policy.

---

## PART X — Disruption injection & propagation (simulation logic, by stage)

**Framing.** A scenario injects **events**; each event names an affected **stage/entity**, an
**effect type**, a **magnitude**, a start week $t^\ast$, and a **duration** $\Delta t$. At PH-00
the active events set the disruption state $\delta_t$; at PH-20 firm knowledge $\phi_t\to1$ after
the detection lag (compressed by P-S.4). **Policies read $\phi_t$, never $\delta_t$** — the firm
reacts to what it *knows*. This part documents, per stage, what an event modifies and how it
propagates to the KPIs — the simulation-logic half of this single source of truth, and the exact
mechanism the research papers rely on. Affected entity marked with $^\ast$.

### X.1 Supplier stage — *the WSC-2026 disruption*

**X.1.a Lead-time extension** (the paper's case). Supplier $s^\ast$ delayed by $\Delta t$ from
$t^\ast$: effective lead time in the window $T^{disr}_{s^\ast}=T_{s^\ast}+\Delta t$. Scheduled
receipts of affected material $m^\ast$ in $[t^\ast,t^\ast+\Delta t]$ are pushed back by $\Delta t$:
$$I^{R,disr}_{m^\ast}[t+\Delta t]=I^R_{m^\ast}[t],\qquad I^{R,disr}_{m^\ast}[t]=0,$$
and in-transit present in the window propagates forward:
$$I^{T,disr}_{m^\ast}[t+\tau]=I^T_{m^\ast}[t],\quad \forall\tau\in[1,\Delta t-1].$$
**Propagation:** delayed arrivals → $I_{m^\ast}\!\downarrow$ (PH-90) → production feasibility
$\min_m\lfloor I_m/r_{p,m}\rfloor\!\downarrow$ (PH-50) → $Q_p\!\downarrow$ → $F_p\!\downarrow$.
**KPI:** fill rate ↓, backlog ↑, TTR, revenue loss (the stress-test signal, paper Fig. 3).
**Bent by:** P-S.1 backup, P-S.2 rebalance, P-T.2 expedite, P-P.5 overtime, P-P.9 allocation.

**X.1.b Capacity reduction.** $K_{s^\ast}\!\downarrow$. Under finite capacity (P-S.5) shipped
$=\min(\Xi_s,K^{disr}_s)$; residual queues (endogenous lead-time extension) or is rejected
(lost-inbound). Same downstream chain as X.1.a.

### X.2 Focal-plant stage

**Production capacity reduction.** $O_p\!\downarrow$ (per product or plant-wide) for
$[t^\ast,t^\ast+\Delta t]$: $\text{cap}_{p,t}\!\downarrow$ →
$Q_p=\min(D_p,O^{disr}_p,\text{material})\!\downarrow$ → $F_p/Y_p\!\downarrow$. **KPI:** fill rate ↓,
TTS. **Bent by:** P-P.5 overtime (lifts cap), P-P.9 allocation (reshapes which products absorb the
shortfall).

### X.3 Transport stage

**Lane transit delay.** Lane $\ell$ transit $+\Delta t$: folds into the effective link lead time
(as X.1.a, lane-scoped) → arrivals delayed → $I_m\!\downarrow$. **Bent by:** P-T.2 expedite,
P-T.3 mode-shift.

### X.4 Customer stage

**Demand surge** 🧩. $D_p\!\uparrow$ at PH-10: higher draw → $B_p\!\uparrow$, material demand
$D_m\!\uparrow$ → procurement ↑. **KPI:** fill rate ↓. Planned event class (needs a demand-side
effect type, gap G11).

### X.5 Scope — stress testing is an experiment, not a policy

Systematically applying X.1 to **each** supplier and ranking the resulting revenue loss is the
**vulnerability ranking** (paper Fig. 3). That sweep is an **experiment** (blueprint §9, ST-1
battery) that *consumes* the propagation model above; it is not a policy and is documented in the
experiment layer, not here. This single source of truth owns the **propagation mechanism** (X.1–X.4);
the blueprint owns the **experiment machinery** that drives it.

---

## Appendix A — Engine binding (implemented ✅ · specified ✚ · registered-planned 🧩)

| Category | ✅ today | ✚ to add | 🧩 registered |
|---|---|---|---|
| Inventory | min_max, rop_q, base_stock, periodic; bases: days_of_supply, forward_visible (P-C.6 book) | min_max_ss, regular, regular_ss, order_on_demand, unlimited, no_replenishment, MRP, Quantity-basis | — |
| Sourcing | single, multi (P-S.2), backup (P-S.1), ranked | capacity-proportional, tiered | capacity_reservation (P-S.3) |
| Production | MTS, MTO | dispatching (P-P.11) | lot_sizing (P-P.2), flex/altBoM/repurpose |
| Capacity | overtime (P-P.5) | supplier-capacity model (P-S.5) | standing reserve (P-P.6) |
| Safety stock | fixed_days, service_level, king, abc_xyz | — | — |
| Forecasting | built-in SES-like | SES/Holt/HW/Croston/MA/naive (P-F.1) | — |
| Transport | expedite (P-T.2) | consolidation (P-T.5), frequency (P-T.6) | lane portfolio/mode-shift/hedge |
| Fulfillment | lost_sales, backorder, allocation | min_split_ratio, patience (P-C.5) | demand_shaping (P-C.3) |
| Demand/LT | triangularAV, det/stoch LT; forward schedule τ* (P-C.6) | demand_model (P-C.4), lead_time_model (P-S.6) | — |
| Recovery | early-warning (P-S.4) | — | playbook (P-X.1) |

## Appendix B — Symbol index

$t,m,p,s,c,\ell$ indices; $I$ on-hand; $\mathrm{IP}$ position; $\Pi$ pipeline; $\Xi$ queue; $B$
backlog; $\Lambda$ lost; $Y/Y^\star$ FG stock/target; $D/\hat D$ demand/forecast; $\phi$ firm
knowledge; $O$ order; $x/g$ plan/output; $\omega$ overtime; $F$ fulfillment; $A$ arrivals;
$\mathcal C^{res}$ cost ledger; $L$ lead time; $K_s/O_p$ capacity; $b_{p,m}$ BoM; $u_p$ value;
$c_m$ cost; $\mathrm{SS}$ safety stock; $\rho_t$ review gate; $\kappa$ coverage; $z(\alpha)$
service-level factor; $\sigma_D/\sigma_L$ demand/lead-time std.

## Appendix C — Change control

Authoritative policy & simulation-logic specification. Any change to a policy type, parameter,
equation, UI column, prefill rule, preset, or engine binding **must** update this file in the
same change. Implemented-policy parameters verified against
`src/lib/policies/registry.generated.json`; ✚ types specified to implementable rigor. Cross-refs:
`docs/design/next-gen-platform-design.md` (blueprint), `docs/design/platform-architecture-report.md`
(architecture), `docs/data-simulation-mapping.md` (mapping contract).
