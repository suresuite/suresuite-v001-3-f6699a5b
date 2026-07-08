# SureSuite — Supply Chain Policy Library & Simulation Logic (authoritative specification)

| | |
|---|---|
| **Status** | v2.0 — reframed: *policies* (operational decision rules), not *strategies*; comprehensive per-category policy library with mathematical models and the UI/coding contract. |
| **Date** | 2026-07-07 |
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

Each is specified below with its mathematical model.

### III.1 Min-max policy (s, S) ✅

- **Purpose.** Reorder when position falls below $s$; raise it to $S$ (the classic (s,S) rule).
- **Inputs.** *Sets:* item $i$ at facility $f$. *Parameters:*

  | symbol | unit | range | default | meaning |
  |---|---|---|---|---|
  | $s$ | units or day-mult | $0\le s<S$ | — | reorder point |
  | $S$ | units or day-mult | $>s$ | — | order-up-to level |

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

**Purpose.** Plan replenishment by **projecting inventory forward** over a horizon and releasing
orders, lead-time-offset, to cover **net requirements** before a safety-stock violation. Unlike the
reactive (s,S) family, MRP is *forward-looking*. **Parameters.** $\mathrm{SS}$ (safety level),
planning horizon $N$ weeks; uses gross requirements from BoM explosion of the production plan and
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

### IV.1 Sourcing / Procurement

**Decision governed.** For each *(plant, material)*: which supplier(s) receive the material's
replenishment order $O_{m,t}$ (produced by the inventory policy, §III), in what split. Links
$\mathcal L_m=\{(s,m)\}$; cost $c_\ell$, lead time $L_\ell$, reliability $r_s$; weights $w_{m,s}$.

| # | Policy type | Split rule | Engine |
|---|---|---|---|
| 1 | **Single sourcing** | all to cheapest $s^\star$ | ✅ |
| 2 | **Multi-sourcing (fixed split)** | fixed quotas $w_{m,s}$ | ✅ `P-S.2` |
| 3 | **Primary + backup (contingent)** | primary unless disrupted → backup | ✅ `P-S.1` |
| 4 | **Ranked selection** | 100% to min_cost / min_leadtime / reliability | ✅ |
| 5 | **Capacity-proportional** | $w_{m,s}\propto K_s$ | ✚ |
| 6 | **Tiered quota with floors** | quotas + minima | ✚ |

**Model.** $O_{\ell,t}=w_{m,s}O_{m,t}$, $\sum_\ell O_{\ell,t}=O_{m,t}$. Fixed split: $w_{m,s}\ge$`min_share_pct`, non-primary premium to $\mathcal C^{res}$. Contingent: 100% primary while $\phi_t=0$; reroute to backup on firm-visible disruption, hold `cooldown_weeks`. **Timing & quantity are not sourcing policies** — timing is the inventory review gate $\rho_t$, quantity is $O_{m,t}$; sourcing sets only the split.

### IV.2 Production

**IV.2.a Build discipline.** MTS: $x_{p,t}=(S^{FG}_p-\mathrm{IP}^{FG}_{p,t})^+$ ✅. MTO: $x_{p,t}=D_{p,t}+B_{p,t}$ ✅ (default). ATO ⛔ reserved. Both capacity- and material-clipped at PH-50: $g_{p,t}=\min(x_{p,t},\text{cap}_{p,t},\min_m\lfloor I_{m,t}/b_{p,m}\rfloor)$. (The P-P.0 mechanic, named.)

**IV.2.b Lot sizing.** lot-for-lot ✅ | fixed-$Q$ | EOQ $Q^\ast=\sqrt{2A\bar D/(c^h c)}$ | EPQ $=Q^\ast/\sqrt{1-\bar D/P}$ | POQ (cover $T$ periods). 🧩 `P-P.2`.

**IV.2.c Dispatching (scarcity ordering).** FIFO | EDD | SPT | Critical-Ratio ($\frac{\text{time to due}}{\text{proc time}}$). ✚ `P-P.11`. Sub-weekly scheduling ⛔.

### IV.3 Capacity

Base $O_p$ ✅ | **Overtime** ✅ `P-P.5`: $\omega_{p,t}=\min((\bar\omega-1)O_p,(D_{p,t}+B_{p,t}-O_p)^+)\mathbf 1[\text{activation}]$, cost $\pi^o u_p\omega$; **inert when materials bind** | **Standing reserve** $O_p(1+\gamma)$ 🧩 `P-P.6`.

### IV.4 Safety stock (sizing methods that feed §III)

fixed-days $d\bar D_i$ ✅ | service-level $z(\alpha)\sigma_D\sqrt{L_i}$ ✅ | **King** $z(\alpha)\sqrt{L_i\sigma_D^2+\bar D_i^2\sigma_L^2}$ ✅ | **ABC-XYZ** 3×3 $z$-matrix ✅ (`P-P.3` materials, `P-P.4` FG revenue-ABC). Output $\mathrm{SS}_i$ is consumed by the inventory policy — a declared edge, not hidden.

### IV.5 Forecasting (drives MRP, MTS targets, safety stock)

naive $\hat D_{t+1}=D_t$ | MA-$k$ | **SES** $\alpha D_t+(1-\alpha)\hat D_t$ | **Holt** (level+trend) | **Holt-Winters** (+seasonal $M$) | **Croston** (intermittent). Error KPIs (bias/MAPE/RMSE) exposed. ✚ (promoted PH-10 mechanic).

### IV.6 Supplier capacity & lead-time models (mechanic → policy)

**Capacity** ✚ `P-S.5`: infinite | finite-queue (wait in $\Xi_s$) | finite-reject; shipped$=\min(\Xi_s,K_s)$ → congestion = endogenous lead-time extension. **Lead-time** ✚ `P-S.6`: deterministic | stochastic (lognormal/gamma, CV `lead_time_cv`) — pairs with King SS.

