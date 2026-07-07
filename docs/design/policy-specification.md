# SureSuite — Supply Chain Policy & Simulation Logic Specification

| | |
|---|---|
| **Status** | v1.0 — authoritative specification |
| **Date** | 2026-07-07 |
| **Role** | **This document is the single source of truth for the supply chain policies and the simulation logic of SureSuite.** Every policy the platform exposes, every parameter it accepts, every equation the engine evaluates, and the exact behavior of Prefill and Apply-Preset for each policy are defined here. |
| **Governance** | Any change to a policy, parameter, execution order, disruption behavior, prefill rule, or preset **must be reflected in this document in the same change**. Code and this specification move together; if they disagree, that is a defect. |
| **Ground truth** | Parameter tables, units, ranges, enums, defaults, hooks, and data requirements are transcribed from the engine registry export (`src/lib/policies/registry.generated.json`, engine `0.2.0`). Mathematical formulations are transcribed from the engine plugins under `scsim/scsim/policies/`. Where this document and the registry disagree, the registry is authoritative and this document is to be corrected. |
| **Related** | Blueprint: `docs/design/next-gen-platform-design.md`. Architecture report: `docs/design/platform-architecture-report.md`. Field mapping: `docs/data-simulation-mapping.md`. |

---

## How to read this document

1. **§1 Notation** fixes one symbol per concept for the entire document.
2. **§2 Simulation flow** defines the weekly execution order (`simulation_flow_id`) and the eleven phases.
3. **§3 Disruption propagation** defines how a shock enters and travels to the KPIs.
4. **§4 Prefill & Apply-Preset framework** defines where parameter values come from before the user edits.
5. **§5 Catalog at a glance** indexes every policy, stage, status, slot.
6. **§6 Policy specifications** — one complete entry per policy (template in §6.0).
7. **§7 Engine mechanics** — core simulation logic not yet a user-facing policy (promoted defaults).
8. **§8 Policy interaction graph** — the complete dependency map.
9. **§9 Preset definitions** — the exact parameter delta of every Apply-Preset option.
10. **Appendices** — symbol index, KPI dictionary, prefill provenance table, glossary.

**Status legend:** ✅ implemented and executes today · 🧩 planned (schema registered; selecting it raises a clear error, never a silent no-op) · ✚ engine mechanic slated to become a named policy (documented in §7). A parameter marked *(not read today)* is accepted by the UI but not consumed by the current engine mapping (gap G1) — flagged so no reader mistakes configuration for behavior.

---

## 1. Notation

One symbol, one meaning, for the whole document.

### 1.1 Indices and sets

| Symbol | Meaning | Engine binding |
|---|---|---|
| $t \in \{0,\dots,H\}$ | week index; $H$ = horizon in weeks | `ctx.week` |
| $m \in \mathcal{M}$ | material (raw/component) | `model.materials` |
| $p \in \mathcal{P}$ | finished product | `model.products` |
| $s \in \mathcal{S}$ | supplier | `model.suppliers` |
| $c \in \mathcal{C}$ | customer | `Network.customers` |
| $\ell = (s,m) \in \mathcal{L}$ | supplier link (source arc for a material) | `model.links` |
| $\mathcal{L}_m$ | links that can source material $m$ | — |
| $\ell^\star_m$ | **primary link** of $m$ = min-cost source | `model.primary_link` |
| $b_{p,m} \ge 0$ | BoM coefficient: units of $m$ per unit of $p$ | `model.bom` |

### 1.2 Data parameters (constant within a run unless disrupted)

| Symbol | Meaning | Unit | Source (master → fallback) |
|---|---|---|---|
| $c_m$ | unit cost/valuation of material $m$ | €/unit | `materials.cost` → cheapest inbound `unit_price` → 1.0 |
| $u_p$ | unit value (sell price) of product $p$ | €/unit | `products.sell_price` → demand-weighted outbound `unit_price` → 1.0 |
| $c^h_m$ | annual holding-cost rate on $c_m$ | frac/yr | `materials.holding_cost_pct` → policy → 0.20 |
| $L_\ell$ | lead time of link $\ell$ | weeks | `inbound_logistics.lead_time` → 2 |
| $Q^{\min}_m$ | minimum order quantity for $m$ | units | `materials.moq` → 0 |
| $K_s$ | supplier $s$ weekly capacity | units/wk | `suppliers.capacity_per_week` → ∞ |
| $r_s \in [0,1]$ | supplier reliability score | — | `suppliers.reliability_score` → 1.0 |
| $O_p$ | base weekly production capacity for $p$ | units/wk | `products.production_capacity` → $\max(2\bar D_p,1000)$ |
| $\bar D_p$ | mean weekly demand for product $p$ | units/wk | `products.demand_mean` → Σ weekly outbound volume |
| $\mathrm{CV}_p$ | demand coefficient of variation | — | `products.demand_cv` → scenario `cv` → 0.30 |

### 1.3 State variables (persistent — carry week to week)

The **only** channel by which one week influences the next.

| Symbol | Meaning | Unit | Engine key |
|---|---|---|---|
| $I_{m,t}$ | on-hand material inventory | units | `state.on_hand` |
| $\Pi_{\ell,t}$ | in-transit pipeline on link $\ell$ | units | `state.pipeline` |
| $\Xi_{s,t}$ | order queue at supplier $s$ (capacity gating) | units | `state.queue` |
| $B_{p,t}$ | backlog of unfilled demand | units | `state.backlog` |
| $\Lambda_{p,t}$ | cumulative lost sales | units | `state.lost_sales` |
| $Y_{p,t}$ | finished-goods on-hand (MTS) | units | `state.fg_on_hand` |
| $Y^\star_{p,t}$ | finished-goods target $S^{FG}_p$ | units | `state.fg_target` |
| $\mathcal{C}^{res}_t$ | cost-of-resilience ledger (append-only) | € | `state.cost_ledger` |

### 1.4 Transient variables (recomputed weekly, one owner phase)

| Symbol | Meaning | Unit | Engine key |
|---|---|---|---|
| $\delta_t$ | disruption state | — | `disruption_state` |
| $D_{p,t}$ | realized demand | units | `demand` |
| $\hat D_{p,t}$ | demand forecast | units | `forecast` |
| $\phi_t \in \{0,1\}$ | firm knowledge (disruption firm-visible?) | — | `firm_knowledge` |
| $\hat D^{\mathrm m}_{m,t}$ | expected material demand (BoM-exploded) | units | `material_demand` |
| $s_{m,t}$ | reorder point for $m$ | units | `inventory_levels` |
| $S_{m,t}$ | order-up-to level for $m$ | units | `inventory_levels` |
| $O_{\ell,t}$ | purchase order on link $\ell$ | units | `purchase_orders` |
| $x_{p,t}$ | production plan quantity | units | `production_plan` |
| $\omega_{p,t}$ | overtime capacity granted | units | `overtime_capacity` |
| $g_{p,t}$ | production output (completed) | units | `production_output` |
| $F_{p,t}$ | fulfillment (units served) | units | `fulfillment` |
| $A_{\ell,t}$ | arrivals landing on link $\ell$ | units | `arrivals` |

### 1.5 Conventions

- **Inventory position:** $\mathrm{pos}_{m,t} = I_{m,t} + \sum_{\ell \in \mathcal L_m}\Pi_{\ell,t}$.
- **Indicator** $\mathbf 1[\cdot]$ is 1 when the predicate holds, else 0.
- **ModeStrip** $\langle a,b,c\rangle$: nominal/alert/crisis; the engine selects `crisis` while a disruption is firm-visible ($\phi_t=1$), else `nominal`; `alert` reserved for a graded-signal extension.
- **Value-weighting:** aggregate KPIs weight quantities by $u_p$.
- All rates normalize to the **weekly** bucket (annual ÷52; daily volumes per the mapping contract).

---

## 2. The simulation flow

### 2.1 `simulation_flow_id = "weekly-v1"`

The execution order is a named, versioned constant denoting the eleven-phase weekly pipeline, executed once per week for $t=0\dots H$. The order is **data, not code**: each phase declares the state keys it reads and writes, and the engine validates at load time that no phase reads a key before its writer runs, that each transient key has exactly one owner, and that persistent writes are authorized (`scsim/scsim/core/phases.py::validate_hooks`). The flow id is part of the engine fingerprint, so any change to the order or the read/write contract is a provenance change that invalidates cached and validated results.

Rationale for a fixed weekly pipeline: the weekly S&OP cadence is the domain's native rhythm; fixing it permits vectorized execution and makes the policy-interaction graph statically derivable and provably sound (§8). Sub-weekly dynamics are out of scope by design.

### 2.2 The eleven phases

| Phase | Name | Owns (transient) | Reads (upstream) | Resident policies |
|---|---|---|---|---|
| **PH-00** | week start | $\delta_t$ | scenario events | (mechanic) disruption activation |
| **PH-10** | demand realization | $D_{p,t}$, $\hat D_{p,t}$ | $\delta_t$ | ✚ P-C.4 demand model, ✚ P-F.1 forecasting |
| **PH-20** | detection | $\phi_t$ | $\delta_t$ | ✅ P-S.4 early-warning |
| **PH-30** | fulfil-from-stock (MTS) | updates $Y_{p,t}$, $F_{p,t}$ | $Y$, $D$ | ✚ P-P.12 fulfillment discipline |
| **PH-40** | production planning | $x_{p,t}$, $\omega_{p,t}$ | $\hat D$, $\phi$, $B$, $I$ | ✚ P-P.0, ✅ P-P.5, ✅ P-P.9 |
| **PH-50** | production execute | $g_{p,t}$ | $x$, $I_m$ | (mechanic) feasibility/conservation |
| **PH-60** | fulfillment | $F_{p,t}$, $B$, $\Lambda$ | $D$, $g$, $Y$ | ✅ P-C.1, ✅ P-C.2 |
| **PH-70** | material planning | $\hat D^{\mathrm m}_m$, $s_{m}$, $S_{m}$ | $\hat D$, $x$ | ✅ P-P.1, ✅ P-P.3, ✅ P-P.4 |
| **PH-80** | procurement | $O_{\ell,t}$ | $s,S$, pos | ✅ P-P.1, ✅ P-S.1, ✅ P-S.2 |
| **PH-90** | logistics | $A_{\ell,t}$ | $O$, $\Pi$, $\Xi$, $K_s$ | ✅ P-T.2, ✚ P-S.5, 🧩 P-T.x |
| **PH-99** | accounting | $\mathcal C^{res}$, KPI rows | all | (mechanic) KPI computation |

### 2.3 State-key lifecycle (cross-week loop)

