# %% [markdown]
# # SuReSuite 02 · Disruption and resilience: what breaks, and how fast it recovers
#
# The Simulation Lab's **stress tests** in Python. You give a scenario a
# **disruption schedule**, run it against the same policies and random worlds as
# the baseline, and read three things:
#
# - **impact** — fill rate and lost sales against the baseline, paired by replication;
# - **time to survive** (TTS) — weeks the chain kept serving after the event began;
# - **time to recover** (TTR) — weeks until service returned to its pre-disruption level.
#
# Four stress tests on the Example project (demo), each one a lesson:
#
# | Test | Target | Lesson |
# |---|---|---|
# | Plant shutdown, 4 weeks | `plant` | works on **every** project; nothing upstream can help |
# | Sole-source outage, 6 weeks | `S2` — the only supplier of M2 | a single-sourced material is the weak link |
# | Dual-source outage, 6 weeks | `S1` — M1 also comes from S3 | a second source absorbs most of it |
# | 60 % capacity cut, 6 weeks | `S2` | a cut only bites when what is left is below what the plan needs |

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

# Supplier ids of YOUR project (from your suppliers / inbound data). The demo
# uses the Example project's: S2 is the only source of M2; M1 comes from S1 and S3.
SOLE_SOURCE_SUPPLIER = SUPPLIER_ID or ("" if LIVE else "S2")
DUAL_SOURCE_SUPPLIER = "" if LIVE else "S1"   # live: set to a supplier whose material has a second source

# %% [markdown]
# ## 1 · What a disruption event is
#
# An event names a **target**, a **start**, a **duration** and a **magnitude**:
#
# - **target** — one of *your project's supplier ids*, or `plant`. The engine
#   cannot disrupt a material, a customer or a lane yet: such an event is
#   **skipped**, and the pre-run gate answers `422` so you find out before you pay
#   for a run that hit nothing.
# - **start / duration** — in days; the engine works in whole weeks (start at
#   week 1 or later, 1–52 weeks long), and an event that would begin inside the
#   detected warm-up is moved to its end.
# - **magnitude** — `100` means the target ships nothing for the window (its
#   deliveries are deferred, not lost). Below 100 cuts its capacity **by** that
#   share, and needs the supplier to declare a capacity (`capacity_per_week`).
#
# At most five events per scenario reach the engine.

# %%
tests = {"plant shutdown (4 wk)": [outage("plant", start_day=140, duration_days=28)]}
if SOLE_SOURCE_SUPPLIER:
    tests[f"{SOLE_SOURCE_SUPPLIER} outage (6 wk)"] = [outage(SOLE_SOURCE_SUPPLIER)]
    tests[f"{SOLE_SOURCE_SUPPLIER} −60 % capacity"] = [outage(SOLE_SOURCE_SUPPLIER, magnitude_pct=60)]
if DUAL_SOURCE_SUPPLIER:
    tests[f"{DUAL_SOURCE_SUPPLIER} outage (6 wk)"] = [outage(DUAL_SOURCE_SUPPLIER)]
if not SOLE_SOURCE_SUPPLIER:
    print("set SUPPLIER_ID in the CONFIG cell to add supplier outages; running the plant shutdown only")

scenarios = {name: stress_scenario(api, PID, base, events, name=f"{base['name']} + {name}")
             for name, events in tests.items()}
pd.DataFrame([{"test": n, "scenario": s["id"], **s["disruption_schedule"][0]} for n, s in scenarios.items()])

# %% [markdown]
# ## 2 · Run the baseline and every stress test
#
# Same policy version, same seed, CRN on — the only thing that differs from the
# baseline is the disruption, which makes the comparison a clean one.

# %%
baseline_run = api.run_and_wait(PID, base["id"], version["id"])
stress_runs = {}
for name, sc in scenarios.items():
    print(f"── {name}")
    stress_runs[name] = api.run_and_wait(PID, sc["id"], version["id"])
    assert_disruption_applied(api.replications(stress_runs[name]["id"]))

# %% [markdown]
# ## 3 · Impact at a glance

# %%
summary = []
for name, run in {"baseline": baseline_run, **stress_runs}.items():
    reps = replications_frame(api.replications(run["id"]))
    agg = run["aggregate_kpis"]
    summary.append({
        "test": name,
        "fill rate": fmt_kpi("fill_rate", agg.get("fill_rate")),
        "lost sales": fmt_kpi("lost_sales_value", agg.get("lost_sales_value")),
        "cost of resilience": fmt_kpi("cost_of_resilience", agg.get("cost_of_resilience")),
        "TTS (wk)": fmt_kpi("tts_weeks", agg.get("tts_weeks")),
        "TTR (wk)": fmt_kpi("ttr_weeks", agg.get("ttr_weeks")),
        "recovery censored": (f"{int(reps['ttr_censored'].sum())}/{len(reps)}" if "ttr_censored" in reps else "—"),
    })
pd.DataFrame(summary).set_index("test")

# %% [markdown]
# A **censored** recovery means the run ended before service came back, so its
# TTR is a lower bound and is left out of the mean rather than counted as a
# number — the same rule the app applies. A TTS of "—" means service never
# dipped below its band: the chain survived the whole window.

# %%
plot_kpis({"baseline": baseline_run, **stress_runs}, ["fill_rate", "lost_sales_value", "cost_of_resilience"],
          title="Baseline vs each stress test — error bars: 95 % CI")

# %% [markdown]
# ## 4 · Paired impact: stress test − baseline
#
# The baseline and a stress test share their random worlds, so the impact is read
# replication by replication — the Lab's disruption-impact comparison (the runs
# differ only in their events).

# %%
for name, run in stress_runs.items():
    print(f"\n{name} − baseline")
    display(paired_compare(api.replications(baseline_run["id"]), api.replications(run["id"]),
                           ["fill_rate", "lost_units", "lost_sales_value", "cost_of_resilience"],
                           labels=("baseline", name)).drop(columns=["delta", "half_width"]))

# %% [markdown]
# ## 5 · Week by week
#
# The shaded band is the window the event **actually** covered (whole weeks,
# moved past the warm-up if needed). Watch the dip, how deep it goes, and how
# long the line takes to climb back.

# %%
for name, run in stress_runs.items():
    window = effective_window(scenarios[name]["disruption_schedule"][0], run)
    plot_series({"baseline": api.series(baseline_run["id"]), name: api.series(run["id"])}, "fill_rate",
                title=f"Weekly fill rate — {name}", window=window, warmup_week=run.get("warmup_detected_at"))

# %% [markdown]
# **Reading it (demo numbers).**
#
# - The **plant shutdown** is the deepest dip: no upstream buffer helps a plant
#   that cannot produce.
# - The **S2 outage** is a clear loss; the **S1 outage**, the same six weeks, is
#   *not distinguishable from the baseline* at ten replications — its paired
#   interval includes zero. M1 has a second source (S3), M2 does not. Single
#   sourcing is what turns a supplier problem into a shortage — notebook 03
#   follows it. (If you need to know whether S1 costs *anything*, run more
#   replications: the interval narrows with their square root.)
# - The **60 % cut** changes nothing: S2 declares far more capacity than the plan
#   draws, so 40 % of it is still enough. The event *was* applied (the check above
#   passed) — it just did not bind.
#
# ## Next
#
# - **03 Material shortage** — the S2 outage seen as a shortage of M2, and what
#   backorders do to it.
# - **01 Policy experiment** — buy resilience with safety stock and measure it.
#
# **In the app:** the stress scenarios are in the Simulation Lab's scenario list;
# the Lab's stress-test presets launch the same two kinds of event (supplier
# outage, plant shutdown).
