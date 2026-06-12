"""SimWorker: consumes scenario and policy commands from Upstash Redis streams
and broadcasts KPI deltas via Supabase Realtime."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import httpx
import redis.asyncio as redis

from .engine import apply_delta, compute_kpis
from .graph_cache import GraphCache
from .network_metrics import compute_network_metrics
from .schemas import Command
from .scsim_bridge import compute_kpis_scsim, scsim_enabled

log = logging.getLogger(__name__)

STREAM_PREFIX = "sim.cmd."
CONSUMER_GROUP = "sim-workers"
PROJECT_DISCOVERY_KEY = "sim.active_projects"  # set populated by edge function (future)
DEFAULT_PROJECTS_REFRESH = 5.0  # seconds
EVICT_INTERVAL = 60.0


class SimWorker:
    def __init__(
        self,
        redis_url: str,
        supabase_url: str,
        service_role_key: str,
        idle_ttl: int = 600,
    ):
        self._redis = redis.from_url(redis_url, decode_responses=True)
        self._supabase_url = supabase_url.rstrip("/")
        self._service_role_key = service_role_key
        self._cache = GraphCache(supabase_url, service_role_key, idle_ttl)
        self._http = httpx.AsyncClient(timeout=5.0)
        self._consumer_name = f"worker-{int(time.time())}"
        self._active_streams: set[str] = set()
        self._tasks: list[asyncio.Task] = []

    async def aclose(self) -> None:
        for t in self._tasks:
            t.cancel()
        await self._cache.aclose()
        await self._http.aclose()
        await self._redis.aclose()

    async def run(self) -> None:
        self._tasks.append(asyncio.create_task(self._discover_loop()))
        self._tasks.append(asyncio.create_task(self._evict_loop()))
        await asyncio.gather(*self._tasks, return_exceptions=True)

    # ------------------------------------------------------------------ loops

    async def _evict_loop(self) -> None:
        while True:
            await asyncio.sleep(EVICT_INTERVAL)
            try:
                await self._cache.evict_idle()
            except Exception:
                log.exception("evict loop failed")

    async def _discover_loop(self) -> None:
        """Discover per-project streams. For Phase 1 we use Redis KEYS scan;
        for high cardinality, switch to a shared set updated by sim-command."""
        while True:
            try:
                async for key in self._redis.scan_iter(match=f"{STREAM_PREFIX}*"):
                    if key not in self._active_streams:
                        self._active_streams.add(key)
                        self._tasks.append(asyncio.create_task(self._consume(key)))
                        log.info("subscribed to %s", key)
            except Exception:
                log.exception("discover loop failed")
            await asyncio.sleep(DEFAULT_PROJECTS_REFRESH)

    async def _consume(self, stream: str) -> None:
        try:
            await self._redis.xgroup_create(stream, CONSUMER_GROUP, id="$", mkstream=True)
        except redis.ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise

        while True:
            try:
                resp = await self._redis.xreadgroup(
                    CONSUMER_GROUP, self._consumer_name, {stream: ">"},
                    count=10, block=5000,
                )
                if not resp:
                    continue
                for _stream, messages in resp:
                    for msg_id, fields in messages:
                        await self._handle(stream, msg_id, fields)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("consume loop failed for %s", stream)
                await asyncio.sleep(1.0)

    # --------------------------------------------------------------- handlers

    async def _handle(self, stream: str, msg_id: str, fields: dict[str, str]) -> None:
        t0 = time.perf_counter()
        # Keep raw dict so experiment.run can access top-level fields (scenario, recovery)
        # that sim-command embeds outside the Command schema's `payload` key.
        raw: dict[str, Any] = {}
        try:
            raw = json.loads(fields["data"])
            cmd = Command(**raw)
        except Exception:
            log.exception("bad command on %s id=%s", stream, msg_id)
            await self._redis.xack(stream, CONSUMER_GROUP, msg_id)
            return

        try:
            cg = await self._cache.get(cmd.project_id)
            async with cg.lock:
                if cmd.kind == "scenario.changed":
                    dirty = apply_delta(cg.graph, cmd.payload)
                    policies = await self._cache.get_effective_policies(cmd.project_id)
                    kpis = await asyncio.to_thread(
                        compute_kpis, cg.graph, dirty, policies
                    )

                elif cmd.kind == "scenario.reset":
                    for n in cg.graph.nodes:
                        cg.graph.nodes[n].pop("_disruption", None)
                    policies = await self._cache.get_effective_policies(cmd.project_id)
                    kpis = await asyncio.to_thread(
                        compute_kpis, cg.graph, set(cg.graph.nodes), policies
                    )

                elif cmd.kind == "policy.changed":
                    # Invalidate stale policy cache, reload, recompute full graph
                    self._cache.invalidate_policies(cmd.project_id)
                    policies = await self._cache.get_effective_policies(cmd.project_id)
                    dirty = set(cg.graph.nodes)
                    kpis = await asyncio.to_thread(
                        compute_kpis, cg.graph, dirty, policies
                    )

                elif cmd.kind == "experiment.run":
                    # sim-command embeds the full scenario + resolved recovery at top level
                    scenario_data: dict = raw.get("scenario") or {}
                    recovery_data: dict = raw.get("recovery") or {}

                    disruption_schedule: list[dict] = scenario_data.get("disruption_schedule") or []
                    n_weeks = max(1, round(float(scenario_data.get("horizon_days", 90)) / 7))
                    seed = int(scenario_data.get("seed", 42))
                    n_reps = min(200, max(1, int(scenario_data.get("replications", 30))))

                    policies = await self._cache.get_effective_policies(cmd.project_id)
                    # Merge scenario-level recovery_overrides into policies so the engine
                    # applies the chosen playbook's responses during inventory review.
                    if recovery_data:
                        policies.setdefault("default", {})["recovery"] = {
                            **policies.get("default", {}).get("recovery", {}),
                            **recovery_data,
                        }

                    if scsim_enabled():
                        # Opt-in phase-pipeline engine (SCSIM_ENGINE=1); falls
                        # back to the legacy engine on any conversion failure.
                        try:
                            kpis = await asyncio.to_thread(
                                compute_kpis_scsim, cg.graph, policies,
                                n_weeks, seed, n_reps, disruption_schedule,
                            )
                        except Exception:
                            log.exception("scsim bridge failed; falling back to legacy engine")
                            kpis = await asyncio.to_thread(
                                compute_kpis, cg.graph, set(cg.graph.nodes), policies,
                                n_weeks, seed, n_reps, disruption_schedule,
                            )
                    else:
                        kpis = await asyncio.to_thread(
                            compute_kpis, cg.graph, set(cg.graph.nodes), policies,
                            n_weeks, seed, n_reps, disruption_schedule,
                        )
                    # Attach run_id so the broadcast payload links to the DB run row
                    kpis["run_id"] = raw.get("run_id")

                else:
                    policies = await self._cache.get_effective_policies(cmd.project_id)
                    kpis = cg.last_kpis or await asyncio.to_thread(
                        compute_kpis, cg.graph, set(), policies
                    )

                # Broadcast only changed fields for bandwidth efficiency
                delta = {k: v for k, v in kpis.items() if cg.last_kpis.get(k) != v}
                cg.last_kpis = kpis

            if delta:
                await self._broadcast(cmd.project_id, "kpi.delta", {
                    "kpis": delta,
                    "ts": int(time.time() * 1000),
                    "source": "worker",
                })
        finally:
            await self._redis.xack(stream, CONSUMER_GROUP, msg_id)
            log.debug("handled %s in %.1f ms", cmd.kind, (time.perf_counter() - t0) * 1000)

    async def _broadcast(self, project_id: str, event: str, payload: dict[str, Any]) -> None:
        try:
            r = await self._http.post(
                f"{self._supabase_url}/realtime/v1/api/broadcast",
                headers={
                    "apikey": self._service_role_key,
                    "Authorization": f"Bearer {self._service_role_key}",
                    "Content-Type": "application/json",
                },
                json={"messages": [{
                    "topic": f"sim:{project_id}",
                    "event": event,
                    "payload": payload,
                    "private": False,
                }]},
            )
            if r.status_code >= 300:
                log.warning("broadcast failed %s %s", r.status_code, r.text)
        except Exception:
            log.exception("broadcast error")
