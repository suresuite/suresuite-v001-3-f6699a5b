# %% [markdown]
# # SuReSuite 03 · Simulate on your own machine
#
# **You will:** pull your project's frozen data and policies, run the platform's
# engine on your machine (laptop or Colab), check it gives the platform's numbers,
# then run a sweep and a what-if that cost no quota.
# **Time:** about 15 minutes. **You need:** a personal API key with `read:data`,
# `read:policies`, `read:runs` and `write:runs` (and `write:policies` unless you set
# `POLICY_VERSION_ID`). The engine is not handed out in demo mode.
#
# Nothing here writes to the platform. Edits are made on **local copies** only.

# %% include: config

# %% include: setup

# %% include: library

# %% include: local

# %% include: demo_data baseline

# %%
api = connect(BASE_URL, API_KEY, DEMO_DATA)
project = pick_project(api, PROJECT_ID)
PID = project["id"]

# %% [markdown]
# ## Try changing
# - `SUPPLIER` — a supplier id from **your** data (inbound logistics), ideally the
#   only source of some material.
# - `OUTAGE_WEEKS`, `SAFETY_DAYS` — the two axes of the sweep in step 4.

# %%
SUPPLIER = SUPPLIER_ID or ("" if LIVE else "S2")
OUTAGE_WEEKS = [2, 4, 6, 8, 10]
SAFETY_DAYS = [7, 14, 28, 42]

# %% [markdown]
# ## 1 · Pull the frozen data and policies
# `dataset(api, PID)` takes the newest dataset version; pass an id for a specific one.
# **Expect:** the table sizes and a `graph_hash`, the policy label and its
# `policy_hash`, then the first inbound lanes.

# %%
data = dataset(api, PID)
pol = policy(api, PID, POLICY_VERSION_ID or api.snapshot_policies(PID, "notebook 03")["id"])
print(data)
print("policy version:", pol.label, "· policy_hash", (pol.policy_hash or "")[:12])
data.tables["inbound"].head()

# %% [markdown]
# ## 2 · Install the engine
# Downloaded through the API once per environment; every file is checked by its sha256.
# **Expect:** "engine … installed (2 wheels, sha256 checked)", then `engine ready: True`.

# %%
if not engine_available():
    if LIVE:
        install_engine(api)
    else:
        print("demo mode cannot hand out the engine — add SURESUITE_API_KEY (see notebook 00) and run again")
RUN_LOCAL = engine_available()
print("engine ready:", RUN_LOCAL)

# %% [markdown]
# ## 3 · Reproduce a platform run
# The platform runs the baseline; your machine runs the same inputs with the same seed.
# **Expect:** `identical on every KPI: True` and two equal columns.

# %%
scenario = baseline_scenario(api, PID, SCENARIO_ID)
platform = api.run_and_wait(PID, scenario["id"], pol.id)

if RUN_LOCAL:
    run_data = dataset(api, PID, platform["dataset_version_id"]) if platform.get("dataset_version_id") else data
    local = simulate(run_data, pol, scenario=scenario)
    keys = [k for k, v in platform["aggregate_kpis"].items() if not k.startswith("_") and isinstance(v, (int, float))]
    same = all(platform["aggregate_kpis"][k] == local["run"]["aggregate_kpis"].get(k) for k in keys)
    print("identical on every KPI:", same)
    if not same:
        print("engine versions:", platform.get("code_version"), "vs", local["run"].get("engine_version"),
              "— re-run install_engine after a platform upgrade")
    display(pd.DataFrame({
        "platform": {kpi_label(k): fmt_kpi(k, platform["aggregate_kpis"][k]) for k in keys},
        "your machine": {kpi_label(k): fmt_kpi(k, local["run"]["aggregate_kpis"].get(k)) for k in keys},
    }))

# %% [markdown]
# ## 4 · Sweep: outage length × safety stock
# One local run per cell, on a local copy of the policy.
# **Expect:** the run count and time, then a heatmap — 100 % while the stock outlasts
# the outage, falling once the outage is longer.

# %%
import copy


def with_policy(snapshot, family, **fields):
    """A local copy of a policy snapshot with one family's fields changed."""
    snap = copy.deepcopy(snapshot)
    snap.setdefault("defaults", {})[family] = {**(snap["defaults"].get(family) or {}), **fields}
    return snap


