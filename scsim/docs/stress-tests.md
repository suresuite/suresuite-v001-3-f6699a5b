# Stress Test module (Part VI)

A battery cell = one (target × effect × magnitude × duration) scenario run
with the **current portfolio**. All cells of a battery share:

* one **clean reference** run (no events) — supplies the SLA series and the
  RI cost normalization, and warms the snapshot cache;
* one **warm-state snapshot per model seed** — cells restore at `t_w` and
  simulate only the post-warm-up weeks (§10.2.4, the single biggest lever
  for big sweeps; bit-identity with full runs is tested);
* the **same world streams** (CRN by construction) — cross-cell comparisons
  are paired.

| # | Test | Status | Entry point |
|---|---|---|---|
| ST-1 | Supplier outage sweep (manuscript ✅): supplier × LT-ext × Δt {5,8,10} | ✅ | `scsim.stress.run_st1` |
| ST-2 | Supplier capacity-cut sweep: supplier × φ {0.75,0.5,0.25,0} × {4,8} wks | ✅ | `scsim.stress.run_st2` |
| ST-3 | Material shortage sweep | 🧩 M7 | — |
| ST-4 | Edge/lane shock (needs edge split) | 🧩 M7 | — |
| ST-5 | Demand surge | 🧩 M7 | — |
| ST-6 | Compound (ST-1 ∩ ST-5) | 🧩 M7 | — |
| ST-7 | Nexus-node attack (top-k ML-critical, ml-service integration) | 🧩 M7 | — |

ST-2 cells on suppliers without a finite `capacity_per_week` are **skipped
with reasons** (`report.skipped`) rather than failing the battery — ∞ has no
flow to throttle (§3.5).

## Outputs

`StressTestReport.scorecard()` — one row per cell: KPI mean/CI stats
(fill_rate, revenue, lost_sales_value, C^res, TTR, TTS, max_backlog,
lost_inbound_units, service_loss_area), the **Resilience Index with its
components**, the supplier's ρ_s and profile (the vulnerability-map overlay
of manuscript Figs. 4–5), replication counts, and badges.

`StressTestReport.vulnerability_ranking()` — suppliers ranked by worst-cell
RI (lower = more vulnerable), with ρ_s beside each entry: the headline
"which supplier, and is it even backup-able?" view.

## ST-1 vs ST-2 — the headline contrast

The same supplier ranks differently under **delay** (LT-extension: time
compression strategies win — P-T.2, P-T.3) and **volume loss** (capacity
cut: source/substitute diversification wins — P-S.2, P-S.3, P-P.8). Run
both batteries with the same portfolio and compare rankings; the effect-type
hints in §4.6 rule 4 come from exactly this contrast.

## Budgets

`run_mode="full"` uses the scenario's `model_seeds × disruption_event_seeds`
grid. `fast_scan` (10×6 seeds, kpi_only traces) stamps every cell with
`wide_ci_badge` — fast-scan numbers must never be silently mixed with
full-mode results (Risk R4); the badge travels with the row.
