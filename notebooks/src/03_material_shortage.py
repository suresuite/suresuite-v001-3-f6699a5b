# %% [markdown]
# # SuReSuite 03 · Material shortage: a sole source fails, and what your policy does about it
#
# A material shortage is not one KPI: it is what several of them say together —
# demand the plant could not serve, money lost or deferred, a backlog that builds
# and drains, inventory that runs dry. This notebook produces one on purpose and
# reads it end to end, on **any** project:
#
# 1. **Find the weak link** — a material with only one supplier.
# 2. **Induce the shortage** — that supplier ships nothing for six weeks.
# 3. **Read the evidence** — the shortage KPIs and the week-by-week picture.
# 4. **Change the response** — the unmet-demand policy (`P-C.1`): are lost orders
#    gone for good (*lost sales*), or do customers wait (*backorders*)?
#
# **Why the disruption targets a supplier, not the material.** The engine
# disrupts suppliers and the plant; a material target is skipped (the pre-run
# gate tells you so with a `422`). A material runs short when the suppliers that
# feed it stop — so the way to starve `M2` is to stop `S2`, its only source.
#
# **Live mode edits your project's fulfillment policy** for the backorder variant
# and restores it at the end of the block.

# %% include: config

# %% include: setup

# %% include: library

# %% include: demo_data baseline backorder s2_outage s2_outage_backorder s1_outage

# %%
api = connect(BASE_URL, API_KEY, DEMO_DATA)
project = pick_project(api, PROJECT_ID)
PID = project["id"]
base = baseline_scenario(api, PID, SCENARIO_ID)

# %% [markdown]
# ## 1 · Find the weak link
#
# A material with **one** supplier is exposed to that supplier alone. The API
# does not serve your input tables, so the weak link comes from you: look in
# your inbound-logistics data (the app's **Data Manager**, or the network view's
# single-source exposure) for a material with a single supplier, and put that
# supplier's id in `SUPPLIER_ID`.
#
# In the demo, the Example project's inbound lanes make the choice for us:

# %%
if LIVE:
    SOLE_SUPPLIER, SHORT_MATERIAL, CONTRAST_SUPPLIER = SUPPLIER_ID, "(its material)", ""
    if not SOLE_SUPPLIER:
        raise SystemExit("set SUPPLIER_ID in the CONFIG cell to the only supplier of one of your materials")
else:
    lanes = pd.DataFrame(api.t.d["dataset"]["inbound"])  # the demo's own input data
    sources = lanes.groupby("material_id")["supplier_id"].apply(sorted)
    display(sources.rename("suppliers").to_frame())
    SHORT_MATERIAL = next(m for m, s in sources.items() if len(s) == 1)
    SOLE_SUPPLIER = sources[SHORT_MATERIAL][0]
    CONTRAST_SUPPLIER = next(s[0] for m, s in sources.items() if len(s) > 1)
    print(f"{SHORT_MATERIAL} has one supplier, {SOLE_SUPPLIER}; "
          f"{CONTRAST_SUPPLIER}'s material has a second source (the contrast case)")

# %% [markdown]
# ## 2 · Two policies × two worlds
#
# **Policies.** *Lost sales* is the default (an order the plant cannot serve this
# week is gone). *Backorders* keep it waiting up to four weeks, at a penalty of
# 0.5 per unit per day. In the app this is /policies → Customer → fulfillment.
#
# | Stored field (`fulfillment`) | Engine (`P-C.1 unmet_demand_handling`) |
# |---|---|
# | `backorder_allowed: true` | `rule = "backorder"` (otherwise `"lost_sales"`) |
# | `max_backorder_days: 28` | `backorder_horizon` = 4 weeks |
# | `backorder_cost_per_day: 0.5` | `backorder_penalty` = 3.5 per unit per week |
#
# **Worlds.** The baseline, and the baseline plus a six-week outage of the sole
# supplier from day 140.

# %%
with editing_policies(api, PID):
    lost_sales = api.snapshot_policies(PID, "unmet demand: as configured")
    api.set_policy(PID, "fulfillment", backorder_allowed=True, max_backorder_days=28, backorder_cost_per_day=0.5)
    backorders = api.snapshot_policies(PID, "unmet demand: backorders, 4 weeks")

shortage = stress_scenario(api, PID, base, [outage(SOLE_SUPPLIER, start_day=140, duration_days=42)],
                           name=f"{base['name']} + {SOLE_SUPPLIER} 6-week outage")

runs = {}
for world, sc in (("baseline", base), ("shortage", shortage)):
    for policy, version in (("lost sales", lost_sales), ("backorders", backorders)):
        print(f"── {policy} · {world}")
        runs[(world, policy)] = api.run_and_wait(PID, sc["id"], version["id"])
assert_disruption_applied(api.replications(runs[("shortage", "lost sales")]["id"]))

