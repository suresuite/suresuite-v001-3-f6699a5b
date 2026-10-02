# suresuite — SuReSuite for Python

Pull the data your API key may read, run the platform's simulation engine on your
own machine (a laptop, Google Colab), and analyse the results with the helpers the
SuReSuite notebooks use. Nothing here writes to the platform.

```bash
pip install "suresuite[plots,excel]"     # from the wheel your SuReSuite app serves at /python/
export SURESUITE_API_KEY="sk_test_…"     # a personal key from /developer
```

```python
import suresuite as ss

api = ss.connect()
ss.install_engine(api)                         # downloads the engine, checks each sha256, pip-installs

pid = ss.pick_project(api)["id"]
data = ss.dataset(api, pid)                    # the latest frozen dataset version, with its rows
pol = ss.policy(api, pid)                      # the latest policy version
print(data)                                    # Dataset(v3 '…', graph_hash 1a2b…: suppliers 60, …)

base = ss.simulate(data, pol, replications=30)
shock = ss.simulate(data, pol, replications=30,
                    disruptions=[ss.outage("S2", start_day=140, duration_days=42)])
ss.kpi_table(base["run"])
ss.paired_compare(base["replications"], shock["replications"], ["fill_rate", "lost_sales_value"])

# a what-if on your copy only: double one supplier's capacity
sup = data.tables["suppliers"].copy()
sup.loc[sup.supplier_id == "S2", "capacity_per_week"] *= 2
ss.simulate(ss.with_tables(data, suppliers=sup), pol)
```

**Same engine, same answer.** `simulate` calls `sim_worker.local.run_from_snapshots`
— the function the platform's browser engine runs and the worker's own pipeline —
so a local run of the same dataset version, policy version and scenario reproduces
the platform's run. Results come back in the API's shapes.

**Your compute.** A local run uses your CPU and none of your organization's compute
quota. Requests to the API (pulling data, the engine) are logged against your key.

The full user guide — requirements, the function reference, reproducibility and
limits — is [`docs/api/python-library.md`](../docs/api/python-library.md). The four
notebooks on `/developer` (00 Quickstart, 01 Policy experiment, 02 Disruption and
resilience, 03 Simulate on your own machine) show it in use.
