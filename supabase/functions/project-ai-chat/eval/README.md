# AI-agent eval harness (ai-agents.md §7.4)

Two tiers gate the agent layer the way golden traces gate the engine (asset A13):

1. **Deterministic tier — every PR, must pass.** This directory, run with
   `deno test`. No LLM calls, no network: providers are fetch-mocked, the
   supabase-js bundle is import-mapped to a local stub (`deno.json`), and the
   proposal/chat-store RPCs run against a throwaway scratch Postgres booted
   from the real migration files.
2. **Model-scored tier — nightly + before any flag flip**
   (`run_model_eval.ts`): executes enabled agents' fixtures and
   `routing.golden.jsonl` against every enabled model, scores the §6.5/§7.4
   targets (exit 1 on a miss — the flag-flip gate), and records results into
   `ai_chat_events` under `thread_id 'eval:<run-id>'` when service-role creds
   are set. `--mock` exercises the runner offline (oracle classifier + fixture
   args); a mock run is never flag-flip evidence.

   ```sh
   deno run --allow-env --allow-read --allow-write --allow-net run_model_eval.ts \
     [--models=gemini-2.5-flash,gpt-5] [--agents=data-steward] [--mock] [--out=report.json]
   ```

There is also a runnable Stage 1 end-to-end demo transcript
(`deno run --allow-env --allow-read demo_stage1.ts`): routed ask → agent turn →
proposal card → wrap-up → idempotent re-run → apply with the findings delta.

## Running

```sh
cd supabase/functions/project-ai-chat/eval
deno test --allow-env --allow-read --allow-write --allow-run .
```

Run from **inside this directory** so Deno picks up `eval/deno.json` (the
offline import map). Permissions: `--allow-env` (flag toggling), `--allow-read`
(fixtures, migrations), `--allow-write`/`--allow-run` (scratch Postgres via
initdb/pg_ctl/psql). Without local Postgres binaries the DB-backed suite skips
with a warning; CI sets `EVAL_REQUIRE_DB=1` to turn that skip into a failure.

## Contents