if RUN_LOCAL and SUPPLIER:
    grid = pd.DataFrame(index=pd.Index(SAFETY_DAYS, name="safety stock (days)"),
                        columns=pd.Index(OUTAGE_WEEKS, name="outage (weeks)"), dtype=float)
    started = time.time()
    for days in SAFETY_DAYS:
        snap = with_policy(pol.snapshot, "inventory", safety_stock_method="fixed_days", safety_stock_days=days)
        for weeks in OUTAGE_WEEKS:
            r = simulate(data, snap, scenario=scenario,
                         disruptions=[outage(SUPPLIER, start_day=140, duration_days=7 * weeks)])
            grid.loc[days, weeks] = r["run"]["aggregate_kpis"]["fill_rate"]
    print(f"{grid.size} runs in {time.time() - started:.1f}s on this machine")

    fig, ax = plt.subplots(figsize=(6.5, 3.4))
    im = ax.imshow(grid.values * 100, cmap="Blues", vmin=80, vmax=100, aspect="auto")
    ax.set_xticks(range(len(OUTAGE_WEEKS)), OUTAGE_WEEKS)
    ax.set_yticks(range(len(SAFETY_DAYS)), SAFETY_DAYS)
    ax.set_xlabel(f"outage of {SUPPLIER} (weeks)")
    ax.set_ylabel("safety stock (days)")
    for i in range(len(SAFETY_DAYS)):
        for j in range(len(OUTAGE_WEEKS)):
            v = grid.values[i, j] * 100
            ax.text(j, i, f"{v:.1f}", ha="center", va="center", fontsize=8,
                    color="white" if v >= 93 else "#1b1b1b")
    ax.set_title("Fill rate (%)", fontsize=10)
    fig.colorbar(im, ax=ax, shrink=0.8)
    plt.tight_layout()
    plt.show()
else:
    print("the sweep needs the engine and a SUPPLIER")

# %% [markdown]
# ## 5 · What-if: a second supplier
# `with_tables` edits a **local copy** of the data. The material `SUPPLIER` ships gets a
# backup lane (10 % pricier) from another supplier; the same 6-week outage is run four ways:
# as is · + backup lane · + backup lane and reactive switch-over (P-S.1) · + backup lane
# and orders split ahead of time (P-S.2).
# **Expect (demo):** the lane alone changes nothing, the reactive switch saves a little,
# and only split orders keep the fill rate at 100 % — at a cost you can read.

# %%
if RUN_LOCAL and SUPPLIER:
    inbound = data.tables["inbound"]
    sole = inbound[inbound.supplier_id == SUPPLIER]
    others = inbound[inbound.supplier_id != SUPPLIER]
    if len(sole) and len(others):
        backup = sole.assign(supplier_id=others.iloc[0]["supplier_id"], unit_price=sole["unit_price"] * 1.1)
        two_lanes = with_tables(data, inbound=pd.concat([inbound, backup], ignore_index=True))
        shock = [outage(SUPPLIER, start_day=140, duration_days=42)]
        cases = {
            "as is": simulate(data, pol, scenario=scenario, disruptions=shock),
            "+ backup lane": simulate(two_lanes, pol, scenario=scenario, disruptions=shock),
            "+ reactive switch": simulate(two_lanes, with_policy(pol.snapshot, "recovery", response=["dual_source_activate"]),
                                          scenario=scenario, disruptions=shock),
            "+ split orders": simulate(two_lanes, with_policy(pol.snapshot, "sourcing", strategy="multi"),
                                       scenario=scenario, disruptions=shock),
        }
        print(f"backup lane for {', '.join(sole.material_id)} from {others.iloc[0]['supplier_id']}")

        def _row(r):
            agg, reps = r["run"]["aggregate_kpis"], replications_frame(r["replications"])
            return {kpi_label("fill_rate"): fmt_kpi("fill_rate", agg["fill_rate"]),
                    kpi_label("lost_units"): fmt_kpi("lost_units", reps["lost_units"].mean()),
                    kpi_label("lost_sales_value"): fmt_kpi("lost_sales_value", agg["lost_sales_value"]),
                    kpi_label("cost_of_resilience"): fmt_kpi("cost_of_resilience", agg["cost_of_resilience"])}
        display(pd.DataFrame({name: _row(r) for name, r in cases.items()}))
    else:
        print(f"{SUPPLIER} has no lane, or there is no other supplier to copy")

# %% [markdown]
# ## 6 · Save your results
# Local results stay on your machine and say what they were computed from.
# **Expect:** `local_run_weekly.csv` written, and `computed_by: client` with the hashes.

# %%
if RUN_LOCAL:
    local["series"].to_csv("local_run_weekly.csv", index=False)
    print({k: local["run"].get(k) for k in ("computed_by", "engine_version", "dataset_version_id",
                                            "graph_hash", "policy_hash")})

# %% [markdown]
# ## Next
# - **00–02** — the same helpers (`kpi_table`, `paired_compare`, `plot_series`) work on local results.
# - **Your own scripts:** `pip install` the `suresuite` package from the app's /developer
#   page, then `import suresuite as ss` — `ss.dataset`, `ss.policy`, `ss.simulate`, `ss.with_tables`.
