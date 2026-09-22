"""Run lifecycle honesty (audit 2026-09-22, WP 4: F-06, F-18).

F-06: cancel flipped the row to `cancelled`, and the worker then PATCHed
`{"status": "done"}` BY ID with no status guard, publishing the run anyway —
and it could not stop the engine at all: a project's stream is consumed one
message at a time, so the cancel command was not even READ until the run it
should stop had finished. Now every status write is a guarded TRANSITION, the
per-replication counter write doubles as the cancel check, and the engine is
stopped through `RunCancelled`.

F-18: `rep_count_done` was the REQUESTED count on the legacy path (zero
evidence rows) and could exceed persisted rows on the canonical one.
"""
from __future__ import annotations

import ast
import asyncio
import json
from pathlib import Path

import httpx
import pytest

from scsim import RunCancelled

from sim_worker.worker import CancelWatch, SimWorker, build_run_update


def _worker(handler) -> SimWorker:
    w = SimWorker(redis_url="redis://localhost:6379",
                  supabase_url="https://example.supabase.co", service_role_key="k")
    w._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return w


def _capture(rows_returned):
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json=rows_returned)
    return seen, handler


def test_a_transition_is_guarded_on_the_from_statuses():
    seen, h = _capture([{"id": "r1"}])
    changed = asyncio.run(_worker(h)._transition("r1", {"status": "done"}, ("queued", "running")))
    assert changed is True
    q = dict(seen[0].url.params)
    assert q["id"] == "eq.r1" and q["status"] == "in.(queued,running)"
    assert seen[0].headers["Prefer"] == "return=representation"


def test_a_transition_on_a_cancelled_row_changes_nothing_and_says_so():
    _, h = _capture([])  # no row matched: it is cancelled (or gone)
    assert asyncio.run(_worker(h)._transition("r1", {"status": "done"}, ("queued", "running"))) is False


def test_the_streamed_counter_write_detects_a_cancel():
    _, h = _capture([])
    watch = CancelWatch()
    asyncio.run(_worker(h)._stream_replication("r1", "p1", {"rep_index": 0, "seed_used": 1}, 1, watch))
    assert watch.cancelled
    with pytest.raises(RunCancelled):
        watch.check()


def test_an_active_run_is_not_flagged():
    _, h = _capture([{"id": "r1"}])
    watch = CancelWatch()
    asyncio.run(_worker(h)._stream_replication("r1", "p1", {"rep_index": 0, "seed_used": 1}, 1, watch))
    assert not watch.cancelled
    watch.check()  # does not raise


def test_no_status_is_written_except_through_a_transition():
    """The static half: a raw `_update_run(…, {"status": …})` is how F-06
    happened, so the worker may not contain one."""
    src = Path(__file__).resolve().parents[1] / "sim_worker" / "worker.py"
    offenders = []
    for n in ast.walk(ast.parse(src.read_text())):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == "_update_run"):
            for a in n.args:
                if isinstance(a, ast.Dict) and any(
                        isinstance(k, ast.Constant) and k.value == "status" for k in a.keys):
                    offenders.append(n.lineno)
    assert offenders == [], f"status written without a guard at lines {offenders}"
    assert "\"status\": \"done\"" not in json.dumps(
        [l for l in src.read_text().splitlines() if "_update_run(" in l])


# ── F-18: the count is the evidence ───────────────────────────────────────

def test_rep_count_is_the_replications_that_exist():
    kpis = {"source": "scsim", "engine_version": "0.2.5",
            "replications": [{"rep_index": i} for i in range(7)]}
    assert build_run_update(kpis, n_reps=30)["rep_count_done"] == 7


def test_a_legacy_run_claims_no_replications_it_did_not_write():
    assert build_run_update({"source": "worker", "mean_fill_rate": 0.8}, n_reps=30)["rep_count_done"] == 0
