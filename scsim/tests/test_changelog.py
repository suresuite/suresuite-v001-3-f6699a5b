"""The engine's change record and its gate — PLAN.md §25 · WP 15.4 · gate `engine-ledger`.

`scsim/CHANGELOG.yaml` is the one place an engine version's meaning is authored.
These tests hold the committed file to rules 1 and 4 and the entry schema, and
MUTATION-TEST every rule of the gate: each mutation below is a way the record
could lie, and each must turn the gate red. A rule no mutation can break is a
rule nobody has shown to work.
"""
from __future__ import annotations

import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path

import pytest

from scsim import ENGINE_VERSION

_SPEC = importlib.util.spec_from_file_location(
    "engine_changelog", Path(__file__).resolve().parents[1] / "scripts" / "engine_changelog.py")
ec = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(ec)

ENTRIES = ec.load_entries(ec.CHANGELOG.read_text())


def _static(entries, version=ENGINE_VERSION):
    return ec.check_entries(entries, version, policy_ids=ec.known_policy_ids(), kpis=ec.known_kpis(),
                            goldens=ec.golden_names(), adr_numbers=ec._adr_numbers())


def _new_entry(version: str, **over):
    e = {
        "version": version, "date": dt.date(2026, 10, 4), "commit": None, "tier": 2, "adr": None,
        "summary": "s", "technical": "t", "policies": ["P-P.1"], "kpis": ["fill_rate"],
        "goldens_moved": [], "comparable": "changed-for", "comparability": "c", "refs": [],
        "amendments": [],
    }
    e.update(over)
    return e


GOLDEN_E = json.loads(ec.GOLDEN_ENGINE.read_text())
GOLDEN_W = json.loads(ec.GOLDEN_WORKER.read_text())
SCHEMA = ec.PIPELINE_SCHEMA.read_text()


def _history(head_entries, *, head_version, base_version=ENGINE_VERSION, base_entries=None,
             head_e=None, head_w=None, head_schema=None, src_changed=False):
    return ec.check_history(
        head_version=head_version, head_entries=head_entries,
        base_version=base_version, base_entries=ENTRIES if base_entries is None else base_entries,
        base_golden_engine=GOLDEN_E, head_golden_engine=head_e or GOLDEN_E,
        base_golden_worker=GOLDEN_W, head_golden_worker=head_w or GOLDEN_W,
        base_schema=SCHEMA, head_schema=head_schema or SCHEMA,
        engine_src_changed=src_changed,
    )


def _moved_engine():
    g = dict(GOLDEN_E)
    name = sorted(g)[0]
    g[name] = "0" * 64
    return g, f"engine:{name}"


# ── the committed record ─────────────────────────────────────────────────────

def test_the_committed_record_holds():
    assert _static(ENTRIES) == []


def test_the_running_version_is_the_newest_entry():
    assert ENTRIES[0]["version"] == ENGINE_VERSION


def test_every_version_since_the_first_is_described():
    # The backfill reached 0.1.0 (WP 15.4, from the full history). A gap would be a
    # version some result carries and no page can explain.
    assert ENTRIES[-1]["version"] == "0.1.0"
    assert len({e["version"] for e in ENTRIES}) == len(ENTRIES)


def test_the_generated_views_are_current():
    assert ec.render_markdown(ENTRIES) == ec.OUT_MD.read_text()
    assert ec.render_ts(ENTRIES) == ec.OUT_TS.read_text()


# ── rule 1: a version is described ───────────────────────────────────────────

def test_rule_1_a_bump_with_no_entry_fails():
    assert any("rule 1" in e for e in _static(ENTRIES, version="9.9.9"))


def test_rule_1_entries_out_of_order_fail():
    bad = copy.deepcopy(ENTRIES)
    bad[0], bad[1] = bad[1], bad[0]
    assert any("DESCEND" in e for e in _static(bad))


def test_rule_1_a_duplicate_version_fails():
    bad = [copy.deepcopy(ENTRIES[0])] + copy.deepcopy(ENTRIES)
    assert any("appears twice" in e for e in _static(bad))


# ── the schema ───────────────────────────────────────────────────────────────

def test_a_tier_3_entry_without_an_adr_fails():
    bad = [_new_entry("0.7.0", tier=3, adr=None)] + copy.deepcopy(ENTRIES)
    assert any("names its ADR" in e for e in _static(bad, "0.7.0"))


def test_a_tier_3_entry_as_a_patch_fails():
    bad = [_new_entry("0.6.2", tier=3, adr="0002")] + copy.deepcopy(ENTRIES)
    assert any("minor or major bump" in e for e in _static(bad, "0.6.2"))


