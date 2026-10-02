"""The offline demo answers like the live API, and refuses what it has not recorded."""
import pytest

FRAME = {"horizon_days": 364, "replications": 10, "seed": 42, "crn": True}
S2 = [{"target": "S2", "start_day": 140, "duration_days": 42, "magnitude_pct": 100}]


def test_demo_keys_match_the_recorder(lib, demo_data):
    import record_demo

    for label, policies, schedule in record_demo.RECORDINGS:
        assert lib["_demo_key"](policies, schedule, record_demo.FRAME) == record_demo.demo_key(
            policies, schedule, record_demo.FRAME), label
    for rec in demo_data["recordings"]:
        assert rec["key"] == lib["_demo_key"](rec["policies"], rec["disruption_schedule"], record_demo.FRAME)


def _setup(api):
    pid = api.projects()[0]["id"]
    base = next(s for s in api.scenarios(pid) if not s["disruption_schedule"])
    return pid, base


def test_baseline_end_to_end(lib, demo):
    pid, base = _setup(demo)
    version = demo.snapshot_policies(pid, "baseline")
    run = demo.run_and_wait(pid, base["id"], version["id"])
    assert run["status"] == "done"
    assert set(run) == set(lib["RUN_FIELDS"])
    assert "_meta" in run["aggregate_kpis"] and "_range" in run["aggregate_kpis"]

    table = lib["kpi_table"](run)
    assert "fill_rate" in table.index and "_meta" not in table.index
    assert table.loc["fill_rate", "measure"] == "Fill rate (α)"

    reps = demo.replications(run["id"])
    assert len(reps) == 10 and [r["rep_index"] for r in reps] == list(range(10))
    series = demo.series(run["id"])
    assert len(series) == 10 * 52 and {"week", "fill_rate", "backlog_units"} <= set(series.columns)


def test_idempotent_replay_and_reuse(demo):
    pid, base = _setup(demo)
    v = demo.snapshot_policies(pid, "baseline")
    a = demo.dispatch(pid, base["id"], v["id"])
    b = demo.dispatch(pid, base["id"], v["id"])
    assert a["id"] == b["id"]  # same inputs, same idempotency key, same run
    demo.wait(a["id"])
    c = demo.dispatch(pid, base["id"], v["id"], force_rerun=True)  # a different body → a new key
    assert c["id"] != a["id"]


def test_policy_version_is_content_addressed(demo):
    pid, _ = _setup(demo)
    v1 = demo.snapshot_policies(pid, "first")
    v2 = demo.snapshot_policies(pid, "second")
    assert v1["id"] == v2["id"] and v2["label"] == "first"


def test_editing_policies_restores(lib, demo):
    pid, _ = _setup(demo)
    with lib["editing_policies"](demo, pid):
        demo.set_policy(pid, "inventory", safety_stock_method="fixed_days", safety_stock_days=28)
        assert demo.policy_defaults(pid)["inventory"]["safety_stock_days"] == 28
    assert demo.policy_defaults(pid)["inventory"] == {}


def test_restore_happens_even_when_the_block_fails(lib, demo):
    pid, _ = _setup(demo)
    with pytest.raises(RuntimeError):
        with lib["editing_policies"](demo, pid):
            demo.set_policy(pid, "fulfillment", backorder_allowed=True)
            raise RuntimeError("a run failed")
    assert demo.policy_defaults(pid)["fulfillment"] == {}


def test_material_target_is_stopped_by_the_gate(lib, demo):
    pid, _ = _setup(demo)
    v = demo.snapshot_policies(pid, "baseline")
    sc = demo.create_scenario(pid, "material", horizon_days=364, disruption_schedule=[
        {"target": "material:M2", "start_day": 140, "duration_days": 42, "magnitude_pct": 100}])
    with pytest.raises(lib["SuReSuiteError"]) as e:
        demo.dispatch(pid, sc["id"], v["id"])
    assert e.value.status == 422 and e.value.details["validation"] == "ack_required"
    assert "cannot disrupt material targets" in e.value.details["findings"][0]["message"]

    # acknowledged, the event is skipped — and the guard says so instead of a stress result
    run = demo.run_and_wait(pid, sc["id"], v["id"], acknowledge_warnings=True)
    with pytest.raises(AssertionError, match="no disruption reached the engine"):
        lib["assert_disruption_applied"](demo.replications(run["id"]))


def test_supplier_outage_applies(lib, demo):
    pid, _ = _setup(demo)
    v = demo.snapshot_policies(pid, "baseline")
    sc = demo.create_scenario(pid, "S2 outage", horizon_days=364, disruption_schedule=S2)
    run = demo.run_and_wait(pid, sc["id"], v["id"])
    lib["assert_disruption_applied"](demo.replications(run["id"]))
    assert run["aggregate_kpis"]["fill_rate"] < 1.0


def test_unrecorded_combination_is_refused_not_invented(lib, demo):
    pid, _ = _setup(demo)
    demo.set_policy(pid, "inventory", safety_stock_days=99)
    v = demo.snapshot_policies(pid, "odd")
    base = next(s for s in demo.scenarios(pid) if not s["disruption_schedule"])
    with pytest.raises(lib["SuReSuiteError"]) as e:
        demo.dispatch(pid, base["id"], v["id"])
    assert e.value.code == "demo_no_recording"


def test_unknown_fields_are_rejected_like_the_gateway(lib, demo):
    pid, _ = _setup(demo)
    with pytest.raises(lib["SuReSuiteError"]) as e:
        demo.create_scenario(pid, "x", warmup_mode="manual")
    assert e.value.status == 400
    with pytest.raises(lib["SuReSuiteError"]):
        demo.put(f"/projects/{pid}/policies", {"defaults": {"not_a_family": {}}})


def test_other_projects_read_as_not_found(lib, demo):
    with pytest.raises(lib["SuReSuiteError"]) as e:
        demo.project("00000000-0000-0000-0000-000000000000")
    assert (e.value.status, e.value.code) == (404, "project_not_found")
