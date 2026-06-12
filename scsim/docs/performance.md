# Performance engineering (Part X)

## Targets and current numbers

Measured with `python scripts/benchmark.py --large` (single core, full ✅
portfolio enabled: P-P.3, P-P.5, P-P.9, P-S.1, P-T.2):

| Workload | Target | Measured (dev container) |
|---|---|---|
| Single replication, manuscript scale (15 P × 556 M × 58 S × 156 wk) | ≤ 0.5 s | ~0.33 s |
| Large instance (200 P × 5,000 M × 300 S × 156 wk) | ≤ 5 s/rep | ~2.5 s |
| One experiment cell (540 reps) | ≤ 90 s on 8 cores | ~0.33 s × 540 / cores; embarrassingly parallel |

CI runs the manuscript-scale case with a 3× guard band
(`tests/test_performance.py`, marked `slow`) so shared runners don't flake
while real regressions still fail (§10.4).

## The choices that make it fast

1. **Phase-sweep vectorization, not per-entity events.** PH-70/80 inventory
   math is NumPy over M-vectors; PH-50 producibility walks the sparse BoM
   (CSR) once; demand draws are grouped per distribution. A 5,000-material
   week costs milliseconds, not 5,000 events.
2. **Ring-buffer pipeline over supplier-material links.** In-transit is a
   `[n_links, W]` circular array (`W = max_LT + 52 + 12`); advancing is a
   slot index, LT-extension deferral is a slice move, expediting is a slot
   move. Link-level attribution is what lets disruptions target one
   supplier's flow inside a multi-sourced material.
3. **Parallelism ACROSS runs only.** Replications and stress cells are
   embarrassingly parallel (the seed tree is structural — see
   [statistics](statistics.md)); within-run stays single-threaded →
   deterministic, debuggable.
4. **Warm-state snapshots.** Stress batteries restore the post-warm-up
   world per model seed instead of re-simulating it for every cell
   (~`t_w/horizon` of every run saved; bit-identity tested).
5. **LP discipline (P-P.9).** Active-products × binding-shared-materials
   prefilter (per-τ cumulative check), 4-week horizon, HiGHS; `no_binding`
   weeks skip the solve entirely; solver failures fall back to the
   revenue-ranked greedy and are counted in `ScenarioResult.lp_fallbacks`
   (Risk R3 flag).
6. **IO discipline.** Traces buffer in NumPy and write one Parquet (zstd)
   file per replication when pyarrow is installed; verbosity
   {kpi_only, weekly, full_debug} — stress tests default to kpi_only.

## Complexity budget (per simulated week)

inventory math O(M) · production O(nnz(BoM)) · procurement O(M) ·
logistics O(L + S) · allocation LP bounded by design. Memory: the link ring
buffer dominates at O(L × (max_LT + 64)) floats — ~9 MB/rep at the large
instance.
