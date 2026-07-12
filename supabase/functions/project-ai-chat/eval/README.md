# AI-agent eval harness (ai-agents.md §7.4)

Two tiers gate the agent layer the way golden traces gate the engine (asset A13):

1. **Deterministic tier — every PR, must pass.** This directory, run with
   `deno test`. No LLM calls, no network: providers are fetch-mocked, the
   supabase-js bundle is import-mapped to a local stub (`deno.json`), and the
   proposal/chat-store RPCs run against a throwaway scratch Postgres booted
   from the real migration files.
2. **Model-scored tier — nightly + before any flag flip** (Stage 1 adds
   `run_model_eval.ts`): executes enabled agents' fixtures and
   `routing.golden.jsonl` against every enabled model.

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
| `db_rpc_test.ts` + `fixtures/local-threads.json` | §4.1/§4.2 proposal state machine, idempotency, service-role-only apply markers, T10 cap; §7.1 event store; §13.1 capability seeds; §14.1 chat store incl. lossless localStorage import and TS↔SQL quick-thread-id parity. |
| `chat_import_test.ts` | §14.7 M0 import mapping (pure functions). |
| `fixtures/<agent>/` | Golden task suites per agent (populated per stage, §5). |

Fixture growth discipline (§7.3): every production misroute, rejected-with-note
proposal, or apply failure becomes a fixture; fixtures are removed only with a
`retired_reason`.
