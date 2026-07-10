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

from .datamap import load_project_data
from .engine import apply_delta, compute_kpis
from .graph_cache import GraphCache
from .network_metrics import compute_network_metrics
from .policy_snapshot import snapshot_to_policies
from .schemas import Command
from .scsim_bridge import compute_kpis_scsim, compute_run_from_project, scsim_enabled

log = logging.getLogger(__name__)

# Non-scalar KPI keys that must never be broadcast as a KPI delta.
_NON_BROADCAST_KEYS = {
    "replications", "mapping_warnings", "feasibility_warnings", "scsim_notes", "run_id",
}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def build_run_update(kpis: dict[str, Any], n_reps: int) -> dict[str, Any]:
    """Translate an engine KPI dict (mean_*/ci_* shape) into the
    simulation_runs row update persisted after an experiment.run."""
    aggregate = {k[len("mean_"):]: v for k, v in kpis.items() if k.startswith("mean_")}
    aggregate["_meta"] = {
        "engine": kpis.get("source", "worker"),
        **({"scsim_notes": kpis["scsim_notes"]} if kpis.get("scsim_notes") else {}),
    }
    if kpis.get("source") == "scsim":
        code_version = f"scsim-{kpis.get('engine_version', 'unknown')}"
    else:
        code_version = "worker-legacy"
    patch: dict[str, Any] = {
        "status": "done",
        "ended_at": _now(),
        "aggregate_kpis": aggregate,
        "ci_half_widths": {k[len("ci_"):]: v for k, v in kpis.items() if k.startswith("ci_")},
        "code_version": code_version,
        "rep_count_done": n_reps,
    }
    if kpis.get("mapping_warnings") is not None:
        patch["mapping_warnings"] = kpis["mapping_warnings"]
    if kpis.get("warmup_detected_at") is not None:
        patch["warmup_detected_at"] = kpis["warmup_detected_at"]
    return patch

STREAM_PREFIX = "sim.cmd."
CONSUMER_GROUP = "sim-workers"
PROJECT_DISCOVERY_KEY = "sim.active_projects"  # set populated by edge function (future)
DEFAULT_PROJECTS_REFRESH = 5.0  # seconds
EVICT_INTERVAL = 60.0
XREAD_BLOCK_MS = 5000


