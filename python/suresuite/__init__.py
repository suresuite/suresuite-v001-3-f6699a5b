"""suresuite — SuReSuite for Python (Phase 12).

Pull the data your key may read, run the platform's simulation engine on your own
machine, and analyse the results with the same helpers the notebooks use.

    import suresuite as ss
    api = ss.connect()                 # SURESUITE_API_KEY, or the offline demo without one
    ss.install_engine(api)             # the engine, sha256-checked (needs a key)
    data, pol = ss.dataset(api, pid), ss.policy(api, pid)
    run = ss.simulate(data, pol, replications=30)
    ss.kpi_table(run["run"])

Nothing here writes to the platform: a local run stays on your machine.
"""
from __future__ import annotations

import os

from . import client as _client
from .client import (  # noqa: F401  (re-exported)
    FAMILIES,
    TERMINAL,
    SuReSuite,
    SuReSuiteError,
    assert_disruption_applied,
    baseline_scenario,
    capacity_binding,
    editing_policies,
    effective_window,
    export_run_workbook,
    fmt_kpi,
    kpi_label,
    kpi_table,
    outage,
    paired_compare,
    pick_project,
    plot_kpis,
    plot_series,
    replications_frame,
    stress_scenario,
)
from .local import (  # noqa: F401
    Dataset,
    Policy,
    dataset,
    engine_available,
    install_engine,
    policy,
    simulate,
    with_tables,
)

__version__ = "0.1.0"
DEFAULT_BASE_URL = "https://wckdrutwkytwcomrlpib.supabase.co/functions/v1/api/v1"


def connect(api_key: str | None = None, base_url: str | None = None, demo_data=None) -> SuReSuite:
    """A client: live with a key (argument, or SURESUITE_API_KEY), otherwise the
    offline demo (pass `demo_data`, e.g. a notebook's DEMO_DATA)."""
    key = api_key or os.environ.get("SURESUITE_API_KEY")
    base = base_url or os.environ.get("SURESUITE_BASE_URL") or DEFAULT_BASE_URL
    if not key and demo_data is None:
        raise ValueError("no API key: pass api_key=…, set SURESUITE_API_KEY, or pass demo_data for the offline demo")
    return _client.connect(base, key, demo_data)
