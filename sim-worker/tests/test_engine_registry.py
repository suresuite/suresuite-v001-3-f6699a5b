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
    from sim_worker.build import code_version

    stamped = build_run_update({"source": "scsim", "engine_version": ENGINE_VERSION,
                                "engine_build": code_version()}, 1)
    # WP 15.1 · §4 D292 — the BUILD, by content, not the version alone.
    assert p["p_code_version"] == code_version() != f"scsim-{ENGINE_VERSION}"
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


def test_the_report_carries_the_build_parts_for_the_ledger(monkeypatch):
    # WP 15.2 · §4 D291 — the digests always; the commit and image when the deploy states them.
    from sim_worker.build import engine_build

    monkeypatch.setenv("GIT_SHA", "ABCDEF1234567")
    monkeypatch.setenv("FLY_IMAGE_REF", "registry.fly.io/w:deployment-1")
    b = engine_report_payload(True)["p_build"]
    assert b["scsim_digest"] == engine_build()["scsim_digest"]
    assert b["sim_worker_digest"] == engine_build()["sim_worker_digest"]
    assert b["commit"] == "abcdef1234567" and b["image_digest"] == "registry.fly.io/w:deployment-1"
    monkeypatch.delenv("GIT_SHA")
    monkeypatch.delenv("FLY_IMAGE_REF")
    assert "commit" not in engine_report_payload(True)["p_build"]  # unknown, not guessed


def test_a_registry_without_the_ledger_still_gets_the_build(monkeypatch):
    # The deploy window: the worker is live before `20261004000001`. PostgREST
    # answers 404 for the five-argument call; the worker reports without p_build.
    monkeypatch.setenv("SCSIM_ENGINE", "1")
    bodies: list[dict] = []

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        bodies.append(body)
        if "p_build" in body:
            return httpx.Response(404, json={"code": "PGRST202"})
        return httpx.Response(200, json="00000000-0000-0000-0000-000000000000")

    asyncio.run(_worker(handler)._report_engine())
    assert len(bodies) == 2 and "p_build" in bodies[0] and "p_build" not in bodies[1]
    assert bodies[1]["p_code_version"] == bodies[0]["p_code_version"]
