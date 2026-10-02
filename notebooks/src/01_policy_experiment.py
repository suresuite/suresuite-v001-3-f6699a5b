# %% [markdown]
# # SuReSuite 01 · Policy experiment: does more safety stock pay for itself?
#
# The core loop of the app — **/policies → edit → Save version → Simulation Lab →
# Compare** — in Python:
#
# 1. read a policy in the engine's catalog and find the field that drives it;
# 2. change it, snapshot the change as version **B**, and put the project back
#    exactly as it was;
# 3. run A and B on the same random worlds (common random numbers), on a normal
#    year and on a stressed one;
# 4. compare them **replication by replication**, and only call a winner when
#    the confidence interval says there is one.
#
# The question: *safety stock costs holding money every week — when does it earn
# that back?* The demo answers it for the Example project, where supplier `S2` is
# the only source of material `M2`.
#
# **Live mode edits your project's policies** (and restores them at the end of
# the block, even if a run fails). Use a sandbox project if other people are
# editing the same one. Per-node overrides are never touched.

# %% include: config

# %% include: setup

# %% include: library

# %% include: demo_data baseline safety_stock_28d s2_outage s2_outage_safety_stock_28d s2_outage_safety_stock_7d s2_outage_safety_stock_14d s2_outage_safety_stock_42d

# %%
api = connect(BASE_URL, API_KEY, DEMO_DATA)
project = pick_project(api, PROJECT_ID)
PID = project["id"]
base = baseline_scenario(api, PID, SCENARIO_ID)

# The stress test needs a supplier of YOUR project: set SUPPLIER_ID in the CONFIG
# cell (a supplier_id from your suppliers / inbound data). The demo uses S2, the
# only source of material M2.
SUPPLIER = SUPPLIER_ID or ("" if LIVE else "S2")

# %% [markdown]
# ## 1 · Find the lever: catalog policy → the field you edit
#
# The catalog describes policies in the **engine's** vocabulary. The project
# stores them in the **app's** field names (what you see on /policies), and the
# engine maps one onto the other when a run starts. So you read the catalog to
# understand a policy, and you edit the stored field.
#
# | Engine policy (catalog) | Stored family · field | Meaning |
# |---|---|---|
# | `P-P.3 safety_stock_materials` · `fixed_days_cover` | `inventory` · `safety_stock_method="fixed_days"`, `safety_stock_days` | days of demand held as material safety stock — **7 when the field is empty** (the catalog's own default, 14, is what the engine uses when called directly, not through a project) |
# | `P-C.1 unmet_demand_handling` · `rule` | `fulfillment` · `backorder_allowed`, `max_backorder_days`, `backorder_cost_per_day` | lost sales vs backorders (notebook 03) |
# | `P-S.1 backup_supplier` | `recovery` · `response=["dual_source_activate"]` | switch to a backup source when one fails |
#
# A field the engine does not read is stored and silently ignored, so stick to
# names you can see on the /policies page.

# %%
catalog = api.catalog(PID)
ss = next(p for p in catalog["policies"] if p["id"] == "safety_stock_materials")
print(ss["catalog_ref"], ss["id"], "—", ss["summary"][:160], "…\n")
pd.DataFrame([{"param": name, "title": s.get("title"), "type": s.get("type"), "default": s.get("default"),
               "min": s.get("minimum"), "max": s.get("maximum"), "unit": s.get("unit")}
              for name, s in ss["params_schema"]["properties"].items()]).set_index("param")

# %% [markdown]
# ## 2 · Version A (as is) and version B (28 days of safety stock)
#
# `editing_policies` remembers the configuration, lets you change it, and writes
# it back when the block ends. Inside, we snapshot A, apply the edit, snapshot B.
# A policy version is **content-addressed**: snapshotting a configuration that
# already has a version returns that version.

# %%
SAFETY_STOCK_DAYS = 28

with editing_policies(api, PID) as original:
    version_a = api.snapshot_policies(PID, "A · as is")
    api.set_policy(PID, "inventory", safety_stock_method="fixed_days", safety_stock_days=SAFETY_STOCK_DAYS)
    version_b = api.snapshot_policies(PID, f"B · safety stock {SAFETY_STOCK_DAYS} days")

print("A:", version_a["id"], version_a["policy_hash"][:12])
print("B:", version_b["id"], version_b["policy_hash"][:12])
if version_a["id"] == version_b["id"]:
    print("A and B are the same configuration — this project already holds that setting; pick another value")

# %% [markdown]
# ## 3 · Two worlds to test them in
#
# Safety stock is insurance, so test it where insurance matters. A **normal year**
# (the baseline) shows what it costs; a **stressed year** — the supplier ships
# nothing for six weeks from day 140 — shows what it buys. Both scenarios share
# the baseline's horizon, replications and seed.

# %%
scenarios = {"normal year": base}
if SUPPLIER:
    scenarios["outage year"] = stress_scenario(
        api, PID, base, [outage(SUPPLIER, start_day=140, duration_days=42)],
        name=f"{base['name']} + {SUPPLIER} 6-week outage")
else:
    print("no SUPPLIER_ID set — only the normal year is tested")
{name: sc["id"] for name, sc in scenarios.items()}