def test_an_unknown_policy_or_kpi_fails():
    bad = [_new_entry("0.6.2", policies=["P-P.99"], kpis=["happiness"])] + copy.deepcopy(ENTRIES)
    errs = _static(bad, "0.6.2")
    assert any("P-P.99" in e for e in errs) and any("happiness" in e for e in errs)


def test_a_new_entry_may_not_leave_goldens_moved_unknown():
    bad = [_new_entry("0.6.2", goldens_moved=None)] + copy.deepcopy(ENTRIES)
    assert any("backfilled" in e for e in _static(bad, "0.6.2"))


def test_a_new_entry_may_not_count_unrecorded_changes():
    bad = [_new_entry("0.6.2", unrecorded_changes=3)] + copy.deepcopy(ENTRIES)
    assert any("recorded, not counted" in e for e in _static(bad, "0.6.2"))


def test_an_all_digit_commit_left_unquoted_fails():
    bad = copy.deepcopy(ENTRIES)
    bad[0]["commit"] = 25127133  # what YAML makes of an unquoted all-digit sha
    assert any("quote it" in e for e in _static(bad))


def test_a_tier_3_amendment_fails():
    bad = copy.deepcopy(ENTRIES)
    bad[0]["amendments"].append({"date": dt.date(2026, 10, 4), "commit": None, "tier": 3, "summary": "x"})
    assert any("cannot be an amendment" in e for e in _static(bad))


# ── rule 4: identical means nothing moved ────────────────────────────────────

def test_rule_4_identical_while_a_golden_moved_fails():
    bad = [_new_entry("0.6.2", goldens_moved=["engine:g1_steady"], comparable="identical")] \
        + copy.deepcopy(ENTRIES)
    assert any("rule 4" in e for e in _static(bad, "0.6.2"))


# ── rule 2: moved means bumped, and listed exactly ───────────────────────────

def test_rule_2_a_moved_digest_with_no_bump_fails():
    head_e, _ = _moved_engine()
    assert any("rule 2" in e for e in _history(ENTRIES, head_version=ENGINE_VERSION, head_e=head_e))


def test_rule_2_an_incomplete_goldens_moved_fails():
    head_e, moved = _moved_engine()
    head = [_new_entry("0.6.2", goldens_moved=[])] + copy.deepcopy(ENTRIES)
    assert any("rule 2" in e for e in _history(head, head_version="0.6.2", head_e=head_e))


def test_rule_2_holds_when_the_entry_names_exactly_what_moved():
    head_e, moved = _moved_engine()
    head = [_new_entry("0.6.2", goldens_moved=[moved])] + copy.deepcopy(ENTRIES)
    assert _history(head, head_version="0.6.2", head_e=head_e) == []


def test_rule_2_a_reworded_worker_warning_is_not_a_moved_run():
    head_w = copy.deepcopy(GOLDEN_W)
    case = sorted(head_w)[0]
    head_w[case]["mapping_warnings"] = ["reworded"]
    assert _history(ENTRIES, head_version=ENGINE_VERSION, head_w=head_w) == []


def test_rule_2_a_moved_worker_digest_is_named_with_its_prefix():
    head_w = copy.deepcopy(GOLDEN_W)
    case = sorted(head_w)[0]
    head_w[case]["sha256"] = "f" * 64
    assert ec.moved_goldens(GOLDEN_W, head_w, "worker") == [f"worker:{case}"]


# ── rule 3: a contract change is Tier 3 ──────────────────────────────────────

def _changed_schema():
    d = json.loads(SCHEMA)
    d["phases"][0]["owns"] = d["phases"][0]["owns"] + ["new_key"]
    return json.dumps(d)


def test_rule_3_a_schema_change_marked_tier_2_fails():
    head = [_new_entry("0.7.0")] + copy.deepcopy(ENTRIES)
    assert any("rule 3" in e for e in _history(head, head_version="0.7.0", head_schema=_changed_schema()))


def test_rule_3_a_schema_change_with_no_bump_fails():
    assert any("rule 3" in e for e in _history(ENTRIES, head_version=ENGINE_VERSION,
                                               head_schema=_changed_schema()))


def test_rule_3_only_the_version_stamp_changing_is_not_a_contract_change():
    d = json.loads(SCHEMA)
    d["engine_version"] = "9.9.9"
    head = [_new_entry("0.6.2")] + copy.deepcopy(ENTRIES)
    assert _history(head, head_version="0.6.2", head_schema=json.dumps(d)) == []


# ── rule 6: an unbumped engine change is recorded ────────────────────────────

