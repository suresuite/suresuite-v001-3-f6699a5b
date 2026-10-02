# ── SuReSuite notebook library ──────────────────────────────────────────────
# The `suresuite` Python package's client (python/suresuite/client.py), inlined
# into each notebook by scripts/notebooks/build-notebooks.mjs. Run this cell;
# you do not need to read it. It defines:
#   connect()                      the API client (live, or the offline demo)
#   api.run_and_wait(...)          dispatch a simulation run and poll it to the end
#   kpi_table / replications_frame / paired_compare / assert_disruption_applied
#   editing_policies(...)          edit policies and ALWAYS put them back
#   plot_kpis / plot_series        small, honest charts
# Every helper talks to the public /v1 API the same way in live and demo mode.
import base64
import contextlib
import copy
import hashlib
import io
import json
import math
import re
import time
import uuid
import zlib

import pandas as pd
import requests

try:  # the charts need matplotlib; the package works without it (`pip install suresuite[plots]`)
    import matplotlib.pyplot as plt
except ImportError:  # pragma: no cover - exercised only without the extra
    plt = None

try:  # as the `suresuite` package; in a notebook the KPI_DISPLAY cell is inlined below instead
    from .kpi_display import KPI_DISPLAY
except ImportError:
    pass

FAMILIES = ("sourcing", "inventory", "transport", "fulfillment", "production", "recovery", "demand")
TERMINAL = ("done", "failed", "cancelled")  # a run's lifecycle: queued → running → done | failed | cancelled
PALETTE = ["#2a78d6", "#eda100", "#008300", "#e87ba4", "#7a5af8", "#5f6b7a"]  # fixed order per series
T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262,
       10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131, 16: 2.12, 17: 2.11,
       18: 2.101, 19: 2.093, 20: 2.086, 21: 2.08, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06,
       26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042}
_MONEY = {"symbol": "€"}  # replaced by the engine's declared unit when the catalog is read


class SuReSuiteError(RuntimeError):
    """The API's error envelope {"error": {"code", "message", "details"}} as an exception."""

    def __init__(self, status, code, message, details=None, request_id=None):
        super().__init__(f"[{status} {code}] {message}")
        self.status, self.code, self.message = status, code, message
        self.details, self.request_id = details, request_id


# ── transports: how a request reaches the platform ──────────────────────────
class HttpTransport:
    """The real thing: HTTPS to the /v1 gateway with your key."""

    def __init__(self, base_url, api_key, timeout=60):
        self.base = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {api_key}"

    def request(self, method, path, params=None, body=None, headers=None):
        r = self.session.request(method, self.base + path, params=params, json=body,
                                 headers=headers or {}, timeout=self.timeout)
        try:
            payload = r.json() if r.content else {}
        except ValueError:  # an HTML error page from a proxy, say
            payload = {"error": {"code": "non_json_response", "message": r.text[:200]}}
        return r.status_code, dict(r.headers), payload

    def fetch(self, url):
        # A signed storage URL carries its own authorization: never send the API key to it.
        r = requests.get(url, timeout=self.timeout)
        r.raise_for_status()
        return r.content


