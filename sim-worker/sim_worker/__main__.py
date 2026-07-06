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
