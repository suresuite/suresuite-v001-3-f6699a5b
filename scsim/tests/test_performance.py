"""CI performance guardrail (Part X §10.4).

The hard targets (0.5 s manuscript-scale, 5 s large) are checked by
scripts/benchmark.py on dedicated hardware; CI asserts a generous multiple
so shared runners don't flake while real regressions (>3×) still fail.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from benchmark import synthetic_network  # noqa: E402

from scsim import DisruptionEvent, Scenario, SimulationSettings
from scsim.core.engine import compile_scenario, run_replication
from scsim.disruption.injector import resolve_events
from scsim.entities.enums import WarmupMethod


@pytest.mark.slow
def test_manuscript_scale_replication_budget():
    net = synthetic_network(15, 556, 58)
    sc = Scenario(
        name="perf", network=net,
        settings=SimulationSettings(project_seed=1, horizon=156, model_seeds=1,
                                    warmup_method=WarmupMethod.MANUAL, warmup_end=40,
                                    analysis_window=52),
        events=[DisruptionEvent(target_id="s0", start=60, duration=8)],
        policies={"safety_stock_materials": {}, "material_allocation": {},
                  "expedited_shipments": {}, "backup_supplier": {},
                  "short_term_capacity": {}},
    )
    compiled = compile_scenario(sc)
    events = resolve_events(compiled.model, 40, 0)
    run_replication(compiled, 0, 0, events)  # warm caches
    t0 = time.perf_counter()
    run_replication(compiled, 1, 0, events)
    elapsed = time.perf_counter() - t0
    assert elapsed < 1.5, (
        f"manuscript-scale replication took {elapsed:.2f}s — over 3× the 0.5s "
        f"target (Part X §10.1); profile before merging"
    )