class SuReSuite:
    """Client for the SuReSuite public /v1 API."""

    def __init__(self, transport, live):
        self.t, self.live = transport, live
        self._catalog = {}

    # ── plumbing ──
    def _call(self, method, path, params=None, body=None, headers=None, retries=4):
        for attempt in range(retries + 1):
            try:
                status, hdrs, payload = self.t.request(method, path, params=params, body=body, headers=headers)
            except requests.RequestException as e:  # network trouble: retry with backoff, then give up
                if attempt == retries:
                    raise
                wait = 2 ** (attempt + 1)
                print(f"  network error ({type(e).__name__}) — retrying in {wait}s")
                time.sleep(wait)
                continue
            err = (payload or {}).get("error") or {} if status >= 400 else {}
            if status == 429 and err.get("code") in ("rate_limited", "too_many_failed_auths") and attempt < retries:
                wait = min(int(hdrs.get("Retry-After", "5") or 5), 60)
                print(f"  rate-limited — waiting {wait}s")
                time.sleep(wait)
                continue
            if status in (502, 503, 504) and attempt < retries:
                time.sleep(2 ** (attempt + 1))
                continue
            remaining = hdrs.get("X-RateLimit-Remaining")
            if remaining is not None and remaining.isdigit() and int(remaining) <= 5:
                print(f"  note: {remaining} requests left in this key's rate-limit window")
            if status >= 400:
                raise SuReSuiteError(status, err.get("code", "unknown"), err.get("message", ""),
                                     err.get("details"), hdrs.get("X-Request-Id"))
            return payload
        raise RuntimeError("unreachable")

    def get(self, path, **params):
        return self._call("GET", path, params={k: v for k, v in params.items() if v is not None} or None)

    def post(self, path, body=None, idempotency_key=None):
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
        return self._call("POST", path, body=body or {}, headers=headers)

    def put(self, path, body):
        return self._call("PUT", path, body=body)

    def list_all(self, path, limit=100, **params):
        """Follow cursor pagination (?limit=&cursor=) until the last page."""
        rows, cursor = [], None
        while True:
            page = self.get(path, limit=limit, cursor=cursor, **params)
            rows += page["data"]
            cursor = page.get("next_cursor")
            if not cursor:
                return rows

    # ── projects and input data ──
    def projects(self):
        return self.list_all("/projects")

    def project(self, project_id):
        return self.get(f"/projects/{project_id}")

    def dataset_versions(self, project_id):
        return self.get(f"/projects/{project_id}/dataset-versions")["data"]

    def freeze_dataset(self, project_id, label=None):
        return self.post(f"/projects/{project_id}/datasets:freeze", {"label": label} if label else {})

    # ── policies ──
    def catalog(self, project_id):
        if project_id not in self._catalog:
            cat = self.get(f"/projects/{project_id}/policy-catalog")
            money = {k["unit"] for k in cat.get("kpis") or [] if k.get("name") in ("revenue", "lost_sales_value")}
            if len(money) == 1:
                _MONEY["symbol"] = money.pop()
            self._catalog[project_id] = cat
        return self._catalog[project_id]

    def policies(self, project_id):
        return self.get(f"/projects/{project_id}/policies")

    def policy_defaults(self, project_id):
        """The seven policy families, each a dict ({} = engine defaults)."""
        d = self.policies(project_id)["defaults"] or {}
        return {f: dict(d.get(f) or {}) for f in FAMILIES}

    def set_policy(self, project_id, family, **fields):
        """Change some fields of ONE family. PUT replaces a family as a whole, so this
        reads the family, merges your fields in, and writes the whole family back."""
        if family not in FAMILIES:
            raise ValueError(f"family must be one of {FAMILIES}")
        merged = {**self.policy_defaults(project_id)[family], **fields}
        self.put(f"/projects/{project_id}/policies", {"defaults": {family: merged}})
        return merged

    def snapshot_policies(self, project_id, label):
        """An immutable policy version. An unchanged configuration returns the version
        that already holds it (content-addressed), so the label may be an older one."""
        return self.post(f"/projects/{project_id}/policy-versions", {"label": label})

    def dataset_version(self, project_id, version="latest", tables=None):
        """One frozen dataset version WITH its rows (`snapshot`): exactly what a run
        reads. `version` is an id or "latest"; `tables` narrows it."""
        return self.get(f"/projects/{project_id}/dataset-versions/{version}",
                        tables=",".join(tables) if tables else None)

    def policy_version(self, project_id, version="latest"):
        """One frozen policy version with its `snapshot` and `policy_hash`."""
        return self.get(f"/projects/{project_id}/policy-versions/{version}")

    def engine(self):
        """The engine's wheels: sha256, size and a short-lived signed URL each."""
        return self.get("/engine")

    def policy_versions(self, project_id):
        return self.get(f"/projects/{project_id}/policy-versions")["data"]

    # ── scenarios ──
    def scenarios(self, project_id):
        return self.list_all(f"/projects/{project_id}/scenarios")

    def create_scenario(self, project_id, name, **fields):
        return self.post(f"/projects/{project_id}/scenarios", {"name": name, **fields})

    # ── runs ──
    def run(self, run_id):
        return self.get(f"/runs/{run_id}")

    def replications(self, run_id):
        return self.list_all(f"/runs/{run_id}/replications")

    def validation(self, run_id):
        return self.get(f"/runs/{run_id}/validation")

    def cancel(self, run_id):
        return self.post(f"/runs/{run_id}:cancel")

    def series(self, run_id):
        """Every weekly series of a run as ONE long table:
        rep_index · model_rep · event_rep · week · one column per series."""
        page = self.get(f"/runs/{run_id}/replications", include="time_series", limit=100)
        where = page.get("series") or {}
        if where.get("location") == "object" and where.get("url"):
            blob = self.t.fetch(where["url"])  # live: Parquet bytes; demo: a column table
            return pd.read_parquet(io.BytesIO(blob)) if isinstance(blob, (bytes, bytearray)) else pd.DataFrame(blob)
        if where.get("location") == "expired":
            raise SuReSuiteError(410, "series_expired",
                                 "this run's weekly series have expired; re-run its RunKey to reproduce them",
                                 where)
        rows = []  # an older run keeps its series on each replication row
        for rep in self.list_all(f"/runs/{run_id}/replications", include="time_series"):
            ts = rep.get("time_series") or {}
            for week in range(max((len(v) for v in ts.values()), default=0)):
                rows.append({"rep_index": rep["rep_index"], "model_rep": (rep.get("kpis") or {}).get("model_rep"),
                             "event_rep": (rep.get("kpis") or {}).get("event_rep"), "week": week,
                             **{k: (v[week] if week < len(v) else None) for k, v in ts.items()}})
        return pd.DataFrame(rows)

    def dispatch(self, project_id, scenario_id, policy_version_id, *, acknowledge_warnings=False,
                 force_rerun=False, idempotency_key=None):
        """POST a run. Returns the run row (a reused one on 409, if you allow reuse)."""
        body = {"scenario_id": scenario_id, "policy_version_id": policy_version_id}
        if acknowledge_warnings:
            body["acknowledge_warnings"] = True
        if force_rerun:
            body["force_rerun"] = True
        # The key is derived from WHAT you ask for: re-running this cell replays the
        # same run, and changing any input dispatches a new one.
        key = idempotency_key or "nb-" + hashlib.sha256(
            json.dumps({"project": project_id, **body}, sort_keys=True).encode()).hexdigest()[:40]
        try:
            submitted = self.post(f"/projects/{project_id}/runs", body, idempotency_key=key)
        except SuReSuiteError as e:
            if e.code == "reuse_available":
                cand = (e.details or {}).get("reuse_candidate") or {}
                print(f"identical completed run already exists — reusing {cand.get('run_id')} "
                      f"(pass force_rerun=True to compute it again)")
                return self.run(cand["run_id"])
            if e.code == "validation_failed":
                d = e.details or {}
                print("the pre-run data gate stopped this run:")
                for f in d.get("findings") or []:
                    print(f"  - [{f.get('severity')}] {f.get('message')}")
                if d.get("validation") == "ack_required":
                    print("these are warnings: if they are acceptable, dispatch again with acknowledge_warnings=True")
            raise
        print(f"run {submitted['run_id']} dispatched ({submitted['status']})")
        return self.run(submitted["run_id"])

    def wait(self, run_id, timeout_seconds=1800):
        """Poll a run until it is done, failed or cancelled (backoff 3 s → 30 s)."""
        started, delay = time.time(), 3.0
        while True:
            run = self.run(run_id)
            if run["status"] in TERMINAL:
                print(f"\n→ {run['status']} after {time.time() - started:.0f}s"
                      f" — {run.get('rep_count_done') or 0} replications")
                if run["status"] == "failed":
                    print("error:", run.get("error_message"))
                return run
            done, target = run.get("rep_count_done") or 0, run.get("rep_count_target") or "?"
            print(f"  {run['status']} — replication {done}/{target}   ", end="\r")
            if time.time() - started > timeout_seconds:
                raise TimeoutError(f"run {run_id} still {run['status']} after {timeout_seconds}s")
            if self.live:
                time.sleep(delay)
                delay = min(delay * 1.5, 30.0)

    def run_and_wait(self, project_id, scenario_id, policy_version_id, **kw):
        run = self.dispatch(project_id, scenario_id, policy_version_id, **kw)
        return run if run["status"] in TERMINAL else self.wait(run["id"])