| Path | What it pins |
|---|---|
| `golden_transcript_test.ts` + `fixtures/golden-transcripts.json` | §9.1 exit criterion: Layer A request/response pairs recorded pre-Stage-0 replay byte-identically with all flags off (provider request bodies AND ChatRunResult). Re-record via `golden/record_golden.ts` only for a deliberate behavior change. |
| `router_test.ts` | §6.2 deterministic wrapper: short-circuits, strict parse, fallbacks, tie-break, kill-switch parsing. |
| `routing.golden.jsonl` + `routing_golden_test.ts` | §6.5 routing golden set seed (class quotas: ≥25/agent class, ≥25 advisory, ≥15 mixed, ≥10 adversarial) and its well-formedness; rows carry optional §6.6 `expect.needs_run` / `expect.cache_checkable` labels (absent = false) scored by `run_model_eval.ts` against the H2 targets (needs-run recall ≥ 0.80, cache-checkable precision ≥ 0.85 per enabled model). |
| `telemetry_test.ts` | §7.1/§7.5: flag-gated, never-throws, canonical args hashing. |
| `db_rpc_test.ts` + `fixtures/local-threads.json` | §4.1/§4.2 proposal state machine, idempotency, service-role-only apply markers, T10 cap; §13.2 checkpoint 4 (approve requires `agent_apply`, fail closed) + review events; §7.1 event store; §13.1 capability seeds; §14.1 chat store incl. lossless localStorage import and TS↔SQL quick-thread-id parity; `bulk_upsert_*` full-row semantics; §14.3 `set_thread_summary`. |
| `chat_import_test.ts` | §14.7 M0 import mapping (pure functions). |
| `router_structured_test.ts` | Stage 1 classifier wiring: per-provider structured-output request bodies (§6.2/§12.2), key-missing fallback, the low-confidence offer chip + "do it" re-route. |
| `data_steward_test.ts` + `fixtures/data-steward/ds-01…ds-09` | §5.1 golden task suite on the real tool handlers with mocked LLM args: reducer recomputation (1e-9), enum/scope gates, idempotency, injection containment, and the §4.4 apply sequence with its findings delta. |
| `policy_configurator_test.ts` + `fixtures/policy-configurator/pc-01…pc-09` | §5.2 golden task suite: registry-schema diff validation (unknown field / planned-policy milestone refusal), scope gates, the manifest recompile (`findings_preview` / `newly_required`), idempotency, and the §4.4 apply — lineage (`agent:` label + parent), zero-block post-grade, `stale_values` on out-of-band edits. |
| `vv_analyst_test.ts` + `fixtures/vv-analyst/vv-01…vv-08` | §5.3 golden task suite: the HANDLER-READ computed block (engine/Welch warm-up, per-KPI adequacy n*, persisted-tests-only rule), the verdict/basis downgrade, badge derivation, and the §4.4 apply through `record_model_validation` (supersede-not-edit). |
| `memory_test.ts` + `fixtures/memory/mm-01, mm-02` | §14.3 rolling summaries: 24/8 thresholds, verbatim template, persona-only injection (mm-02 pins that no agent turn ever sees the summary). |
| `memory_m2_test.ts` + `fixtures/memory/mm-03…mm-07` | §14.4 project memory: consent-only writes (explicit "remember …" / chip offer — no silent path), retrieval + `document` citations in B2 drafts, stale markers on hash drift, archive-erases, injection-as-data. |
| `db_stage23_test.ts` | Scratch-Postgres pins for `apply_policy_bundle` (merge semantics, agent label + parent lineage, transactional rollback, in-transaction `stale_values`), `record_model_validation` supersession, and the `project_memory` consent funnel (RPC-only writes, guards, 200-cap, capability seed). |
| `experiment_designer_test.ts` + `fixtures/experiment-designer/ed-01…ed-08` | §5.4 golden task suite: the draft hard gates (version-in-project, replication clamp, ≤5 events, FORCED `acknowledge_warnings:false`, read-only `findings_preview`), grounding `{policy_hash}`, idempotency, the §13.3 rights row + §13.4 quotas (per user per project; typed, no attempt burned), and the §4.4 apply through `dispatchExperimentRun` — gate_blocked with findings, queued run with the full provenance stamps indistinguishable from a Lab dispatch (ed-08), idempotent second approve. |
| `modes_test.ts` (+ `ask-01…ask-06` rows in `routing.golden.jsonl`) | §15 Ask/Review: flag default-off, mode resolution (server row > body hint > review; 'auto' rejected), the checkpoint-2 subtraction (classification still detects the blocked intent — the `mode.blocked_intent` signal), the server-authored notice + Switch-to-Review chip part. |
| `suggestions_test.ts` + `fixtures/suggestions/sug-01…sug-05` | §17.3 v0: normative rule order (gaps > validation > experiments > reports > memory), ≤4 cap, `{label, utterance, agent_hint, reason}` shape, capability filter (never suggest the unpermitted), ask-mode "switch to Review" phrasing, flag default-off. |
| `report_builder_test.ts` + `fixtures/report-builder/rb-01…rb-08` | §16.1 golden task suite (v1.2 Phase 3): the "spec, never the file" law (sections carry ONLY source refs), citation-mandatory narrative, refusal-when-no-evidence-run NAMING the missing run (per §15 mode), the closed template/format vocabulary, render determinism (same spec + same data ⇒ identical XLSX cell values; the "AI-drafted commentary" heading), the §4.4 apply through the render pipeline (§16.2 path law, `user_files` bookkeeping, `applied_result {file_ids, paths}`, stale_values on a vanished run), the §13.3 rights row (`agent_proposals` + `reports`, NOT `agent_apply`), the 20/day render quota, and the §15 ask-mode allowlist. |
| `db_reports_test.ts` | Scratch-Postgres pins for `20260723000001_reports_and_file_workspace.sql` (verbatim, against a storage stand-in): the proposals CHECK swap, the checkpoint-4 decision_report rights variant, `user_files` RPCs (service-only `create_user_file`, owner-scoped lazy-sweeping `list_user_files`, the SQL-enforced 500 MB `retention_cap`, row-AND-object deletes), `admin_org_file_usage`, the four §16.3 event kinds, and the capability seeds (`reports` follows `ai_chat`; `agent_report_builder` OFF — Q19). |
| `demo_stage23.ts` | Runnable Stage 2/3 + M2 acceptance transcript: policy bundle draft→apply, stale_values on drift, model-card adopt→supersede, memory save→citation→stale chip. |
| `demo_stage4.ts` | Runnable Stage 4 + §15/§17.3 acceptance transcript: outage ask → spec card (bound version, replications, findings_preview) → approve → queued run with full provenance stamps → idempotent second approve; the §13.3 rights refusal; the 11th-apply quota denial; the same ask blocked in an Ask thread with the mode notice + `mode.blocked_intent`; the suggestion chips. |
| `router_v2_test.ts` | §6.6 router v2 (H2, `ROUTER_V2_SIGNALS`): flag off ⇒ v1 prompt + provider schemas byte-identically; flag on ⇒ exactly the verbatim boolean block + the two schema properties; missing/malformed booleans default false; the deterministic fallbacks and the §15 mode subtraction carry the signals. |
| `closed_loop_test.ts` + `fixtures/closed-loop/cl-01…cl-10` | §20.6 closed-loop suite (H2 `CLOSED_LOOP_ENABLED`; H3 adds cl-04/09/10 under `PLAN_TOOL_ENABLED`): the §20.2 cache-first read (hit table + 12-hex triple note + derived badge, `cache_miss` vs `cache_stale` naming the drifted hash, disambiguation, reps-insufficient miss), the deterministic `cache_hit` draft guard (cl-07 — the guard, not the prompt, is the gate), the §20.3 single-turn branches on the real B4 turn, read-hit ≡ apply-hit through the ONE extracted G17 predicate (`findReuseCandidates`), and the §13.6 stub-DB laws (zero run rows without approval; zero proposals on hits); cl-04 drives the full H3 arc (plan → card → approve → apply → advance → run done → resume reads persisted KPIs; every citation resolves via the §22.2 resolver; every step terminal), cl-09 re-runs the cl-01 battery on a multi-sourced project (§20.7 topology independence), cl-10 pins the quota pause (step failed with the remaining-allowance note, no `apply_attempts` increment per Q21c, honest resume); flags off ⇒ the §5.4 v1 surface/prompt/behavior byte-identically. |
| `plan_integrity_test.ts` + `fixtures/plans/pi-01…pi-08` | §21.6/§7.7-3 plan-integrity suite (H3): the §21.1 handler rules on the real `update_task_plan` (schema verbatim, append-only steps, one active, waiting refs, legal transitions, the plan envelope), the §21.3 integrity law (a mocked mid-step provider crash — through the real §20.5 retry — yields `failed: interrupted`, never a dangling `active`), the §21.4 resume pre-step branches (zero-LLM progress on a running run — zero fetches asserted; run-failed honesty; the awaiting_approval converging advance; owner check; the §21.5 step/resume caps rejected with the cap NAMED), reload + model-switch resume on the SAME row, supersede-visibly, and the Q34 unsynced-thread degradation. |
| `budget_test.ts` | §21.5/§7.7-4 budget-enforcement suite (H3, unflagged): with fake providers + a mocked clock, each meter (LLM calls, tool calls, output chars, wall between hops incl. the §20.5 retry's real elapsed time, the recorded MAX_HOPS hit) triggers its honest-degradation behavior — finish the current step, NAME the exhausted meter, never silent truncation — plus the chat.reply spend payload (`llm_calls`/`tool_calls`/`wall_ms`/`budget_hit`), the §21.3 close of a budget-interrupted plan, the normative DEFAULTs (4/15/48,000/60 s — generous enough that the worst pre-H3 shape fits exactly), and the unmetered byte-identity path. |
| `db_plans_test.ts` | Scratch-Postgres pins for `20260726000001_chat_plans.sql` (verbatim): the §21.2 DDL and 14-day TTL, service-path-only `upsert_chat_plan` with SQL-enforced 12-step cap and create-supersedes-visibly, owner-scoped `get_chat_plan`/`list_chat_plans` (Q20) with the lazy TTL sweep, `advance_chat_plan_step`'s exactly-two client-legal transitions, realtime publication membership, and the three §21.3 plan kinds in the `ai_chat_events` CHECK. |
| `demo_plan_harness.ts` | Runnable H3 acceptance transcript: the 6-week-outage ask → plan checklist → spec card → Approve → the awaiting_run step's LIVE replication count climbing (zero-LLM poll resumes) → run completes → the thread resumes itself → cited answer with the evidence chip → every step terminal; a mid-run "reload" (fresh client, same store) showing the current checklist; and the revoked-capability resume failing typed with the step marked failed. |
| `provider_retry_test.ts` | §20.5 free-tier operations (H2): one retry on 429/5xx with 1 s→2 s ±25% jittered backoff, the typed rate-limit error on a second failure (no silent model substitution), non-retryable statuses untouched. |
| `demo_closed_loop.ts` | Runnable H2 acceptance transcript: (a) cache hit answers instantly citing the stored run id + hashes, no card; (b) miss files the spec card and NOTHING dispatches until Approve (then the queued run carries full provenance stamps); (c) after a data re-upload the `cache_stale` reply names the drifted hash. |
| `demo_reports.ts` | Runnable Phase 3 acceptance transcript: the chained disruption-brief flow (no evidence run → the refusal NAMES it and offers the experiment path → B4 spec → approve → dispatch → run completes → the re-ask drafts the brief citing the NEW run_id) → approve → PDF + XLSX rendered under the §16.2 path law with `user_files` rows and the "AI-drafted commentary" heading; the §13.3 rights row + the 21st-render quota denial; the report ask surviving Ask mode while a steward ask is subtracted. |
| `fixtures/<agent>/` | Golden task suites per agent (populated per stage, §5). |

Fixture growth discipline (§7.3): every production misroute, rejected-with-note
proposal, or apply failure becomes a fixture; fixtures are removed only with a
`retired_reason`.
