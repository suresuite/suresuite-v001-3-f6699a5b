# Measurement protocol

**Turning `ai-for-scm-positioning.md` into an empirical paper**

*Instrument: `scripts/research/compute_indicators.py`. Telemetry source: `public.ai_chat_events` (migration `20260715000002_agent_telemetry.sql` + later CHECK extensions). Eval source: `supabase/functions/project-ai-chat/eval/run_model_eval.ts`.*

---

## 1. What is being measured

The positioning paper claims that generative AI can be delegated supply chain work *safely* if its authority is architecturally bounded. Three claims follow, and each is measurable:

| Claim | Type | How it is established |
|---|---|---|
| **C1** — the bounds hold | architectural invariant | proven by construction + asserted continuously (a violation is a defect, not a data point) |
| **C2** — the bounds bind | empirical | the guardrails demonstrably intercept failures that would otherwise ship |
| **C3** — the bounds cost something | empirical | latency, extra model calls, refusals, and review burden are quantified rather than hidden |

C3 is the contribution most trustworthy-AI papers omit. Reporting it honestly is a design goal of this protocol.

## 2. Indicator set

Computed by `compute_indicators.py` from a telemetry export:

| Principle | Indicator | Event source | Target |
|---|---|---|---|
| DP1 | `unreviewed_mutations` — applied proposals with no prior approval | `proposal.applied` ∖ `proposal.approved` | **0 (invariant; script exits 2 on violation)** |
| DP1 | acceptance rate, applied rate | `proposal.*` | descriptive |
| DP2 | grounding rejections (`not_grounded` / `stale_values` / `project_scope_violation`) | `proposal.apply_failed.payload.status_reason` | > 0 proves the recomputation gate binds |
| DP3 | verifier intervention rate + Wilson 95% CI | `verifier.blocked_reply` ÷ `chat.reply` | descriptive; CI matters because the rate is near 0 |
| DP3 | delivered fabrications | — | **0 by construction** (the verifier is a *pre-send* gate, §22.3) |
| DP4 | share of replies carrying an evidence part | `chat.reply.payload.parts_kinds` | ↑ |
| RQ3 | reply latency p50/p95, retry rate, fallback rate, tool calls & proposals per request | `chat.reply.latency_ms`, `verifier.blocked_reply.payload.retried` | reported, not minimized |

Indicators **not** derivable from telemetry — extraction precision/recall/F1, estimator interval coverage in back-tests, router precision/recall — come from the eval harness (`run_model_eval.ts`, the fixture suites) and are reported alongside.

> **Honest boundary.** `delivered_fabrications = 0` is an architectural property, not an observation: the gate fires before the reply ships, so the store cannot contain a delivered fabrication. The *measured* quantity is how often the gate had to fire. Papers must state this distinction; the script prints it as a note.

## 3. The RQ3 experiment — cost of safety

**Design.** Within-subject, paired: the same question battery, the same models, the same project snapshot, run under two conditions.

| Condition | Configuration |
|---|---|
| **guard-off** | `VERIFIER_ENABLED` unset — replies ship as the model produced them |
| **guard-on** | `VERIFIER_ENABLED=true` — the pre-send verifier is live |

Everything else is held constant. This is a genuine counterfactual rather than a historical comparison because the platform guarantees flag-off behaviour is byte-identical to the pre-guardrail system (`golden_transcript_test.ts`).

**Battery.** The §19.2 intent taxonomy (I1–I15) instantiated on a real project with known ground truth — `scripts/tron_ver2/dataset.json` is the seeded reference — so every reply can be scored against recomputed truth (the `coverage.audit` path).

**Condition labelling.** Runs write telemetry under `thread_id = 'eval:<condition>:<run-id>'`; the script splits on it via `--condition-from thread_prefix`. *(The harness currently writes `eval:<run-id>`; emitting the condition segment is the one small change the A/B needs — see §6.)*

**Hypotheses.**

- **H1 (interception).** Under guard-off, a non-zero share of replies contain ungrounded entities or numerals; under guard-on that share reaching the user is 0. → *the guardrail binds.*
- **H2 (price).** Guard-on increases p50/p95 reply latency and adds model calls (corrective retries) — magnitude to be reported, not assumed negligible.
- **H3 (no capability collapse).** Guard-on does not materially reduce task completion: proposals per request and grounded-answer rate are statistically indistinguishable; only *ungrounded* answers are lost.

H3 is the crux. A guardrail that achieves safety by refusing everything is worthless; the paper must show the refusals are targeted.

**Analysis.** Proportions with Wilson intervals (correct near 0); latency with paired non-parametric comparison (Wilcoxon signed-rank on matched battery items) and reported effect sizes; per-model breakdown via `--condition-from model`, since the weakest enabled model is the binding constraint (§23).

**Sample size.** The battery must be large enough that a zero-count fabrication result is informative: with *n* = 200 replies and 0 observed, the 95% upper bound is ≈ 1.5% — state the bound rather than claiming "no fabrication".

## 4. Threats to validity

| Threat | Handling |
|---|---|
| **Ground truth is self-generated** | truth is recomputed from project tables by deterministic audit code, not by the system under test; the seeded reference dataset is committed |
| **The verifier defines its own success** | it polices ids and high-precision numerals only; a human-scored sample of replies (nightly model-scored tier) checks for failures the verifier's narrow extraction cannot see |
| **Single platform / single family of models** | run the matrix on every enabled model and report per model; the architecture claim is model-agnostic and must survive the weakest one |
| **Fixture overfitting** | suites only grow; the pinned regression fixtures came from real incidents (e.g. the supplier-10 case, §19.0) |
| **Novelty/observer effects in live projects** | separate eval-thread telemetry from production telemetry (the `eval:` prefix); report both |
| **Zero-inflation** | never report a bare 0 — always the interval |

## 5. Reproducibility

Report, for every result: engine fingerprint, `policy_hash` / `graph_hash` of the project snapshot, model codes and versions, flag state, fixture-suite commit, and the telemetry export window. The platform's three-hash triangle makes this mechanical — which is itself evidence for DP7.

## 6. What must be built before the experiment runs

Small, well-defined, and honest about the current state:

1. **Condition-tagged eval threads** — `run_model_eval.ts` writes `thread_id 'eval:<run-id>'`; extend to `eval:<condition>:<run-id>` (one string change plus a `--condition=` flag).
2. **A/B driver** — a runner that executes the battery twice with `VERIFIER_ENABLED` toggled, in one invocation, so conditions are paired rather than collected on different days.
3. **Human-scored sample** — a small annotation task (≥100 replies, two annotators, Cohen's κ reported) to bound what the deterministic verifier cannot catch.

Items 1–2 are hours of work in the existing harness; item 3 is the honest cost of a defensible paper.

## 7. Usage

```sh
# export the window under study
psql "$DATABASE_URL" -c "\copy (select row_to_json(e) from public.ai_chat_events e \
  where created_at >= now() - interval '30 days') to 'events.jsonl'"

# indicator report (Markdown to stdout, full result set as JSON)
python3 scripts/research/compute_indicators.py --events events.jsonl \
    --condition-from thread_prefix --json indicators.json

# per-model matrix
python3 scripts/research/compute_indicators.py --events events.jsonl --condition-from model
```

Exit codes: `0` clean · `1` no events · `2` **DP1 invariant violated** (an applied proposal with no approval — treat as a defect, not a finding).
