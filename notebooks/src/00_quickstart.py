# %% [markdown]
# # SuReSuite 00 · Quickstart: your first simulation run from Python
#
# This notebook does in Python what you do in the app's **Simulation Lab**: pick a
# project, freeze its input data, snapshot its policies, choose a baseline
# scenario, run it, and read the results — KPIs with confidence intervals, the
# spread across replications, and the weekly trajectory.
#
# It talks to the same public `/v1` API every integration uses, so a run you
# start here appears in the app, and a run you start in the app can be read here.
#
# **Two ways to run it**
#
# | Mode | What you need | What happens |
# |---|---|---|
# | **Demo** (default) | nothing | Recorded engine output for the *Example* project (1 product, 2 materials, 3 suppliers) is replayed. Every cell behaves as in live mode. |
# | **Live** | an API key from the app's **/developer** page | Runs on your own project, on the platform's engine. |
#
# **The series** — each notebook mirrors one thing you do in the app:
#
# | Notebook | Mirrors |
# |---|---|
# | **00 Quickstart** (this one) | Simulation Lab: set up, run, read results |
# | 01 Policy experiment | /policies edit → Save version → Lab Compare |
# | 02 Disruption and resilience | Lab stress tests: plant shutdown, supplier outage |
# | 03 Material shortage | A sole-source outage, and what your backorder policy does to it |
# | 04 Results and reproducibility | The run-results workbook and its reproducibility sheet |

# %% [markdown]
# ## Setup
#
# **Google Colab** — open the **Secrets** panel (key icon, left sidebar), add a
# secret named `SURESUITE_API_KEY` with your key, and allow this notebook to use it.
#
# **Local Jupyter / VS Code** — in a terminal:
#
# ```bash
# python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
# pip install jupyterlab requests pandas matplotlib pyarrow openpyxl
# export SURESUITE_API_KEY="sk_test_…"                   # Windows: set SURESUITE_API_KEY=sk_test_…
# jupyter lab
# ```
#
# No key yet? Leave everything as it is: the notebook runs in **demo mode**. Set
# `MODE = "live"` instead to be asked for the key with a hidden prompt. Never
# paste a key into a cell — a notebook is easy to share by accident.
#
# A `sk_test_` key is the one to experiment with: it allows one run at a time,
# 30 requests a minute and 300 a day, which is plenty for this series.

# %% include: config

# %% include: setup

# %% include: library

# %% include: demo_data baseline

# %%
api = connect(BASE_URL, API_KEY, DEMO_DATA)

# %% [markdown]
# ## 1 · Your projects
#
# A key sees the projects of its organization (and only some of them, if it was
# restricted to a list). A project outside that reads as *not found* — exactly
# like one that does not exist, so a key cannot be used to discover projects.

# %%
pd.DataFrame(api.projects())[["id", "name", "plant_name", "supply_chain_model", "created_at"]]

# %%
project = pick_project(api, PROJECT_ID)
PID = project["id"]

# %% [markdown]
# ## 2 · Input data: freeze a dataset version
#
# A **dataset version** is an immutable, hash-stamped snapshot of the project's
# input data — what you uploaded on **/project-manager**. Every run records the
# `graph_hash` of the data it read. Freezing is deduplicated: if nothing changed
# since the last snapshot, you get that snapshot back instead of a new one.
#
# Uploading CSVs is not in the API yet — do it in the app's Data Manager.

# %%
frozen = api.freeze_dataset(PID, "notebook checkpoint")
print("dataset version", frozen["id"], "· graph_hash", frozen["graph_hash"][:16], "…")
pd.DataFrame(api.dataset_versions(PID))[["id", "label", "graph_hash", "created_at"]].head()

# %% [markdown]
# ## 3 · Policies: what the engine can do, and what this project uses
#
# The **policy catalog** is the engine's own registry — every policy, its catalog
# id (`P-S.x` supplier, `P-P.x` plant, `P-T.x` transport, `P-C.x` customer, …),
# whether it is implemented, and a JSON schema of its parameters. The app's forms
# and this API read the same artifact, so what you see is exactly what runs.

# %%
catalog = api.catalog(PID)
print("engine", catalog["engine_version"], "·", len(catalog["policies"]), "policies in the catalog")
pd.DataFrame([{"catalog_ref": p.get("catalog_ref"), "policy": p["id"], "stage": p.get("stage"),
               "status": p.get("status"), "summary": (p.get("summary") or "")[:90]}
              for p in catalog["policies"]]).sort_values("catalog_ref").set_index("catalog_ref")

# %% [markdown]
# The project's **current configuration** is stored per family (`sourcing`,
# `inventory`, `transport`, `fulfillment`, `production`, `recovery`, `demand`) in
# the field names of the app's **/policies** page. An empty family means the
# engine's defaults. Notebook 01 edits them.

# %%
{family: fields or "(engine defaults)" for family, fields in api.policy_defaults(PID).items()}

# %% [markdown]
# ## 4 · Snapshot the policies
#
# A run never reads the live, editable configuration: it runs against an
# immutable **policy version**, identified by its `policy_hash`. This is the
# app's **Save version** button.

