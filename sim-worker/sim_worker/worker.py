"""SimWorker: consumes scenario and policy commands from Upstash Redis streams
and broadcasts KPI deltas via Supabase Realtime."""
from __future__ import annotations

import asyncio
import json
import logging
import threading
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
from . import series_store

try:  # scsim ships with the canonical path; the legacy-only image lacks it
    from scsim import RunCancelled
except ImportError:  # pragma: no cover
    class RunCancelled(Exception):  # type: ignore[no-redef]
        pass

log = logging.getLogger(__name__)

# The statuses a run may still leave. Every status write is a TRANSITION out of
# one of these (audit F-06): the terminal PATCH used to match by id alone and
# overwrote a user's cancellation with "done".
ACTIVE = ("queued", "running")


class CancelWatch:
    """Cooperative cancel for one run (audit F-06).

    A project's stream is consumed one message at a time, so an
    `experiment.cancel` is not even read until the run it names has finished.
    The cancellation lives on the ROW (sim-command sets it), and the worker
    notices when its per-replication counter write matches no active row. The
    engine is then stopped from its progress observer via `RunCancelled`, the
    one exception it re-raises.
    """

    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def check(self) -> None:
        if self._event.is_set():
            raise RunCancelled("run cancelled by the user")

# Non-scalar KPI keys that must never be broadcast as a KPI delta.
_NON_BROADCAST_KEYS = {
    "replications", "mapping_warnings", "feasibility_warnings", "scsim_notes", "run_id",
    "item_series", "capacity_binding", "stopping_rule",
}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def engine_report_payload(scsim_on: bool) -> dict[str, Any]:
    """WP 10.4 · §4 D245 — what this worker tells the engine registry at boot:
    which registered engine it runs and the build. The slug is the registry's;
    the code version is spelled exactly as `build_run_update` stamps it on a run,
    so the registry and the runs agree about what "scsim-0.2.8" means."""
    if scsim_on:
        from scsim import ENGINE_VERSION

        return {"p_slug": "scsim", "p_version": ENGINE_VERSION,
                "p_code_version": f"scsim-{ENGINE_VERSION}", "p_capabilities": None}
    return {"p_slug": "legacy-worker", "p_version": None,
            "p_code_version": "worker-legacy", "p_capabilities": None}


def engine_mismatch(engine: dict[str, Any] | None, scsim_on: bool) -> str | None:
    """WP 10.4 · §4 D245 — the engine a run was dispatched to versus the engine
    this worker runs. Until WP 10.4 the worker ran whichever engine its
    environment flag chose and the run was LABELLED after the fact, so a run
    bound to scsim could be computed by the retired legacy engine. Returns the
    refusal, or None when they agree or the dispatcher named no engine (a
    dispatcher deployed ahead of the registry)."""
    slug = (engine or {}).get("slug")
    if slug == "scsim" and not scsim_on:
        return ("this run is bound to the scsim engine, and this worker runs the retired "
                "legacy engine (SCSIM_ENGINE is not set) — not run rather than mislabelled")
    if slug == "legacy-worker" and scsim_on:
        return "this run is bound to the retired legacy engine, which this worker does not run"
    return None


