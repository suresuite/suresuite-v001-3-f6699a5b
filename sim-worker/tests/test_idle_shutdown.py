"""Scale-to-zero contract: the worker exits cleanly only after a real idle
period with nothing in flight, and the in-flight counter never leaks — the two
properties that make stopping the Fly machine safe (a leaked counter would pin
the worker awake forever; a premature stop would kill a running experiment)."""
import asyncio
import time

from sim_worker.worker import SimWorker


def _make_worker(idle_shutdown: int, on_idle=None) -> SimWorker:
    # redis.from_url / httpx.AsyncClient are lazy — no network on construction,
    # and the idle logic under test touches neither.
    return SimWorker(
        redis_url="redis://localhost:6379",
        supabase_url="https://example.supabase.co",
        service_role_key="service-role-key",
        idle_shutdown=idle_shutdown,
        on_idle=on_idle,
    )


def test_disabled_never_stops():
    w = _make_worker(idle_shutdown=0)
    w._last_activity = time.monotonic() - 10_000  # ancient
    assert w._should_idle_stop() is False


def test_fresh_worker_is_not_idle():
    w = _make_worker(idle_shutdown=900)
    # Just constructed → last_activity ~ now → nowhere near the threshold.
    assert w._should_idle_stop() is False


def test_stops_after_quiet_period():
    w = _make_worker(idle_shutdown=900)
    w._last_activity = time.monotonic() - 901
    assert w._should_idle_stop() is True


def test_in_flight_command_blocks_stop():
    w = _make_worker(idle_shutdown=900)
    w._last_activity = time.monotonic() - 10_000
    w._active = 1  # a long experiment.run is still processing
    assert w._should_idle_stop() is False
    w._active = 0
    assert w._should_idle_stop() is True


def test_handle_wrapper_decrements_and_stamps_on_error():
    """A command that blows up inside _handle_inner must still release the
    in-flight counter and refresh activity, or one bad command would pin the
    worker awake forever."""
    async def drive():
        stopped = False

        def on_idle():
            nonlocal stopped
            stopped = True

        w = _make_worker(idle_shutdown=900, on_idle=on_idle)
        w._last_activity = time.monotonic() - 10_000

        async def boom(*_a):
            raise RuntimeError("handler exploded")

        w._handle_inner = boom  # type: ignore[assignment]

        raised = False
        try:
            await w._handle("sim.cmd.p", "1-0", {"data": "{}"})
        except RuntimeError:
            raised = True

        assert raised, "wrapper must not swallow handler errors"
        assert w._active == 0, "counter leaked after a failed handler"
        # Activity was stamped on exit, so the worker is no longer 'idle'.
        assert w._should_idle_stop() is False

    asyncio.run(drive())


def test_idle_monitor_fires_on_idle():
    """End-to-end: the monitor loop calls on_idle once the quiet period has
    elapsed. Uses a tiny idle_shutdown so the loop's own interval is short."""
    async def drive():
        fired = asyncio.Event()
        w = _make_worker(idle_shutdown=2, on_idle=fired.set)
        # Pretend the last command was handled well before the threshold.
        w._last_activity = time.monotonic() - 5
        monitor = asyncio.create_task(w._idle_monitor())
        try:
            await asyncio.wait_for(fired.wait(), timeout=5)
        finally:
            monitor.cancel()
        assert fired.is_set()

    asyncio.run(drive())
