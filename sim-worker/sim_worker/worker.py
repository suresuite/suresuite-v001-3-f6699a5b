"""SimWorker: consumes scenario and policy commands from Upstash Redis streams
and broadcasts KPI deltas via Supabase Realtime."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Callable

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
    "item_series", "capacity_binding",
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
        # WHICH products/suppliers capacity bound, and for how many weeks of the
        # analysis window (WP 9.3 / §4 D165). A run-level fact about the run, so
        # it rides `_meta` beside the conversion notes rather than becoming a
        # scalar KPI — `products_capacity_bound` is the scalar, and it cannot
        # name a product.
        **({"capacity_binding": kpis["capacity_binding"]}
           if kpis.get("capacity_binding") else {}),
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
# Idle-poll cadences. The discover and consume loops below poll on these timers
# even when nothing is running, and every poll is a billed Upstash command — at
# the old 5 s cadence the two loops alone issued ~1M idle reads/month, blowing
# the 500k free tier. 30 s cuts that ~6x. Widening XREAD_BLOCK_MS costs no
# job-pickup latency: a blocking XREADGROUP returns the instant a command is
# XADD'd; the longer block only removes empty idle polls. A longer
# DEFAULT_PROJECTS_REFRESH only delays discovery of a brand-new project's
# first-ever stream — streams persist, so repeat runs are unaffected.
DEFAULT_PROJECTS_REFRESH = 30.0  # seconds
EVICT_INTERVAL = 60.0
XREAD_BLOCK_MS = 30000


class SimWorker:
    def __init__(
        self,
        redis_url: str,
        supabase_url: str,
        service_role_key: str,
        idle_ttl: int = 600,
        idle_shutdown: int = 0,
        on_idle: Callable[[], None] | None = None,
    ):
        # socket_timeout MUST exceed the XREADGROUP block window: redis-py 8
        # changed its default from None to 5 s — at or below the block window —
        # so every idle poll's read died with a TimeoutError before the server's
        # empty reply arrived (requirements.txt doesn't pin the redis major). The
        # +10 keeps this derived timeout above the block whatever it is set to.
        # The keepalive + health check hold the connection across Upstash's
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
        # Scale-to-zero bookkeeping. `idle_shutdown` (seconds, 0 = disabled)
        # is the quiet period after which the worker exits cleanly so Fly can
        # stop the machine; `on_idle` is the callback that triggers the clean
        # shutdown. `_active` counts in-flight command handlers so a long run
        # is never mistaken for idle; `_last_activity` is stamped whenever a
        # command is picked up or finishes.
        self._idle_shutdown = idle_shutdown
        self._on_idle = on_idle
        self._active = 0
        self._last_activity = time.monotonic()

    async def aclose(self) -> None:
        for t in self._tasks:
            t.cancel()
        await self._cache.aclose()
        await self._http.aclose()
        await self._redis.aclose()

    async def run(self) -> None:
        self._tasks.append(asyncio.create_task(self._discover_loop()))
        self._tasks.append(asyncio.create_task(self._evict_loop()))
        if self._idle_shutdown > 0 and self._on_idle is not None:
            self._tasks.append(asyncio.create_task(self._idle_monitor()))
        await asyncio.gather(*self._tasks, return_exceptions=True)

    # ------------------------------------------------------------------ loops

    def _should_idle_stop(self) -> bool:
        """True when scale-to-zero is armed, nothing is in flight, and no
        command has been handled for `idle_shutdown` seconds. Pure/synchronous
        so the decision is unit-testable without driving the sleep loop."""
        return (
            self._idle_shutdown > 0
            and self._active == 0
            and (time.monotonic() - self._last_activity) >= self._idle_shutdown
        )

    async def _idle_monitor(self) -> None:
        """Scale-to-zero: exit cleanly after a quiet period so the Fly machine
        stops billing. A clean exit(0) only STOPS the machine when fly.toml sets
        `[[restart]] policy = "on-failure"` (with the default "always" Fly just
        restarts it — no savings, but also no stranded run). The next enqueued
        command wakes the machine again via the sim-command edge function's Fly
        Machines API call (supabase/functions/_shared/wakeWorker.ts), which also
        closes the original 'queued forever with no worker' hole."""
        interval = max(1.0, min(30.0, self._idle_shutdown / 2))
        while True:
            await asyncio.sleep(interval)
            if self._should_idle_stop():
                log.info(
                    "idle %.0fs (no work, nothing in flight) — exiting to scale "
                    "the Fly machine to zero", time.monotonic() - self._last_activity,
                )
                assert self._on_idle is not None  # guarded by run()
                self._on_idle()
                return

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
        # Scale-to-zero in-flight guard: count active handlers and stamp
        # activity on BOTH entry and exit. Stamping on exit keeps a long
        # experiment.run from ever looking idle; the always-run finally keeps a
        # malformed command from leaking the counter and pinning the worker
        # awake forever.
        self._active += 1
        self._last_activity = time.monotonic()
        try:
            await self._handle_inner(stream, msg_id, fields)
        finally:
            self._active -= 1
            self._last_activity = time.monotonic()

    async def _handle_inner(self, stream: str, msg_id: str, fields: dict[str, str]) -> None:
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
                    # Single-run inspection mode (G17/§9.5.1): the dispatcher
                    # forwards payload.inspection; the mapper honors it only
                    # for 1-replication runs (warns and ignores otherwise).
                    if (cmd.payload or {}).get("inspection") is True:
                        scenario_data = {**scenario_data, "inspection": True}

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
                        # The final authoritative write. Streamed upserts are
                        # best-effort (liveness), but losing THIS one loses
                        # data — mark the run failed instead of reporting a
                        # green run with zero persisted replications.
                        reps_ok = await self._write_replications(
                            run_id, cmd.project_id, kpis.get("replications") or [])
                        if not reps_ok:
                            await self._update_run(run_id, {
                                "status": "failed",
                                "error_message": "replication rows failed to persist "
                                                 "(see worker logs) — run aborted to avoid "
                                                 "reporting results with no evidence rows",
                            })
                            raise RuntimeError("run_replications upsert failed")
                        # Inspection mode's whole point is the per-item series:
                        # a requested-but-unpersisted inspection run must fail
                        # loudly, never report green with no item evidence.
                        item_rows = kpis.get("item_series") or []
                        if item_rows:
                            items_ok = await self._write_item_series(
                                run_id, cmd.project_id, item_rows)
                            if not items_ok:
                                await self._update_run(run_id, {
                                    "status": "failed",
                                    "error_message": "per-item series failed to persist "
                                                     "(run_item_series upsert; see worker "
                                                     "logs) — inspection run aborted",
                                })
                                raise RuntimeError("run_item_series upsert failed")
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
    ) -> bool:
        """Idempotently UPSERT per-replication rows on (run_id, rep_index).
        Returns True on success — the caller decides whether a failure is
        best-effort (mid-run streaming) or fatal (the final write)."""
        if not reps:
            return True
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
                return False
            return True
        except Exception:
            log.exception("failed to upsert replications for run %s", run_id)
            return False

    async def _write_item_series(
        self, run_id: str, project_id: str, rows: list[dict[str, Any]]
    ) -> bool:
        """Idempotently UPSERT per-item weekly series rows on
        (run_id, kind, item_id) — the single-run inspection evidence
        (G17/§9.5.1). Chunked: ~577 rows × 156-week series is a few MB."""
        if not rows:
            return True
        payload = [{
            "run_id": run_id, "project_id": project_id,
            "kind": r["kind"], "item_id": r["item_id"], "series": r.get("series", {}),
        } for r in rows]
        for i in range(0, len(payload), 100):
            chunk = payload[i:i + 100]
            try:
                resp = await self._http.post(
                    f"{self._supabase_url}/rest/v1/run_item_series",
                    params={"on_conflict": "run_id,kind,item_id"},
                    headers={
                        "apikey": self._service_role_key,
                        "Authorization": f"Bearer {self._service_role_key}",
                        "Content-Type": "application/json",
                        "Prefer": "resolution=merge-duplicates,return=minimal",
                    },
                    json=chunk,
                    timeout=30.0,
                )
                if resp.status_code >= 300:
                    log.warning("item-series upsert failed %s %s",
                                resp.status_code, resp.text[:200])
                    return False
            except Exception:
                log.exception("failed to upsert item series for run %s", run_id)
                return False
        return True

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