class SimWorker:
    def __init__(
        self,
        redis_url: str,
        supabase_url: str,
        service_role_key: str,
        idle_ttl: int = 600,
    ):
        # socket_timeout MUST exceed the XREADGROUP block window: redis-py 8
        # changed its default from None to 5 s — equal to the block — so every
        # idle poll's read died with a TimeoutError before the server's empty
        # reply arrived (requirements.txt doesn't pin the redis major). The
        # keepalive + health check hold the connection across Upstash's
        # idle-connection reaping between commands.
        self._redis = redis.from_url(
            redis_url,
            decode_responses=True,
            socket_timeout=XREAD_BLOCK_MS / 1000 + 10,
            socket_connect_timeout=10,
            socket_keepalive=True,
            health_check_interval=30,
        )
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
                    count=10, block=XREAD_BLOCK_MS,
                )
                if not resp:
                    continue
                for _stream, messages in resp:
                    for msg_id, fields in messages:
                        await self._handle(stream, msg_id, fields)
            except asyncio.CancelledError:
                raise
            except (redis.ConnectionError, redis.TimeoutError) as e:
                # Transient network trouble: one line, not a stack trace per
                # poll — the loop reconnects on the next iteration anyway.
                log.warning("redis unavailable for %s: %s — retrying", stream, e)
                await asyncio.sleep(1.0)
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
                    run_id: str | None = raw.get("run_id")
                    scenario_data: dict = raw.get("scenario") or {}
                    recovery_data: dict = raw.get("recovery") or {}

                    disruption_schedule: list[dict] = scenario_data.get("disruption_schedule") or []
                    n_weeks = max(1, round(float(scenario_data.get("horizon_days", 90)) / 7))
                    seed = int(scenario_data.get("seed", 42))
                    n_reps = min(200, max(1, int(scenario_data.get("replications", 30))))

                    # Runs are bound to a saved policy version: prefer the snapshot
                    # embedded in the envelope, fetch it by id if it was too large
                    # to embed, and only fall back to live tables for legacy
                    # commands that predate version-bound runs.
                    snapshot: dict | None = raw.get("policy_snapshot")
                    if snapshot is None and raw.get("policy_version_id"):
                        snapshot = await self._fetch_version_snapshot(raw["policy_version_id"])
                    if snapshot is not None:
                        policies = snapshot_to_policies(snapshot)
                    else:
                        policies = await self._cache.get_effective_policies(cmd.project_id)
                    # Merge scenario-level recovery_overrides into policies so the engine
                    # applies the chosen playbook's responses during inventory review.
                    if recovery_data:
                        policies.setdefault("default", {})["recovery"] = {
                            **policies.get("default", {}).get("recovery", {}),
                            **recovery_data,
                        }

                    if scsim_enabled() and run_id:
                        # Canonical path: the worker is the SOLE authoritative
                        # writer. Map the project's stored data (item masters +
                        # logistics + policies + scenario) → scsim, run it, and
                        # persist runs + per-rep replications idempotently.
                        await self._update_run(run_id, {"status": "running", "started_at": _now()})
                        try:
                            project_model = await self._fetch_project_model(cmd.project_id)
                            data = await load_project_data(
                                self._http, self._supabase_url, self._service_role_key,
                                cmd.project_id, scenario=scenario_data, policies=policies,
                                project_model=project_model,
                            )
                            # Live streaming: the engine invokes this observer from
                            # its worker thread after each replication; hand the
                            # upsert to the event loop without blocking the run.
                            # The UI's realtime subscriptions on run_replications /
                            # simulation_runs render rows as they land.
                            loop = asyncio.get_running_loop()
                            stream_futs: list = []

                            def on_replication(rep: dict, done: int, total: int) -> None:
                                stream_futs.append(asyncio.run_coroutine_threadsafe(
                                    self._stream_replication(
                                        run_id, cmd.project_id, rep, done),
                                    loop,
                                ))

                            kpis = await asyncio.to_thread(
                                compute_run_from_project, data, on_replication)
                            # Let in-flight streamed writes settle before the final
                            # authoritative update, so a stale rep_count_done can't
                            # land after the run is marked done.
                            if stream_futs:
                                await asyncio.gather(
                                    *[asyncio.wrap_future(f) for f in stream_futs],
                                    return_exceptions=True,
                                )
                        except Exception as exc:
                            await self._update_run(run_id, {
                                "status": "failed", "error_message": str(exc)[:500],
                            })
                            raise
                        kpis["run_id"] = run_id
                        await self._write_replications(
                            run_id, cmd.project_id, kpis.get("replications") or [])
                        await self._update_run(
                            run_id, build_run_update(kpis, int(kpis.get("n_reps", n_reps))))
                    else:
                        # Legacy analytical path (no scsim / no run_id).
                        try:
                            kpis = await asyncio.to_thread(
                                compute_kpis, cg.graph, set(cg.graph.nodes), policies,
                                n_weeks, seed, n_reps, disruption_schedule,
                            )
                        except Exception as exc:
                            if run_id:
                                await self._update_run(run_id, {
                                    "status": "failed", "error_message": str(exc)[:500],
                                })
                            raise
                        kpis["run_id"] = run_id
                        if run_id:
                            await self._update_run(run_id, build_run_update(kpis, n_reps))

                else:
                    policies = await self._cache.get_effective_policies(cmd.project_id)
                    kpis = cg.last_kpis or await asyncio.to_thread(
                        compute_kpis, cg.graph, set(), policies
                    )

                # Broadcast only changed scalar fields for bandwidth efficiency
                # (never the bulky replications / warnings payloads).
                delta = {
                    k: v for k, v in kpis.items()
                    if k not in _NON_BROADCAST_KEYS and cg.last_kpis.get(k) != v
                }
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

    async def _fetch_version_snapshot(self, version_id: str) -> dict[str, Any] | None:
        """Fetch an immutable policy_versions.snapshot via PostgREST (service role)."""
        try:
            r = await self._http.get(
                f"{self._supabase_url}/rest/v1/policy_versions",
                params={"id": f"eq.{version_id}", "select": "snapshot"},
                headers={
                    "apikey": self._service_role_key,
                    "Authorization": f"Bearer {self._service_role_key}",
                },
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0]["snapshot"] if rows else None
        except Exception:
            log.exception("failed to fetch policy version %s", version_id)
            return None

    async def _fetch_project_model(self, project_id: str) -> str | None:
        """projects.supply_chain_model → fulfillment mode default."""
        try:
            r = await self._http.get(
                f"{self._supabase_url}/rest/v1/projects",
                params={"id": f"eq.{project_id}", "select": "supply_chain_model"},
                headers={"apikey": self._service_role_key,
                         "Authorization": f"Bearer {self._service_role_key}"},
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0].get("supply_chain_model") if rows else None
        except Exception:
            return None

    async def _stream_replication(
        self, run_id: str, project_id: str, rep: dict[str, Any], done: int
    ) -> None:
        """Persist one finished replication mid-run and bump the live counter,
        so researchers watch real data accumulate while the engine runs. The
        final _write_replications/_update_run pass re-upserts everything
        idempotently — losing a streamed write costs liveness, never data."""
        await self._write_replications(run_id, project_id, [rep])
        await self._update_run(run_id, {"rep_count_done": done})

    async def _write_replications(
        self, run_id: str, project_id: str, reps: list[dict[str, Any]]
    ) -> None:
        """Idempotently UPSERT per-replication rows on (run_id, rep_index)."""
        if not reps:
            return
        rows = [{
            "run_id": run_id, "project_id": project_id,
            "rep_index": r["rep_index"], "seed_used": r["seed_used"],
            "status": "done", "kpis": r.get("kpis", {}),
            "time_series": r.get("time_series", {}), "warmup_at": r.get("warmup_at"),
            "ended_at": _now(),
        } for r in reps]
        try:
            resp = await self._http.post(
                f"{self._supabase_url}/rest/v1/run_replications",
                params={"on_conflict": "run_id,rep_index"},
                headers={
                    "apikey": self._service_role_key,
                    "Authorization": f"Bearer {self._service_role_key}",
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates,return=minimal",
                },
                json=rows,
            )
            if resp.status_code >= 300:
                log.warning("replication upsert failed %s %s", resp.status_code, resp.text[:200])
        except Exception:
            log.exception("failed to upsert replications for run %s", run_id)

    async def _update_run(self, run_id: str, patch: dict[str, Any]) -> None:
        """PATCH a simulation_runs row via PostgREST (service role)."""
        try:
            r = await self._http.patch(
                f"{self._supabase_url}/rest/v1/simulation_runs",
                params={"id": f"eq.{run_id}"},
                headers={
                    "apikey": self._service_role_key,
                    "Authorization": f"Bearer {self._service_role_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=patch,
            )
            if r.status_code >= 300:
                log.warning("run update failed %s %s", r.status_code, r.text)
        except Exception:
            log.exception("failed to update run %s", run_id)

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
