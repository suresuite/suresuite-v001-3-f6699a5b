# Phase 1 (Stage 0 + M0) readiness validation

- **Date**: 2026-07-12
- **Implementation under test**: PR [#72](https://github.com/suresuite/suresuite-v001-3-f6699a5b/pull/72)
  (`claude/suresuite-ai-agent-phase-1-5v7uh2`), merged into `main` at `aac0208`.
- **Authority**: `docs/design/ai-agents.md` §9.1 (Stage 0 exit criteria), §14.7 (M0 exit
  criteria), §7 (telemetry + privacy), §4 (proposal fabric), §13.1 (capability seeds).
- **Validation environment**: Claude Code remote session. GitHub API reachable; the
  session's network policy **denies all egress to `wckdrutwkytwcomrlpib.supabase.co`**
  (CONNECT 403 on both 443/REST and 5432/Postgres, retried per protocol). Every check
  that requires touching the deployed Supabase project is therefore **NOT VERIFIABLE
  from this environment** and is recorded with the exact command a human must run.
  Local evidence (deterministic eval tier against a scratch Postgres booted from the
  verbatim migration files, plus static code inspection) is recorded where it exists.

## Summary table

| # | Check | Result | Basis |
|---|---|---|---|
| 1 | Merge + CI green | **PASS** | GitHub API: PR merged; `eval` + `migrate` success on head; post-merge `migrate` **and** `eval` green on `main`; `migration-results/results/latest.log` confirms |
| 2 | Schema present (5 tables + 7 `agent_*` keys) | **NOT VERIFIABLE** (remote) — strong indirect evidence | Network policy blocks Supabase; migrations applied per green CI (“Remote database is up to date”); scratch-Postgres eval seeds exactly the 7 required keys |
| 3 | Flags-off equivalence | **PASS (local tier)**; live probe NOT VERIFIABLE | Golden-transcript equivalence test exists and passes; full deterministic tier 29/29 green locally and in CI |
| 4 | Telemetry flows + privacy | **NOT VERIFIABLE** (remote) | Requires live traffic + reading `ai_chat_events`; local telemetry tests pin the ids-only §7.5 payload shape |
| 5 | Chat store round-trip | **NOT VERIFIABLE** (remote) — full round-trip verified on scratch Postgres | Cascade delete, FTS search, flags, and `import_local_threads` idempotency all pass against the verbatim migrations locally |
| 6 | Legacy mode gone + health | **PASS (static)**; live probes NOT VERIFIABLE | `index.ts` rejects non-tools mode with a typed error, legacy path deleted; health function iterates gemini/openai/deepseek from `MODEL_REGISTRY` |
| 7 | Privilege posture (anon → apply markers denied) | **NOT VERIFIABLE** (remote) | Scratch-Postgres test “apply markers are service-role-only (single-writer, A11)” passes locally; live anon probe blocked by network policy |
| 8 | Proposal state machine on sandbox project | **SKIPPED / NOT VERIFIABLE** | Cannot query the DB to find a `test\|sandbox\|demo` project; state machine itself verified on scratch Postgres |

## Verdict

**READY FOR PHASE 2: NOT CONFIRMED (no failures found).**

No check failed. Checks 1, 3 (local requirement), and 6 (static requirement) PASS
outright. Checks 2, 4, 5, 7 and the live halves of 3 and 6 could not be executed
because this session's network policy denies all egress to the Supabase project;
they are NOT VERIFIABLE, not FAIL. Every remotely-unverifiable behavior has a
passing local equivalent that runs the **verbatim migration files** on a scratch
Postgres, and CI applied those same files to the production DB successfully — so
the remaining risk is limited to deployment-environment drift (RLS/JWT config,
edge-function deployment state, live provider keys), not to the code or schema.

**To confirm readiness**, a human (or a session in a network-enabled environment)
must run the commands listed per check below. If all return the expected results,
Phase 1 is READY FOR PHASE 2 with check 8 SKIPPED-if-no-sandbox.

---

## Check 1 — Merge + CI green: PASS

- PR #72 state: `merged: true`, `merged_at: 2026-07-12T14:46:56Z`, merge commit
  `aac02086` into `main`. Head: `1e226d3e` on `claude/suresuite-ai-agent-phase-1-5v7uh2`.
- Final check runs on the PR head (both `conclusion: success`):
  - `eval` — run [29196057048](https://github.com/suresuite/suresuite-v001-3-f6699a5b/actions/runs/29196057048), job 86659106724, completed 2026-07-12T14:20:34Z.
  - `migrate` — run [29196055663](https://github.com/suresuite/suresuite-v001-3-f6699a5b/actions/runs/29196055663), job 86659103213, completed 2026-07-12T14:21:14Z.
- Post-merge runs on `main` @ `aac02086` (both `success`):
  - `migrate` (`supabase-migrations.yml`) — run [29196916377](https://github.com/suresuite/suresuite-v001-3-f6699a5b/actions/runs/29196916377).
  - `eval` (`ai-agent-eval.yml`) — run [29196916360](https://github.com/suresuite/suresuite-v001-3-f6699a5b/actions/runs/29196916360).
- `migration-results` branch, `results/latest.log` (SHA `a347caab`):

  ```
  run_id: 29196916377  outcome: success
  trigger: push  ref: main  sha: aac02086bfb5dc7d91c9ae7bb99f042483886d8d
  ──────────────────────────────────────
  Connecting to remote database...
  Remote database is up to date.
  ```

  “Remote database is up to date” on the post-merge run means the Stage 0 + M0
  migrations were already applied to the production DB by the (green) branch run
  29196055663 — this is also the strongest available indirect evidence for check 2.

## Check 2 — Schema present: NOT VERIFIABLE (remote), strong indirect evidence

- **Attempted**: PostgREST with the anon key (`GET /rest/v1/capabilities?key=like.agent_*`
  and per-table probes) and direct Postgres on 5432. Both denied by the session
  network policy: `CONNECT tunnel failed, response 403` from the egress proxy
  (retried once per protocol; proxy log shows `connect_rejected — policy denial`).
  No service-role key or DB password is present in this environment.
- **Indirect evidence**:
  - CI applied the migration set to the production DB (check 1 log above); the set
    includes `20260715000001_agent_proposals.sql` (proposals),
    `20260715000002_agent_telemetry.sql` (ai_chat_events),
    `20260715000003_agent_capabilities.sql`, and `20260717000001_chat_store.sql`
    (chat_folders, chat_threads, chat_messages).
  - The capability seed migration inserts **exactly** the 7 required keys
    (extracted from the SQL): `agent_apply`, `agent_data_steward`,
    `agent_experiment_designer`, `agent_explainer`, `agent_policy_configurator`,
    `agent_proposals`, `agent_vv_analyst`.
  - The local eval test “capability rows + role defaults match the §13.1/§14.7
    seeding” passes against the verbatim migration files.
- **Human command to confirm** (any SQL access to the project DB):

  ```sql
  select relname from pg_class where relname in
    ('proposals','ai_chat_events','chat_folders','chat_threads','chat_messages');
  select key from capabilities where key like 'agent_%' order by key;
  ```

  Expected: 5 rows; then exactly the 7 keys above. Anon-key fallback:
  `GET {SUPABASE_URL}/rest/v1/capabilities?select=key&key=like.agent_*&order=key`
  and `POST {SUPABASE_URL}/rest/v1/rpc/list_agent_proposals` with a known
  `p_project_id` (200/empty array proves table + RPC; “function does not exist” fails).

## Check 3 — Flags-off equivalence: PASS (local tier); live probe NOT VERIFIABLE

- The §9.1-mandated golden-transcript equivalence test **exists**:
  `supabase/functions/project-ai-chat/eval/golden_transcript_test.ts` +
  `fixtures/golden-transcripts.json` (8 recorded pre-Stage-0 request/response
  pairs: gemini text/tool-call/safety-block/empty-reply, gpt-5 text/tool-call,
  deepseek tool-call/history-clamp, plus a no-orphans fixture-coverage test).
- Ran locally (deno 2.9.2), per the harness README:

  ```
  cd supabase/functions/project-ai-chat/eval
  deno test --allow-env --allow-read --allow-write --allow-run .
  → ok | 29 passed (23 steps) | 0 failed
  ```

  All 9 golden-transcript tests pass, alongside the router flag-off passthrough
  test (“flag off ⇒ pure passthrough (no classifier call, advisory)”) and the
  DB-backed suite against scratch Postgres. The same tier ran green in CI on the
  PR head and on post-merge `main` (check 1 run URLs).
- **Live probe (NOT VERIFIABLE — network policy)**. Human command:

  ```sh
  curl -s -X POST "{SUPABASE_URL}/functions/v1/project-ai-chat" \
    -H "apikey: {ANON_KEY}" -H "Authorization: Bearer {USER_JWT}" \
    -H "Content-Type: application/json" \
    -d '{"mode":"tools","message":"hello xylophone-probe-471","model":"gemini-2.5-flash","conversationHistory":[]}'
  ```

  Expected: 200 with body shaped exactly `{reply, parts, toolCalls, model}` — no
  extra fields — while router/agent flags are off.

## Check 4 — Telemetry flows + privacy: NOT VERIFIABLE (remote)

- Depends on check 3's live message plus reading `ai_chat_events` — both blocked.
- Local evidence: `telemetry_test.ts` passes, pinning the §7.1 row shape
  (“ids only, payload jsonb”), the flag gate, never-throws behavior, and the
  §7.5 canonical args-hashing (message text is never written; args are hashed).
  `record_proposal_viewed writes exactly one typed event` and
  `event_kind is a closed set; prune is service-role-only` also pass on scratch Postgres.
- **Human commands to confirm** (service-role SQL, after sending the check-3 message):

  ```sql
  select event_kind, request_id from ai_chat_events
    order by created_at desc limit 10;  -- expect chat.request/chat.reply/tool.call sharing a request_id
  select count(*) from ai_chat_events
    where payload::text ilike '%xylophone-probe-471%';  -- expect 0 (§7.5)
  select count(*) from ai_chat_events
    where payload::text ilike '%@%';   -- inspect any hits: no user emails in payloads
  ```

## Check 5 — Chat store round-trip: NOT VERIFIABLE (remote); full round-trip PASSES on scratch Postgres

- The exact sequence demanded here runs green locally against the verbatim
  migration files (eval `db_rpc_test.ts` steps):
  - `import_local_threads: lossless on the seeded fixture` — pass
  - `import is idempotent by thread id (re-run imports nothing)` — pass
  - `append_chat_message: dense seq, content cap, owner-only` — pass
  - `thread flags: NULL keeps; move requires an owned folder` — pass
  - `search_chat_messages: owner-scoped FTS (§14.5)` — pass
  - `delete_chat_thread cascades messages (right to erase)` — pass
  - `RLS: direct reads are owner-bounded; anon sees nothing` — pass
  - `quick-thread id derivation: TS and SQL agree exactly` — pass
- **Human sequence to confirm against production** (anon key + owner JWT, throwaway
  thread; the delete is the cleanup): `rpc/upsert_chat_thread` →
  `rpc/append_chat_message` ×2 → `rpc/search_chat_messages` finds the content →
  `rpc/set_thread_flags` (pinned) reflects → `rpc/delete_chat_thread` removes the
  thread and (verify) its messages; then call `rpc/import_local_threads` twice with
  the same fixture payload and confirm no duplicates.

## Check 6 — Legacy mode gone + health: PASS (static); live probes NOT VERIFIABLE

- **Legacy path deleted, not dormant** — `supabase/functions/project-ai-chat/index.ts`:
  the only references to the anonymized-abstract mode are comments recording its
  removal; the handler hard-rejects anything but tools mode:

  ```ts
  // index.ts:67-69
  if (mode !== 'tools') {
    return json(400, { error: 'This endpoint only supports mode:"tools" — the legacy chat mode has been removed.' , ... })
  ```

  A repo-wide grep for the anonymization path finds no executable remnant in
  `supabase/functions/` or `src/`.
- **Health** — `supabase/functions/project-ai-health/index.ts` iterates the distinct
  providers of `MODEL_REGISTRY` and probes each (`gemini`, `openai`, `deepseek`),
  returning per-provider `{configured, reachable, models}`; the old single
  hardcoded gpt-5 check is gone.
- **Live probes (NOT VERIFIABLE — network policy)**. Human commands:
  - `POST {SUPABASE_URL}/functions/v1/project-ai-chat` **without** `mode:"tools"` →
    expect the typed 400 error above, not a chat reply.
  - `GET {SUPABASE_URL}/functions/v1/project-ai-health` → expect a `providers`
    object with `gemini`, `openai`, `deepseek` entries.

## Check 7 — Privilege posture: NOT VERIFIABLE (remote)

- Local evidence: eval step `apply markers are service-role-only (single-writer, A11)`
  passes on scratch Postgres — non-service roles calling
  `mark_agent_proposal_applied` / `mark_agent_proposal_apply_failed` raise, per §4.1.
  `clients cannot write proposals directly (RPC-only posture)` also passes.
- **Human probe to confirm** (ANON key only; mutates nothing):

  ```sh
  curl -s -X POST "{SUPABASE_URL}/rest/v1/rpc/mark_agent_proposal_applied" \
    -H "apikey: {ANON_KEY}" -H "Authorization: Bearer {ANON_KEY}" \
    -H "Content-Type: application/json" -d '{"p_proposal_id":"00000000-0000-4000-8000-000000000000"}'
  # repeat for mark_agent_proposal_apply_failed
  ```

  Expected: a permission error. Any “function executed” success = FAIL
  (privilege hole, §4.1) and must block Phase 2.

## Check 8 — Proposal state machine on a sandbox project: SKIPPED / NOT VERIFIABLE

- The check is conditional on a project named like `test|sandbox|demo`; without DB
  access the condition itself cannot be evaluated, so this is recorded as
  SKIPPED/NOT VERIFIABLE rather than touching any real project.
- The state machine is fully verified on scratch Postgres: idempotency-key
  convergence (duplicate create ⇒ same id), `proposed → approved → rejected` with
  wrong-state actions raising, `draft → proposed`, supersede linkage, TTL/grounding
  expiry, lazy sweep in `list_agent_proposals`, and the per-user live cap (§8 T10).
- **Human sequence to confirm** (only if a sandbox project exists):
  `create_agent_proposal` (data-steward/`item_master_diff`, dummy 1-row payload) →
  uuid; re-create with the same idempotency key → same uuid;
  `review_agent_proposal(id,'approve')` → approved;
  `review_agent_proposal(id,'reject')` → rejected (terminal audit row); verify each
  transition via `list_agent_proposals`.

---

## What a follow-up session must do

Nothing in the code or schema needs fixing. To upgrade the verdict to
**READY FOR PHASE 2**, run the human commands above for checks 2–7 from an
environment whose network policy allows `*.supabase.co` (or with `psql` access
to the project DB). Concretely:

1. Check 2: the two SQL queries (or the PostgREST fallbacks) — expect 5 tables + 7 keys.
2. Check 3 (live half): one tools-mode POST — expect exactly `{reply, parts, toolCalls, model}`.
3. Check 4: the three telemetry/privacy SQL queries — expect shared `request_id`, 0 message-text hits, no emails.
4. Check 5: the RPC round-trip with a throwaway thread, plus the double `import_local_threads`.
5. Check 6 (live half): the no-mode POST (typed 400) and the health GET (3 providers).
6. Check 7: the two anon-key negative probes — expect permission errors.
7. Check 8: only if a `test|sandbox|demo` project exists; otherwise SKIPPED is acceptable.

If any of those live probes contradicts the local evidence, the discrepancy is in
deployment configuration (RLS grants, function deployment, env keys), and the fix
session should start there — the migration files and function source are proven
consistent with §4, §7, §9.1, §13.1 and §14.7 by the deterministic eval tier.
