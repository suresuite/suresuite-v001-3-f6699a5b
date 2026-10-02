# %% [markdown]
# # SuReSuite 05 · Simulate on your own machine
#
# Notebooks 00–04 ask the platform to run each simulation. This one runs the
# **platform's own engine on your machine** — your laptop or your Colab session —
# from the same frozen inputs a platform run reads:
#
# 1. **pull** a dataset version (the input rows) and a policy version;
# 2. **get the engine** (through the API, every file checked by its sha256);
# 3. **reproduce** a platform run locally — and see that the numbers are the same;
# 4. do what local compute makes free: a **20-scenario sweep** in seconds;
# 5. try a **what-if on your copy of the data** — the platform's data is untouched.
#
# Nothing in this notebook writes to the platform. Local runs use your CPU, not
# your organization's compute quota; pulling data and the engine are ordinary,
# logged API requests.
#
# For your own scripts the same functions ship as a package —
# `pip install suresuite` from your SuReSuite app (see `docs/api/README.md`).

# %% include: config

# %% include: setup

# %% include: library

# %% include: local

# %% include: demo_data baseline

# %%
api = connect(BASE_URL, API_KEY, DEMO_DATA)
project = pick_project(api, PROJECT_ID)
PID = project["id"]
SUPPLIER = SUPPLIER_ID or ("" if LIVE else "S2")   # a supplier of YOUR project, for the stress sweep

# %% [markdown]
# ## 1 · Pull the frozen inputs
#
# A **dataset version** is the input data exactly as a run reads it, frozen and
# hashed (`graph_hash`); a **policy version** is the configuration, frozen and
# hashed (`policy_hash`). These two plus a scenario are everything a run needs.
# `latest` takes the newest of each; pass an id for a specific one.

# %%
data = dataset(api, PID)               # snapshot the app's data first (00 · §2) if "latest" is old
pol = policy(api, PID, POLICY_VERSION_ID or api.snapshot_policies(PID, "notebook 05")["id"])
print(data)
print("policy version:", pol.label, "· policy_hash", (pol.policy_hash or "")[:12], "…")
data.tables["inbound"].head()

# %% [markdown]
# ## 2 · Get the engine
#
# The engine is two Python packages (`scsim`, `sim_worker`). With an API key,
# `install_engine` downloads them through `GET /v1/engine`, checks each file's
# sha256 against the one the platform published, and installs them — once per
# environment. In demo mode the engine is not handed out: it comes with a key.

# %%
if not engine_available():
    if LIVE:
        install_engine(api)
    else:
        print("The engine is not installed here, and the demo cannot hand it out — it comes with an API\n"
              "key. Add SURESUITE_API_KEY (see notebook 00) and run this notebook again.")
RUN_LOCAL = engine_available()
print("engine ready:", RUN_LOCAL)

# %% [markdown]
# ## 3 · Reproduce a platform run, locally
#
# Ask the platform for the baseline run, then compute the same run here from the
# same dataset version, policy version and scenario. Same engine, same inputs,
# same random numbers — so the numbers should not merely be close; they should be
# the same.

# %%
scenario = baseline_scenario(api, PID, SCENARIO_ID)
platform = api.run_and_wait(PID, scenario["id"], pol.id)

if RUN_LOCAL:
    # The run records which dataset version it read — pull exactly that one.
    run_data = dataset(api, PID, platform["dataset_version_id"]) if platform.get("dataset_version_id") else data
    local = simulate(run_data, pol, scenario=scenario)
    keys = [k for k in platform["aggregate_kpis"] if not k.startswith("_")
            and isinstance(platform["aggregate_kpis"][k], (int, float))]
    side = pd.DataFrame({
        "platform": {kpi_label(k): fmt_kpi(k, platform["aggregate_kpis"][k]) for k in keys},
        "your machine": {kpi_label(k): fmt_kpi(k, local["run"]["aggregate_kpis"].get(k)) for k in keys},
    })
    same = all(platform["aggregate_kpis"][k] == local["run"]["aggregate_kpis"].get(k) for k in keys)
    print("identical on every KPI:", same)
    if not same:
        print("they differ — check the engine versions:", platform.get("code_version"), "vs",
              local["run"].get("engine_version"), "(re-run install_engine after a platform upgrade)")
    display(side)