# %% [markdown]
# ## 4 · Run the 2 × 2

# %%
runs = {}
for world, sc in scenarios.items():
    for label, version in (("A", version_a), ("B", version_b)):
        print(f"── {label} in the {world}")
        runs[(world, label)] = api.run_and_wait(PID, sc["id"], version["id"])
if "outage year" in scenarios:
    assert_disruption_applied(api.replications(runs[("outage year", "A")]["id"]))

# %%
KPIS = ["fill_rate", "lost_sales_value", "avg_on_hand_value", "cost_of_resilience"]
plot_kpis({f"{l} · {w}": r for (w, l), r in runs.items()}, KPIS,
          title=f"A (as is) vs B (safety stock {SAFETY_STOCK_DAYS} days) — error bars: 95 % CI")

# %% [markdown]
# ## 5 · The paired comparison — the Simulation Lab's Compare
#
# Under common random numbers, replication *i* of A and replication *i* of B drew
# the same demand and the same disruptions. So the right question is not "do the
# two error bars overlap?" but "what is the mean of the per-replication
# differences B − A, and does its 95 % interval exclude zero?" — the common
# swing cancels, and a real difference shows even when the runs' own intervals
# overlap. A direction is named only when the interval excludes zero.
#
# Two runs compare fairly when they differ in **one** thing (here: the policy
# version) and share the seed, CRN and engine version.

# %%
for world in scenarios:
    a, b = runs[(world, "A")], runs[(world, "B")]
    print(f"\n{world}: B − A, paired over {a['rep_count_done']} replications")
    display(paired_compare(api.replications(a["id"]), api.replications(b["id"]),
                           KPIS + ["cost_ss_holding", "cost_lost_sales"])
            .drop(columns=["delta", "half_width"]))

# %% [markdown]
# **Reading it (demo numbers).** In the normal year B holds more material and
# pays more safety-stock holding cost, and the fill rate cannot improve — it is
# already 100 %. In the outage year the same stock carries the plant through most
# of the six weeks: fill rate rises and lost sales fall by far more than the
# holding cost. *Cost of resilience* is the engine's sum of the two, so it is the
# one number that answers "does it pay for itself".

# %% [markdown]
# ## 6 · How much is enough? A small sweep
#
# One run per level, all in the stressed year. This costs four runs (each is a
# separate request against your key's limits), so it is off in live mode unless
# you switch it on.

# %%
RUN_SWEEP = not LIVE   # set True to run it live
LEVELS = [7, 14, 28, 42]

if RUN_SWEEP and SUPPLIER:
    sweep = {}
    with editing_policies(api, PID):
        for days in LEVELS:
            api.set_policy(PID, "inventory", safety_stock_method="fixed_days", safety_stock_days=days)
            v = api.snapshot_policies(PID, f"safety stock {days} days")
            print(f"── {days} days")
            sweep[days] = api.run_and_wait(PID, scenarios["outage year"]["id"], v["id"])
    rows = []
    for days, r in sweep.items():
        agg, ci = r["aggregate_kpis"], r["ci_half_widths"] or {}
        reps = replications_frame(api.replications(r["id"]))
        rows.append({"safety stock (days)": days, "fill_rate": agg["fill_rate"], "fill_ci": ci.get("fill_rate") or 0,
                     "holding": reps["cost_ss_holding"].mean(), "lost sales": reps["cost_lost_sales"].mean()})
    curve = pd.DataFrame(rows).set_index("safety stock (days)")

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 3.4))
    ax1.errorbar(curve.index, curve["fill_rate"] * 100, yerr=curve["fill_ci"] * 100, color=PALETTE[0],
                 marker="o", capsize=3, linewidth=2)
    ax1.set_title("Fill rate in the outage year (%)", fontsize=10)
    ax1.set_xlabel("safety stock (days)")
    ax2.bar(curve.index, curve["holding"], width=4, color=PALETTE[0], label="safety-stock holding")
    ax2.bar(curve.index, curve["lost sales"], width=4, bottom=curve["holding"], color=PALETTE[1], label="lost sales")
    ax2.set_title(f"Cost of resilience, by component ({_MONEY['symbol']})", fontsize=10)
    ax2.set_xlabel("safety stock (days)")
    ax2.legend(frameon=False, fontsize=8)
    for ax in (ax1, ax2):
        ax.spines[["top", "right"]].set_visible(False)
    plt.tight_layout()
    plt.show()
    display(curve.round(4))
else:
    print("sweep skipped (set RUN_SWEEP = True, and SUPPLIER_ID, to run it)")

# %% [markdown]
# **Reading the curve (demo).** Each extra week of cover costs a little holding
# money and removes a lot of lost sales, until the stock outlasts the outage —
# after that, more stock is pure cost. The knee of that curve is the decision.
#
# ## Next
#
# - **02 Disruption and resilience** — which disruptions hurt most, and why a
#   single-sourced material is the weak link.
# - **03 Material shortage** — the same outage seen through backorders.
#
# **In the app:** the runs above are in the Simulation Lab under the scenarios
# this notebook created, and the policy versions under /policies → versions.