# %% [markdown]
# ## 3 · The shortage, in numbers
#
# | KPI | What it says about the shortage |
# |---|---|
# | Fill rate | the share of demand (by value) served on time |
# | Lost units / lost sales | demand that never got served — gone |
# | Peak backlog | the most units waiting at once (backorders only) |
# | Time to survive / to recover | weeks until service broke, weeks until it came back |
# | Cost of resilience | the engine's total: lost sales + backorder penalty + buffers |

# %%
SHORTAGE_KPIS = ["fill_rate", "lost_units", "lost_sales_value", "max_backlog", "tts_weeks", "ttr_weeks",
                 "cost_lost_sales", "cost_backorder_penalty", "cost_of_resilience"]
table = {}
for (world, policy), run in runs.items():
    reps = replications_frame(api.replications(run["id"]))
    table[f"{policy} · {world}"] = {kpi_label(k): fmt_kpi(k, (run["aggregate_kpis"].get(k)
                                                              if k in run["aggregate_kpis"] else
                                                              reps[k].mean() if k in reps else None))
                                    for k in SHORTAGE_KPIS}
pd.DataFrame(table)

# %% [markdown]
# **Reading it (demo numbers).** With no disruption, the two policies are
# identical — nothing goes unserved, so how unserved demand is handled does not
# matter. Under the shortage, *lost sales* loses about a hundred units of demand
# for good. *Backorders* lose none of it: the same units wait in a backlog that
# peaks above a hundred and drains once M2 flows again — and the cost is a delay
# penalty, an order of magnitude below the lost revenue. The fill rate barely
# moves between the two, because it counts **on-time** service: a backorder is
# served late, not on time.

# %%
print("backorders − lost sales, during the shortage (paired by replication)")
paired_compare(api.replications(runs[("shortage", "lost sales")]["id"]),
               api.replications(runs[("shortage", "backorders")]["id"]),
               ["fill_rate", "lost_units", "lost_sales_value", "max_backlog", "cost_of_resilience"],
               labels=("lost sales", "backorders")).drop(columns=["delta", "half_width"])

# %% [markdown]
# ## 4 · Week by week: the inventory runs dry, the backlog builds
#
# Material on hand falls through the outage window as the plant draws down what
# it holds of the short material; with backorders, the unserved demand appears
# as a backlog instead of disappearing.

# %%
window = effective_window(shortage["disruption_schedule"][0], runs[("shortage", "lost sales")])
series = {f"{p} · shortage": api.series(runs[("shortage", p)]["id"]) for p in ("lost sales", "backorders")}
plot_series(series, "on_hand_units", title="Material on hand (units) — all materials", window=window)
plot_series(series, "backlog_units", title="Backlog (units waiting)", window=window)
plot_series(series, "fill_rate", title="Weekly fill rate", window=window)

# %% [markdown]
# ## 5 · Where capacity bound
#
# The run also records which products or suppliers capacity held back. An empty
# answer here is informative: the shortage was a supply interruption, not a
# capacity limit.

# %%
binding = capacity_binding(runs[("shortage", "lost sales")]) or {}
if binding.get("products") or binding.get("suppliers"):
    display(binding)
else:
    print("capacity held nothing back during this run — the shortage was a supply interruption "
          f"(plant capacity {binding.get('plant_capacity', '?')} units/week, over {binding.get('window_weeks', '?')} "
          "weeks of analysis window)")

# %% [markdown]
# ## 6 · The contrast: the same outage on a dual-sourced material
#
# Same six weeks, on a supplier whose material has a second source. If the
# shortage above was about single sourcing, this one should barely register.

# %%
if CONTRAST_SUPPLIER:
    contrast = stress_scenario(api, PID, base, [outage(CONTRAST_SUPPLIER, start_day=140, duration_days=42)],
                               name=f"{base['name']} + {CONTRAST_SUPPLIER} 6-week outage")
    contrast_run = api.run_and_wait(PID, contrast["id"], lost_sales["id"])
    assert_disruption_applied(api.replications(contrast_run["id"]))
    plot_kpis({f"{SOLE_SUPPLIER} out (sole source)": runs[("shortage", "lost sales")],
               f"{CONTRAST_SUPPLIER} out (dual source)": contrast_run,
               "no outage": runs[("baseline", "lost sales")]},
              ["fill_rate", "lost_units", "lost_sales_value"], title="Sole source vs dual source, same outage")
else:
    print("live mode: set CONTRAST_SUPPLIER to a supplier whose material has a second source to run the contrast")

# %% [markdown]
# ## What to try next
#
# - **Buy time:** notebook 01's safety-stock sweep, on this same outage.
# - **Make it worse:** a longer outage (`duration_days`), or two suppliers at once
#   (up to five events per scenario).
# - **A partial cut** (`magnitude_pct` below 100) only matters if the supplier's
#   remaining capacity falls below what the plan draws — see notebook 02.
#
# **In the app:** the scenarios and runs above are in the Simulation Lab; the
# network pages show each material's sources (single-source exposure).