# ── results as tables ───────────────────────────────────────────────────────
def _fmt(kind, v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "—"
    if kind == "pct2":
        return f"{v * 100:.2f}%"
    if kind == "pct1":
        return f"{v * 100:.1f}%"
    if kind == "money":
        return f"{'-' if v < 0 else ''}{_MONEY['symbol']}{abs(v):,.0f}"
    if kind == "units":
        return f"{v:,.0f}"
    if kind.startswith("fixed"):
        return f"{v:.{int(kind[5:] or 2)}f}"
    return f"{v:,.4g}"


def kpi_label(key):
    return KPI_DISPLAY.get(key, (key, "num", None))[0]


def fmt_kpi(key, value):
    return _fmt(KPI_DISPLAY.get(key, (key, "num", None))[1], value)


def _numeric(d):
    return {k: v for k, v in (d or {}).items()
            if not k.startswith("_") and isinstance(v, (int, float)) and not isinstance(v, bool)
            and not math.isnan(v)}


def _order(keys):
    rank = {k: i for i, k in enumerate(KPI_DISPLAY)}
    return sorted(keys, key=lambda k: (rank.get(k, 10_000), k))


def kpi_table(run, kpis=None):
    """A run's aggregate KPIs: mean ± 95 % CI half-width, labelled and formatted the way
    the Simulation Lab shows them. Measures the engine did not produce are left out."""
    agg, ci = _numeric(run.get("aggregate_kpis")), run.get("ci_half_widths") or {}
    keys = [k for k in (kpis or _order(agg)) if k in agg]
    return pd.DataFrame([{"kpi": k, "measure": kpi_label(k), "mean": fmt_kpi(k, agg[k]),
                          "± 95% CI": fmt_kpi(k, ci.get(k)) if ci.get(k) is not None else "—",
                          "value": agg[k]} for k in keys]).set_index("kpi")


def replications_frame(replications):
    """One row per replication: rep_index, model_rep, event_rep and every KPI."""
    return pd.DataFrame([{"rep_index": r["rep_index"], **(r.get("kpis") or {})} for r in replications]
                        ).set_index("rep_index").sort_index()


def capacity_binding(run):
    """Which products / suppliers capacity held back, if any (from the run's _meta)."""
    return ((run.get("aggregate_kpis") or {}).get("_meta") or {}).get("capacity_binding")


def assert_disruption_applied(replications):
    """A disruption that reached the engine leaves recovery measures on every replication.
    None of them means every event was SKIPPED (a target the engine cannot disrupt) and
    the run is really a baseline — say so instead of reporting its KPIs as a stress test."""
    if not any("recovery_measurable" in (r.get("kpis") or {}) for r in replications):
        raise AssertionError(
            "no disruption reached the engine: every event was skipped. A target must be one of "
            "this project's supplier ids or the plant (\"plant\") — material, customer and lane "
            "targets are not supported by the engine yet.")
    print("disruption applied — recovery measures are present on the replications")


def paired_compare(reps_a, reps_b, kpis=None, labels=("A", "B")):
    """B − A per KPI, paired replication by replication on the common-random-numbers
    cell (model_rep, event_rep) — the Simulation Lab's Compare rule. A direction
    ("better" / "worse") is drawn only when the 95 % interval of the paired
    difference excludes zero; otherwise the honest answer is "no clear difference"."""

    def key(r):
        k = r.get("kpis") or {}
        return (f"m{int(k['model_rep'])}:e{int(k.get('event_rep') or 0)}"
                if isinstance(k.get("model_rep"), (int, float)) else f"i{r['rep_index']}")

    a_by = {key(r): r for r in reps_a if r.get("status", "done") == "done"}
    keys = kpis or _order(set().union(*[_numeric(r.get("kpis")).keys() for r in reps_a])
                          - {"model_rep", "event_rep", "recovery_measurable", "ttr_censored", "tts_censored"})
    rows = []
    for kpi in keys:
        diffs, va_all, vb_all = [], [], []
        for r in reps_b:
            a = a_by.get(key(r))
            va = _numeric((a or {}).get("kpis")).get(kpi)
            vb = _numeric(r.get("kpis")).get(kpi)
            if a is not None and va is not None and vb is not None and r.get("status", "done") == "done":
                diffs.append(vb - va)
                va_all.append(va)
                vb_all.append(vb)
        n = len(diffs)
        if n < 2:
            continue
        m = sum(diffs) / n
        sd = math.sqrt(sum((d - m) ** 2 for d in diffs) / (n - 1))
        hw = (T95.get(n - 1, 1.96) * sd) / math.sqrt(n)
        separated = abs(m) > hw
        direction = KPI_DISPLAY.get(kpi, (kpi, "num", None))[2]
        if not separated:
            verdict = "no clear difference"
        elif direction is None:
            verdict = "higher" if m > 0 else "lower"
        else:
            verdict = f"{labels[1]} better" if (m > 0) == direction else f"{labels[1]} worse"
        rows.append({"kpi": kpi, "measure": kpi_label(kpi),
                     labels[0]: fmt_kpi(kpi, sum(va_all) / n), labels[1]: fmt_kpi(kpi, sum(vb_all) / n),
                     f"{labels[1]} − {labels[0]}": f"{'+' if m >= 0 else '-'}{fmt_kpi(kpi, abs(m))} ± {fmt_kpi(kpi, hw)}",
                     "pairs": n, "verdict": verdict, "delta": m, "half_width": hw})
    return pd.DataFrame(rows).set_index("kpi") if rows else pd.DataFrame()


@contextlib.contextmanager
def editing_policies(api, project_id):
    """Edit the project's live policy defaults inside this block; they are put back
    exactly as they were when the block ends — even if a run fails. (Per-node
    overrides are not touched: the API has no way to delete one.)"""
    original = api.policy_defaults(project_id)
    try:
        yield original
    finally:
        api.put(f"/projects/{project_id}/policies", {"defaults": original})
        print("policies restored to their original values")


# ── picking what to work on ─────────────────────────────────────────────────
FRAME_FIELDS = ("horizon_days", "warmup_days", "replications", "seed", "crn", "primary_kpi")


def pick_project(api, project_id=""):
    """The configured project, or the first one this key can see."""
    projects = api.projects()
    if not projects:
        raise SystemExit("this key can see no projects — check its organization and project restriction on /developer")
    project = api.project(project_id) if project_id else projects[0]
    print(f"project: {project['name']}  ({project['id']})")
    return project


def baseline_scenario(api, project_id, scenario_id=""):
    """The configured scenario, else the newest one WITHOUT disruptions, else a new
    52-week baseline (the Simulation Lab's defaults: 364 days, 10 replications,
    seed 42, common random numbers on)."""
    scenarios = api.scenarios(project_id)
    if scenario_id:
        sc = next(s for s in scenarios if s["id"] == scenario_id)
    else:
        sc = next((s for s in scenarios if not s.get("disruption_schedule")), None)
        if sc is None:
            created = api.create_scenario(project_id, "Notebook baseline", description="52 weeks, no disruption",
                                          horizon_days=364, replications=10, seed=42, crn=True)
            sc = next(s for s in api.scenarios(project_id) if s["id"] == created["id"])
            print("created a baseline scenario")
    if sc.get("disruption_schedule"):
        print("note: this scenario already has disruptions — it is not a clean baseline")
    if (sc.get("horizon_days") or 0) < 364:
        print(f"note: horizon_days={sc.get('horizon_days')} runs as 52 weeks — the engine's minimum horizon")
    print(f"scenario: {sc['name']}  ({sc['id']}) — {sc['horizon_days']} days, {sc['replications']} replications, "
          f"seed {sc['seed']}, CRN {'on' if sc.get('crn') else 'off'}")
    return sc


def stress_scenario(api, project_id, base, events, name):
    """`base`'s frame (horizon, replications, seed, CRN) plus a disruption schedule.
    Reuses an existing scenario with the same name and schedule, so running a cell
    again does not pile up copies in the Simulation Lab."""
    norm = lambda sched: _canon([{k: e[k] for k in ("target", "start_day", "duration_days", "magnitude_pct")}
                                 for e in sched or []])
    for sc in api.scenarios(project_id):
        if sc["name"] == name and norm(sc.get("disruption_schedule")) == norm(events):
            return sc
    created = api.create_scenario(project_id, name, description="created by a SuReSuite notebook",
                                  disruption_schedule=events,
                                  **{k: base[k] for k in FRAME_FIELDS if base.get(k) is not None})
    return next(s for s in api.scenarios(project_id) if s["id"] == created["id"])


def outage(target, start_day=140, duration_days=42, magnitude_pct=100):
    """One disruption event. target: a supplier id of the project, or "plant".
    magnitude_pct 100 = the target ships nothing for the window (its deliveries are
    deferred, not lost); below 100 = its capacity is cut BY that share, which bites
    only when the remaining capacity is below what the plan needs."""
    return {"target": target, "target_type": "node", "start_day": start_day,
            "duration_days": duration_days, "magnitude_pct": magnitude_pct}


# ── the run-results workbook (the app's "verifiable export") ────────────────
def export_run_workbook(api, run, scenario, path, policy_version_label=None):
    """Write the sheets the app's run-results workbook carries — run_meta,
    aggregate_kpis, replication_kpis, series_<key> (weeks × replications) and
    reproducibility — so a figure that leaves the notebook says what produced it."""
    reps = [r for r in api.replications(run["id"]) if r.get("status", "done") == "done"]
    agg, ci = run.get("aggregate_kpis") or {}, run.get("ci_half_widths") or {}
    rng = agg.get("_range") or {}
    validation = api.validation(run["id"])
    meta = [
        ("run_id", run["id"]), ("status", run["status"]), ("created_at", run.get("created_at")),
        ("ended_at", run.get("ended_at")), ("code_version (engine)", run.get("code_version")),
        ("policy_version_id", run.get("policy_version_id")), ("policy_version_label", policy_version_label),
        ("policy_hash (SHA-256)", run.get("policy_hash")), ("dataset_version_id", run.get("dataset_version_id")),
        ("graph_hash (SHA-256)", run.get("graph_hash")), ("scenario_hash (baseline fingerprint)", run.get("scenario_hash")),
        ("model_validation_id", run.get("model_validation_id")), ("scenario_id", scenario["id"]),
        ("scenario_name", scenario["name"]), ("root seed", scenario.get("seed")),
        ("replications (target)", run.get("rep_count_target")), ("replications (done)", run.get("rep_count_done")),
        ("CRN (common random numbers)", scenario.get("crn")), ("horizon_days", scenario.get("horizon_days")),
        ("warmup_detected_at (weeks, engine)", run.get("warmup_detected_at")),
        ("disruption_schedule (full JSON; empty = baseline)", json.dumps(scenario.get("disruption_schedule") or [])),
        ("credibility", validation.get("status")), ("source", "SuReSuite public API /v1" if api.live else "offline demo"),
        ("generated", pd.Timestamp.now(tz="UTC").isoformat()),
    ]
    aggregate = pd.DataFrame([{"kpi": k, "mean": agg[k], "ci_halfwidth": ci.get(k),
                               "min": (rng.get(k) or {}).get("min"), "max": (rng.get(k) or {}).get("max")}
                              for k in sorted(_numeric(agg))])
    replication = pd.DataFrame([{"rep_index": r["rep_index"], "seed_used (root seed)": r.get("seed_used"),
                                 **(r.get("kpis") or {})} for r in reps])
    series = api.series(run["id"])
    label = lambda row: f"rep {int(row.rep_index)}" + (f" · world {int(row.model_rep)}" if pd.notna(row.model_rep) else "")
    series["replication"] = series.apply(label, axis=1)
    repro = [
        ("dataset", f"dataset version {run.get('dataset_version_id')} · graph_hash {run.get('graph_hash')}"),
        ("policy", f"policy version {run.get('policy_version_id')} · policy_hash {run.get('policy_hash')}"),
        ("scenario", f"scenario {scenario['id']} · scenario_hash {run.get('scenario_hash')} · seed {scenario.get('seed')}"
                     f" · disruptions {json.dumps(scenario.get('disruption_schedule') or [])}"),
        ("engine", run.get("code_version")),
        ("known limit", "assembled by a notebook from the API's run row; network-analysis figures and "
                        "mapping warnings are not part of this record (the API does not return them)"),
    ]
    with pd.ExcelWriter(path) as xl:
        pd.DataFrame(meta, columns=["field", "value"]).to_excel(xl, sheet_name="run_meta", index=False)
        aggregate.to_excel(xl, sheet_name="aggregate_kpis", index=False)
        replication.to_excel(xl, sheet_name="replication_kpis", index=False)
        for col in [c for c in series.columns if c not in ("rep_index", "model_rep", "event_rep", "week", "replication")]:
            series.pivot_table(index="week", columns="replication", values=col, sort=False).to_excel(
                xl, sheet_name=f"series_{col}"[:31])
        pd.DataFrame(repro, columns=["binding", "value"]).to_excel(xl, sheet_name="reproducibility", index=False)
    print(f"wrote {path}: run_meta, aggregate_kpis, replication_kpis, {series.shape[1] - 5} series sheets, reproducibility")
    return path


# ── charts ──────────────────────────────────────────────────────────────────
def _need_plt():
    if plt is None:
        raise ImportError("charts need matplotlib: pip install 'suresuite[plots]'")


def plot_kpis(runs, kpis, title=None):
    """One small panel per KPI (their scales differ), one bar per run, with the
    run's 95 % CI half-width as the error bar. `runs` is {label: run_row}."""
    _need_plt()
    kpis = [k for k in kpis if all(k in _numeric(r.get("aggregate_kpis")) for r in runs.values())]
    if not kpis:
        print("none of those KPIs is present on every run")
        return
    fig, axes = plt.subplots(1, len(kpis), figsize=(2.9 * len(kpis), 3.3), squeeze=False)
    for ax, kpi in zip(axes[0], kpis):
        labels = list(runs)
        vals = [_numeric(runs[l].get("aggregate_kpis"))[kpi] for l in labels]
        errs = [(runs[l].get("ci_half_widths") or {}).get(kpi) or 0 for l in labels]
        ax.bar(range(len(labels)), vals, yerr=errs, capsize=3, width=0.65,
               color=[PALETTE[i % len(PALETTE)] for i in range(len(labels))])
        ax.set_xticks(range(len(labels)), labels, rotation=30, ha="right", fontsize=8)
        ax.set_title(kpi_label(kpi), fontsize=9)
        ax.spines[["top", "right"]].set_visible(False)
    if title:
        fig.suptitle(title, y=1.02)
    plt.tight_layout()
    plt.show()


def plot_series(series_by_label, column, title=None, window=None, warmup_week=None):
    """Mean weekly trajectory per run with a band from the lowest to the highest
    replication. `series_by_label` is {label: api.series(run_id)}; `window` is a
    (start_week, end_week) disruption window to shade."""
    _need_plt()
    fig, ax = plt.subplots(figsize=(8, 3.4))
    for i, (label, df) in enumerate(series_by_label.items()):
        if column not in df:
            continue
        g = df.groupby("week")[column]
        color = PALETTE[i % len(PALETTE)]
        ax.plot(g.mean().index, g.mean().values, color=color, linewidth=2, label=label)
        ax.fill_between(g.min().index, g.min().values, g.max().values, color=color, alpha=0.12, linewidth=0)
    if window:
        ax.axvspan(window[0], window[1], color="#5f6b7a", alpha=0.10, label="disruption window")
    if warmup_week:
        ax.axvline(warmup_week, color="#5f6b7a", linestyle=":", linewidth=1, label="warm-up ends")
    ax.set_xlabel("week")
    ax.set_ylabel(column)
    ax.set_title(title or column, fontsize=10)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(fontsize=8, frameon=False, loc="best")
    plt.tight_layout()
    plt.show()


def effective_window(event, run):
    """The weeks an event actually covered: the engine works in weeks, starts no
    earlier than week 1, and moves an event that would start inside the warm-up to
    the warm-up's end."""
    start = max(1, round(event["start_day"] / 7))
    start = max(start, int(run.get("warmup_detected_at") or 0))
    return start, start + max(1, min(52, round(event["duration_days"] / 7)))


# ── the offline demo: the same API, answered from recorded engine output ─────
RUN_FIELDS = ("id", "scenario_id", "project_id", "status", "started_at", "ended_at", "created_at",
              "updated_at", "rep_count_target", "rep_count_done", "aggregate_kpis", "ci_half_widths",
              "warmup_detected_at", "policy_version_id", "policy_hash", "dataset_version_id",
              "graph_hash", "scenario_hash", "model_validation_id", "gate_skipped", "error_message",
              "code_version")
SCENARIO_FIELDS = {"name": None, "description": "", "horizon_days": 90, "warmup_days": 14,
                   "replications": 10, "seed": 42, "crn": True, "disruption_schedule": [],
                   "recovery_overrides": {}, "primary_kpi": "fill_rate"}
RUN_BODY_FIELDS = ("scenario_id", "policy_version_id", "acknowledge_warnings", "force_rerun")


def _canon(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"))


def _sha(v):
    return hashlib.sha256(_canon(v).encode()).hexdigest()


def _demo_key(policies, schedule, frame):
    """MUST match demo_key() in notebooks/tools/record_demo.py (pinned by the tests)."""
    pol = {f: v for f, v in sorted(policies.items()) if v}
    sched = sorted(({"target": str(e["target"]), "start_day": int(e["start_day"]),
                     "duration_days": int(e["duration_days"]),
                     "magnitude_pct": float(e.get("magnitude_pct", 100))} for e in schedule), key=_canon)
    fr = {k: frame[k] for k in ("horizon_days", "replications", "seed", "crn")}
    return _sha({"policies": pol, "schedule": sched, "frame": fr})


class DemoTransport:
    """Answers the /v1 routes the notebooks use from recorded engine output, keeping
    policies, scenarios and runs in memory for this session. Responses have the live
    API's shapes; a request it has no recording for is refused, never invented."""

    TS = "2026-10-01T00:00:00+00:00"

    def __init__(self, data):
        self.d = data
        self.pid = data["project"]["id"]
        self.recordings = {r["key"]: r for r in data["recordings"]}
        self.supplier_ids = {s["supplier_id"] for s in data["dataset"]["suppliers"]}
        self.defaults = {f: {} for f in FAMILIES}
        self.overrides = []
        self.datasets = [{"id": self._id("dataset", 1), "label": "initial upload", "graph_hash": data["graph_hash"],
                          "author_email": "demo@example.com", "created_at": self.TS, "version_no": 1, "tuple": None}]
        self.versions, self.scenarios, self.runs, self.idem = [], [], {}, {}
        self._new_scenario({"name": "Baseline (demo)", "description": "52 weeks, no disruption",
                            "horizon_days": 364, "replications": 10})
        self._n = 0

    def _id(self, kind, n):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"suresuite-demo/{kind}/{n}"))

    def _err(self, status, code, message, details=None):
        return status, {"X-Request-Id": "demo"}, {"error": {"code": code, "message": message,
                                                            **({"details": details} if details else {})}}

    def _ok(self, body, status=200):
        return status, {"X-Request-Id": "demo"}, body

    def _new_scenario(self, body):
        unknown = set(body) - set(SCENARIO_FIELDS)
        if unknown:
            raise ValueError(f"unknown scenario field(s): {sorted(unknown)}")
        sc = {**copy.deepcopy(SCENARIO_FIELDS), **copy.deepcopy(body),
              "id": self._id("scenario", len(self.scenarios) + 1), "created_at": self.TS, "updated_at": self.TS}
        self.scenarios.insert(0, sc)
        return sc

    def fetch(self, url):
        rec = self.recordings[self.runs[url.split("demo://series/")[1]]["_key"]]
        return rec["series"]  # already a column table; read by series() below

    def request(self, method, path, params=None, body=None, headers=None):
        params, body, headers = params or {}, body or {}, headers or {}
        p = path.split("?")[0]
        m = re.fullmatch(r"/projects/([^/]+)(/.*)?", p)
        if p == "/projects" and method == "GET":
            return self._ok({"data": [self.d["project"]], "next_cursor": None})
        if m:
            if m.group(1) != self.pid:
                return self._err(404, "project_not_found", "project not found")
            return self._project(method, m.group(2) or "", body, headers)
        if p == "/engine" and method == "GET":
            return self._err(403, "demo_no_engine",
                             "the offline demo cannot hand out the engine — it comes with an API key "
                             "(create one on the app's /developer page, then suresuite.install_engine())")
        m = re.fullmatch(r"/runs/([^/:]+)(/replications|/validation|:cancel|:add-reps)?", p)
        if m:
            run = self.runs.get(m.group(1))
            if run is None:
                return self._err(404, "run_not_found", "run not found")
            return self._run(method, run, m.group(2) or "", params, body)
        return self._err(404, "route_not_found", f"no route for {method} {p}")

    def _project(self, method, sub, body, headers):
        if sub == "" and method == "GET":
            return self._ok(self.d["project"])
        if sub == "/dataset-versions" and method == "GET":
            return self._ok({"data": self.datasets})
        if sub == "/datasets:freeze" and method == "POST":
            dv = self.datasets[0]  # nothing changed since: the existing version comes back
            return self._ok({k: dv[k] for k in ("id", "label", "graph_hash", "created_at")}, 201)
        if sub == "/policy-catalog" and method == "GET":
            return self._ok(self.d["catalog"])
        if sub == "/policies" and method == "GET":
            return self._ok({"defaults": {"project_id": self.pid, **copy.deepcopy(self.defaults),
                                          "fulfillment_strategy": None, "active_preset": None,
                                          "created_at": self.TS, "updated_at": self.TS},
                             "overrides": copy.deepcopy(self.overrides)})
        if sub == "/policies" and method == "PUT":
            bad = set(body) - {"defaults", "fulfillment_strategy", "overrides"}
            bad |= set((body.get("defaults") or {})) - set(FAMILIES)
            if bad:
                return self._err(400, "invalid_request", f"unrecognized key(s): {sorted(bad)}")
            for fam, val in (body.get("defaults") or {}).items():
                self.defaults[fam] = copy.deepcopy(val)
            for o in body.get("overrides") or []:
                self.overrides = [x for x in self.overrides if (x["scope"], x["target_key"], x["family"])
                                  != (o["scope"], o["target_key"], o["family"])] + [{**o, "updated_at": self.TS}]
            return self._ok({"ok": True})
        if sub == "/policy-versions" and method == "POST":
            h = _sha({f: v for f, v in self.defaults.items() if v})
            for v in self.versions:  # content-addressed: the oldest holder of this config comes back
                if v["policy_hash"] == h:
                    return self._ok({k: v[k] for k in ("id", "label", "policy_hash", "created_at")}, 201)
            v = {"id": self._id("policy-version", len(self.versions) + 1), "label": body.get("label"),
                 "notes": None, "author_email": "demo@example.com", "author_name": "Demo",
                 "parent_version_id": None, "policy_hash": h, "created_at": self.TS, "run_count": 0,
                 "card_count": 0, "version_no": len(self.versions) + 1, "_policies": copy.deepcopy(self.defaults)}
            self.versions.append(v)
            return self._ok({k: v[k] for k in ("id", "label", "policy_hash", "created_at")}, 201)
        m = re.fullmatch(r"/dataset-versions/([^/]+)", sub)
        if m and method == "GET":
            dv = self.datasets[0] if m.group(1) in ("latest", self.datasets[0]["id"]) else None
            if dv is None:
                return self._err(404, "dataset_version_not_found", "no such dataset version in this project")
            snap = {"schema_version": 3, "inputs": {**copy.deepcopy(self.d["dataset"]), "customers": [],
                                                    "bom_multi_level": []}, "network": {}}
            return self._ok({**{k: dv[k] for k in ("id", "label", "version_no", "graph_hash", "author_email",
                                                   "created_at")},
                             "hash_inputs": None, "hash_network": None, "schema_version": 3, "snapshot": snap})
        m = re.fullmatch(r"/policy-versions/([^/]+)", sub)
        if m and method == "GET":
            vid = m.group(1)
            v = (self.versions[-1] if self.versions else None) if vid == "latest" else \
                next((x for x in self.versions if x["id"] == vid), None)
            if v is None:
                return self._err(404, "policy_version_not_found", "no such policy version in this project")
            return self._ok({**{k: x for k, x in v.items() if not k.startswith("_")},
                             "snapshot": {"schema_version": 2, "defaults": copy.deepcopy(v["_policies"]),
                                          "fulfillment_strategy": None, "overrides": []}})
        if sub == "/policy-versions" and method == "GET":
            return self._ok({"data": [{k: v for k, v in x.items() if not k.startswith("_")}
                                      for x in reversed(self.versions)]})
        if sub == "/scenarios" and method == "GET":
            return self._ok({"data": copy.deepcopy(self.scenarios), "next_cursor": None})
        if sub == "/scenarios" and method == "POST":
            try:
                sc = self._new_scenario(body)
            except ValueError as e:
                return self._err(400, "invalid_request", str(e))
            return self._ok({k: sc[k] for k in ("id", "name", "horizon_days", "replications", "seed", "created_at")}, 201)
        if sub == "/runs" and method == "POST":
            return self._dispatch(body, headers.get("Idempotency-Key"))
        return self._err(404, "route_not_found", f"no route for {method} /projects/…{sub}")

    def _dispatch(self, body, idem):
        bad = set(body) - set(RUN_BODY_FIELDS)
        if bad:
            return self._err(400, "invalid_request", f"unrecognized key(s): {sorted(bad)}")
        if idem and idem in self.idem:
            run = self.runs[self.idem[idem]]
            return 202, {"Idempotency-Replayed": "true"}, {"run_id": run["id"], "status": run["status"],
                                                          "policy_hash": run["policy_hash"], "graph_hash": run["graph_hash"]}
        sc = next((s for s in self.scenarios if s["id"] == body.get("scenario_id")), None)
        ver = next((v for v in self.versions if v["id"] == body.get("policy_version_id")), None)
        if sc is None or ver is None:
            return self._err(500, "dispatch_failed", "scenario or policy version does not belong to this project")
        findings = []
        for ev in sc["disruption_schedule"][:5]:
            raw = str(ev.get("target", ""))
            tid = raw.rsplit(":", 1)[-1]
            if tid in self.supplier_ids or raw.lower().startswith("plant:") or tid.lower() == "plant":
                continue
            kind = raw.split(":", 1)[0].lower() if ":" in raw else ""
            why = (f"The engine cannot disrupt {kind} targets yet — this event is skipped."
                   if kind in ("material", "edge", "customer", "lane")
                   else f"No supplier or plant named \"{tid}\" in this project's data — this event is skipped.")
            findings.append({"severity": "warn", "field": "scenarios.disruption_schedule", "policy": "engine",
                             "rows": [raw], "message": f"Disruption on \"{raw}\": {why}"})
        if findings and not body.get("acknowledge_warnings"):
            return self._err(422, "validation_failed", "the pre-run gate needs acknowledgement",
                             {"validation": "ack_required", "ack_required": True, "findings": findings})
        live_schedule = [ev for ev in sc["disruption_schedule"][:5]
                         if not any(f["rows"] == [str(ev.get("target", ""))] for f in findings)]
        key = _demo_key(ver["_policies"], live_schedule, sc)
        rec = self.recordings.get(key)
        if rec is None:
            labels = ", ".join(r["label"] for r in self.d["recordings"])
            return self._err(400, "demo_no_recording",
                             "the offline demo has no recording for this policy + scenario combination "
                             f"(recorded: {labels}). Use the notebook's suggested settings, or go live.")
        if not body.get("force_rerun"):
            for prev in self.runs.values():
                if prev["_key"] == key and prev["policy_version_id"] == ver["id"] and prev["status"] == "done":
                    return self._err(409, "reuse_available", "an identical completed run exists",
                                     {"reuse_candidate": {"run_id": prev["id"], "ended_at": prev["ended_at"],
                                                          "created_at": prev["created_at"],
                                                          "code_version": prev["code_version"],
                                                          "rep_count_done": prev["rep_count_done"]}})
        self._n += 1
        run = {f: None for f in RUN_FIELDS}
        run.update(id=self._id("run", self._n), scenario_id=sc["id"], project_id=self.pid, status="queued",
                   created_at=self.TS, updated_at=self.TS, rep_count_target=sc["replications"], rep_count_done=0,
                   policy_version_id=ver["id"], policy_hash=ver["policy_hash"],
                   dataset_version_id=self.datasets[0]["id"], graph_hash=self.d["graph_hash"],
                   scenario_hash=_sha({k: sc[k] for k in ("horizon_days", "warmup_days", "replications", "seed", "crn")}),
                   gate_skipped=False, _key=key, _polls=0)
        self.runs[run["id"]] = run
        if idem:
            self.idem[idem] = run["id"]
        return 202, {"X-Request-Id": "demo"}, {"run_id": run["id"], "status": "queued", "policy_hash": run["policy_hash"],
                                                "graph_hash": run["graph_hash"], "gate_skipped": False}

    def _advance(self, run):
        if run["status"] in TERMINAL:
            return
        run["_polls"] += 1
        rec = self.recordings[run["_key"]]
        if run["_polls"] == 1:
            run.update(status="running", started_at=self.TS, rep_count_done=run["rep_count_target"] // 2)
        else:
            res = rec["run"]
            run.update(status="done", ended_at=self.TS, rep_count_done=res["rep_count_done"],
                       aggregate_kpis=copy.deepcopy(res["aggregate_kpis"]),
                       ci_half_widths=copy.deepcopy(res["ci_half_widths"]),
                       warmup_detected_at=res.get("warmup_detected_at"), code_version=res["code_version"])

    def _run(self, method, run, sub, params, body):
        if sub == "" and method == "GET":
            self._advance(run)
            return self._ok({k: copy.deepcopy(run[k]) for k in RUN_FIELDS})
        if sub == "/replications" and method == "GET":
            reps = self.recordings[run["_key"]]["replications"] if run["status"] == "done" else []
            after = int(params.get("cursor")) if params.get("cursor") not in (None, "") else -1
            limit = max(1, min(100, int(params.get("limit") or 20)))
            rows = [copy.deepcopy(r) for r in reps if r["rep_index"] > after]
            page = rows[:limit]
            body = {"data": page, "next_cursor": str(page[-1]["rep_index"]) if len(rows) > limit else None}
            if params.get("include") == "time_series":
                for r in page:
                    r["time_series"] = {}
                body["series"] = {"location": "object", "format": "parquet (zstd), long form",
                                  "url": f"demo://series/{run['id']}", "expires_in_seconds": 600}
            return self._ok(body)
        if sub == "/validation" and method == "GET":
            return self._ok({"status": "unvalidated", "model_validation": None, "gate_skipped": False})
        if sub == ":cancel" and method == "POST":
            if run["status"] not in TERMINAL:
                run.update(status="cancelled", ended_at=self.TS)
            # Like the live API, the answer says "cancelled" even for a run that had
            # already finished — read the run back to see what really happened.
            return self._ok({"run_id": run["id"], "status": "cancelled"}, 202)
        if sub == ":add-reps" and method == "POST":
            return self._ok({"run_id": run["id"], "added": (body or {}).get("n")}, 202)
        return self._err(404, "route_not_found", f"no route for {method} /runs/…{sub}")


def connect(base_url, api_key=None, demo_data=None):
    """A live client when you have a key, otherwise the offline demo."""
    if api_key:
        return SuReSuite(HttpTransport(base_url, api_key), live=True)
    if isinstance(demo_data, str):  # the notebook embeds it compressed (raw deflate + base64)
        demo_data = json.loads(zlib.decompress(base64.b64decode(demo_data), -15))
    return SuReSuite(DemoTransport(demo_data), live=False)
