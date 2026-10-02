# %% [markdown]
# # SuReSuite 04 · Results and reproducibility: take a run out of the platform, and say what made it
#
# A number that leaves the platform should carry the dataset, policy, scenario
# and engine that produced it — or it cannot be checked, re-run, or trusted in a
# report. This notebook:
#
# 1. writes a run's **results workbook** — the sheets the app's run-results export
#    carries (`run_meta`, `aggregate_kpis`, `replication_kpis`, one `series_<key>`
#    per weekly series, `reproducibility`) — plus tidy CSVs for your own analysis;
# 2. reads the run's **provenance**: the three hashes, the versions behind them,
#    the engine, the seed;
# 3. covers the **operations** an integration needs: cancelling, re-running,
#    errors, limits.

# %% include: config

# %% include: setup

# %% include: library

# %% include: demo_data baseline

# %%
api = connect(BASE_URL, API_KEY, DEMO_DATA)
project = pick_project(api, PROJECT_ID)
PID = project["id"]
scenario = baseline_scenario(api, PID, SCENARIO_ID)
version = (next(v for v in api.policy_versions(PID) if v["id"] == POLICY_VERSION_ID)
           if POLICY_VERSION_ID else api.snapshot_policies(PID, "notebook baseline"))
run = api.run_and_wait(PID, scenario["id"], version["id"])

# %% [markdown]
# ## 1 · The results workbook
#
# Open it in Excel or Google Sheets. `series_<key>` sheets are weeks × replications;
# replications are named `rep <i> · world <m>` — the world is the common-random-
# numbers draw, which is what pairs a replication with its twin in another run.

# %%
path = export_run_workbook(api, run, scenario, f"suresuite_run_{run['id'][:8]}.xlsx",
                           policy_version_label=version.get("label"))
try:
    from google.colab import files  # Colab: download it to your computer
    files.download(path)
except Exception:
    print("saved next to this notebook:", path)

# %% [markdown]
# **Tidy tables for your own analysis.** One row per replication, and the weekly
# series in long form (one row per replication × week) — the shapes pandas,
# R and BI tools want.

# %%
reps = replications_frame(api.replications(run["id"]))
weekly = api.series(run["id"])
reps.to_csv(f"suresuite_run_{run['id'][:8]}_replications.csv")
weekly.to_csv(f"suresuite_run_{run['id'][:8]}_weekly.csv", index=False)
print(f"replications: {reps.shape}, weekly: {weekly.shape}")
weekly.head()

# %% [markdown]
# ## 2 · What produced this run
#
# Every run records the **provenance triangle** — three content hashes:
#
# | Hash | Fingerprint of | Changes when |
# |---|---|---|
# | `graph_hash` | the input data (a dataset version) | you upload or edit data |
# | `policy_hash` | the policy configuration (a policy version) | you save a different policy version |
# | `scenario_hash` | the scenario's frame: horizon, replications, seed, CRN | you change the frame (not the disruptions) |
#
# plus the engine build (`code_version`). Two runs with the same three hashes and
# engine are the same experiment: that is how the platform knows it can offer you
# an existing result instead of computing it again (`409 reuse_available`).

# %%
record = {
    "dataset": {"dataset_version_id": run.get("dataset_version_id"), "graph_hash": run.get("graph_hash")},
    "policy": {"policy_version_id": run.get("policy_version_id"), "label": version.get("label"),
               "policy_hash": run.get("policy_hash")},
    "scenario": {"scenario_id": scenario["id"], "name": scenario["name"], "scenario_hash": run.get("scenario_hash"),
                 "root_seed": scenario.get("seed"), "replications": run.get("rep_count_done"),
                 "crn": scenario.get("crn"), "disruption_schedule": scenario.get("disruption_schedule") or []},
    "engine": run.get("code_version"),
    "credibility": api.validation(run["id"])["status"],
}
print(json.dumps(record, indent=2))

# %% [markdown]
# **Known limits of this record** (stated, not hidden): the API does not return a
# run's *mapping warnings* (for instance an event the engine had to move or
# skip), nor the analysis runs behind network figures. The app's own workbook
# carries what it can; this one says what it cannot.

# %% [markdown]
# ## 3 · Operations
#
# ### Cancel a run
#
# `POST /runs/{id}:cancel` stops a queued or running run. Read the run back to see
# what happened: the answer says `cancelled` even for a run that had already
# finished, while the run itself stays `done`.

# %%
fresh = api.dispatch(PID, scenario["id"], version["id"], force_rerun=True)  # a new computation of the same run
api.cancel(fresh["id"])
print("after cancel:", api.run(fresh["id"])["status"])
print("cancelling a finished run leaves it:", (api.cancel(run["id"]), api.run(run["id"])["status"])[1])

# %% [markdown]
# ### Re-running, and getting a tighter interval
#
# - **The same request twice** returns the same run: `dispatch` sends an
#   idempotency key derived from what you asked for (valid for 24 hours).
# - **An identical completed run** answers `409 reuse_available`; `dispatch`
#   reads that run. `force_rerun=True` computes it again.
# - **A narrower confidence interval** needs more replications: create a scenario
#   with a higher `replications` (up to 200, within your plan) and run it. The
#   interval narrows with the square root of the count — four times the
#   replications, half the width. (`POST /runs/{id}:add-reps` is accepted by the
#   API but does not extend a run today, so do not rely on it.)
#
# ### Errors you will meet
#
# Every error has the same envelope, `{"error": {"code", "message", "details"}}`,
# and every response carries an `X-Request-Id` to quote to support.
#
# | Code | Status | What to do |
# |---|---|---|
# | `invalid_key` · `expired_key` · `revoked_key` | 401 | fix or rotate the key on /developer |
# | `missing_scope` | 403 | the key lacks a scope (`read:runs`, `write:policies`, …) — create one with it |
# | `replications_exceeded` | 403 | ask for fewer replications than your plan allows |
# | `project_not_found` · `run_not_found` | 404 | a wrong id — or one outside your key's reach (deliberately the same answer) |
# | `invalid_request` | 400 | a field the endpoint does not accept; `details` names it |
# | `reuse_available` | 409 | an identical completed run exists — read it, or `force_rerun=True` |
# | `validation_failed` | 422 | the pre-run data gate: `details.findings` says what is wrong; warnings can be accepted |
# | `quota_exceeded` | 402 | the organization's monthly compute is spent |
# | `rate_limited` | 429 | the client waits `Retry-After` seconds and retries |
# | `daily_quota_exceeded` · `concurrent_runs_exceeded` | 429 | wait for tomorrow / for a run to finish (test keys run one at a time) |

# %%
try:
    api.run("00000000-0000-0000-0000-000000000000")
except SuReSuiteError as e:
    print("caught:", e, "| code:", e.code, "| request id:", e.request_id)

# %% [markdown]
# ## That's the series
#
# | Notebook | You learned to |
# |---|---|
# | 00 | connect, snapshot, run, read KPIs with their confidence |
# | 01 | change a policy safely and prove (or not) that it helps |
# | 02 | stress the chain and measure survival and recovery |
# | 03 | produce a material shortage and change how it is absorbed |
# | 04 | take results out with their provenance |
#
# **Not in the API yet — do these in the app:** upload and edit input data
# (/project-manager), network analysis, the Data Trust report, Project
# Intelligence, model validation, and the experiment designer.