# %% [markdown]
# ## 4 · A 20-scenario sweep, for free
#
# How long can the chain lose its sole supplier, and how much safety stock buys
# that time? Five outage lengths × four safety-stock levels is twenty runs. On the
# platform that is twenty dispatches against your quota; here it is a loop.
#
# The policy change is made **on a local copy of the policy snapshot** — nothing
# on the platform is edited.

# %%
import copy

OUTAGE_WEEKS = [2, 4, 6, 8, 10]
SAFETY_DAYS = [7, 14, 28, 42]

if RUN_LOCAL and SUPPLIER:
    grid = pd.DataFrame(index=pd.Index(SAFETY_DAYS, name="safety stock (days)"),
                        columns=pd.Index(OUTAGE_WEEKS, name="outage (weeks)"), dtype=float)
    started = time.time()
    for days in SAFETY_DAYS:
        snap = copy.deepcopy(pol.snapshot)
        snap.setdefault("defaults", {})["inventory"] = {
            **(snap["defaults"].get("inventory") or {}), "safety_stock_method": "fixed_days", "safety_stock_days": days}
        for weeks in OUTAGE_WEEKS:
            r = simulate(data, snap, scenario=scenario,
                         disruptions=[outage(SUPPLIER, start_day=140, duration_days=7 * weeks)])
            grid.loc[days, weeks] = r["run"]["aggregate_kpis"]["fill_rate"]
    print(f"{len(SAFETY_DAYS) * len(OUTAGE_WEEKS)} runs in {time.time() - started:.1f}s on this machine")

    fig, ax = plt.subplots(figsize=(6.5, 3.4))
    im = ax.imshow(grid.values * 100, cmap="Blues", vmin=80, vmax=100, aspect="auto")
    ax.set_xticks(range(len(OUTAGE_WEEKS)), OUTAGE_WEEKS)
    ax.set_yticks(range(len(SAFETY_DAYS)), SAFETY_DAYS)
    ax.set_xlabel("outage of the sole supplier (weeks)")
    ax.set_ylabel("safety stock (days)")
    for i in range(len(SAFETY_DAYS)):
        for j in range(len(OUTAGE_WEEKS)):
            v = grid.values[i, j] * 100
            ax.text(j, i, f"{v:.1f}", ha="center", va="center", fontsize=8,
                    color="white" if v >= 93 else "#1b1b1b")  # light text on the dark (high) cells
    ax.set_title("Fill rate (%) — the buffer that outlasts the outage", fontsize=10)
    fig.colorbar(im, ax=ax, shrink=0.8)
    plt.tight_layout()
    plt.show()
else:
    print("the sweep needs the engine and SUPPLIER_ID (the demo uses S2)")

# %% [markdown]
# **Reading it (demo).** Down a column the outage is fixed and stock rises; along
# a row the stock is fixed and the outage lengthens. The fill rate holds at 100 %
# while the safety stock outlasts the outage, and falls once the outage is the
# longer of the two.

# %% [markdown]
# ## 5 · A what-if on your copy of the data
#
# Policies are one lever; the network is another. What if the single-sourced
# material had a second supplier? `with_tables` returns an edited **local copy** of
# the dataset — the platform's data, and the version you pulled, stay as they are.
# We give the material `SUPPLIER` ships a second, 10 % pricier lane from another
# supplier, and run the same six-week outage four ways:
#
# | Case | Data | Policy (local copy) |
# |---|---|---|
# | single source | as uploaded | as configured |
# | + a second lane | + backup lane | as configured |
# | + reactive backup | + backup lane | `recovery.response = ["dual_source_activate"]` (P-S.1) |
# | + split orders | + backup lane | `sourcing.strategy = "multi"` (P-S.2) |

