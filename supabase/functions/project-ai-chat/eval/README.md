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
| `routing.golden.jsonl` + `routing_golden_test.ts` | §6.5 routing golden set seed (class quotas: ≥25/agent class, ≥25 advisory, ≥15 mixed, ≥10 adversarial) and its well-formedness. |
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
| `demo_stage23.ts` | Runnable Stage 2/3 + M2 acceptance transcript: policy bundle draft→apply, stale_values on drift, model-card adopt→supersede, memory save→citation→stale chip. |
| `fixtures/<agent>/` | Golden task suites per agent (populated per stage, §5). |

Fixture growth discipline (§7.3): every production misroute, rejected-with-note
proposal, or apply failure becomes a fixture; fixtures are removed only with a
`retired_reason`.
