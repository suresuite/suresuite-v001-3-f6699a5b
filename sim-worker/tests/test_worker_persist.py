"""build_run_update converts engine KPI dicts into simulation_runs row patches."""
from sim_worker.worker import build_run_update


def test_scsim_result_shape():
    kpis = {
        "source": "scsim",
        "engine_version": "0.3.1",
        "scsim_notes": ["transport modes collapsed to fastest"],
        "mean_fill_rate": 0.93,
        "ci_fill_rate": 0.02,
        "mean_revenue": 1200.5,
        "ci_revenue": 30.0,
        "fill_rate": 0.93,
        "run_id": "abc",
        # rep_count_done counts these, not n_reps (audit F-18)
        "replications": [{"rep_index": i} for i in range(30)],
    }
    patch = build_run_update(kpis, n_reps=30)

    assert patch["status"] == "done"
    assert patch["rep_count_done"] == 30
    assert patch["code_version"] == "scsim-0.3.1"
    assert patch["aggregate_kpis"]["fill_rate"] == 0.93
    assert patch["aggregate_kpis"]["revenue"] == 1200.5
    assert patch["aggregate_kpis"]["_meta"] == {
        "engine": "scsim",
        "scsim_notes": ["transport modes collapsed to fastest"],
    }
    assert patch["ci_half_widths"] == {"fill_rate": 0.02, "revenue": 30.0}
    # bare aliases / run_id must not leak into aggregates
    assert "run_id" not in patch["aggregate_kpis"]
    assert patch["ended_at"].endswith("Z")


def test_legacy_result_shape():
    kpis = {"source": "worker", "mean_fill_rate": 0.8, "ci_fill_rate": 0.05}
    patch = build_run_update(kpis, n_reps=10)

    assert patch["code_version"] == "worker-legacy"
    assert patch["aggregate_kpis"]["_meta"] == {"engine": "worker"}
    assert "scsim_notes" not in patch["aggregate_kpis"]["_meta"]


def test_missing_source_defaults_to_worker():
    patch = build_run_update({"mean_x": 1.0}, n_reps=1)
    assert patch["code_version"] == "worker-legacy"
    assert patch["aggregate_kpis"]["_meta"]["engine"] == "worker"
