#!/usr/bin/env python3
"""Compute the DP1-DP7 indicator set and the RQ3 cost-of-safety metrics.

Research instrument for `docs/research/ai-for-scm-positioning.md` and its
measurement protocol (`docs/research/measurement-protocol.md`).

INPUT is an export of `public.ai_chat_events` as a JSON array — the columns
created by migration 20260715000002_agent_telemetry.sql (+ the later
CHECK-extension migrations):

    id, created_at, user_id, org_id, project_id, thread_id, request_id,
    persona_id, agent_id, model_code, provider_code, event_kind,
    proposal_id, payload, latency_ms

Export example (psql):

    \\copy (select row_to_json(e) from public.ai_chat_events e
           where created_at >= now() - interval '30 days') to 'events.jsonl'

Both a JSON array and JSON-lines are accepted.

Usage:
    python3 compute_indicators.py --events events.json
    python3 compute_indicators.py --events events.json \\
        --condition-from thread_prefix --json out.json

The A/B condition (guardrails on vs off, RQ3) is read from one of:
  * thread_prefix  — `eval:<condition>:<run-id>` thread ids (the harness
                     convention: run_model_eval.ts writes `eval:<run-id>`)
  * model          — model_code, for the per-model matrix (§23)
  * agent          — agent_id
  * none (default) — a single pooled condition
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from typing import Any, Iterable


# ── loading ──────────────────────────────────────────────────────────────────

def load_events(path: str) -> list[dict[str, Any]]:
    """Accept a JSON array, JSON-lines, or psql row_to_json output."""
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read().strip()
    if not text:
        return []
    if text.lstrip().startswith("["):
        rows = json.loads(text)
    else:
        rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    out: list[dict[str, Any]] = []
    for row in rows:
        # psql `row_to_json` in a one-column copy yields {"row_to_json": {...}}
        if isinstance(row, dict) and set(row.keys()) == {"row_to_json"}:
            row = row["row_to_json"]
        if isinstance(row, dict):
            if isinstance(row.get("payload"), str):
                try:
                    row["payload"] = json.loads(row["payload"])
                except json.JSONDecodeError:
                    row["payload"] = {}
            out.append(row)
    return out


def condition_of(ev: dict[str, Any], mode: str) -> str:
    if mode == "thread_prefix":
        thread = ev.get("thread_id") or ""
        parts = thread.split(":")
        # eval:<condition>:<run-id> -> condition ; eval:<run-id> -> "eval"
        if len(parts) >= 3 and parts[0] == "eval":
            return parts[1]
        if len(parts) == 2 and parts[0] == "eval":
            return "eval"
        return "production"
    if mode == "model":
        return ev.get("model_code") or "unknown"
    if mode == "agent":
        return ev.get("agent_id") or "advisory"
    return "all"


# ── statistics ───────────────────────────────────────────────────────────────

def _ratio(num: int, den: int) -> float | None:
    return (num / den) if den else None


def wilson_ci(successes: int, total: int, z: float = 1.96) -> tuple[float, float] | None:
    """Wilson score interval — correct for proportions near 0, which is where
    the fabrication-rate metric lives (target 0)."""
    if total == 0:
        return None
    p = successes / total
    d = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / d
    half = (z / d) * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    return (max(0.0, centre - half), min(1.0, centre + half))


def quantiles(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {"n": 0, "p50": None, "p95": None, "mean": None}
    ordered = sorted(values)

    def q(frac: float) -> float:
        if len(ordered) == 1:
            return ordered[0]
        pos = frac * (len(ordered) - 1)
        low = math.floor(pos)
        high = math.ceil(pos)
        if low == high:
            return ordered[int(pos)]
        return ordered[low] + (ordered[high] - ordered[low]) * (pos - low)

    return {
        "n": len(ordered),
        "p50": q(0.50),
        "p95": q(0.95),
        "mean": sum(ordered) / len(ordered),
    }


# ── indicator computation ────────────────────────────────────────────────────

def compute(events: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """All indicators derivable from the telemetry store alone.

    Indicators requiring the eval harness (extraction P/R/F1, interval
    coverage in back-tests) are NOT computed here — they come from
    run_model_eval.ts and the fixture suites; see the measurement protocol.
    """
    events = list(events)
    kinds = Counter(ev.get("event_kind") for ev in events)

    replies = [ev for ev in events if ev.get("event_kind") == "chat.reply"]
    blocked = [ev for ev in events if ev.get("event_kind") == "verifier.blocked_reply"]

    # DP1 — proposal, not action.
    created = kinds.get("proposal.created", 0)
    approved = kinds.get("proposal.approved", 0)
    rejected = kinds.get("proposal.rejected", 0)
    applied = kinds.get("proposal.applied", 0)
    apply_failed = kinds.get("proposal.apply_failed", 0)
    expired = kinds.get("proposal.expired", 0)

    # Integrity check: every applied proposal must have been approved first.
    approved_ids = {ev.get("proposal_id") for ev in events
                    if ev.get("event_kind") == "proposal.approved" and ev.get("proposal_id")}
    applied_ids = {ev.get("proposal_id") for ev in events
                   if ev.get("event_kind") == "proposal.applied" and ev.get("proposal_id")}
    unreviewed_mutations = sorted(applied_ids - approved_ids)

    # DP2 — deterministic value computation: apply failures whose reason is a
    # grounding/staleness rejection (the recomputation gate firing).
    grounding_reasons = ("not_grounded", "stale_values", "project_scope_violation")
    recompute_rejections = [
        ev for ev in events
        if ev.get("event_kind") == "proposal.apply_failed"
        and str((ev.get("payload") or {}).get("status_reason", "")).lower() in grounding_reasons
    ]

    # DP3 — grounded-or-refuse. The verifier is a pre-send gate, so a blocked
    # reply is an INTERCEPTED fabrication, never a delivered one.
    violation_classes: Counter[str] = Counter()
    retried = 0
    for ev in blocked:
        payload = ev.get("payload") or {}
        violations = payload.get("violations") or {}
        if isinstance(violations, dict):
            for cls, count in violations.items():
                try:
                    violation_classes[cls] += int(count)
                except (TypeError, ValueError):
                    violation_classes[cls] += 1
        if payload.get("retried"):
            retried += 1

    # DP4 — quantitative claims carry evidence. `chat.reply` payload records
    # the reply's part kinds; an evidence part means citations shipped.
    with_evidence = sum(
        1 for ev in replies
        if "evidence" in ((ev.get("payload") or {}).get("parts_kinds") or [])
    )

    # RQ3 — cost of safety.
    reply_latencies = [float(ev["latency_ms"]) for ev in replies
                       if isinstance(ev.get("latency_ms"), (int, float))]
    tool_calls = kinds.get("tool.call", 0)
    requests = kinds.get("chat.request", 0)

    return {
        "volume": {
            "events": len(events),
            "requests": requests,
            "replies": len(replies),
            "tool_calls": tool_calls,
            "event_kinds": dict(sorted(kinds.items(), key=lambda kv: -kv[1])),
        },
        "DP1_proposal_not_action": {
            "created": created,
            "approved": approved,
            "rejected": rejected,
            "applied": applied,
            "apply_failed": apply_failed,
            "expired": expired,
            "acceptance_rate": _ratio(approved, approved + rejected),
            "applied_rate": _ratio(applied, created),
            "unreviewed_mutations": len(unreviewed_mutations),
            "unreviewed_mutation_ids": unreviewed_mutations,
            "invariant_holds": len(unreviewed_mutations) == 0,
        },
        "DP2_deterministic_values": {
            "grounding_rejections": len(recompute_rejections),
            "rejection_rate_of_applies": _ratio(len(recompute_rejections), applied + apply_failed),
            "reasons": dict(Counter(
                str((ev.get("payload") or {}).get("status_reason", "")).lower()
                for ev in recompute_rejections
            )),
        },
        "DP3_grounded_or_refuse": {
            "replies": len(replies),
            "verifier_interventions": len(blocked),
            "intervention_rate": _ratio(len(blocked), len(replies)),
            "intervention_rate_ci95": wilson_ci(len(blocked), len(replies)),
            "violations_by_class": dict(violation_classes),
            "resolved_by_retry": retried,
            "resolved_by_fallback": len(blocked) - retried,
            "delivered_fabrications": 0,
            "delivered_fabrications_note": (
                "0 by construction: verifier.blocked_reply is emitted on the SAVE, "
                "before the reply ships (ai-agents.md §22.3). This field is an "
                "architectural invariant, not a measurement."
            ),
        },
        "DP4_evidence_bearing_replies": {
            "replies_with_evidence_part": with_evidence,
            "share": _ratio(with_evidence, len(replies)),
        },
        "RQ3_cost_of_safety": {
            "reply_latency_ms": quantiles(reply_latencies),
            "extra_llm_calls_from_retries": retried,
            "retry_rate_of_replies": _ratio(retried, len(replies)),
            "fallback_rate_of_replies": _ratio(len(blocked) - retried, len(replies)),
            "tool_calls_per_request": _ratio(tool_calls, requests),
            "proposals_per_request": _ratio(created, requests),
        },
    }


# ── reporting ────────────────────────────────────────────────────────────────

def fmt(value: Any, digits: int = 4) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, bool):
        return "yes" if value else "NO"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    if isinstance(value, (list, tuple)):
        if len(value) == 2 and all(isinstance(v, float) for v in value):
            return f"[{value[0]:.4f}, {value[1]:.4f}]"
        return str(len(value))
    if isinstance(value, dict):
        return ", ".join(f"{k}={v}" for k, v in value.items()) or "—"
    return str(value)


def render_markdown(results: dict[str, dict[str, Any]]) -> str:
    conditions = list(results.keys())
    lines: list[str] = ["# AI-for-SCM indicator report", ""]
    lines.append(f"Conditions: {', '.join(conditions)}")
    lines.append("")

    rows: list[tuple[str, str]] = [
        ("DP1", "invariant_holds"), ("DP1", "acceptance_rate"), ("DP1", "applied_rate"),
        ("DP1", "unreviewed_mutations"),
        ("DP2", "grounding_rejections"), ("DP2", "rejection_rate_of_applies"),
        ("DP3", "intervention_rate"), ("DP3", "intervention_rate_ci95"),
        ("DP3", "delivered_fabrications"),
        ("DP4", "share"),
        ("RQ3", "retry_rate_of_replies"), ("RQ3", "fallback_rate_of_replies"),
        ("RQ3", "tool_calls_per_request"), ("RQ3", "proposals_per_request"),
    ]
    key_for = {
        "DP1": "DP1_proposal_not_action",
        "DP2": "DP2_deterministic_values",
        "DP3": "DP3_grounded_or_refuse",
        "DP4": "DP4_evidence_bearing_replies",
        "RQ3": "RQ3_cost_of_safety",
    }

    header = "| Indicator | " + " | ".join(conditions) + " |"
    lines.append(header)
    lines.append("|" + "---|" * (len(conditions) + 1))
    for group, field in rows:
        cells = [fmt(results[c][key_for[group]].get(field)) for c in conditions]
        lines.append(f"| {group} · {field} | " + " | ".join(cells) + " |")

    lines.append("")
    lines.append("## Latency (RQ3 — the price of the guardrails)")
    lines.append("")
    lines.append("| Condition | n | p50 ms | p95 ms | mean ms |")
    lines.append("|---|---|---|---|---|")
    for c in conditions:
        lat = results[c]["RQ3_cost_of_safety"]["reply_latency_ms"]
        lines.append(
            f"| {c} | {lat['n']} | {fmt(lat['p50'], 0)} | {fmt(lat['p95'], 0)} | {fmt(lat['mean'], 1)} |"
        )

    lines.append("")
    lines.append("## Volume")
    lines.append("")
    for c in conditions:
        vol = results[c]["volume"]
        lines.append(f"- **{c}**: {vol['events']} events · {vol['requests']} requests · "
                     f"{vol['replies']} replies · {vol['tool_calls']} tool calls")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--events", required=True, help="ai_chat_events export (JSON array or JSONL)")
    parser.add_argument("--condition-from", default="none",
                        choices=["none", "thread_prefix", "model", "agent"],
                        help="how to split the A/B or per-model conditions")
    parser.add_argument("--json", help="also write the full result set as JSON here")
    args = parser.parse_args(argv)

    events = load_events(args.events)
    if not events:
        print("no events found — nothing to compute", file=sys.stderr)
        return 1

    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ev in events:
        buckets[condition_of(ev, args.condition_from)].append(ev)

    results = {cond: compute(rows) for cond, rows in sorted(buckets.items())}
    print(render_markdown(results))

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(results, fh, indent=2)
        print(f"\nJSON written to {args.json}", file=sys.stderr)

    # Exit non-zero if the DP1 architectural invariant is violated anywhere:
    # an applied proposal with no approval is a finding, not a statistic.
    violated = [c for c, r in results.items()
                if not r["DP1_proposal_not_action"]["invariant_holds"]]
    if violated:
        print(f"\nINVARIANT VIOLATION (DP1) in: {', '.join(violated)}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
