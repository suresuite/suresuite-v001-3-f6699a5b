"""Entry point: `python -m sim_worker`."""
from __future__ import annotations

import asyncio
import logging
import os
import signal

from dotenv import load_dotenv

from .worker import SimWorker

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
)
log = logging.getLogger("sim_worker")


async def main() -> None:
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