def test_rule_6_engine_source_changed_with_no_bump_and_no_amendment_fails():
    assert any("rule 6" in e for e in _history(ENTRIES, head_version=ENGINE_VERSION, src_changed=True))


def test_rule_6_holds_with_an_appended_amendment():
    head = copy.deepcopy(ENTRIES)
    head[0]["amendments"].append({"date": dt.date(2026, 10, 4), "commit": None, "tier": 1,
                                  "summary": "a refactor"})
    assert _history(head, head_version=ENGINE_VERSION, src_changed=True) == []


# ── rule 7: append-only ──────────────────────────────────────────────────────

def test_rule_7_rewriting_a_published_entry_fails():
    head = copy.deepcopy(ENTRIES)
    head[3]["comparable"] = "identical"
    assert any("rule 7" in e for e in _history(head, head_version=ENGINE_VERSION))


def test_rule_7_removing_a_published_entry_fails():
    head = copy.deepcopy(ENTRIES)[:-1]
    assert any("rule 7" in e for e in _history(head, head_version=ENGINE_VERSION))


def test_rule_7_editing_an_amendment_fails():
    head = copy.deepcopy(ENTRIES)
    head[0]["amendments"][0]["summary"] = "something else"
    assert any("rule 7" in e for e in _history(head, head_version=ENGINE_VERSION))


def test_rule_7_completing_a_null_commit_is_allowed():
    base = [_new_entry("0.6.2")] + copy.deepcopy(ENTRIES)
    head = copy.deepcopy(base)
    head[0]["commit"] = "abcdef12"
    assert _history(head, head_version="0.6.2", base_version="0.6.2", base_entries=base) == []


# ── rule 8: the record does not understate its measured effect (WP 15.5) ─────

_RR = importlib.util.spec_from_file_location(
    "release_report", Path(__file__).resolve().parents[1] / "scripts" / "release_report.py")
rr = importlib.util.module_from_spec(_RR)
_RR.loader.exec_module(rr)


def _report(version, changed=(), moved=()):
    return {"version": version, "previous_version": "0.0.1", "changed": list(changed), "moved": list(moved)}


def test_rule_8_identical_while_the_report_shows_a_change_fails():
    e = _new_entry("0.6.2", comparable="identical", policies=[], kpis=[])
    assert any("rule 8" in x for x in ec.check_release(e, _report("0.6.2", changed=["fill_rate"])))


def test_rule_8_a_moved_kpi_the_entry_does_not_name_fails():
    e = _new_entry("0.6.2", kpis=["fill_rate"])
    errs = ec.check_release(e, _report("0.6.2", changed=["fill_rate", "revenue"], moved=["fill_rate", "revenue"]))
    assert any("revenue" in x and "understates" in x for x in errs)


def test_rule_8_holds_when_the_entry_names_what_moved_or_says_not_comparable():
    rep = _report("0.6.2", changed=["revenue"], moved=["revenue"])
    assert ec.check_release(_new_entry("0.6.2", kpis=["revenue"]), rep) == []
    assert ec.check_release(_new_entry("0.6.2", comparable="not-comparable"), rep) == []


def test_rule_8_a_report_for_another_version_fails():
    assert any("rule 8" in x for x in ec.check_release(_new_entry("0.6.2"), _report("0.6.1")))


def test_the_committed_report_and_record_agree():
    rel = ec.RELEASES / f"{ENGINE_VERSION}.json"
    assert rel.exists(), "every version from 0.6.1 on has a release report (WP 15.5)"
    assert ec.check_release(ENTRIES[0], json.loads(rel.read_text())) == []


def test_the_report_tells_identical_moved_and_noise_apart():
    same = [{"fill_rate": 0.9}, {"fill_rate": 0.8}, {"fill_rate": 0.85}]
    assert rr.compare(same, same, "fill_rate")["verdict"] == "identical"
    shifted = [{"fill_rate": x["fill_rate"] + 0.05} for x in same]
    assert rr.compare(same, shifted, "fill_rate")["verdict"] == "moved"
    noisy = [{"fill_rate": 0.9 + d} for d in (0.01, -0.012, 0.004)]
    assert rr.compare(same[:1] * 3, noisy, "fill_rate")["verdict"] == "within noise"
    # A KPI one side could not measure (None) is dropped pairwise, never read as 0.
    gaps = rr.compare([{"ttr_weeks": None}, {"ttr_weeks": 3.0}], [{"ttr_weeks": 4.0}, {"ttr_weeks": 3.0}], "ttr_weeks")
    assert gaps["n"] == 1 and gaps["verdict"] == "identical"