# %%
def with_policy(snapshot, family, **fields):
    """A local copy of a policy snapshot with one family's fields changed."""
    snap = copy.deepcopy(snapshot)
    snap.setdefault("defaults", {})[family] = {**(snap["defaults"].get(family) or {}), **fields}
    return snap


if RUN_LOCAL and SUPPLIER:
    inbound = data.tables["inbound"]
    sole = inbound[inbound.supplier_id == SUPPLIER]
    others = inbound[inbound.supplier_id != SUPPLIER]
    if len(sole) and len(others):
        backup = sole.assign(supplier_id=others.iloc[0]["supplier_id"], unit_price=sole["unit_price"] * 1.1)
        two_lanes = with_tables(data, inbound=pd.concat([inbound, backup], ignore_index=True))
        shock = [outage(SUPPLIER, start_day=140, duration_days=42)]
        cases = {
            "single source": simulate(data, pol, scenario=scenario, disruptions=shock),
            "+ a second lane": simulate(two_lanes, pol, scenario=scenario, disruptions=shock),
            "+ reactive backup": simulate(two_lanes, with_policy(pol.snapshot, "recovery", response=["dual_source_activate"]),
                                          scenario=scenario, disruptions=shock),
            "+ split orders": simulate(two_lanes, with_policy(pol.snapshot, "sourcing", strategy="multi"),
                                       scenario=scenario, disruptions=shock),
        }
        print(f"backup lane for {', '.join(sole.material_id)} from {others.iloc[0]['supplier_id']}; "
              f"6-week outage of {SUPPLIER}")
        def _row(r):
            agg, reps = r["run"]["aggregate_kpis"], replications_frame(r["replications"])
            return {kpi_label("fill_rate"): fmt_kpi("fill_rate", agg["fill_rate"]),
                    kpi_label("lost_units"): fmt_kpi("lost_units", reps["lost_units"].mean()),  # per replication
                    kpi_label("lost_sales_value"): fmt_kpi("lost_sales_value", agg["lost_sales_value"]),
                    kpi_label("cost_of_resilience"): fmt_kpi("cost_of_resilience", agg["cost_of_resilience"])}
        display(pd.DataFrame({name: _row(r) for name, r in cases.items()}))
    else:
        print(f"{SUPPLIER} has no lane, or no other supplier exists to copy")

# %% [markdown]
# **Reading it (demo).** The second lane alone changes **nothing**: the engine
# orders from a lane only when a policy tells it to, so capacity sitting in the
# network is not resilience. Reactive backup activation (P-S.1) switches over only
# after it detects the failure and waits out the backup's lead time, so it saves a
# little. Splitting orders across both lanes ahead of time (P-S.2) keeps service
# whole through the outage — and its price is the multi-sourcing premium you can
# read in the cost of resilience. That trade-off is the decision.

# %% [markdown]
# ## 6 · Keep what you computed
#
# Local results come back in the API's shapes, so every helper in notebooks 00–04
# works on them — `kpi_table`, `paired_compare`, `plot_series`, the workbook
# export. They stay on your machine: nothing here wrote to the platform. Each run
# says what it was computed from (`dataset_version_id`, `policy_hash`, the
# scenario) and `computed_by: client`, so a number you report can be traced.

# %%
if RUN_LOCAL:
    local["series"].to_csv("local_run_weekly.csv", index=False)
    print({k: local["run"].get(k) for k in ("computed_by", "engine_version", "dataset_version_id",
                                            "graph_hash", "policy_hash")})

# %% [markdown]
# ## Next
#
# - **Your own scripts:** the same functions as a package — `import suresuite as ss`,
#   then `ss.dataset`, `ss.policy`, `ss.simulate`, `ss.with_tables`.
# - **Bigger sweeps:** a local run of a large project takes longer than the
#   Example's fraction of a second; Colab gives you a machine for free.
# - **Pushing results back** to the platform is not offered yet — when it is, a
#   result computed on your machine will be badged "client-computed" until the
#   platform re-runs it and gets the same numbers.
