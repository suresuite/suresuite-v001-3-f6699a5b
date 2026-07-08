"""Real-time supply chain simulation worker.

``SimWorker`` is exported lazily so importing the pure ingestion/compute
submodules (``datamap``, ``scsim_bridge``, ``policy_snapshot``) does NOT drag
in the redis dependency of ``worker`` — those submodules run on Vercel's
Python serverless runtime (``api/run_simulation.py``), which has no redis.
"""

__all__ = ["SimWorker"]


def __getattr__(name: str):
    if name == "SimWorker":
        from .worker import SimWorker

        return SimWorker
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
