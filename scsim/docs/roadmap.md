# Roadmap & milestone status (Part XI)

Engine version: **0.2.0** (ADR 0001 — MTS fulfillment mode). ✅ = shipped ·
🔜 = next · 🧩 = scheduled.

| M | Deliverable | Status |
|---|---|---|
| M1 | Entities + Part III dictionary in Pydantic; registry; phase-pipeline skeleton + hook validation; golden #1 | ✅ — registry serves all 22 policies with units/ranges; pipeline schema snapshot test green |
| M2 | MTO core loop (PH-10..99); LT-extension injector; warm-up detection (MSER-5 + Conway); ring-buffer pipeline; golden #2–3 | ✅ — perf 0.33 s/rep at manuscript scale (target ≤ 0.5 s) |
| M3 | ✅ policies as plugins (P-P.1, P-C.1, P-S.1, P-P.3, P-P.5, P-P.9, P-T.2); keyed policy RNG; G-RNG test; warm-state snapshots | ✅ — directional manuscript reproduction in the test suite (expedite dominates long outages; S1+S5 synergy negative & significant; overtime inert when material-constrained) |
| M4 | ST-1 end-to-end + scorecard + RI; fast_scan | ✅ engine-side (`run_st1`, badges, snapshot reuse); job sharding to workers is orchestration-layer work |
| M5 | Portfolio study + synergy decomposition (CRN, bootstrap stars, overlap diagnostics, breadth ladder) | ✅ engine-side; Portfolio Builder / Synergy Explorer UI pending |
| M6 | Docs auto-generation + docs CI gate; validation suite | ✅ — `scripts/gen_docs.py --check` gates CI; 90+ tests including golden traces |
| M7 | capacity_reduction ✅ + ST-2 ✅; **MTS mode + P-P.4 ✅ (0.2.0, ADR 0001)**; P-S.2 ✅; golden #6 ✅ + MTS-vs-MTO TTS comparison ✅; plant/edge targets, edge split, P-S.4, P-C.2, ST-3/4/5 | 🔜 — most of M7 shipped; plant targets / edge split / remaining batteries scheduled |
| M8 | Remaining 🧩 policies; P-X.1 playbook; LLM diff proposer (flagged) | 🧩 — full parameter schemas already in the registry |

## Shipped ahead of plan

* `capacity_reduction` effect with queue/reject overflow, ramps, and
  conservation tests (planned M7) — needed for the ST-1 vs ST-2 contrast.
* `edge:lane` targets in behavior-neutral mode (golden #5 equivalence).
* ST-2 capacity-cut battery with skip-with-reason semantics.
* MTS mode + P-P.4 + P-S.2 + golden #6 (M7 items, landed in 0.2.0): the
  CODP is live — networks may mix MTO and MTS products; the M5 positive-
  synergy exit criterion ({P-P.3, P-P.5} on complementary constraints) is
  validated in the test suite.

## Known gaps before M7 closes

* ~~`node:plant` disruption targets (P-P.4's "uniquely protective" case).~~
  ✅ shipped — a plant capacity_reduction / lead_time_extension throttles or
  halts the plant's own production (`tests/test_plant_disruption.py`); both
  input mappers (`io/project_map.py`, `io/legacy_graph.py`) pass `plant:*` /
  `node:plant` targets through instead of skipping them.
* Edge lead-time split (`Lane.lead_time_weeks > 0` is schema-valid but the
  engine still folds transport into `T_s`).
* P-S.4 early-warning (the global `detection_lag_weeks` lever already
  exists in settings; the policy packages it with monitoring cost), P-C.2.
* ST-3..7 batteries; demand-surge events need a demand-side effect type
  (Tier-3: new event target class).
* Worker-pool sharding / resumable sweeps (orchestration; the seed tree and
  snapshot store are already shard-safe).