def build_run_update(kpis: dict[str, Any], n_reps: int) -> dict[str, Any]:
    """Translate an engine KPI dict (mean_*/ci_* shape) into the
    simulation_runs row update persisted after an experiment.run."""
    aggregate = {k[len("mean_"):]: v for k, v in kpis.items() if k.startswith("mean_")}
    # The range across replications the bridge computes and this used to drop
    # (WP 10.6 · §4 D246). Under an underscore key, like `_meta`, so a reader
    # that iterates KPIs is not handed `min_fill_rate` as a KPI of its own.
    rng = {
        k[len("min_"):]: {"min": v, "max": kpis.get("max_" + k[len("min_"):])}
        for k, v in kpis.items() if k.startswith("min_")
    }
    if rng:
        aggregate["_range"] = rng
    aggregate["_meta"] = {
        "engine": kpis.get("source", "worker"),
        **({"scsim_notes": kpis["scsim_notes"]} if kpis.get("scsim_notes") else {}),
        # WHICH products/suppliers capacity bound, and for how many weeks of the
        # analysis window (WP 9.3 / §4 D167). A run-level fact about the run, so
        # it rides `_meta` beside the conversion notes rather than becoming a
        # scalar KPI — `products_capacity_bound` is the scalar, and it cannot
        # name a product.
        **({"capacity_binding": kpis["capacity_binding"]}
           if kpis.get("capacity_binding") else {}),
        # Which rule decided the replication count (audit F-13): the KPI table
        # labels a sequentially stopped run's intervals.
        **({"stopping_rule": kpis["stopping_rule"]} if kpis.get("stopping_rule") else {}),
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
        # The replications that EXIST, not the ones asked for (audit F-18). The
        # legacy engine writes no `run_replications` rows, so it claims none;
        # it used to claim the requested count over an empty table.
        "rep_count_done": len(kpis.get("replications") or []),
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
# The series sweep (WP 10.9 · §4 D252): production ships no pg_cron, so the
# worker is what runs retention — once at boot (every wake from scale-to-zero)
# and then daily while it stays up.
SERIES_SWEEP_INTERVAL = 24 * 60 * 60
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
        await self._report_engine()
        self._tasks.append(asyncio.create_task(self._discover_loop()))
        self._tasks.append(asyncio.create_task(self._series_sweep_loop()))
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

                    refusal = engine_mismatch(raw.get("engine"), scsim_enabled())
                    if refusal and run_id:
                        log.warning("run %s refused: %s", run_id, refusal)
                        await self._transition(run_id, {
                            "status": "failed", "error_message": refusal, "ended_at": _now(),
                        }, ("queued",))
                        return  # the outer finally ACKs

                    if scsim_enabled() and run_id:
                        # Canonical path: the worker is the SOLE authoritative
                        # writer. Map the project's stored data (item masters +
                        # logistics + policies + scenario) → scsim, run it, and
                        # persist runs + per-rep replications idempotently.
                        # queued → running, and ONLY from queued: a run cancelled
                        # before the worker reached it is left cancelled, not run.
                        if not await self._transition(
                                run_id, {"status": "running", "started_at": _now()}, ("queued",)):
                            log.info("run %s is no longer queued — not starting it", run_id)
                            return  # the outer finally ACKs
                        watch = CancelWatch()
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
                                # Runs in the engine's thread. A cancel noticed by
                                # an EARLIER replication's write stops the run here.
                                watch.check()
                                stream_futs.append(asyncio.run_coroutine_threadsafe(
                                    self._stream_replication(
                                        run_id, cmd.project_id, rep, done, watch),
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
                        except RunCancelled:
                            # The row already says cancelled (sim-command wrote
                            # it); nothing is published and nothing overwrites it.
                            log.info("run %s cancelled mid-run — engine stopped", run_id)
                            return  # the outer finally ACKs
                        except Exception as exc:
                            await self._transition(run_id, {
                                "status": "failed", "error_message": str(exc)[:500],
                            }, ACTIVE)
                            raise
                        kpis["run_id"] = run_id
                        # The warm tier (WP 10.6): the weekly series of every
                        # replication go to ONE zstd Parquet object; the rows keep
                        # their KPIs and the run points at the object. If the
                        # object cannot be written the rows carry the series as
                        # before — the tier is an optimisation, never a loss.
                        reps = kpis.get("replications") or []
                        series_patch, reps = await self._store_series(run_id, cmd.project_id, reps)
                        # The final authoritative write. Streamed upserts are
                        # best-effort (liveness), but losing THIS one loses
                        # data — mark the run failed instead of reporting a
                        # green run with zero persisted replications.
                        reps_ok = await self._write_replications(
                            run_id, cmd.project_id, reps)
                        if not reps_ok:
                            await self._transition(run_id, {
                                "status": "failed",
                                "error_message": "replication rows failed to persist "
                                                 "(see worker logs) — run aborted to avoid "
                                                 "reporting results with no evidence rows",
                            }, ACTIVE)
                            raise RuntimeError("run_replications upsert failed")
                        # Inspection mode's whole point is the per-item series:
                        # a requested-but-unpersisted inspection run must fail
                        # loudly, never report green with no item evidence.
                        item_rows = kpis.get("item_series") or []
                        if item_rows:
                            items_ok = await self._write_item_series(
                                run_id, cmd.project_id, item_rows)
                            if not items_ok:
                                await self._transition(run_id, {
                                    "status": "failed",
                                    "error_message": "per-item series failed to persist "
                                                     "(run_item_series upsert; see worker "
                                                     "logs) — inspection run aborted",
                                }, ACTIVE)
                                raise RuntimeError("run_item_series upsert failed")
                        if not await self._transition(
                                run_id,
                                {**build_run_update(kpis, int(kpis.get("n_reps", n_reps))), **series_patch},
                                ACTIVE):
                            log.info("run %s was cancelled before its results landed — "
                                     "results not published", run_id)
                    else:
                        # Legacy analytical path (no scsim / no run_id).
                        try:
                            kpis = await asyncio.to_thread(
                                compute_kpis, cg.graph, set(cg.graph.nodes), policies,
                                n_weeks, seed, n_reps, disruption_schedule,
                            )
                        except Exception as exc:
                            if run_id:
                                await self._transition(run_id, {
                                    "status": "failed", "error_message": str(exc)[:500],
                                }, ACTIVE)
                            raise
                        kpis["run_id"] = run_id
                        if run_id:
                            await self._transition(run_id, build_run_update(kpis, n_reps), ACTIVE)

                elif cmd.kind == "experiment.cancel":
                    # The cancellation is the ROW's status, written by sim-command
                    # before this message was enqueued; the run it names has
                    # already stopped (or never started) by the time a
                    # one-at-a-time stream reaches this. Nothing to compute and
                    # nothing to broadcast — it used to fall into the branch
                    # below and recompute legacy KPIs (audit F-06).
                    return  # the outer finally ACKs

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
        self, run_id: str, project_id: str, rep: dict[str, Any], done: int,
        watch: "CancelWatch | None" = None,
    ) -> None:
        """Persist one finished replication mid-run and bump the live counter,
        so researchers watch real data accumulate while the engine runs. The
        final _write_replications/_update_run pass re-upserts everything
        idempotently — losing a streamed write costs liveness, never data.

        The counter write is a guarded transition, which makes it the cancel
        check too (audit F-06): if it matches no ACTIVE row, the run has been
        cancelled, and the watch stops the engine at its next replication."""
        # With the warm tier, a streamed row carries KPIs only: the series go to
        # the run's Parquet object at the end, so realtime ships progress, not
        # every replication's weekly arrays (WP 10.6 · §4 D246).
        if series_store.available():
            rep = {**rep, "time_series": {}}
        await self._write_replications(run_id, project_id, [rep])
        still_active = await self._transition(run_id, {"rep_count_done": done}, ACTIVE)
        if not still_active and watch is not None:
            watch.cancel()

    async def _transition(
        self, run_id: str, patch: dict[str, Any], from_statuses: tuple[str, ...],
    ) -> bool:
        """PATCH the run only while its status is one of ``from_statuses``.

        Returns True when a row changed. False means the run had already left
        those statuses — typically cancelled by the user — and the patch was not
        applied. A transport failure returns True (the run is presumed active,
        so one lost write cannot cancel a run) and is logged."""
        try:
            r = await self._http.patch(
                f"{self._supabase_url}/rest/v1/simulation_runs",
                params={"id": f"eq.{run_id}", "status": f"in.({','.join(from_statuses)})",
                        "select": "id"},
                headers={
                    "apikey": self._service_role_key,
                    "Authorization": f"Bearer {self._service_role_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
                json=patch,
            )
            if r.status_code >= 300:
                log.warning("run transition failed %s %s", r.status_code, r.text)
                return True
            return bool(r.json())
        except Exception:
            log.exception("failed to transition run %s", run_id)
            return True

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

    async def _store_series(
        self, run_id: str, project_id: str, reps: list[dict[str, Any]],
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        """Write the run's series object; return (run patch, rows to persist).

        On success the rows lose their series and the patch names the object and
        its size; on any failure the rows keep their series and the patch is
        empty, so the run reads exactly as it did before the tier existed."""
        if not series_store.available() or not any(r.get("time_series") for r in reps):
            return {}, reps
        try:
            data = series_store.write(reps)
            path = series_store.object_path(project_id, run_id)
            r = await self._http.post(
                f"{self._supabase_url}/storage/v1/object/{series_store.BUCKET}/{path}",
                headers={
                    "apikey": self._service_role_key,
                    "Authorization": f"Bearer {self._service_role_key}",
                    "Content-Type": "application/vnd.apache.parquet",
                    "x-upsert": "true",
                },
                content=data,
            )
            if r.status_code >= 300:
                log.warning("series object upload failed %s %s — keeping JSONB series",
                            r.status_code, r.text[:200])
                return {}, reps
        except Exception:
            log.exception("series object failed — keeping JSONB series")
            return {}, reps
        return (
            {"series_object": path, "series_bytes": len(data)},
            [{**rep, "time_series": {}} for rep in reps],
        )

    async def _series_sweep_loop(self) -> None:
        while True:
            await self._sweep_series()
            await asyncio.sleep(SERIES_SWEEP_INTERVAL)

    async def _sweep_series(self) -> dict[str, Any]:
        """Expire due series (WP 10.6 retention) and remove their objects.

        The database marks the runs and hands back every object path to remove —
        the expired runs' and those queued by deleted runs — and the objects go
        through the Storage API, which is the only way that frees the stored
        bytes (a SQL delete on `storage.objects` drops the row and orphans the
        file, and hosted Supabase refuses it). Never fatal: a failure is logged
        with the paths, and the next sweep starts afresh."""
        headers = {
            "apikey": self._service_role_key,
            "Authorization": f"Bearer {self._service_role_key}",
            "Content-Type": "application/json",
        }
        try:
            r = await self._http.post(
                f"{self._supabase_url}/rest/v1/rpc/sweep_expired_run_series",
                headers=headers, json={"p_limit": 500},
            )
            if r.status_code >= 300:
                log.warning("series sweep failed %s %s", r.status_code, r.text[:200])
                return {}
            result = r.json() or {}
        except Exception:
            log.exception("series sweep failed")
            return {}
        paths = [p for p in (result.get("paths") or []) if isinstance(p, str) and p]
        removed = 0
        for i in range(0, len(paths), 100):
            chunk = paths[i:i + 100]
            try:
                d = await self._http.request(
                    "DELETE",
                    f"{self._supabase_url}/storage/v1/object/{series_store.BUCKET}",
                    headers=headers, json={"prefixes": chunk},
                )
                if d.status_code >= 300:
                    log.warning("series objects not removed %s %s: %s",
                                d.status_code, d.text[:200], chunk)
                else:
                    removed += len(chunk)
            except Exception:
                log.exception("series objects not removed: %s", chunk)
        if result.get("runs") or paths:
            log.info("series sweep: %s run(s) expired, %d of %d object(s) removed",
                     result.get("runs", 0), removed, len(paths))
        return {**result, "removed": removed}

    async def _report_engine(self) -> None:
        """Tell the engine registry which build this worker runs (WP 10.4). Never
        fatal: a registry the migration has not reached yet, or a slow PostgREST,
        must not keep the worker from consuming its queue."""
        try:
            r = await self._http.post(
                f"{self._supabase_url}/rest/v1/rpc/sim_engine_report",
                headers={
                    "apikey": self._service_role_key,
                    "Authorization": f"Bearer {self._service_role_key}",
                    "Content-Type": "application/json",
                },
                json=engine_report_payload(scsim_enabled()),
            )
            if r.status_code >= 300:
                log.warning("engine report failed %s %s", r.status_code, r.text)
        except Exception:
            log.exception("engine report failed")

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
