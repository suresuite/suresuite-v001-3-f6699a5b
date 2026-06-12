# KPIs

The normative table lives in the [generated KPI dictionary](reference/kpis.md)
(rendered from `scsim.kpi.definitions` — Part V). This page documents the
computational conventions.

## Conventions

* **Analysis window** = `[t_w, min(t_w + analysis_window, horizon))`. Every
  KPI is computed over this window only.
* **fill_rate** is value-weighted β-service against the week's own demand:
  `Σ u_p · served_new_p / Σ u_p · D_p`. Backlog clearing counts in
  `revenue`, not in the FR numerator (so FR ≤ 1 by construction).
* **cost_of_resilience** sums the ledger components
  `ss_holding + backup_premium + expediting + overtime + lost_sales +
  allocation_labor + fg_ss_holding + backorder_penalty`; each replication
  row also carries every component separately (`cost_*`).
* **ΔR / ΔC** (Eqs. 24–25 style) are computed per replication, CRN-paired
  against S0 (built-ins only, same world):
  `ΔR = Σu(Q_i − Q_S0) / Σu(D − Q_S0)`, `ΔC = 1 − C_i/C_S0`, then
  percentile-bootstrapped.
* **TTR / TTS** use the replication's own pre-disruption fill-rate band
  (mean over `[t_w, t*)` minus 2 pp). TTS = weeks from `t*` surviving inside
  the band (censored at the window if FR never leaves it). TTR = weeks from
  `t*` until FR re-enters the band sustained for 3 weeks (0 if it never
  left; censored at the window if it never recovers).
* **service_loss_area** needs a clean reference: the SAME portfolio without
  events, CRN-paired per model seed —
  `Σ max(0, FR_clean − FR_disrupted)` over the window. Produced by
  `run_portfolio_study(..., include_clean_reference=True)` and by every
  stress battery automatically.

## Resilience Index

`RI = 100·[w₁(1−ŠLA) + w₂(1−ŤTR) + w₃·ŤTS + w₄(1−Č)]`, default weights
`(.35, .25, .15, .25)` (editable; must sum to 1). Components are always
returned alongside the score (`ResilienceIndex.as_dict()`).

Normalizations (deliberate, documented choices):

| Component | Normalization | Rationale |
|---|---|---|
| ŠLA | `SLA / window_weeks` | FR ∈ [0,1] bounds the area by the window length. |
| ŤTR | `TTR / window_weeks` | Censored-at-window ⇒ 1 (never recovered). |
| ŤTS | `TTS / window_weeks` | Censored-at-window ⇒ 1 (never knocked below the band). |
| Č | `C^res / clean-baseline revenue`, clipped to [0,1] | Cost in units of healthy revenue. |