- $I_{m,t+1} = I_{m,t} + A_{\cdot,t}$ (PH-90) − material consumed by production (PH-50).
- $\Pi_{\ell,t+1}$ = pipeline advanced one week; $O_{\ell,t}$ (PH-80) enters at arrival slot $t+L_\ell$.
- $\Xi_{s,t+1}$ = queue after this week's capacity-gated shipments (PH-90).
- $B_{p,t+1}$, $\Lambda_{p,t+1}$ at PH-60; $Y_{p,t+1}$, $Y^\star_{p,t+1}$ at PH-30/50/70.

The feedback — PH-90/PH-70 writing state PH-40 reads *next* week — makes the model dynamical. This is the substrate disruptions travel along (§3).

---

## 3. Disruption propagation

### 3.1 How a shock enters

A scenario defines events; each names a target (supplier/plant/material/lane), effect type, magnitude, start week, duration. At PH-00 active events set $\delta_t$. The firm does not act on $\delta_t$ directly: at PH-20, firm knowledge $\phi_t$ becomes 1 only after the detection lag has elapsed since the event start (compressed by P-S.4). **Policies read $\phi_t$, never $\delta_t$** — the model honors that firms respond to what they *know*, not to ground truth.

### 3.2 The propagation table (explicit and traceable)

| Event type | Target | Variable(s) modified | Propagation (writer→key→reader) | Terminal KPI effect |
|---|---|---|---|---|
| **Lead-time extension** | supplier link $\ell$ | $L_\ell \uparrow$ | orders arrive later → $\Pi_\ell$ delayed → $A_\ell \downarrow$ → $I_m \downarrow$ → $g_p \downarrow$ → $F_p \downarrow$ | fill ↓, backlog ↑, TTR |
| **Supplier capacity reduction** | supplier $s$ | $K_s \downarrow$ | PH-90 ships $\min(\Xi_s,K_s)$ → $\Xi_s$ congests = *endogenous* lead-time ↑ → $A_\ell \downarrow$ | fill ↓, lost-inbound |
| **Plant capacity reduction** | plant / product $p$ | $O_p \downarrow$ | PH-40 caps $x_p$ → $g_p \downarrow$ → $Y_p$/$F_p \downarrow$ | fill ↓, TTS |
| **Transport delay** | lane $\ell$ | lane transit $\uparrow$ | folds into effective $L_\ell$ → $A_\ell$ delayed → $I_m \downarrow$ | fill ↓, TTR |
| **Demand surge** 🧩 | customer / product $p$ | $D_{p,t} \uparrow$ | PH-10 higher draw → $B_p \uparrow$, $\hat D^{\mathrm m}_m \uparrow$ | fill ↓ (planned, G11) |

### 3.3 How policies bend the chain

Interventions occur at specific chain points, only while $\phi_t=1$: **P-S.4** shortens the $\delta_t\!\to\!\phi_t$ lag; **P-S.1/P-S.2** reroute/pre-split orders at PH-80; **P-T.2** pulls pipeline forward at PH-90; **P-P.5** grants overtime at PH-40; **P-P.9** re-solves the plan under scarcity; **P-C.1/P-C.2** decide lost-vs-backorder and who is protected at PH-60. Each intervention is a declared read of $\phi_t$ + a declared write to a chain state key, so the full "which policy modifies which variable under which disruption" map is the join of this table with the per-policy hooks (§6) — no hidden edges.

### 3.4 Current boundary (documented, not hidden)

Today: supplier/plant/lane targets; lead-time-extension and capacity-reduction effects; ≤5 concurrent events; no demand-surge effect (gap G11). Demand-surge (PH-10) needs a demand-side effect type and is planned. Stated so a scenario author knows exactly what can and cannot be injected.

---

## 4. Prefill and Apply-Preset — the framework

### 4.1 Value resolution precedence (per parameter, per row)

$$\text{effective value} = \underbrace{\text{user edit}}_{\text{highest}} \succ \text{preset-derived} \succ \text{data-prefill} \succ \underbrace{\text{registry default}}_{\text{lowest}}$$

1. **User edit** — typed into the cell; always wins.
2. **Preset-derived** — written by Apply-Preset, carrying a human-readable `why` (§4.3).
3. **Data-prefill** — read from uploaded data (item masters, or a reducer over logistics arcs), rendered with a provenance badge (exact vs. ≈ derived) (§4.2).
4. **Registry default** — the parameter's engine `default`; always valid and documented; shown plainly so no behavior is hidden.

The required-data manifest sits across this: a `required` datum with no source blocks the run (never silently defaulted); `recommended` warns; `defaulted` informs.

### 4.2 Data-prefill sources (the reducers)

| Prefilled quantity | Master field | Reducer fallback (master empty) |
|---|---|---|
| material cost $c_m$ | `materials.cost` | **cheapest** inbound `unit_price` across the material's arcs |
| product price $u_p$ | `products.sell_price` | **demand-weighted average** outbound `unit_price` |
| mean demand $\bar D_p$ | `products.demand_mean` | **Σ** weekly outbound `volume` |
| supplier capacity $K_s$ | `suppliers.capacity_per_week` | (none — empty = unlimited) |
| link lead time $L_\ell$ | `inbound_logistics.lead_time` | (none — empty defaults to 2 wk, warned) |
| MOQ $Q^{\min}_m$ | `materials.moq` | (none — empty = 0) |

Each cell shows a badge (exact / ≈ derived / default) — the "no hidden heuristic" guarantee.

### 4.3 Apply-Preset mechanics

A **preset** is a named strategy that writes a coherent parameter set across a stage's policies, each field with a `why`. Presets are **derivation functions** (they read project context — mean demand, CV, top supplier — and compute values), not static templates. Implementation: `src/lib/policies/presets/*`, `{ value, why }` per field, applied as source (2).

The three-per-stage set is already the correct streamlined set and is preserved: **Supplier** {Lowest-cost single source, Dual-source resilient, JIT inbound}; **Plant** {Make-to-Stock, Make-to-Order, Lean pull}; **Customer** {Premium service, Cost-first fulfillment, Agile high-mix}. Exact deltas in §9. Correctness requirement (enforced in §9): **a preset must set the parameters the engine actually reads** — presets are re-expressed over engine parameters (coverage $\kappa$, `policy_type`, safety-stock method), not absolute UI fields the engine ignores.

---

## 5. The policy catalog at a glance

| ID | Policy | Stage | Slot | Horizon | Status |
|---|---|---|---|---|---|
| **P-S.1** | backup_supplier | supplier | supplier selection | operational | ✅ |
| **P-S.2** | proactive_multi_sourcing | supplier | multi-sourcing | strategic | ✅ |
| **P-S.3** | capacity_reservation | supplier | capacity | strategic | 🧩 |
| **P-S.4** | early_warning_failover | supplier | detection | operational | ✅ |
| **P-S.5** | supplier_capacity_model | supplier | capacity | strategic | ✚ (§7) |
| **P-S.6** | lead_time_model | supplier | lead time | tactical | ✚ (§7) |
| **P-F.1** | forecasting_method | plant | forecasting | tactical | ✚ (§7) |
| **P-P.0** | greedy_production_plan | plant | production planning | operational | ✚ (§7) |
| **P-P.1** | inventory_control | plant | inventory control | tactical | ✅ |
| **P-P.2** | lot_sizing | plant | production planning | tactical | 🧩 |
| **P-P.3** | safety_stock_materials | plant | safety stock | strategic | ✅ |
| **P-P.4** | fg_safety_stock | plant | safety stock (FG) | strategic | ✅ |
| **P-P.5** | short_term_capacity | plant | capacity | operational | ✅ |
| **P-P.6** | standing_capacity_reserve | plant | capacity | strategic | 🧩 |
| **P-P.7** | process_flexibility | plant | production planning | strategic | 🧩 |
| **P-P.8** | alternative_bom | plant | production planning | operational | 🧩 |
| **P-P.9** | material_allocation | plant | allocation | operational | ✅ |
| **P-P.10** | repurposing | plant | production planning | operational | 🧩 |
| **P-T.1** | multimodal_lane_portfolio | transport | transport | strategic | 🧩 |
| **P-T.2** | expedited_shipments | transport | transport | operational | ✅ |
| **P-T.3** | mode_shift | transport | transport | operational | 🧩 |
| **P-T.4** | leadtime_hedging | transport | transport | tactical | 🧩 |
| **P-C.1** | unmet_demand_handling | customer | order management | operational | ✅ |
| **P-C.2** | customer_allocation | customer | allocation | operational | ✅ |
| **P-C.3** | demand_shaping | customer | demand modeling | operational | 🧩 |
| **P-C.4** | demand_model | customer | demand modeling | strategic | ✚ (§7) |
| **P-X.1** | recovery_playbook | cross | recovery | operational | 🧩 |

The following sections specify each of these in full.


---

## 6. Policy specifications

### 6.0 Specification template

Every entry is self-contained and follows this structure so any policy can be reviewed independently:

- **Identity** — id, catalog ref, stage, slot, horizon, status, engine class, constraint targeted.
- **Purpose** — the one-sentence job of the policy.
- **Business interpretation** — what a supply chain manager understands it to mean.
- **Assumptions** — modeling assumptions that bound its validity.
- **Required / optional inputs** — data and upstream state, with the data-requirement level.
- **Parameters** — name, symbol, unit, range/constraint, default, meaning (from the registry).
- **Policy logic** — prose description of the decision.
- **Mathematical formulation** — equations in the §1 notation.
- **Decision rules** — the conditional structure, including disruption (crisis-mode) behavior.
- **Outputs** — state keys written and their definitions.
- **Upstream dependencies** — which outputs it consumes, via which key/phase.
- **Downstream consumers** — who reads its outputs.
- **Prefill** — where each parameter's pre-filled value comes from (per §4).
- **Preset behavior** — how each relevant Apply-Preset option sets its parameters (per §9).
- **Implementation notes** — hooks (phase, priority), vectorization, current-code divergence.

---

### Stage A — Supplier policies (`P-S.x`)

The supplier stage answers two distinct questions that must not be conflated: *how a supplier serves an order it accepted* (capacity, lead time, allocation, shipment — supplier-owned) and *from whom the firm buys and how it splits/reroutes* (sourcing — procurement-owned, catalogued here because the decision is about suppliers). Procurement *timing and quantity* is an inventory-control decision (P-P.1), not a supplier policy.

---

#### P-S.1 — `backup_supplier` ✅

**Identity.** `backup_supplier` · P-S.1 · supplier · slot: supplier selection · horizon: operational · ✅ implemented · class: strategic · constraint: material availability.

**Purpose.** On a firm-visible disruption (or when weeks-of-cover falls below a threshold), reroute a material's replenishment orders from its primary source to a pre-designated backup source.

**Business interpretation.** The contingency second source a risk-aware buyer keeps warm: "if our main supplier is down, switch these materials to the backup until it recovers."