---

## PART V — Transportation policy library

**Decision governed.** For each *(lane)* or *(facility, item)*: mode, consolidation, dispatch
frequency, and expediting. **Prerequisite for modes:** lanes as first-class entities (gap G7);
today lane lead time folds into supplier lead time.

| # | Policy type | Parameters | Model | Engine |
|---|---|---|---|---|
| 1 | **Single-mode (direct)** | mode, cost, transit | fixed $L_\ell$, cost per unit | ✅ (folded) |
| 2 | **Multimodal lane portfolio** | ≤3 lanes/link, mode split % | $L,c$ blend by share | 🧩 `P-T.1` |
| 3 | **Mode shift (reactive)** | upgrade lane, LT saving, cost | on $\phi_t=1$, shift to faster mode | 🧩 `P-T.3` |
| 4 | **Shipment consolidation** | min-fill %, window $W$ | hold until fill $\ge$ threshold or $W$ elapses | ✚ `P-T.5` |
| 5 | **Shipping frequency** | fixed weekly \| quantity-threshold | dispatch when accumulated $\ge$ threshold | ✚ `P-T.6` |
| 6 | **Expedited shipments** | premium %, scope, decision | pull pipeline forward at premium | ✅ `P-T.2` |
| 7 | **Lead-time hedging** | hedge weeks, applies-to | order earlier by a time buffer | 🧩 `P-T.4` |

**Model (expedite, P-T.2).** While $\phi_t=1$, for disrupted (or all) materials, pull in-transit
units forward one or more weeks at cost $\pi^{exp} c_m$ per unit, when **revenue-positive**
($u_p$ recovered $> \pi^{exp}c_m$). **Model (consolidation).** dispatch when
$\text{accumulated}_{\ell,t}\ge \text{min\_fill}\cdot\text{capacity}$ or window $W$ elapses —
trades cycle time for freight cost. **Necessity.** Modes/consolidation/frequency justified once
lanes are first-class; **route optimization / milk-run design is ⛔** (network-design, not
weekly simulation).

---

## PART VI — Fulfillment / Customer policy library

**Decision governed.** How unmet demand is handled and how scarce supply is allocated across
customers. **Scope.** (facility, product) and (customer).

### VI.1 Unmet-demand handling (`P-C.1` ✅)

| Policy type | Model |
|---|---|
| **Lost sales** ✅ | unmet $U_{p,t}=(D_{p,t}-F_{p,t})^+$ becomes lost: $\Lambda_{p,t}\mathrel+=U_{p,t}$ |
| **Backorder** | $B_{p,t+1}=B_{p,t}+U_{p,t}-\text{(served backlog)}$; entries older than `backorder_horizon` expire → lost; penalty $\pi^{bo}$ per unit·week to $\mathcal C^{res}$ |
| **Partial backorder** | share `partial_accept_prob` waits, remainder lost |

### VI.2 Customer allocation under scarcity (`P-C.2` ✅)

When supply $<$ demand, split fulfillment $F_{p,t}$ across customers $c$:

| Rule | Allocation |
|---|---|
| **FCFS / proportional / fair-share** | pro-rata at weekly buckets: $F_{p,c}=D_{p,c}\cdot\frac{\text{available}}{\sum_c D_{p,c}}$ |
| **Priority** | serve by `priority_weights` descending until supply exhausted |
| **SLA-tier** | guarantee per-segment fill floors `sla_tiers`; scale down pro-rata if infeasible |

Requires `outbound_logistics.volume` (per-customer demand shares). Inert for single-customer MTO.

### VI.3 Minimum split ratio (partial shipment)

Per row, `min_split_ratio ∈ (0,1]`: if set, an order may ship in parts, each part $\ge
\text{ratio}\times\text{order}$ — prevents delaying a whole order for a small shortfall
(ALX semantics). Default: ship-complete.

### VI.4 Backorder / patience behavior (`P-C.5` ✚)

Customer patience window → cancellation; delivery-window flexibility; measured α/β service
contracts per customer. ✚ (demand-side companion to P-C.1).

### VI.5 Demand shaping (`P-C.3` 🧩)

Substitution offers / delay incentives with accept-probabilities; needs a revenue-elasticity
model — 🧩 planned, activation deferred (no-op today).

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

## Appendix A — Engine binding (implemented ✅ · specified ✚ · registered-planned 🧩)

| Category | ✅ today | ✚ to add | 🧩 registered |
|---|---|---|---|
| Inventory | min_max, rop_q, base_stock, periodic | min_max_ss, regular, regular_ss, order_on_demand, unlimited, no_replenishment, MRP, Quantity-basis | — |
| Sourcing | single, multi (P-S.2), backup (P-S.1), ranked | capacity-proportional, tiered | capacity_reservation (P-S.3) |
| Production | MTS, MTO | dispatching (P-P.11) | lot_sizing (P-P.2), flex/altBoM/repurpose |
| Capacity | overtime (P-P.5) | supplier-capacity model (P-S.5) | standing reserve (P-P.6) |
| Safety stock | fixed_days, service_level, king, abc_xyz | — | — |
| Forecasting | built-in SES-like | SES/Holt/HW/Croston/MA/naive (P-F.1) | — |
| Transport | expedite (P-T.2) | consolidation (P-T.5), frequency (P-T.6) | lane portfolio/mode-shift/hedge |
| Fulfillment | lost_sales, backorder, allocation | min_split_ratio, patience (P-C.5) | demand_shaping (P-C.3) |
| Demand/LT | triangularAV, det/stoch LT | demand_model (P-C.4), lead_time_model (P-S.6) | — |
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
