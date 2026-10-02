# %% [markdown]
# # SuReSuite 01 · Policy experiment
#
# **You will:** change one policy (safety stock), run the old version A and the new
# version B side by side, and see whether B is really better.
# **Time:** about 15 minutes. **You need:** nothing for demo mode; with a key, a
# project you may edit (use a sandbox if others work on it).
#
# Your policies are edited inside a protected block and **always put back**
# afterwards, even if a run fails.

# %% include: config

# %% include: setup

# %% include: library

# %% include: demo_data baseline safety_stock_28d s2_outage s2_outage_safety_stock_28d s2_outage_safety_stock_7d s2_outage_safety_stock_14d s2_outage_safety_stock_42d

# %%
api = connect(BASE_URL, API_KEY, DEMO_DATA)
project = pick_project(api, PROJECT_ID)
PID = project["id"]
base = baseline_scenario(api, PID, SCENARIO_ID)

# %% [markdown]
# ## Try changing
# - `SAFETY_STOCK_DAYS` — the safety stock for version B (days of demand; the default is 7).
# - `SUPPLIER` — a supplier id from **your** data (inbound logistics) for the stress test.
#   The demo uses `S2`, the only supplier of material M2.
# - `RUN_SWEEP` — the sweep in step 4 uses four runs; it is off in live mode to save quota.

# %%
SAFETY_STOCK_DAYS = 28
SUPPLIER = SUPPLIER_ID or ("" if LIVE else "S2")
RUN_SWEEP = not LIVE
SWEEP_LEVELS = [7, 14, 28, 42]

# %% [markdown]
# ## 1 · Make versions A and B
# A is the policy as it is. B sets `inventory.safety_stock_days` (the field on the
# /policies page). Both are saved as frozen versions, then your policies are restored.
# **Expect:** two different version ids, then "policies restored to their original values".

# %%
with editing_policies(api, PID):
    version_a = api.snapshot_policies(PID, "A · as is")
    api.set_policy(PID, "inventory", safety_stock_method="fixed_days", safety_stock_days=SAFETY_STOCK_DAYS)
    version_b = api.snapshot_policies(PID, f"B · safety stock {SAFETY_STOCK_DAYS} days")
print("A:", version_a["id"], "\nB:", version_b["id"])
if version_a["id"] == version_b["id"]:
    print("A and B are identical — your project already uses this value; pick another SAFETY_STOCK_DAYS")

# %% [markdown]
# ## 2 · Run A and B in a normal year and in an outage year
# Safety stock costs money every week and pays off in a disruption, so test both.
# The outage year stops `SUPPLIER` for six weeks from day 140.
# **Expect:** four runs reaching `done`, and "disruption applied".

# %%
scenarios = {"normal year": base}
if SUPPLIER:
    scenarios["outage year"] = stress_scenario(api, PID, base, [outage(SUPPLIER, start_day=140, duration_days=42)],
                                               name=f"{base['name']} + {SUPPLIER} 6-week outage")
else:
    print("no SUPPLIER set — only the normal year is tested")

runs = {}
for world, sc in scenarios.items():
    for label, version in (("A", version_a), ("B", version_b)):
        print(f"── {label} · {world}")
        runs[(world, label)] = api.run_and_wait(PID, sc["id"], version["id"])
if "outage year" in scenarios:
    assert_disruption_applied(api.replications(runs[("outage year", "A")]["id"]))

# %% [markdown]
# ## 3 · Compare B with A
# Each replication of A is compared with the same replication of B (same random
# draws), and the verdict says "better" or "worse" only when the 95 % interval of the
# difference excludes zero. Otherwise it says "no clear difference".
# **Expect (demo):** normal year — B costs more and serves no better;
# outage year — B has a higher fill rate and far lower lost sales.

# %%
KPIS = ["fill_rate", "lost_sales_value", "cost_ss_holding", "cost_of_resilience"]
for world in scenarios:
    print(f"\n{world}: B − A")
    display(paired_compare(api.replications(runs[(world, "A")]["id"]),
                           api.replications(runs[(world, "B")]["id"]), KPIS).drop(columns=["delta", "half_width"]))

# %% [markdown]
# ## 4 · How much safety stock is enough?
# One run per level, all in the outage year.
# **Expect:** fill rate rising with stock, and lost-sales cost falling faster than
# holding cost rises — until the stock outlasts the outage.

# %%
if RUN_SWEEP and SUPPLIER:
    rows = []
    with editing_policies(api, PID):
        for days in SWEEP_LEVELS:
            api.set_policy(PID, "inventory", safety_stock_method="fixed_days", safety_stock_days=days)
            v = api.snapshot_policies(PID, f"safety stock {days} days")
            r = api.run_and_wait(PID, scenarios["outage year"]["id"], v["id"])
            reps = replications_frame(api.replications(r["id"]))
            rows.append({"safety stock (days)": days, "fill rate": r["aggregate_kpis"]["fill_rate"],
                         "holding cost": reps["cost_ss_holding"].mean(), "lost sales": reps["cost_lost_sales"].mean()})
    curve = pd.DataFrame(rows).set_index("safety stock (days)")
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 3.3))
    ax1.plot(curve.index, curve["fill rate"] * 100, marker="o", color=PALETTE[0], linewidth=2)
    ax1.set_title("Fill rate in the outage year (%)", fontsize=10)
    ax2.bar(curve.index, curve["holding cost"], width=4, color=PALETTE[0], label="safety-stock holding")
    ax2.bar(curve.index, curve["lost sales"], width=4, bottom=curve["holding cost"], color=PALETTE[1], label="lost sales")
    ax2.set_title(f"Cost, by component ({_MONEY['symbol']})", fontsize=10)
    ax2.legend(frameon=False, fontsize=8)
    for ax in (ax1, ax2):
        ax.set_xlabel("safety stock (days)")
        ax.spines[["top", "right"]].set_visible(False)
    plt.tight_layout()
    plt.show()
    display(curve.round(2))
else:
    print("sweep skipped — set RUN_SWEEP = True (and SUPPLIER) to run it")

# %% [markdown]
# ## Next
# - **02** — which disruptions hurt most.
# - **03** — run the same kind of sweep on your own machine, without using quota.
