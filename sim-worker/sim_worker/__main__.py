"""Entry point: `python -m sim_worker`."""
from __future__ import annotations

import asyncio
import logging
import os
import signal

from dotenv import load_dotenv

from .scsim_bridge import scsim_enabled
from .worker import SimWorker

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
)
log = logging.getLogger("sim_worker")

# Accepted schemes for the native Redis connection (redis-py's parse_url).
_REDIS_SCHEMES = ("redis://", "rediss://", "unix://")


def redis_url_problem(url: str | None) -> str | None:
    """Return a plain-English reason UPSTASH_REDIS_URL is unusable, or None if
    it's fine. Guards the #1 setup mistake: pasting Upstash's https:// REST URL
    (which belongs in the edge function) into the worker's native Redis slot,
    which otherwise crash-loops with an opaque redis-py ValueError."""
    if not url or not url.strip():
        return "UPSTASH_REDIS_URL is empty — set it to the native rediss://…:6379 URL from Upstash."
    if url.startswith("https://") or url.startswith("http://"):
        return (
            "UPSTASH_REDIS_URL looks like the REST URL (starts with https://). "
            "The worker needs the NATIVE Redis URL that starts with 'rediss://' and ends "
            "in ':6379' — the https:// REST URL belongs in the Supabase edge function "
            "(UPSTASH_REDIS_REST_URL), not here."
        )
    if not url.startswith(_REDIS_SCHEMES):
        return (
            f"UPSTASH_REDIS_URL must start with one of {', '.join(_REDIS_SCHEMES)} "
            "(expected the native Upstash URL 'rediss://default:<password>@<host>.upstash.io:6379')."
        )
    return None


def _strip_wrapping_quotes(name: str) -> None:
    """Normalize one env var in place: trim whitespace and one pair of matching
    wrapping quotes. Secrets pasted into a dashboard as `"rediss://…"` otherwise
    fail the scheme check (or worse, reach redis-py and crash-loop opaquely).
    Mirrors _shared/env.ts on the edge-function side."""
    raw = os.environ.get(name)
    if raw is None:
        return
    v = raw.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1].strip()
    os.environ[name] = v


def validate_env() -> None:
    """Fail fast with a one-line, human-readable reason instead of a traceback
    when a required secret is missing or malformed."""
    for var in ("UPSTASH_REDIS_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        _strip_wrapping_quotes(var)
    problem = redis_url_problem(os.environ.get("UPSTASH_REDIS_URL"))
    if problem:
        log.error("config error: %s", problem)
        raise SystemExit(1)
    for var in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if not (os.environ.get(var) or "").strip():
            log.error("config error: %s is empty — set it from Supabase → Project Settings → API.", var)
            raise SystemExit(1)


def _log_engine_mode() -> None:
    """Announce (and fail fast on) the experiment engine at startup, so a
    `fly logs` glance shows which engine will handle experiment.run."""
    if not scsim_enabled():
        log.warning(
            "engine mode: LEGACY — experiment.run uses the frozen analytical "
            "engine (aggregates only, no per-replication rows). "
            "Set SCSIM_ENGINE=1 for the canonical scsim path."
        )
        return
    from scsim import ENGINE_VERSION  # ImportError here must kill the worker

    log.info("engine mode: scsim %s (SCSIM_ENGINE=1)", ENGINE_VERSION)


async def main() -> None:
    _log_engine_mode()
    validate_env()
    worker = SimWorker(
        redis_url=os.environ["UPSTASH_REDIS_URL"],
        supabase_url=os.environ["SUPABASE_URL"],
        service_role_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        idle_ttl=int(os.getenv("IDLE_TTL_SECONDS", "600")),
    )

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    log.info("sim-worker starting")
    runner = asyncio.create_task(worker.run())
    await stop.wait()
    log.info("shutdown signal received")
    runner.cancel()
    try:
        await runner
    except asyncio.CancelledError:
        pass
    await worker.aclose()
    log.info("sim-worker stopped")


if __name__ == "__main__":
    asyncio.run(main())