# %%
if POLICY_VERSION_ID:
    VERSION = next(v for v in api.policy_versions(PID) if v["id"] == POLICY_VERSION_ID)
else:
    VERSION = api.snapshot_policies(PID, "notebook baseline")
print("policy version", VERSION["id"], "·", VERSION.get("label"), "· policy_hash", VERSION["policy_hash"][:16], "…")

# %% [markdown]
# ## 5 · A baseline scenario
#
# A **scenario** is the experimental frame: horizon, replications, root seed,
# common random numbers (CRN), and an optional disruption schedule. A *baseline*
# has no disruptions. Two things worth knowing:
#
# - The engine works in **weeks** and simulates at least **52 of them**, so a
#   `horizon_days` below 364 still runs a year.
# - The warm-up is **detected** by the engine (the run reports where it ended), so
#   the `warmup_days` field of an API-created scenario is not used.

# %%
scenario = baseline_scenario(api, PID, SCENARIO_ID)

# %% [markdown]
# ## 6 · Run it
#
# Runs are **asynchronous**: the API answers `202` with a run id at once, and the
# notebook polls until the run is `done`, `failed` or `cancelled`. Three answers
# you may see instead of a new run, all handled by `run_and_wait`:
#
# - **the same run again** — the request carries an idempotency key derived from
#   what you asked for, so running this cell twice never pays for two runs;
# - **`409 reuse_available`** — an identical completed run already exists, and the
#   notebook reads it (pass `force_rerun=True` to compute it again);
# - **`422 validation_failed`** — the pre-run data gate found a problem; its
#   findings are printed. Warnings can be accepted with `acknowledge_warnings=True`.

# %%
run = api.run_and_wait(PID, scenario["id"], VERSION["id"])

# %% [markdown]
# ## 7 · Results: the KPIs
#
# The mean of each KPI over the replications, with the half-width of its 95 %
# confidence interval — the table the Simulation Lab shows. Measures the engine
# did not produce on this run (time to recover, say, on a run with no disruption)
# are left out rather than shown as zero.

# %%
print("provenance:", {k: (run.get(k) or "")[:12] for k in ("policy_hash", "graph_hash", "scenario_hash")},
      "· engine", run.get("code_version"), "· warm-up ended at week", run.get("warmup_detected_at"))
kpi_table(run).drop(columns="value")

# %% [markdown]
# ## 8 · Every replication
#
# One row per replication. `model_rep` / `event_rep` identify the random "world" a
# replication drew — under common random numbers, replication *i* of two runs saw
# the same world, which is what makes a paired comparison (notebook 01) fair.

# %%
reps = replications_frame(api.replications(run["id"]))
cols = [c for c in ("model_rep", "fill_rate", "revenue", "lost_sales_value", "avg_on_hand_value",
                    "cost_of_resilience") if c in reps]
reps[cols].round(4)

# %%
fig, ax = plt.subplots(figsize=(6, 3))
ax.hist(reps["revenue"], bins=8, color=PALETTE[0], edgecolor="white")
ax.set_title(f"{kpi_label('revenue')} across {len(reps)} replications", fontsize=10)
ax.set_xlabel(f"revenue ({_MONEY['symbol']})")
ax.set_ylabel("replications")
ax.spines[["top", "right"]].set_visible(False)
plt.tight_layout()
plt.show()

# %% [markdown]
# ## 9 · The weekly trajectory
#
# The engine publishes weekly series for every replication — fill rate, revenue,
# backlog, inventory, capacity. The API hands them over as one table (`week`,
# replication, one column per series): the line is the mean over replications,
# the band the lowest-to-highest replication.

# %%
weekly = api.series(run["id"])
print("series:", [c for c in weekly.columns if c not in ("rep_index", "model_rep", "event_rep", "week")])
plot_series({"baseline": weekly}, "on_hand_units", title="Material on hand (units), weekly",
            warmup_week=run.get("warmup_detected_at"))

# %% [markdown]
# ## 10 · How much to trust it
#
# Every run carries a credibility label: **validated** (a model-validation card
# matches this run's exact policy, data and scenario hashes), **stale** (a card
# exists but the model changed since), or **unvalidated**. It is a label, not a
# gate — validation is done in the app (**/policies → Run & Validate**).

# %%
validation = api.validation(run["id"])
print("credibility:", validation["status"])
if validation.get("model_validation"):
    card = validation["model_validation"]
    print("verdict:", card.get("verdict"), "· validated at", card.get("validated_at"))

# %% [markdown]
# ## Next
#
# - **01 Policy experiment** — change a policy, run A against B on the same random
#   worlds, and read a paired difference with a confidence interval.
# - **02 Disruption and resilience** — what a plant shutdown or a supplier outage
#   costs, and how fast the chain recovers.
#
# **Not in the API yet — do these in the app:** uploading data (/project-manager),
# the network analysis pages, the Data Trust report, Project Intelligence, and
# model validation.
