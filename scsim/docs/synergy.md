# Portfolio studies & synergy (Part V / Synergy Explorer)

## Portfolio study

```python
from scsim.core.engine import run_portfolio_study
from scsim.synergy import decompose

study = run_portfolio_study(scenario, portfolios={
    "S1":    {"backup_supplier": {}},
    "S5":    {"expedited_shipments": {}},
    "S1+S5": {"backup_supplier": {}, "expedited_shipments": {}},
})
syn = decompose(study, "S1+S5", ["S1", "S5"])
print(syn.synergy_revenue.point, syn.synergy_revenue.stars)
```

`run_portfolio_study` runs, under one shared world (CRN by construction):

* **S0** — built-ins only (P-P.1 + P-C.1 with the scenario's params): the
  do-nothing baseline of Eqs. 24–25;
* each **portfolio** (built-ins + the strategy set);
* a **clean reference per portfolio** (same policies, no events) for the
  SLA series — disrupted rep `(i, j)` pairs with the clean rep at model
  seed `i`.

Warm-up is detected once on S0 and shared (same network and built-ins ⇒
same steady state). Per-replication ΔR, ΔC and SLA arrays live in
`study.deltas[name]`.

## Synergy decomposition

`synergy_X(AB…) = Δ_X(combo) − Σ Δ_X(components)`, computed per replication
on the CRN-paired delta arrays, then percentile-bootstrapped (two-sided,
`bootstrap_resamples`, stars at .05/.01/.001).

* **Positive** synergy: the combination unlocks more than its parts
  (complementary constraints).
* **Negative** synergy: submodular overlap — both strategies fix the same
  bottleneck. The engine's own test suite reproduces the manuscript's
  headline case: `backup_supplier + expedited_shipments` on a long supplier
  outage is strongly negative and significant (each alone recovers most of
  the same lost revenue).

`SynergyResult.overlap_diagnostics` lists constraint tags targeted by more
than one component portfolio — the structural warning that pairs with the
empirical number.

## Breadth ladder

`scsim.synergy.breadth_ladder(study, ladder)` produces the inverted-U rows:
breadth, mean ΔR, mean ΔC, and the 2–3 guidance-band flag (§4.6 rule 6).
Compile-time composition checks complement it: portfolios with breadth ≥ 4
or ≥ 2 pre-deployed strategies on one constraint tag carry structured
warnings in every result (`feasibility_warnings`).