**Assumptions.** A backup link exists for covered materials (single-sourced materials are skipped); rerouting takes effect at order release, so its benefit is delayed by the backup link's lead time; the primary resumes after the event clears plus a cooldown.

**Required / optional inputs.** Upstream: $\phi_t$ (PH-20), `purchase_orders` (P-P.1 release), inventory position. Data: backup source arcs; `inbound_logistics.unit_price` (recommended — `min_cost` rule ranks by it); `suppliers.reliability_score` (defaulted 1.0 — `reliability` rule).

**Parameters.**

| Name | Symbol | Unit | Range / constraint | Default | Meaning |
|---|---|---|---|---|---|
| `activation_trigger` | — | enum | {on_disruption, coverage_threshold} | on_disruption | What arms the reroute |
| `coverage_threshold_weeks` | $\theta$ | weeks-of-supply | [0.5, 26] | 4.0 | Reroute when position covers fewer weeks than $\theta$ |
| `selection_rule` | — | enum | {min_cost, min_leadtime, reliability} | min_cost | How the backup source is chosen |
| `backup_lead_time_weeks` | $L_{s'}$ | weeks | ≥ 0 (per link) | link's own (plan 6) | Override for backup link lead time |
| `cooldown_weeks` | — | weeks | [0, 8] | 0 | Keep using the backup this long after the event clears |
| `enabled_materials` | — | ids | material set | all multi-sourced | Covered materials; single-sourced skipped |

**Policy logic.** Each week at order release, for every covered material, decide whether the reroute is armed (a firm-visible disruption affects the primary, or coverage < $\theta$). If armed, redirect the release from $\ell^\star_m$ to the selected backup link $\ell'$; else release on the primary.

**Mathematical formulation.** Reroute-armed indicator
$$a_{m,t} = \mathbf 1[\phi_t \wedge \text{primary}(m)\ \text{disrupted}] \vee \mathbf 1\!\left[\tfrac{\mathrm{pos}_{m,t}}{\hat D^{\mathrm m}_{m,t}} < \theta\right].$$
When $a_{m,t}=1$: $O_{\ell',t} \mathrel{+}= O_{\ell^\star_m,t}$, $O_{\ell^\star_m,t}\leftarrow 0$, with backup lead time $L_{\ell'}=L_{s'}$ (override) or the link's own. Cost ledger charges the backup premium over the primary. Backup use persists `cooldown_weeks` after $\phi_t\to0$.

**Decision rules.** Candidate selection by `selection_rule`: min_cost = lowest $c_{\ell'}$; min_leadtime = lowest $L_{\ell'}$; reliability = highest $r_{s'}$. Only multi-sourced materials in `enabled_materials` participate.

**Outputs.** `purchase_orders` (rerouted); `state.cost_ledger` (backup premium).

**Upstream dependencies.** $\phi_t$ (PH-20); $O_{\ell,t}$ (P-P.1 release, PH-80); $\mathrm{pos}_{m,t}$ (state).

**Downstream consumers.** PH-90 logistics (rerouted order enters backup pipeline); PH-99 (premium into $\mathcal C^{res}$).

**Prefill.** `backup_lead_time_weeks` ← backup arc `inbound_logistics.lead_time` (else 2 wk). Selection inputs ← `inbound_logistics.unit_price` (cost), `suppliers.reliability_score` (1.0). `enabled_materials` ← materials with ≥2 source arcs.

**Preset behavior.** *Dual-source resilient* arms it (`activation_trigger=on_disruption`, `selection_rule=reliability`, `cooldown_weeks≈2`). *Lowest-cost single source* and *JIT inbound* leave it disabled (single sourcing has no backup). §9.

**Implementation notes.** Hook PH-80 (after P-P.1 release). Vectorized over covered materials. Reroute changes *which link's pipeline* receives the order — no instant inventory; benefit delayed by $L_{\ell'}$ (correctly models that a backup is not instantaneous).

---

#### P-S.2 — `proactive_multi_sourcing` ✅

**Identity.** `proactive_multi_sourcing` · P-S.2 · supplier · slot: multi-sourcing · horizon: strategic · ✅ implemented (not reachable from the current UI — gap G3; grid unification exposes it) · class: strategic · constraint: material availability.

**Purpose.** Split every replenishment order for a material across multiple warm sources by standing weights, rather than relying on one source and switching only under disruption.

**Business interpretation.** "Always buy 70% from A and 30% from B" — structural diversification that reduces exposure *before* any disruption, at the cost of a premium on non-primary slices.

**Assumptions.** Multiple source links exist per split material; shares sum to 100% per material; a minimum viable slice caps fragmentation. Distinct from P-S.1 (standing split vs. contingent reroute).

**Required / optional inputs.** Upstream: $\phi_t$, `purchase_orders`. Data: `inbound_logistics.volume` (recommended — default split derives weights from lane volumes when explicit ratios absent).

**Parameters.**

| Name | Symbol | Unit | Range / constraint | Default | Meaning |
|---|---|---|---|---|---|
| `weights` | $w_{m,s}$ | share % per (material→supplier) | shares sum to 100 per material | derived | Standing source split |
| `min_share_pct` | — | % | [5, 50] | 20 | Smallest viable slice |
| `secondary_premium` | — | €/unit | ≥ 0 (per link) | 0 | Contractual premium on non-primary slices |
| `rebalance_trigger` | — | enum | {none, disruption} | none | disruption: shift shares off firm-visibly disrupted suppliers |

**Policy logic.** At order release, split each material's order across its sources by $w_{m,s}$. If `rebalance_trigger=disruption` and $\phi_t=1$, redistribute a disrupted supplier's share pro-rata to the others.

**Mathematical formulation.** With release $O_{m,t}$ (P-P.1) and normalized weights $\tilde w_{m,s}=w_{m,s}/\sum_{s'}w_{m,s'}$:
$$O_{(s,m),t} = \tilde w_{m,s}\,O_{m,t}, \qquad \sum_s O_{(s,m),t}=O_{m,t}.$$
Cost ledger: $\sum_{s\ne\text{primary}} O_{(s,m),t}\cdot(\text{secondary\_premium}+(c_{(s,m)}-c_{\ell^\star_m})^+)$.

**Decision rules.** Materials absent from `weights` use an equal split across sources bounded by `min_share_pct` (a below-minimum source is dropped).

**Outputs.** `purchase_orders` (split); `state.cost_ledger` (multi-sourcing premium).

**Upstream dependencies.** $O_{m,t}$ (P-P.1, PH-80); $\phi_t$ (PH-20).

**Downstream consumers.** PH-90 logistics (each split enters its link pipeline); PH-99 (premium).

**Prefill.** `weights` ← `inbound_logistics.volume` shares per material (observed split), else equal split. `secondary_premium` ← observed arc cost difference $c_{(s,m)}-c_{\ell^\star_m}$.

**Preset behavior.** *Dual-source resilient* sets `weights` to 70/30 on multi-sourced materials and `rebalance_trigger=disruption`. Single-source presets leave it inactive.

**Implementation notes.** Hook PH-80. Always on (vs. P-S.1's contingent reroute). Composes with P-S.1: split is the baseline, reroute overrides it under disruption.

---

#### P-S.3 — `capacity_reservation` 🧩

**Identity.** `capacity_reservation` · P-S.3 · supplier · slot: capacity · horizon: strategic · 🧩 planned (M8) · class: strategic · constraint: material availability.

**Purpose.** Pre-pay for a block of reserved weekly capacity at a supplier, callable on short notice, so capacity is available when the market or a disruption would otherwise deny it.

**Business interpretation.** A capacity option/reservation contract: pay a standing fee for the right to draw up to a reserved quantity per week at a guaranteed lead time.

**Assumptions (planned).** Reserved capacity is guaranteed regardless of the supplier's spot congestion; the fee is charged whether or not exercised.

**Parameters.**

| Name | Unit | Range | Default | Meaning |
|---|---|---|---|---|
| `reserved_capacity` | units/wk | ≥ 0 (per link) | — | Guaranteed weekly draw |
| `reservation_fee` | €/unit/wk | ≥ 0 (per link) | — | Standing fee on reserved capacity |
| `call_leadtime_weeks` | weeks | [0, 4] | 0 | Notice required to call the reservation |

**Status note.** Planned; selecting it raises `PolicyNotImplementedError` (M8). Intended propagation: reserved capacity raises effective $K_s$ on the supplier-capacity chain (§3) at a standing $\mathcal C^{res}$ charge. Documented here so the eventual implementation matches this contract.

---

#### P-S.4 — `early_warning_failover` ✅

**Identity.** `early_warning_failover` · P-S.4 · supplier · slot: detection · horizon: operational · ✅ implemented · class: anticipation · constraint: response time.

**Purpose.** Invest in monitoring that compresses the delay between a disruption's start and the firm's knowledge of it, so every reactive policy engages earlier.

**Business interpretation.** Supply-chain visibility/early-warning: "we pay for monitoring, so we learn our supplier is in trouble in week 1 instead of week 3." It does not itself reroute — it makes P-S.1/P-T.2/P-P.5 act sooner.

**Assumptions.** Monitoring reduces but cannot make negative the detection lag; the standing cost is charged whether or not a disruption occurs.

**Required / optional inputs.** Upstream: $\delta_t$ (PH-00). Data: `monitoring_cost` (chosen spend).

**Parameters.**

| Name | Symbol | Unit | Range | Default | Meaning |
|---|---|---|---|---|---|
| `detection_lag_weeks` | $\lambda$ | weeks | [0, 4] | 1 | Monitored disruption-start → firm-knows delay |
| `monitoring_cost` | $C^{mon}$ | €/yr | ≥ 0 | 0 | Standing visibility cost, charged weekly (÷52) into $\mathcal C^{res}$ |

**Policy logic & formulation.** Effective lag $\lambda^{\text{eff}}=\min(\lambda,\lambda^{\text{scenario}})$. Firm knowledge:
$$\phi_t = \mathbf 1\!\left[\exists\ \text{event } e:\ t \ge t^{\text{start}}_e+\lambda^{\text{eff}} \wedge t \le t^{\text{end}}_e\right].$$
Monitoring cost accrues weekly: $\mathcal C^{res}_t \mathrel{+}= C^{mon}/52$.

**Decision rules.** A pure detection-timing policy: it writes $\phi_t$ and nothing else. It does not choose a response (rerouting stays P-S.1, expediting P-T.2, overtime P-P.5).

**Outputs.** `firm_knowledge` $\phi_t$ (PH-20) — the boolean every reactive policy reads.

**Upstream dependencies.** $\delta_t$ (PH-00).

**Downstream consumers.** *Every* disruption-reactive policy: P-S.1, P-S.2 (rebalance), P-T.2, P-P.5, P-P.9, P-P.1 (crisis κ). The highest-fan-out node in the graph.

**Prefill.** `detection_lag_weeks` ← scenario default (1 wk); `monitoring_cost` ← 0 (opt-in).

**Preset behavior.** Not set by the streamlined presets (a deliberate investment decision); left at default. Best varied in a resilience scenario study — "what is a week of warning worth?" as a first-class experiment.

**Implementation notes.** Hook PH-20 (reads $\delta_t$, writes $\phi_t$). Makes visibility's value measurable by CRN-pairing runs with/without monitoring.

---

### Stage B — Plant / focal-firm policies (`P-P.x`, `P-F.x`)

The plant owns the firm's internal decisions: how much to build (production planning), how much material to hold and when to reorder (inventory control), how much buffer to size (safety stock), how to flex capacity, and how to allocate scarce material across products. Forecasting (P-F.1) and the base production plan (P-P.0) are engine mechanics today (§7); the policies below are the ones with registered schemas.

**Correspondence to classical planning.** PH-40 production planning is the **MPS-lite** (master schedule per product per week, adjusted by P-P.5 overtime and P-P.9 allocation). PH-70 material planning — the $\hat D^{\mathrm m}_m$ projection exploded through the BoM with $s_m/S_m$ levels — is the **MRP-lite**. The design names this correspondence rather than inventing parallel MPS/MRP policies: MPS behavior is configured through P-F.1 + P-P.0/P-P.2; MRP behavior through P-P.1 + P-P.3.

---

#### P-P.1 — `inventory_control` ✅

**Identity.** `inventory_control` · P-P.1 · plant · slot: inventory control · horizon: tactical · ✅ implemented (min_max variant validated in the manuscript) · class: built-in · constraint: material availability.

**Purpose.** The everyday material replenishment rule — set reorder/order-up-to levels and release purchase orders. The baseline shock absorber every chain already has; quantifying it prevents over-buying dedicated resilience.

**Business interpretation.** Standard inventory control: min-max (ERP discrete manufacturing), base-stock (high-value/low-volume), (R,Q) (stable flows), periodic (consolidated cadence).

**Assumptions.** Weekly review; deterministic expected demand within the week; the order is placed on the material's primary (min-cost) link; the order-up-to cover is expressed as *weeks of coverage beyond lead time* ($\kappa$), not as an absolute level.

**Required / optional inputs.** Upstream: $\hat D^{\mathrm m}_{m,t}$ (PH-70 material planning), $L_\ell$, $\mathrm{pos}_{m,t}$. Data: `materials.moq` (defaulted 0); `materials.holding_cost_pct` (defaulted; prices the inventory this policy carries).

**Parameters.**

| Name | Symbol | Unit | Range / constraint | Default | Meaning |
|---|---|---|---|---|---|
| `policy_type` | — | enum | {min_max, base_stock, rop_q, periodic} | min_max | The replenishment rule (min_max ✅ manuscript) |
| `coverage_weeks` | $\kappa$ | weeks (ModeStrip) | [0, 26] | ⟨8,10,12⟩ | Order-up-to cover beyond lead time |
| `review_cadence_weeks` | — | weeks | {1, 2, 4} | 1 | How often min_max reviews |
| `rop_q_quantity` | $Q$ | units | ≥ MOQ | — | Fixed (R,Q) lot (rop_q only) |
| `periodic_review_weeks` | — | weeks | [1, 13] | 4 | Period for the periodic rule |

**Policy logic.** At PH-70, set levels from expected demand, lead time, and $\kappa$. At PH-80, compute inventory position and release an order to lift it back to the order-up-to level when below reorder, respecting the review cadence and MOQ.

**Mathematical formulation.** Levels (PH-70), with $\kappa$ selected crisis/nominal by $\phi_t$:
$$s_{m,t}=\hat D^{\mathrm m}_{m,t}\,L_{\ell^\star_m}, \qquad S_{m,t}=\hat D^{\mathrm m}_{m,t}\,(L_{\ell^\star_m}+\kappa).$$
(P-P.3 safety stock is *added onto* $s_{m,t}$ after this policy runs.) Release (PH-80), position $\mathrm{pos}_{m,t}=I_{m,t}+\Pi_{\cdot,t}$:
- **min_max** (gated by review cadence): $O_{m,t}=\max(S_{m,t}-\mathrm{pos}_{m,t},\,Q^{\min}_m)\cdot\mathbf 1[\mathrm{pos}_{m,t}<s_{m,t}]$.
- **base_stock:** order the deficit whenever positive: $O_{m,t}=\max(S_{m,t}-\mathrm{pos}_{m,t},Q^{\min}_m)\cdot\mathbf 1[S_{m,t}-\mathrm{pos}_{m,t}>0]$.
- **rop_q:** $O_{m,t}=\max(Q,Q^{\min}_m)\cdot\mathbf 1[\mathrm{pos}_{m,t}<s_{m,t}]$.
- **periodic:** every `periodic_review_weeks`, order the deficit up to $S_{m,t}$.
The order is placed on the primary link: $O_{\ell^\star_m,t}=O_{m,t}$.

**Decision rules.** $\kappa$ switches to its crisis value while $\phi_t=1$, temporarily raising cover during known disruptions. MOQ rounds every release up.

**Outputs.** `inventory_levels` ($s_{m,t}$, $S_{m,t}$, PH-70); `purchase_orders` ($O_{\ell,t}$, PH-80).

**Upstream dependencies.** $\hat D^{\mathrm m}_{m,t}$ (PH-70, driven by P-F.1 forecast + P-P.0 plan); $L_\ell$, position (state).

**Downstream consumers.** P-P.3 (adds safety stock onto $s$); P-S.1/P-S.2 (reroute/split the release); PH-90 procurement→pipeline.

**Prefill.** `coverage_weeks` ← default ⟨8,10,12⟩ (a coverage heuristic; not data-derived). `rop_q_quantity` ← EOQ estimate if setup/holding costs present, else blank. MOQ ← `materials.moq`.

**Preset behavior.** *Make-to-Stock* → `policy_type=min_max`, larger $\kappa$; *Make-to-Order* → base_stock with low $\kappa$; *Lean pull* → `review_cadence_weeks=1`, low $\kappa$. §9. **Correction (C2/C5):** presets set `policy_type` and $\kappa$ (engine-read), *not* the absolute `reorder_point`/`order_up_to` the engine ignores.

**Implementation notes.** Hooks PH-70/priority 50 (levels) and PH-80/priority 50 (release). Vectorized over $\mathcal M$. **Divergence from today's UI:** the 7-family `inventory.reorder_point`/`order_up_to`/`max_stock`/`service_level_target` are *not read* — the engine derives $s/S$ from $\hat D\cdot L$ and $\kappa$. The grid unification (blueprint Phase B0) makes the grid edit $\kappa$ and `policy_type` directly, removing this mapping loss (G1).

---

#### P-P.3 — `safety_stock_materials` ✅

**Identity.** `safety_stock_materials` · P-P.3 · plant · slot: safety stock (materials) · horizon: strategic · ✅ implemented · class: strategic · constraint: material availability.

**Purpose.** Size a protective buffer on top of the reorder point for each material, differentiated by importance and demand variability.

**Business interpretation.** Classic safety-stock sizing — uniform service level, fixed days of cover, King's method, or ABC-XYZ-differentiated targets (high-value, steady items get tighter buffers than low-value, erratic ones).

**Assumptions.** Normal-approximation service-level statistics; ABC by annual value share, XYZ by demand CV; buffers add to $s_{m,t}$ from P-P.1.

**Required / optional inputs.** Upstream: `inventory_levels` (P-P.1), $\hat D^{\mathrm m}_{m,t}$. Data: `products.demand_cv` (recommended — sizing scales with variability; default 0.30).

**Parameters.**

| Name | Symbol | Unit | Range | Default | Meaning |
|---|---|---|---|---|---|
| `classification` | — | enum | {abc_xyz, uniform, fixed_days, king} | abc_xyz | Sizing method |
| `uniform_service_level` | $\alpha$ | % | [80, 99.9] | 95 | Target service (uniform) |
| `fixed_days_cover` | — | days | [0, 84] | 14 | Cover (fixed_days) |
| `abc_breakpoints` | — | cumulative value share | — | [0.8, 0.95] | A≤80%, B≤95%, C rest (80/15/5) |
| `xyz_cv_breakpoints` | — | demand CV | — | [0.13, 0.25] | X≤0.13, Y≤0.25, Z above |
| `z_matrix` | — | % service level | [80, 99.9] | — | Nine ABC×XYZ service cells |

**Policy logic & formulation.** For the service-level methods, the safety stock adds a $z$-multiple of demand–lead-time standard deviation onto the reorder point:
$$SS_m = z(\alpha_m)\,\sigma_{D^{\mathrm m}_m}\sqrt{L_{\ell^\star_m}}, \qquad s_{m,t} \leftarrow s_{m,t} + SS_m,$$
where $\sigma_{D^{\mathrm m}_m}=\mathrm{CV}_m\,\hat D^{\mathrm m}_m$ and $z(\cdot)$ is the standard-normal quantile. For **abc_xyz**, $\alpha_m$ is read from `z_matrix` at the material's (ABC class × XYZ class) cell; ABC by cumulative value share $c_m\hat D^{\mathrm m}_m$, XYZ by $\mathrm{CV}_m$. **fixed_days:** $SS_m=\hat D^{\mathrm m}_m\cdot(\text{fixed\_days\_cover}/7)$. **king:** King's demand-during-lead-time variance method. Holding cost of $SS_m$ accrues to $\mathcal C^{res}$.

**Decision rules.** The buffer is a *strategic* level (design-time); it does not switch with $\phi_t$ (that is $\kappa$'s job in P-P.1).

**Outputs.** `inventory_levels` (augmented $s_{m,t}$); `state.cost_ledger` (SS holding).

**Upstream dependencies.** P-P.1 levels (PH-70, runs before P-P.3); $\hat D^{\mathrm m}_m$, $\mathrm{CV}$.

**Downstream consumers.** P-P.1 release (PH-80 reads the augmented $s$); PH-99 (SS holding cost).

**Prefill.** `classification` ← abc_xyz; CV inputs ← `products.demand_cv` (else scenario cv, else 0.30); breakpoints ← the 80/15/5 and 0.13/0.25 defaults (documented heuristics, not data-derived).

**Preset behavior.** *Make-to-Stock* / *Premium service* → higher `uniform_service_level` or richer abc_xyz targets; *Lean pull* / *Cost-first* → `fixed_days` with a small cover. §9.

**Implementation notes.** Hook PH-70 (after P-P.1). Vectorized. Exposing the abc_xyz variant to the UI closes part of G1 (the UI currently only reaches fixed_days/service_level/king via the mapper).

---

#### P-P.4 — `fg_safety_stock` ✅ (MTS)

**Identity.** `fg_safety_stock` · P-P.4 · plant · slot: safety stock (finished goods) · horizon: strategic · ✅ implemented (MTS; not reachable from the current UI — gap G3) · class: strategic · constraint: demand-side.

**Purpose.** Size the finished-goods buffer target $S^{FG}_p$ for make-to-stock products, so demand can be served from stock.

**Business interpretation.** FG safety stock for MTS: how much finished product to hold to hit a service target, optionally differentiated by revenue class.

**Assumptions.** MTS products only (MTO holds no FG buffer); revenue-based ABC ranks by $u_p\bar D_p$.

**Required / optional inputs.** Upstream: `forecast` $\hat D_{p,t}$, `state.fg_target`. Data: `products.sell_price` (**required** — revenue segmentation ranks by price×demand; default price 1.0 makes revenue KPIs meaningless); `products.demand_cv` (recommended).

**Parameters.**

| Name | Symbol | Unit | Range | Default | Meaning |
|---|---|---|---|---|---|
| `sizing` | — | enum | {service_level, fixed_days, fixed_units} | service_level | FG buffer sizing method |
| `service_level_pct` | $z^{FG}_p$ | % | [80, 99.9] | 95 | Target service (service_level) |
| `fixed_days_cover` | — | days | [0, 12] | 2 | Cover (fixed_days) |
| `fixed_units` | — | units | ≥ 0 | — | Absolute buffer (fixed_units) |
| `segmentation` | — | enum | {uniform, abc_by_revenue} | uniform | uniform vs. A/B/C by revenue |
| `holding_cost_rate` | $h^{FG}_p$ | %/yr of COGS | [5, 50] | 20 | FG holding rate |

**Policy logic & formulation.** For service_level, the FG target is forecast over the replenishment period plus a $z$-buffer:
$$S^{FG}_{p,t} = \hat D_{p,t} + z(\text{SL}_p)\,\sigma_{D_p}, \qquad Y^\star_{p,t}\leftarrow S^{FG}_{p,t},$$
read next week at PH-40 to drive MTS replenishment (ADR 0001). Under **abc_by_revenue**, $\text{SL}_p$ = configured SL for A, −2 pp for B, −5 pp for C (floor 80), with classes ranked by $u_p\bar D_p$. **fixed_days:** $S^{FG}=\hat D_p\cdot(\text{days}/7)$. **fixed_units:** the constant. FG holding accrues to $\mathcal C^{res}$.

**Outputs.** `state.fg_target` ($Y^\star_{p,t}$); `state.cost_ledger` (FG holding).

**Upstream dependencies.** P-F.1 forecast (PH-10); P-C.4 demand model (for $\sigma$).

**Downstream consumers.** PH-40 production planning (reads $Y^\star$ next week to set MTS build); PH-30 fulfil-from-stock; PH-99.

**Prefill.** `service_level_pct` ← 95; `holding_cost_rate` ← 20; segmentation ← uniform. Revenue class inputs ← `products.sell_price` (else demand-weighted outbound price).

**Preset behavior.** *Make-to-Stock* enables it with `sizing=service_level`, 95% (or abc_by_revenue); *Make-to-Order* leaves FG buffer at zero (build to order). §9.

**Implementation notes.** Hook PH-70 (reads forecast + fg_target, writes fg_target + cost). MTS-only; inert for MTO products. Exposing it closes G3.

---

#### P-P.5 — `short_term_capacity` ✅

**Identity.** `short_term_capacity` · P-P.5 · plant · slot: capacity · horizon: operational · ✅ implemented · class: anticipation · constraint: production capacity.

**Purpose.** Grant temporary overtime capacity above the base production rate, activated when it is revenue-positive (or always during a disruption).

**Business interpretation.** Overtime/extra shifts at a premium — worth it only when the extra units sell for more than the premium costs, and only when base capacity actually binds.

**Assumptions.** Overtime is bounded by a factor of base capacity; the classic result holds — overtime is *inert when materials, not machines, are the binding constraint*.

**Required / optional inputs.** Upstream: $D_{p,t}$, $\phi_t$, $B_{p,t}$, $I$. Data: `products.production_capacity` (**required** — overtime only bites when base capacity binds; the engine's $\max(2\bar D,1000)$ default means capacity never binds and overtime is vacuous).

**Parameters.**

| Name | Symbol | Unit | Range | Default | Meaning |
|---|---|---|---|---|---|
| `activation` | — | enum | {revenue_positive, always_during_disruption} | revenue_positive | When overtime is granted |
| `max_overtime_factor` | — | × $O_p$ | [1.0, 2.0] | 1.5 | Ceiling on overtime capacity |
| `overtime_premium_pct_of_price` | $C^o$ | % of $u_p$ per overtime unit | [1, 25] | 5 | Premium cost per overtime unit |

**Policy logic & formulation.** Overtime is granted up to the factor when it pays:
$$\omega_{p,t} = \big(\text{max\_overtime\_factor}-1\big)O_p \cdot \mathbf 1[\text{activate}_{p,t}],$$
with, for `revenue_positive`, $\text{activate}_{p,t}=\mathbf 1[u_p > C^o\,u_p/100 \ \wedge\ \text{capacity binds}]$ (Eq. 22: unit margin exceeds the overtime premium *and* there is unmet buildable demand). For `always_during_disruption`, $\text{activate}_{p,t}=\phi_t$. Overtime premium accrues to $\mathcal C^{res}$.

**Outputs.** `overtime_capacity` $\omega_{p,t}$ (PH-40); premium into $\mathcal C^{res}$.

**Upstream dependencies.** $\phi_t$ (PH-20); demand/backlog/on-hand (state); base capacity $O_p$ (data).

**Downstream consumers.** PH-40 production plan (P-P.0/P-P.9 add $\omega$ to the capacity ceiling); PH-50 execute; PH-99.

**Prefill.** `max_overtime_factor` ← 1.5; `overtime_premium_pct_of_price` ← 5; activation ← revenue_positive. Base capacity ← `products.production_capacity` (with a required-data warning if absent).

**Preset behavior.** Not a core preset lever; enabled implicitly by resilience-oriented studies. §9.

**Implementation notes.** Hook PH-40. Reproduces the manuscript's negative result: overtime is inert when material availability, not machine capacity, binds.

---

#### P-P.9 — `material_allocation` ✅

**Identity.** `material_allocation` · P-P.9 · plant · slot: allocation · horizon: operational · ✅ implemented (not reachable from the current UI — gap G3) · class: improvisation · constraint: allocation efficiency.

**Purpose.** When material is scarce, decide *which products to build* by solving a rolling-horizon allocation optimizing a chosen objective, instead of a naive first-come build.

**Business interpretation.** Scarcity allocation: "we can't build everything — build the mix that maximizes revenue / fill rate / strategic priority."

**Assumptions.** Rolling horizon of $W$ weeks; LP solved with HiGHS (or a greedy revenue-ranked fallback); binds only when material is actually short.

**Required / optional inputs.** Upstream: $D_{p,t}$, $\phi_t$, $\omega_{p,t}$, $B$, $I$, $\Pi$. Data: `products.sell_price` (recommended — revenue-weighted objectives need real prices).

**Parameters.**

| Name | Symbol | Unit | Range | Default | Meaning |
|---|---|---|---|---|---|
| `objective` | — | enum | {max_revenue, max_fill_rate, priority_weighted, fg_replenish} | max_revenue | What the allocation maximizes |
| `solver` | — | enum | {lp, greedy} | lp | HiGHS LP or revenue-ranked greedy (R3 fallback) |
| `window_weeks` | $W$ | weeks | [1, 13] | 4 | Rolling horizon |
| `activation` | — | enum | {during_disruption, always} | during_disruption | When the LP runs |
| `priority_weights` | — | weight per product | — | — | For priority_weighted (missing → 1) |
| `annual_cost` | $C^{alc}$ | €/yr | ≥ 0 | 6240 | Planner labor cost of running allocation |

**Policy logic & formulation.** Over the window, choose the production plan $\{x_{p,\tau}\}$ maximizing the objective subject to material availability and capacity:
$$\max_{x\ge 0}\ \sum_{\tau=t}^{t+W}\sum_p \pi_p\,x_{p,\tau} \quad \text{s.t.}\quad \sum_p b_{p,m}x_{p,\tau} \le I_{m,\tau}+\Pi_{\cdot,\tau},\ \ x_{p,\tau}\le O_p+\omega_{p,\tau},$$
with $\pi_p=u_p$ (max_revenue), $\pi_p=1$ (max_fill_rate), $\pi_p=$ `priority_weights` (priority_weighted), or the FG-deficit (fg_replenish, MTS). The greedy solver ranks products by $\pi_p$ per unit material and fills in order. $C^{alc}/52$ accrues weekly to $\mathcal C^{res}$ when active.

**Outputs.** `production_plan` $x_{p,t}$ (PH-40); `state.cost_ledger` (planner labor).

**Upstream dependencies.** $\phi_t$; $\omega_{p,t}$ (P-P.5); demand/backlog/on-hand/pipeline (state); $b_{p,m}$ (BoM).

**Downstream consumers.** PH-50 execute; PH-60 fulfillment; PH-99 per-product service KPIs.

**Prefill.** `objective` ← max_revenue; `solver` ← lp; `window_weeks` ← 4; prices ← `products.sell_price` (else demand-weighted outbound).

**Preset behavior.** *Premium service* → `max_fill_rate` or `priority_weighted`; *Cost-first* → `max_revenue`. §9. Activation defaults to during_disruption so the LP cost is incurred only when it matters.

**Implementation notes.** Hook PH-40 (writes the plan, replacing P-P.0's greedy default when active). LP via HiGHS; greedy is the R3 solver-unavailable fallback. Exposing it closes G3.

---

#### Planned plant policies (🧩 — schemas registered, raise until built)

- **P-P.2 `lot_sizing`** (M8): rule ∈ {lot_for_lot, fixed_qty, epq}; `fixed_qty` (≥MOQ), `epq_setup_cost`. Turns P-P.0's lot-for-lot default into economic lots; propagates through $O_{\ell,t}$ order sizes.
- **P-P.6 `standing_capacity_reserve`** (M8): `reserve_factor` (×$O_p$, [0,0.5]), `standing_cost` (€/wk). A pre-paid capacity buffer raising the effective $O_p$ at a standing cost.
- **P-P.7 `process_flexibility`** (M8): `flexibility_matrix` (line→products), `switchover_time_weeks` [0,2], `switchover_cost`. Lets a line build alternate products under disruption.
- **P-P.8 `alternative_bom`** (M8): `substitute_map` (material→substitutes), `substitute_rates` $r'_{p,m'}$, `substitution_cost`, `auto_substitute`. Material-side substitution on the material-availability chain.
- **P-P.10 `repurposing`** (M8): `conversion_map` (line→capability), `conversion_time_weeks` [1,8], `reversion_time_weeks` [0,4], `conversion_cost`. Longer-horizon line conversion.

Each is fully schema-registered; selecting one raises `PolicyNotImplementedError` with its milestone. Their intended propagation paths are the production-capacity and material-availability chains of §3.

---

### Stage C — Transport policies (`P-T.x`)

Transport policies act at PH-90 logistics. Only P-T.2 (expediting) executes today; the lane-portfolio policies require lanes to become first-class model entities (gap G7) before they bind. Route optimization and milk runs are deferred (network *design*, not simulation policy, and below weekly fidelity).

---

#### P-T.2 — `expedited_shipments` ✅

**Identity.** `expedited_shipments` · P-T.2 · transport · slot: transport · horizon: operational · ✅ implemented · class: improvisation · constraint: response time.

**Purpose.** Pay premium freight to pull in-transit material forward (shorten remaining transit) when it is revenue-positive, for disrupted materials or all.

**Business interpretation.** Air-freight/expedite the critical shipment: spend a premium to get material a week or more sooner when a stockout is imminent.

**Assumptions.** Expediting compresses remaining pipeline transit; worth it only when the pulled-forward units enable sales worth more than the premium.

**Required / optional inputs.** Upstream: $\phi_t$, $\hat D^{\mathrm m}_{m,t}$, $B$, $I$, $\Pi$. Data: material cost $c_m$ (the premium is a % of it).

**Parameters.**

| Name | Symbol | Unit | Range | Default | Meaning |
|---|---|---|---|---|---|
| `decision` | — | enum | {revenue_positive, always_during_disruption} | revenue_positive | When to expedite |
| `premium_pct_of_cost` | $C^{exp}_m$ | % of $c_m$ per unit | [1, 50] | 3 | Expedite premium |
| `scope` | — | enum | {disrupted_materials, all} | disrupted_materials | Which materials qualify |

**Policy logic & formulation.** For qualifying materials with pipeline arriving beyond the need week, pull a quantity forward one week when revenue-positive:
$$\text{expedite}_{m,t}=\mathbf 1[\text{scope}_m]\cdot\mathbf 1[\text{margin from earlier arrival} > C^{exp}_m\,c_m],$$
moving $\Pi_{\ell}$ from a later arrival slot to an earlier one. Premium $C^{exp}_m c_m$ per pulled unit accrues to $\mathcal C^{res}$.

**Decision rules.** `scope=disrupted_materials` limits expediting to materials whose source is firm-visibly disrupted ($\phi_t$); `all` allows it whenever revenue-positive.

**Outputs.** `state.pipeline` (arrivals pulled forward); `state.cost_ledger` (premium).

**Upstream dependencies.** $\phi_t$ (PH-20); material demand/backlog/on-hand/pipeline (state).

**Downstream consumers.** PH-90 arrivals → $I_m$ next week → production feasibility; PH-99.

**Prefill.** `premium_pct_of_cost` ← 3; scope ← disrupted_materials; decision ← revenue_positive.

**Preset behavior.** A resilience lever rather than a base preset field; enabled in resilience studies. Manuscript result: expediting dominates for *long* outages. §9.

**Implementation notes.** Hook PH-90. Vectorized over qualifying materials. Reshapes the pipeline ring buffer; conserves units (pull-forward, not creation).

---

#### Planned transport policies (🧩)

- **P-T.1 `multimodal_lane_portfolio`** (M7, needs edge split): `lanes` (≤3 per link), `mode_split_pct` (sum 100). Makes each supplier link a portfolio of modes with per-mode lead time/cost/capacity — the prerequisite for mode choice. Requires lanes to be first-class (G7).
- **P-T.3 `mode_shift`** (M7, needs P-T.1): `upgrade_lane`, `lt_saving_weeks`, `upgrade_cost`, `decision`. Shift volume to a faster mode under disruption.
- **P-T.4 `leadtime_hedging`** (M8): `applies_to` {all, long_lt, abc_a_only}, `hedge_weeks` [0,8], `long_lt_threshold_weeks`. Order earlier than the policy dictates for long-lead/critical materials — a time buffer instead of a unit buffer (Hook PH-70).

---

### Stage D — Customer policies (`P-C.x`)

Customer policies govern demand-side behavior at PH-10 (generation) and PH-60 (fulfillment/allocation). The demand *model* (P-C.4) is an engine mechanic today (§7); the fulfillment policies below are implemented.

---

#### P-C.1 — `unmet_demand_handling` ✅

**Identity.** `unmet_demand_handling` · P-C.1 · customer · slot: order management · horizon: operational · ✅ implemented (lost_sales validated in the manuscript) · class: built-in · constraint: demand-side.

**Purpose.** Decide what happens to demand that cannot be served this week: it is lost, it waits (backorder), or a share waits (partial backorder).

**Business interpretation.** Lost sales (competitive markets — the customer buys elsewhere) vs. backorder (contractual B2B — the order waits) vs. partial. Backorders convert lost revenue into delay cost.

**Assumptions.** Weekly buckets; backorders age and expire at the horizon (aged-out backlog becomes lost); partial splits unmet demand by an accept probability.

**Required / optional inputs.** Upstream: $D_{p,t}$ (PH-10), fg-fulfillment/production output (served), $F_{p,t}$ (PH-60). No extra data required.

**Parameters.**

| Name | Symbol | Unit | Range | Default | Meaning |
|---|---|---|---|---|---|
| `rule` | — | enum | {lost_sales, backorder, partial_backorder} | lost_sales | Unmet-demand disposition (lost_sales ✅ manuscript) |
| `backorder_horizon` | $\bar h$ | weeks | [0, 26] | 4 | Aged-out backlog becomes lost |
| `backorder_penalty` | — | €/unit/wk | ≥ 0 | 0 | Delay-cost per backordered unit-week |
| `partial_accept_prob` | $\beta$ | — | [0, 1] | 0.5 | Share of unmet demand that waits (partial) |

**Policy logic & formulation.** Unmet demand $U_{p,t}=\max(0,\,D_{p,t}-F_{p,t})$. Then:
- **lost_sales:** $\Lambda_{p,t}\mathrel{+}=U_{p,t}$ (nothing carried).
- **backorder:** $B_{p,t+1}=B_{p,t}+U_{p,t}-(\text{served backlog})$, with entries older than $\bar h$ moved to $\Lambda$. Penalty $\text{backorder\_penalty}\cdot B_{p,t}$ accrues to $\mathcal C^{res}$.
- **partial_backorder:** $\beta U_{p,t}$ backordered, $(1-\beta)U_{p,t}$ lost.

**Decision rules.** Backlog is served FIFO before fresh demand next week (the release order is P-P.12's parameter, §7). Aged backorders expire to lost sales at $\bar h$.

**Outputs.** `state.backlog` $B_{p,t}$; `state.lost_sales` $\Lambda_{p,t}$; `fulfillment` (backlog served); `state.cost_ledger` (backorder penalty). (Hooks write `fulfillment, state.backlog, state.cost_ledger, state.lost_sales` at PH-60.)

**Upstream dependencies.** PH-60 `fulfillment` (shaped by P-C.2 allocation); $D_{p,t}$ (PH-10).

**Downstream consumers.** Next-week PH-40 planning (MTO reads backlog); PH-99 KPIs (fill rate, lost-sales value, max backlog).

**Prefill.** `rule` ← lost_sales; `backorder_horizon` ← 4; penalty ← 0; `partial_accept_prob` ← 0.5.

**Preset behavior.** *Premium service* → backorder (no lost sales) with a short horizon; *Cost-first* → accept backorder to cut inventory cost, or lost_sales for pure make-to-order; *Make-to-Order* → backorder. §9.

**Implementation notes.** Hook PH-60. **Divergence from today's UI:** the 7-family `max_backorder_days` (days) maps to `backorder_horizon` (weeks) via ÷7; the grid unification edits weeks directly.

---

#### P-C.2 — `customer_allocation` ✅

**Identity.** `customer_allocation` · P-C.2 · customer · slot: allocation · horizon: operational · ✅ implemented · class: improvisation · constraint: demand-side.

**Purpose.** When supply cannot serve all customers of a product, decide who is served first — spread the pain pro-rata, protect priority accounts, or honor SLA fill floors.

**Business interpretation.** "Who do we disappoint first?" made deliberate: protect strategic accounts / SLA tiers, or share shortfall fairly. Inert for single-customer MTO.

**Assumptions.** ≥2 customers of the product (skipped below two); at weekly buckets fcfs/proportional/fair_share coincide (pro-rata); priority and sla_tier differ.

**Required / optional inputs.** Upstream: $D_{p,t}$, `fulfillment` (PH-60). Data: `outbound_logistics.volume` (**required** — per-customer demand shares come from outbound volumes; without them there are no segments to allocate across).

**Parameters.**

| Name | Symbol | Unit | Range | Default | Meaning |
|---|---|---|---|---|---|
| `rule` | — | enum | {fcfs, proportional, fair_share, priority, sla_tier} | fcfs | Allocation discipline |
| `priority_weights` | — | weight per customer | — | — | Overrides `Customer.priority_weight`; higher serves first |
| `sla_tiers` | — | segment → fill floor % | — | — | Guaranteed first-pass fill per segment; scaled pro-rata when supply cannot honor all |

**Policy logic & formulation.** Given available product $F^{tot}_{p,t}$ and per-customer demand $D_{p,c,t}$:
- **proportional / fair_share / fcfs:** $F_{p,c,t}=D_{p,c,t}\cdot\min\!\left(1,\tfrac{F^{tot}_{p,t}}{\sum_{c'}D_{p,c',t}}\right)$ (pro-rata at weekly buckets).
- **priority:** serve customers in descending `priority_weights` until $F^{tot}$ exhausts.
- **sla_tier:** first pass guarantees each segment's fill floor (scaled down pro-rata if infeasible), then distributes the remainder pro-rata.

**Decision rules.** Inert (skipped) for single-customer products. revenue_max is deferred (needs per-customer pricing) — mapped to priority with a warning.

**Outputs.** Reshaped `fulfillment` split across customers; per-segment fill-rate KPIs (via `kpi_contribution`).

**Upstream dependencies.** PH-60 `fulfillment` (total available); customer demand shares from `outbound_logistics.volume`.

**Downstream consumers.** P-C.1 (unmet per customer → backorder/lost); PH-99 per-segment service KPIs.

**Prefill.** `rule` ← fcfs; segments/weights ← derived from `outbound_logistics.volume` shares.

**Preset behavior.** *Premium service* → sla_tier or priority; *Cost-first* → fcfs; *Agile high-mix* → priority. §9.

**Implementation notes.** Hook PH-60 (read-only resident that reshapes fulfillment; reports per-segment fill via the `kpi_contribution` facet). Wired to the UI's fulfillment `allocation` enum by the mappers.

---

#### Planned / mechanic customer policies

- **P-C.3 `demand_shaping`** 🧩 (M8): `substitution_offer`/`substitution_accept_prob`/`substitution_discount`, `delay_incentive`/`delay_accept_prob`. Move demand instead of fighting supply (offer a substitute or a delay incentive). Needs a revenue/elasticity model; currently a no-op mapping. Hook PH-60.
- **P-C.4 `demand_model`** ✚ (§7): the demand generator (distribution family, order frequency×size, seasonality, forecast-error injection) — an engine mechanic today, documented in §7, slated to become a named customer policy.

---

### Stage E — Cross-cutting (`P-X.x`)

#### P-X.1 — `recovery_playbook` 🧩

**Identity.** `recovery_playbook` · P-X.1 · cross (network) · slot: recovery · horizon: operational · 🧩 planned (M8) · class: meta · constraint: none (orchestrates others).

**Purpose.** Execute a *sequenced, triggered, budgeted* recovery — detect → expedite → backup → overtime — instead of a flat list of responses.

**Business interpretation.** A crisis playbook: ordered steps, each gated by a trigger and a remaining budget, composing the firm's other resilience policies in the right order.

**Parameters.**

| Name | Unit | Range | Default | Meaning |
|---|---|---|---|---|
| `steps` | ordered steps | — | — | The sequenced, triggered actions |
| `cost_cap` | € | ≥ 0 | — | Total recovery budget |
| `evaluation_cadence_weeks` | weeks | {1, 2} | 1 | How often the playbook re-evaluates |

**Status note.** Planned (M8); raises until built. It **composes** enabled policies (P-S.1/P-T.2/P-P.5) under triggers read from $\phi_t$ (PH-20) and a budget; it replaces the flat `recovery.response` list of the current 7-family schema. Its actions enable/retune other policies' crisis modes (the ModeStrip crisis values). Documented here so the eventual implementation matches this orchestration contract. Hook PH-20 (evaluation) + delegated writes.

---

## 7. Engine mechanics (promoted-default policies)

These behaviors are **core simulation logic** that runs on every model but is not yet a user-selectable policy. They are documented here because a specification of "simulation logic" is incomplete without them, and because the blueprint promotes each to a named default policy (the `.0` convention) so that *no behavior is hidden*. Until promoted, they execute as engine mechanics with the parameters shown; selecting a non-default variant is Phase B work.

### 7.1 `demand_model` (✚ P-C.4) — PH-10 demand generation

The world demand generator draws realized weekly demand per product from a distribution parameterized by mean and CV:

| kind | Draw | Notes |
|---|---|---|
| triangular / triangularAV | $D_{p,t}\sim\text{Triangular}(a,b,c)$ from mean & CV | default fallback |
| deterministic | $D_{p,t}=\bar D_p$ | |
| poisson | $D_{p,t}\sim\text{Poisson}(\bar D_p)$ | |
| negbin | $D_{p,t}\sim\text{NegBin}(\bar D_p,k(\bar D_p,\mathrm{CV}))$ | over-dispersed |

Inputs: $\bar D_p$ (`products.demand_mean` → Σ outbound volume), $\mathrm{CV}_p$. Output: $D_{p,t}$ (`demand`, PH-10). Seed: the *world* stream, independent of the policy set (so CRN holds across policy comparisons). Promotion (P-C.4) adds order frequency×size decomposition, seasonality/trend profiles, and forecast-error injection.

### 7.2 `forecasting_method` (✚ P-F.1) — PH-10 forecast update

The built-in forecast produces $\hat D_{p,t}$ driving material planning (PH-70) and MTS production planning (PH-40). Today it is a smoothed expectation of demand; promotion (P-F.1) exposes the method — moving average, exponential smoothing, seasonal naive, user-supplied series — with forecast-error metrics as KPIs. Output: $\hat D_{p,t}$ (`forecast`) — the writer at the head of interactions 1 and 2 (§8).

### 7.3 `greedy_production_plan` (✚ P-P.0) — PH-40 base plan

Builds to demand + backlog (MTO) or replenishes to the FG target (MTS), capped by base capacity plus overtime:
$$x_{p,t}=\min\!\big(O_p+\omega_{p,t},\ \underbrace{D_{p,t}+B_{p,t}}_{\text{MTO}}\ \text{or}\ \underbrace{\max(0,Y^\star_{p,t}-Y_{p,t})}_{\text{MTS}}\big).$$
When P-P.9 is active it *replaces* this greedy plan with the LP solution. Output: $x_{p,t}$ (`production_plan`).

### 7.4 `fulfillment_discipline` (✚ P-P.12) — PH-30/60 ship ordering

Default fulfillment serves demand FIFO from available FG/production output, backlog before fresh demand. Promotion (P-P.12) exposes ship-complete vs. partial, backorder release ordering, and order splitting. Contributes to $F_{p,t}$ (`fulfillment`).

### 7.5 `supplier_capacity_model` (✚ P-S.5) & `lead_time_model` (✚ P-S.6) — PH-90

Supplier capacity defaults to unlimited ($K_s=\infty$) unless `suppliers.capacity_per_week` is set; lead time is deterministic per link (or stochastic if `materials.lead_time_dist`/`lead_time_cv` are set). Promotion names these slots: P-S.5 {infinite, finite_queue, finite_reject}; P-S.6 {deterministic, stochastic(lognormal/gamma)}. Capacity gating at PH-90: shipped $=\min(\Xi_s,K_s)$; the residual congests $\Xi_s$ — the endogenous lead-time-extension mechanism of §3.

---

## 8. Policy interaction graph

### 8.1 Derived, not declared

The interaction graph is **derived** from hook read/write declarations: a directed edge exists wherever one policy/mechanic *writes* a state key another *reads*, ordered intra-week by `PHASE_ORDER` and cross-week through persistent `state.*` keys. Because `validate_hooks` enforces read-before-write, single-owner transient writes, and authorized persistent writes at load time, **the graph is guaranteed sound** — no hidden dependencies, and no runtime edge exists that is not in this graph.

### 8.2 The nine canonical interactions (writer → key → reader)

| # | Interaction | Concrete path |
|---|---|---|
| 1 | Forecasting → Inventory | P-F.1 writes `forecast` (PH-10) → PH-70 projects $\hat D^{\mathrm m}_m$ → P-P.1/P-P.3 set $s_m/S_m$ |
| 2 | Forecasting → Production | `forecast` (PH-10) → PH-40 $x_p$ (MTS replenish-to-target, P-P.0) |
| 3 | Inventory → Procurement | `inventory_levels` (PH-70, P-P.1/P-P.3) → `purchase_orders` (PH-80 release) |
| 4 | Procurement → Production | `purchase_orders` → `state.pipeline`/`state.queue` → `arrivals` → $I_m$ → next-week PH-50 feasibility |
| 5 | Production → Transport | `production_output` (PH-50) → PH-90 logistics (physical when P-T.1 lands) |
| 6 | Transport → Customer service | `arrivals` (PH-90) → $I_m$/$Y_p$ → PH-30/60 `fulfillment` → fill-rate/backlog KPIs |
| 7 | Capacity → Lead time | finite $K_s$ (P-S.5) gates the ship queue (PH-90): $\Xi_s$ congestion *is* endogenous lead-time extension |
| 8 | Allocation → Service level | P-P.9 (PH-40) and P-C.2 (PH-60) reshape `fulfillment` → per-customer/per-product service KPIs |
| 9 | Disruptions → Recovery | `disruption_state` (PH-00) → `firm_knowledge` after lag (PH-20) → P-S.1/P-S.4/P-T.2/P-P.5 + P-X.1 |

### 8.3 Complete writer→reader edge table (implemented policies + mechanics)

| State key | Written by (phase) | Read by (phase) | Flow class |
|---|---|---|---|
| `disruption_state` $\delta_t$ | mechanic (PH-00) | P-S.4 (PH-20) | information |
| `firm_knowledge` $\phi_t$ | P-S.4 / mechanic (PH-20) | P-P.1, P-P.5, P-P.9, P-S.1, P-S.2, P-T.2 | information |
| `demand` $D_{p,t}$ | P-C.4 mechanic (PH-10) | PH-40, PH-60, P-C.1 | information |
| `forecast` $\hat D_{p,t}$ | P-F.1 mechanic (PH-10) | PH-70 (P-P.1/P-P.3), PH-40 (P-P.0), P-P.4 | information |
| `material_demand` $\hat D^{\mathrm m}_m$ | mechanic (PH-70) | P-P.1, P-P.3 | information |
| `inventory_levels` $s_m,S_m$ | P-P.1, P-P.3 (PH-70) | P-P.1 release (PH-80) | information |
| `purchase_orders` $O_\ell$ | P-P.1 (PH-80) | P-S.1, P-S.2 (PH-80); PH-90 | material |
| `production_plan` $x_p$ | P-P.0/P-P.9 (PH-40) | PH-50 execute | material |
| `overtime_capacity` $\omega_p$ | P-P.5 (PH-40) | P-P.0/P-P.9 (PH-40) | material |
| `production_output` $g_p$ | mechanic (PH-50) | PH-60, P-C.1 | material |
| `fulfillment` $F_p$ | mechanic/P-C.1 (PH-60) | P-C.2 (PH-60), PH-99 | material |
| `arrivals` $A_\ell$ | mechanic/P-T.2 (PH-90) | $I_m$ next week | material |
| `state.on_hand` $I_m$ | PH-50, PH-90 | P-P.1 (PH-80), PH-50 | material |
| `state.pipeline` $\Pi_\ell$ | PH-80, PH-90, P-T.2 | P-P.1, P-S.1 | material |
| `state.queue` $\Xi_s$ | PH-80, PH-90 (P-S.5) | PH-90 shipping | material |
| `state.backlog` $B_p$ | P-C.1 (PH-60) | PH-40 next week | information |
| `state.fg_target` $Y^\star_p$ | P-P.4 (PH-70) | PH-40 next week | information |
| `state.cost_ledger` $\mathcal C^{res}$ | any (append-only) | PH-99 | financial |
| `kpi_rows` | mechanic (PH-99) | results persistence | financial |

Flow classes tag each key information / material / financial, so a future explicit-flow UI (the user's eventual goal) has a ready data model — with **no new mechanism** required now.

### 8.4 Composition advice (statistical complement)

Mechanical soundness (`validate_hooks`) is complemented by `check_portfolio`: when two stacked policies target the same constraint, it emits a submodularity/overlap warning — the policies underdeliver jointly. Mechanical graph + statistical composition advice give the full interaction framework with zero prose-drift risk.

---

## 9. Preset definitions (exact parameter deltas)

Three presets per stage — the streamlined set already implemented in `src/lib/policies/presets/` and scoped in `presets/stagePresets.ts`. Each table below states, per preset, the policy field it sets, the value, and the `why`. **Values are given over the engine parameters the engine reads** (correction C2/C5: presets that historically set absolute UI fields such as `reorder_point` are re-expressed over `policy_type`, coverage $\kappa$, and safety-stock method). Presets are *derivation functions* — where a value is context-derived it is written as a formula in the project mean $\bar D$ / CV.

### 9.1 Supplier presets

**Lowest-cost single source** — consolidate on the cheapest supplier; minimal resilience spend.

| Policy | Field | Value | Why |
|---|---|---|---|
| P-S.2 | (multi-sourcing) | disabled | Single source — no split |
| P-S.1 | (backup) | disabled | No backup by design |
| P-S.6 | lead_time_model | deterministic | Predictable single lane |
| (order cadence) | consolidation | weekly | Weekly POs, LTL milk-run |

**Dual-source resilient** — 70/30 split, reliability-ranked backup, monitored.

| Policy | Field | Value | Why |
|---|---|---|---|
| P-S.2 | weights | 70/30 on multi-sourced materials | Structural diversification before disruption |
| P-S.2 | rebalance_trigger | disruption | Shift off disrupted suppliers |
| P-S.1 | activation_trigger / selection_rule | on_disruption / reliability | Warm backup, most reliable first |
| P-S.1 | cooldown_weeks | 2 | Stay on backup two weeks after recovery |

**JIT inbound** — single trusted supplier, daily orders, minimal buffer.

| Policy | Field | Value | Why |
|---|---|---|---|
| P-S.2 | (multi-sourcing) | disabled | Single trusted source |
| P-P.1 | review_cadence_weeks | 1 | Frequent small orders |
| P-P.1 | coverage_weeks $\kappa$ | ⟨2,3,4⟩ | Minimal cover — JIT |

### 9.2 Plant presets

**Make-to-Stock** — build to forecast, hold FG, larger buffers.

| Policy | Field | Value | Why |
|---|---|---|---|
| P-P.1 | policy_type / $\kappa$ | min_max / ⟨8,10,12⟩ | Classic MTS replenishment with generous cover |
| P-P.3 | classification / SL | service_level (or abc_xyz) / 95% | Headline 95% service from stock |
| P-P.4 | sizing / service_level_pct | service_level / 95% | FG buffer sized to 95% |
| (production) | utilization cap | 85% | High utilization, modest slack |

**Make-to-Order** — build to confirmed demand, minimal FG.

| Policy | Field | Value | Why |
|---|---|---|---|
| P-P.1 | policy_type / $\kappa$ | base_stock / ⟨4,5,6⟩ | Lower cover; pull to demand |
| P-P.4 | (FG buffer) | zero / disabled | No finished-goods stock (build to order) |
| P-C.1 | rule | backorder | Orders wait rather than shipping from stock |

**Lean pull** — daily review, low safety stock, 80% utilization.

| Policy | Field | Value | Why |
|---|---|---|---|
| P-P.1 | review_cadence_weeks / $\kappa$ | 1 / ⟨3,4,5⟩ | Frequent review, low cover |
| P-P.3 | classification / fixed_days | fixed_days / small | Thin buffer |
| (production) | utilization cap | 80% | Deliberate slack for flow |

### 9.3 Customer presets

**Premium service** — high service, protect priority accounts, no lost sales.

| Policy | Field | Value | Why |
|---|---|---|---|
| P-C.1 | rule / backorder_horizon | backorder / short | Never lose the order; short wait |
| P-C.2 | rule | sla_tier (or priority) | Protect strategic accounts under scarcity |
| P-P.9 | objective | max_fill_rate / priority_weighted | Allocate scarce material to service |

**Cost-first fulfillment** — lower service, accept backorder to cut inventory cost.

| Policy | Field | Value | Why |
|---|---|---|---|
| P-C.1 | rule | backorder (or lost_sales for pure MTO) | Accept delay to reduce buffers |
| P-C.2 | rule | fcfs | Simplest, cheapest allocation |
| P-P.9 | objective | max_revenue | Chase the highest-margin mix |

**Agile high-mix** — short horizon, priority allocation, flexible mix.

| Policy | Field | Value | Why |
|---|---|---|---|
| P-C.2 | rule | priority | Serve the priority mix first |
| P-P.9 | window_weeks | 2 | Short rolling horizon for responsiveness |
| P-F.1 | (forecast horizon) | short | React to recent demand |

### 9.4 Preset correctness invariant

Every preset table above sets only parameters that appear in the engine registry schema of the
named policy (§6). A CI check (planned, mirroring `check_registry_bridge.mjs`) asserts this: a
preset field with no corresponding engine parameter is a build failure. This is the structural
guarantee behind "Apply-Preset is completely transparent" — the `why` always describes behavior
that actually runs.

---

## Appendix A — Symbol index

Data: $c_m$ material cost, $u_p$ product value, $c^h_m$ holding rate, $L_\ell$ lead time,
$Q^{\min}_m$ MOQ, $K_s$ supplier capacity, $r_s$ reliability, $O_p$ base capacity,
$\bar D_p$ mean demand, $\mathrm{CV}_p$ demand CV. Persistent state: $I_{m,t}$ on-hand,
$\Pi_{\ell,t}$ pipeline, $\Xi_{s,t}$ queue, $B_{p,t}$ backlog, $\Lambda_{p,t}$ lost sales,
$Y_{p,t}$ FG on-hand, $Y^\star_{p,t}$ FG target, $\mathcal C^{res}_t$ cost ledger. Transient:
$\delta_t$ disruption, $D_{p,t}$ demand, $\hat D_{p,t}$ forecast, $\phi_t$ firm knowledge,
$\hat D^{\mathrm m}_{m,t}$ material demand, $s_{m,t}/S_{m,t}$ reorder/order-up-to, $O_{\ell,t}$
order, $x_{p,t}$ plan, $\omega_{p,t}$ overtime, $g_{p,t}$ output, $F_{p,t}$ fulfillment,
$A_{\ell,t}$ arrivals. Policy: $\kappa$ coverage weeks, $\theta$ coverage threshold, $\alpha$
service level, $z(\cdot)$ standard-normal quantile, $\beta$ partial-accept probability,
$\bar h$ backorder horizon, $\lambda$ detection lag. Each symbol has exactly one meaning
document-wide (§1).

## Appendix B — KPI dictionary (PH-99 outputs)

| KPI | Symbol | Unit | Definition |
|---|---|---|---|
| Fill rate | FR | % | Value-weighted served demand $\sum_p u_p F_p / \sum_p u_p D_p$ over the analysis window |
| Lost sales value | — | € | $\sum_p u_p \Lambda_p$ over the window |
| Max backlog | — | units | Peak $\sum_p B_{p,t}$ within the window |
| On-hand value | — | € | Average valued inventory position |
| Revenue | — | € | Valued fulfillment over the window |
| Cost of resilience | $\mathcal C^{res}$ | € | SS holding + backup/multi-sourcing premiums + expediting + overtime + monitoring, per-policy ledgered |
| Time to recover | TTR | weeks | Disruption start until weekly FR re-enters the pre-disruption band |
| Time to survive | TTS | weeks | Weeks FR survives inside the band from disruption start |
| Service-loss area | SLA | %·wk | $\int \max(0, FR^{clean}-FR^{disrupted})\,dt$, CRN-paired |
| Resilience index | RI | 0–100 | $100[w_1(1-\widehat{SLA})+w_2(1-\widehat{TTR})+w_3\widehat{TTS}+w_4(1-\hat C)]$, $w=(.35,.25,.15,.25)$ |

## Appendix C — Prefill provenance table (all prefilled parameters)

| Parameter | Policy | Source | Estimator / assumption |
|---|---|---|---|
| material cost $c_m$ | valuation (all) | `materials.cost` → cheapest inbound `unit_price` → 1.0 | Cheapest available source price; terminal 1.0 flagged as required-data gap |
| product price $u_p$ | P-P.4, P-P.9 | `products.sell_price` → demand-weighted outbound `unit_price` → 1.0 | Revenue-weighted average of observed outbound prices |
| mean demand $\bar D_p$ | demand model | `products.demand_mean` → Σ outbound `volume` | Sum of observed weekly outbound volumes |
| demand CV $\mathrm{CV}_p$ | P-P.3, P-P.4 | `products.demand_cv` → scenario `cv` → 0.30 | Observed CV; default 0.30 flagged recommended |
| lead time $L_\ell$ | P-P.1, P-S.1 | `inbound_logistics.lead_time` → 2 wk | Observed lane lead time; default 2 wk warned |
| MOQ $Q^{\min}_m$ | P-P.1 | `materials.moq` → 0 | Observed MOQ; 0 = no minimum |
| supplier capacity $K_s$ | P-S.5 | `suppliers.capacity_per_week` → ∞ | Empty = unlimited (a valid modeling choice) |
| production capacity $O_p$ | P-P.5, P-P.9 | `products.production_capacity` → $\max(2\bar D_p,1000)$ | Default makes capacity non-binding — flagged required for capacity studies |
| reliability $r_s$ | P-S.1 | `suppliers.reliability_score` → 1.0 | Default = perfectly reliable |
| multi-source weights | P-S.2 | `inbound_logistics.volume` shares → equal split | Observed lane volume shares |

Every prefilled value is one of: an exact master field, a named reducer over logistics arcs, or
a documented default — never an unexplained constant. This table *is* the "no hidden heuristic"
guarantee.

## Appendix D — Glossary

*Slot* — a decision domain a stage must fill (e.g. inventory control). *PolicyBundle* — a node's
resolved `{slot → (policy_id, params)}` map. *Prefill* — a pre-filled parameter value drawn from
project data before the user edits (§4). *Preset* — a named strategy that sets a coherent
parameter set across a stage's policies (§9). *ModeStrip* — a nominal/alert/crisis parameter
triple; crisis engages while a disruption is firm-visible. *Firm knowledge* $\phi_t$ — whether a
disruption is known to the firm this week (after detection lag). *Coverage* $\kappa$ — weeks of
order-up-to cover beyond lead time. *Endogenous lead time* — lead-time extension that emerges
from supplier-queue congestion rather than a parameter (§3, interaction 7). *`simulation_flow_id`*
— the named, versioned weekly execution order (`weekly-v1`, §2). *Promoted default* — an engine
mechanic given a policy id and UI visibility (§7).

---

*End of specification. This document is authoritative for policies and simulation logic; keep it
current with every change to either (see governance header).*
