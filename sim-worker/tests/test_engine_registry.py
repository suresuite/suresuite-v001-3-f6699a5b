"""WP 10.4 · §4 D245 — the worker and the engine registry.

Until WP 10.4 the engine a run used was chosen by an environment flag on the
worker and labelled afterwards from the KPI payload, so a run dispatched as one
engine could be computed by the other. The worker now (1) reports which
registered engine and build it runs, at boot, and (2) refuses a run bound to an
engine it does not run, instead of computing and relabelling it.
"""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from scsim import ENGINE_VERSION

from sim_worker.worker import (
    SimWorker,
    build_run_update,
    engine_mismatch,
    engine_report_payload,
)


def test_the_boot_report_names_the_registered_engine_and_the_build_runs_carry():
    p = engine_report_payload(True)
    assert p["p_slug"] == "scsim"
    assert p["p_version"] == ENGINE_VERSION
    # Spelled exactly as a run is stamped, so the registry and the rows agree.
    stamped = build_run_update({"source": "scsim", "engine_version": ENGINE_VERSION}, 1)
    assert p["p_code_version"] == stamped["code_version"]
    legacy = engine_report_payload(False)
    assert legacy["p_slug"] == "legacy-worker" and legacy["p_code_version"] == "worker-legacy"


@pytest.mark.parametrize(
    "engine, scsim_on, refused",
    [
        ({"slug": "scsim"}, True, False),
        ({"slug": "scsim"}, False, True),       # the D245 case: scsim-bound, legacy worker
        ({"slug": "legacy-worker"}, True, True),
        ({"slug": "legacy-worker"}, False, False),
        (None, True, False),                    # a dispatcher that names no engine yet
        ({}, False, False),
    ],
)
def test_a_run_bound_to_another_engine_is_refused_not_relabelled(engine, scsim_on, refused):
    assert (engine_mismatch(engine, scsim_on) is not None) is refused


def _worker(handler) -> SimWorker:
    w = SimWorker(redis_url="redis://localhost:6379",
                  supabase_url="https://example.supabase.co", service_role_key="k")
    w._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return w


def test_the_report_goes_to_the_registry_rpc_with_the_service_key(monkeypatch):
    monkeypatch.setenv("SCSIM_ENGINE", "1")
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json="00000000-0000-0000-0000-000000000000")

    asyncio.run(_worker(handler)._report_engine())
    assert len(seen) == 1
    assert seen[0].url.path == "/rest/v1/rpc/sim_engine_report"
    assert seen[0].headers["authorization"] == "Bearer k"
    assert json.loads(seen[0].content)["p_slug"] == "scsim"


def test_a_failed_report_never_stops_the_worker(monkeypatch):
    monkeypatch.setenv("SCSIM_ENGINE", "1")

    def refuse(req: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"code": "PGRST202"})

    def explode(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    asyncio.run(_worker(refuse)._report_engine())
    asyncio.run(_worker(explode)._report_engine())
