# %% [markdown]
# # SuReSuite 02 · Disruption and resilience
#
# **You will:** stress the supply chain (a plant shutdown, supplier outages, a
# capacity cut), measure the damage against a normal year, and see how fast it recovers.
# **Time:** about 15 minutes. **You need:** nothing for demo mode; with a key, a
# supplier id from your own data.
#
# **One rule:** a disruption target must be a **supplier id of your project** or
# **`plant`**. Material, customer and lane targets are skipped by the engine (the
# notebook stops and tells you if that happens).

# %% include: config

# %% include: setup

# %% include: library

# %% include: demo_data baseline plant_shutdown s2_outage s1_outage s2_capacity_cut_60

# %%
api = connect(BASE_URL, API_KEY, DEMO_DATA)
project = pick_project(api, PROJECT_ID)
PID = project["id"]
base = baseline_scenario(api, PID, SCENARIO_ID)
version = (next(v for v in api.policy_versions(PID) if v["id"] == POLICY_VERSION_ID)
           if POLICY_VERSION_ID else api.snapshot_policies(PID, "notebook baseline"))

# %% [markdown]
# ## Try changing
# - `SOLE_SOURCE_SUPPLIER` — a supplier that is the only source of some material.
# - `DUAL_SOURCE_SUPPLIER` — a supplier whose material also comes from another supplier.
# - `START_DAY`, `OUTAGE_DAYS` — when and how long (the engine works in whole weeks).
# - `magnitude_pct` in `outage(...)` — 100 = ships nothing; below 100 = capacity cut by that share.

# %%
SOLE_SOURCE_SUPPLIER = SUPPLIER_ID or ("" if LIVE else "S2")
DUAL_SOURCE_SUPPLIER = "" if LIVE else "S1"
START_DAY, OUTAGE_DAYS = 140, 42

tests = {"plant shutdown (4 wk)": [outage("plant", start_day=START_DAY, duration_days=28)]}
if SOLE_SOURCE_SUPPLIER:
    tests[f"{SOLE_SOURCE_SUPPLIER} outage"] = [outage(SOLE_SOURCE_SUPPLIER, START_DAY, OUTAGE_DAYS)]
    tests[f"{SOLE_SOURCE_SUPPLIER} −60 % capacity"] = [outage(SOLE_SOURCE_SUPPLIER, START_DAY, OUTAGE_DAYS, magnitude_pct=60)]
if DUAL_SOURCE_SUPPLIER:
    tests[f"{DUAL_SOURCE_SUPPLIER} outage"] = [outage(DUAL_SOURCE_SUPPLIER, START_DAY, OUTAGE_DAYS)]
if not SOLE_SOURCE_SUPPLIER:
    print("set SUPPLIER_ID in the CONFIG cell to add supplier outages — running the plant shutdown only")

# %% [markdown]
# ## 1 · Run the baseline and every stress test
# Same policies, same random draws — only the disruption differs.
# **Expect:** every run reaches `done`, each followed by "disruption applied".

# %%
scenarios = {name: stress_scenario(api, PID, base, events, name=f"{base['name']} + {name}")
             for name, events in tests.items()}
baseline_run = api.run_and_wait(PID, base["id"], version["id"])
stress_runs = {}
for name, sc in scenarios.items():
    print(f"── {name}")
    stress_runs[name] = api.run_and_wait(PID, sc["id"], version["id"])
    assert_disruption_applied(api.replications(stress_runs[name]["id"]))

# %% [markdown]
# ## 2 · The damage at a glance
# **TTS** = weeks the chain kept serving after the event began; **TTR** = weeks to
# get back to normal service ("—" means service never dipped).
# **Expect (demo):** the plant shutdown is worst; the 60 % cut changes nothing
# (the supplier had spare capacity).

# %%
summary = {}
for name, run in {"baseline": baseline_run, **stress_runs}.items():
    agg = run["aggregate_kpis"]
    summary[name] = {kpi_label(k): fmt_kpi(k, agg.get(k))
                     for k in ("fill_rate", "lost_sales_value", "cost_of_resilience", "tts_weeks", "ttr_weeks")}
display(pd.DataFrame(summary).T)
plot_kpis({"baseline": baseline_run, **stress_runs}, ["fill_rate", "lost_sales_value"],
          title="Baseline vs each stress test (error bars: 95 % CI)")

# %% [markdown]
# ## 3 · Is each loss real?
# Each stress run is compared with the baseline replication by replication.
# **Expect (demo):** the sole-source outage is a clear loss; the dual-source outage
# reads "no clear difference" — the second supplier covers it.

# %%
for name, run in stress_runs.items():
    print(f"\n{name} − baseline")
    display(paired_compare(api.replications(baseline_run["id"]), api.replications(run["id"]),
                           ["fill_rate", "lost_units", "lost_sales_value"],
                           labels=("baseline", name)).drop(columns=["delta", "half_width"]))

# %% [markdown]
# ## 4 · Week by week
# The grey band is the weeks the event actually covered.
# **Expect:** a dip inside the band, and the line climbing back after it.

# %%
for name, run in stress_runs.items():
    window = effective_window(scenarios[name]["disruption_schedule"][0], run)
    plot_series({"baseline": api.series(baseline_run["id"]), name: api.series(run["id"])}, "fill_rate",
                title=f"Weekly fill rate — {name}", window=window)

# %% [markdown]
# ## Next
# - **01** — buy resilience with safety stock and measure it.
# - **03** — try a second supplier on your own copy of the data.
