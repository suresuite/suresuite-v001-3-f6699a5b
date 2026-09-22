"""A failed read fails the run (audit 2026-09-22, F-08).

`load_project_data.rows()` caught every exception and every non-200 and
returned `[]`, so a transient failure on `outbound_logistics` produced a run
with no demand — which then reported a perfect fill rate. "The table is empty"
and "the read did not happen" are different facts; only the first may reach
the engine. The worker marks a run `failed` with the exception's message when
`load_project_data` raises (`worker.py`), so raising here is the whole fix.
"""
from __future__ import annotations

import asyncio

import httpx
import pytest

from sim_worker.datamap import ProjectReadError, load_project_data

TABLES = ("suppliers", "materials", "products", "inbound_logistics",
          "bom_multi_level", "bom_single_level", "outbound_logistics", "customers")


def _load(handler) -> object:
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await load_project_data(http, "https://db.example", "k", "p1",
                                           scenario={}, policies={}, project_model=None)
    return asyncio.run(go())


def _ok(rows_by_table: dict):
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path.endswith("/rpc/ensure_item_masters"):
            return httpx.Response(200, json=None)
        table = req.url.path.rsplit("/", 1)[-1]
        return httpx.Response(200, json=rows_by_table.get(table, []))
    return handler


def test_legitimately_empty_tables_are_not_an_error():
    data = _load(_ok({}))
    assert data.outbound == []


@pytest.mark.parametrize("status", [401, 404, 500, 503])
def test_a_non_200_read_raises_and_names_the_table(status):
    def handler(req):
        if req.url.path.endswith("/outbound_logistics"):
            return httpx.Response(status, text="boom")
        return _ok({})(req)
    with pytest.raises(ProjectReadError) as e:
        _load(handler)
    assert "outbound_logistics" in str(e.value) and str(status) in str(e.value)


def test_a_transport_failure_raises():
    def handler(req):
        if req.url.path.endswith("/inbound_logistics"):
            raise httpx.ConnectError("reset")
        return _ok({})(req)
    with pytest.raises(ProjectReadError, match="inbound_logistics"):
        _load(handler)


def test_a_non_list_body_raises():
    def handler(req):
        if req.url.path.endswith("/materials"):
            return httpx.Response(200, json={"message": "column does not exist"})
        return _ok({})(req)
    with pytest.raises(ProjectReadError, match="materials"):
        _load(handler)
