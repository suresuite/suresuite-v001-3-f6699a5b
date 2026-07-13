# AI-agents v1.2 — implementation prompts (Phases 1–3)

These are the executable prompts for the §9.8 delivery phases of
`docs/design/ai-agents.md` (v1.2). Each is written to be handed verbatim to any
capable coding LLM in a fresh session. Reproducibility comes from three rules
every prompt enforces:

1. **The design doc is the specification** — the prompt only *points*; schemas,
   verbatim prompt templates, thresholds, and fixture definitions live in
   `ai-agents.md` and are never re-invented in the session.
2. **Golden fixtures are the definition of "same results"** — two different
   models implementing the same phase must both turn the same fixture suite
   green; prose similarity is irrelevant, fixture equivalence is the contract.
3. **Deviations update the doc in the same PR** (the CLAUDE.md doc-and-code
   law), so the next prompt always runs against a truthful spec.

Run the phases in order; each AUTHORITY list assumes the previous phase is
merged. Do not run two phases in one session.

---

## Phase 1 — *Act*: agents can run simulations; interaction modes ship

```
Implement Phase 1 of the SureSuite AI-agent v1.2 plan (ai-agents.md §9.8):
Stage 4 (Experiment Designer, single-run subset) plus the §15 interaction
modes and §17.3 suggested-actions v0. Stages 0–3 and workstream M0–M2 are
already merged — build on them, do not redo or refactor them.

AUTHORITY — read fully before writing any code:
1. CLAUDE.md
2. docs/design/ai-agents.md — §5.4 (B4 full spec: verbatim system prompt,
   draft_experiment_spec JSON Schema, grounding budgets, hard gates, refusal
   rules, failure modes, ed-01..ed-08 fixtures), §4.4–4.5 (apply mapping +
   draft-tool family contract), §9.5 + §9.8 Phase 1 (scope/flags), §13.2–13.4
   (checkpoint 5, the experiment_spec rights row: agent_apply + simulation_lab;
   quotas 3 concurrent / 10 per day), §15 (modes, incl. §10 Q23), §17.3
   (suggestions), §10 Q21–Q22 (the as-built seam/module conventions you must
   follow)
3. The deterministic surfaces B4 rides: supabase/functions/_shared/dispatch.ts
   (dispatchExperimentRun — the ONLY dispatch path; note the reps clamp and
   the fail-loudly enqueue), _shared/validationGate.ts (read-only gate preview
   for findings_preview), supabase/functions/sim-command/index.ts
   (CommandSchema — what a Lab dispatch stamps), and the existing agent
   pattern: project-ai-chat/agentTurn.ts (AGENT_TURNS roster),
   configuratorTools.ts / vvTools.ts (the module shape to mirror),
   agent-apply/policyBundleApply.ts (the apply-module shape to mirror).

SCOPE:
- project-ai-chat/experimentTools.ts (new, mirroring the Q22a seam layout):
  buildExperimentContext with the §5.4 budgets (16/8/8/24 KB, 64 KB total);
  draft_experiment_spec with the §5.4 schema VERBATIM; hard gates at draft:
  policy version exists and belongs to the project, replications clamped
  1–200, disruption_schedule ≤ 5 events, acknowledge_warnings FORCED false
  regardless of what the model sends, read-only gate preview stored as
  findings_preview; grounding = {policy_hash} of the bound version;
  provenance llm_drafted; idempotency per §4.5. Register in AGENT_TURNS.
- agent-apply/experimentSpecApply.ts (new) + dispatch-table row: §13.2
  checkpoint-5 (status approved, project ownership, agent_apply AND
  simulation_lab capabilities, §13.4 quota: 3 concurrent + 10/day per user
  per project, counted via proposals.applied_result→run_id joins); scenario
  write path for new_scenario specs; then dispatchExperimentRun — never a
  parallel dispatch. Idempotent re-apply returns the same run_id. Typed
  apply codes: stale_values / gate_blocked / rpc_error / quota_exceeded
  (quota failures do NOT increment apply_attempts, per §10 Q21c).
- router.ts: exp.design / exp.brief intents live; experiment-designer joins
  the enabledAgents resolution (flags ∩ capabilities ∩ dependencies).
- Capabilities: seed agent_experiment_designer (kind feature) OFF for every
  role at landing (the §10 Q19 discipline; flipping at GA is a
  role_capabilities update); extend the FeatureKey union in
  src/lib/capabilities.ts.
- §15 modes: migration adding chat_threads.mode text NOT NULL DEFAULT
  'review' CHECK (mode IN ('ask','review')) — 'auto' deliberately absent;
  ModeSwitch.tsx beside the model picker with Auto rendered disabled and the
  §10 Q6 unlock conditions in its tooltip; server enforcement at router
  checkpoint 2 (ask ⇒ artifact routes disabled; unsynced threads carry mode
  in the request body and the server STILL enforces it); the persona's
  mode-notice reply + one-click "Switch to Review" chip; telemetry kinds
  mode.changed / mode.blocked_intent.
- §17.3 suggestions v0: a suggest mode on project-ai-chat returning ≤ 4
  {label, utterance, agent_hint, reason}, rule-ordered exactly per §17.3
  (data gaps > validation > experiments > reports > memory hygiene),
  capability-filtered (never suggest what the caller cannot do; Review-only
  actions in an ask thread must say "switch to Review"); chips above the
  composer + empty-thread starters; telemetry suggestion.shown /
  suggestion.clicked; fixtures sug-01..sug-05.
- Eval: eval/fixtures/experiment-designer/ ed-01..ed-08 in the deterministic
  tier; routing.golden.jsonl extended with exp.* and ask-mode utterances;
  run_model_eval.ts grows --agents=experiment-designer.

FLAGS (all default OFF; §9 conventions): AGENT_ENABLED_IDS+=experiment-designer,
AGENT_EXPERIMENT_TYPES=single, CHAT_MODES_ENABLED, SUGGESTED_ACTIONS_ENABLED.
Any flag off ⇒ clean regression to the merged Stage 0–3 behavior, proven by
the existing golden-transcript test.

GUARDRAILS: simulation results, KPIs, and rankings are never LLM-generated —
the spec dispatches, the engine computes; no dispatch without a SAVED
policy_version_id (mirror dispatch.ts's own refusal); the model can never set
acknowledge_warnings — only the approving human on the card; no auto-approve;
no other agent, provider, or model ships in this phase; modes only SUBTRACT
capability, never grant. Deviations update ai-agents.md §10 in the same PR.
Commit trailer: "Phase B / §12 / AI agents: Stage 4 (single) + modes +
suggestions (ai-agents.md §9.8 Phase 1)".

ACCEPTANCE (verify each, show evidence):
- ed-01..ed-08 and sug-01..sug-05 green in the deterministic tier; router
  tests green including ask-mode fixtures; golden-transcript byte-identity
  with all new flags off; a live model-scored run on every enabled model
  attached before any flag-flip recommendation (§7.4: a --mock run is never
  flag-flip evidence).
- End-to-end demo transcript: "Test a 6-week outage of supplier S1 with 30
  replications" → spec card showing scenario, bound policy version,
  replications, findings_preview → Approve → run row queued carrying
  policy_version_id, policy_hash, dataset_version_id, graph_hash,
  scenario_hash, model_validation_id exactly as a Lab dispatch would
  (ed-08's provenance-indistinguishability assertion) → second Approve
  returns the same run_id.
- A user WITHOUT simulation_lab sees the card but Approve fails with a typed
  error and nothing dispatches; the 11th same-day apply returns
  quota_exceeded naming the remaining allowance.
- In an ask-mode thread, a mutation ask produces NO proposal, the mode
  notice + switch chip, and a mode.blocked_intent event.
```

## Phase 2 — *Read*: sidebar organization and the readability grammar

```
Implement Phase 2 of the SureSuite AI-agent v1.2 plan (ai-agents.md §9.8):
sidebar v2 (collapsible sections, multi-select bulk actions) and the §17.2
readability grammar, plus §17.4 memory guidance. Phase 1 is merged — the
grammar must handle its experiment cards and mode notices. This phase changes
how content READS; it must not change what any agent, router, or store DOES.

AUTHORITY — read fully before writing any code:
1. CLAUDE.md
2. docs/design/ai-agents.md — §17.1 (sidebar contract + bulk RPC names),
   §17.2 (the content-class treatment table — normative), §17.4, §14.1–14.2
   (the store + folder contract being extended; group ORDER is normative),
   §10 Q20 (the p_user_id resolver idiom every RPC must follow)
3. The as-built surfaces: src/components/intelligence/ChatSidebar.tsx
   (legacy + synced rendering paths — BOTH must keep working),
   src/components/chat/MessageBubble.tsx, ToolCallBadge.tsx, ProposalCard.tsx,
   MemoryChip.tsx, src/hooks/useChatThreads.ts (the single-row RPC call
   sites for move_chat_thread / set_thread_flags / delete_chat_thread),
   supabase/migrations/20260717000001_chat_store.sql.

SCOPE:
- Migration (new): bulk_move_chat_threads(p_thread_ids uuid[], p_folder_id,
  p_user_id), bulk_set_thread_flags(p_thread_ids, p_pinned, p_archived,
  p_user_id), bulk_delete_chat_threads(p_thread_ids, p_user_id) — each
  SECURITY DEFINER, enforcing the same owner checks as its single-row §14.1
  sibling, SKIPPING (not failing on) non-owned ids, returning the affected
  count. No other schema change.
- ChatSidebar.tsx: every §14.2 group (Quick chat, Pinned, per-project,
  My folders, Recent, Archive) gets a header with count badge + chevron;
  collapsed state per user in localStorage key chat.sidebar.collapsed.v1
  (deliberately not server-synced); a Select affordance entering multi-select
  (checkboxes, bottom action bar: Move to folder / Archive / Pin-Unpin /
  Delete-with-count-confirm). In legacy (unsynced) mode, bulk actions loop
  the existing client paths; in synced mode they call the bulk RPCs. Group
  order per §14.2 is unchanged.
- src/lib/chat/partStyles.ts (new): the SINGLE source of the §17.2 treatment
  tokens (semantic design-system tokens only — no hex literals); consumed by
  MessageBubble and the cards.
- ActivityGroup.tsx (new): replaces the always-expanded ToolCallBadge row —
  collapsed one-liner "Analyzed project data · N steps · X.Xs", expanding to
  a step timeline (tool label, row count, duration, error state).
- MessageBubble.tsx: part rails per the §17.2 table (slate data / amber
  proposal / violet memory / emerald file / red error+refusal with typed code
  and one-line remedy); tables > 10 rows collapse to 10 + "Show all N"; data
  cards carry their meta.tool source note; agent turns render under a
  labeled divider ("Data Steward drafted a proposal"); replies > ~3 screens
  get sticky anchors from their markdown headings. Verify in dark mode.
- §17.4: first-run popover on the memory chip (the three-bullet contract:
  consent-only, always visible in the panel, cited when used); a "How memory
  works" explainer in ThreadInfoPanel; a post-apply §17.3 suggestion
  offering to save the decision rationale.

FLAGS: none — this phase is presentation + additive RPCs. The existing
golden-transcript test must still pass untouched (no server chat behavior
changes); existing threads and localStorage-only threads must render
correctly with zero migration.

GUARDRAILS: no change to routing, proposals, tool envelopes, or the message
schema; ToolCallBadge may be deleted only after every call site renders
ActivityGroup; color encodes the CLASS of content, never the agent (the
system must absorb future agents without redesign); all styling flows through
partStyles.ts. Deviations update ai-agents.md §17 in the same PR. Commit
trailer: "Phase B / §12 / AI agents: chat UX v2 (ai-agents.md §9.8 Phase 2)".

ACCEPTANCE (verify each, show evidence):
- Deterministic tier fully green, including new DB tests for the three bulk
  RPCs (owner-skip semantics: a mixed owned/non-owned id array affects only
  owned rows and returns the correct count).
- A seeded dense thread (prose + 4 tool calls + table > 10 rows + proposal +
  memory chip + an error envelope) screenshots in light AND dark mode with:
  one collapsed activity line, correctly railed cards, collapsed table,
  agent-turn divider.
- Sidebar: collapse states survive reload; multi-select bulk archive of 3
  threads works in BOTH legacy and synced modes; delete confirms with count.
- Existing pre-v1.2 threads render byte-identically except the new grouping
  chrome (no content loss, no part regressions).
```

## Phase 3 — *Deliver*: reports, the file workspace, retention

```
Implement Phase 3 of the SureSuite AI-agent v1.2 plan (ai-agents.md §9.8):
agent B6 Report Builder (decision_report), the deterministic report-render
path (XLSX/PDF), and the §16.2 file workspace with retention and admin
visibility. Phases 1–2 are merged — the two-proposal disruption-brief flow
depends on Phase 1's experiment dispatch and the emerald file-card treatment
comes from Phase 2's partStyles.ts.

AUTHORITY — read fully before writing any code:
1. CLAUDE.md
2. docs/design/ai-agents.md — §16.1 (payload schema, template registry, the
   "spec, never the file" law, chained disruption-brief flow, rb-01..rb-08),
   §16.2 (bucket path law, user_files DDL sketch, retention law, admin
   rollup), §16.3 (telemetry kinds), §13.3 (the decision_report rights row:
   agent_proposals + reports, NOT agent_apply), §10 Q24–Q25 (renderer and
   retention defaults), §15 (report-builder is the ONE agent routable in ask
   mode), §4.4–4.5
3. Patterns to mirror: project-ai-chat/configuratorTools.ts (agent module),
   agent-apply/policyBundleApply.ts (apply module), the storage-bucket
   precedent in supabase/migrations/20260527011429_*.sql (avatars), the
   admin surfaces in src/pages/admin/ (AdminUsage.tsx / AdminDashboard.tsx)
   for the rollup's home.

SCOPE:
- Migration(s): extend the proposals CHECK constraints with
  ('report-builder','decision_report') (constraint swap, not table rebuild);
  capability keys agent_report_builder + reports (kind feature; reports
  seeds ON where ai_chat is on, agent_report_builder OFF at landing per the
  Q19 discipline); user_files table per §16.2 (RLS owner-read, writes via
  SECURITY DEFINER RPCs: create_user_file service-path, list_user_files,
  set_file_retained with the 500 MB retained cap enforced in SQL,
  delete_user_file, sweep_expired_files); admin_org_file_usage view (org →
  file count, bytes, expiring-in-7d); private 'workspace' storage bucket
  with the path law org/<org_id>/user/<user_id>/<project_id|shared>/
  <file_id>__<safe_filename>.
- project-ai-chat/reportTools.ts (new): draft_decision_report per the §16.1
  payload schema; template selection from the registry; narrative sections
  citation-mandatory (§4.3); refusal-when-no-evidence-run NAMES the missing
  run and (in review mode) offers the experiment path; provenance rules:
  deterministic sections carry no copied data — only source references
  resolved at render time. Register in AGENT_TURNS; router: report intents;
  report-builder is routable in BOTH ask and review modes (§15).
- supabase/functions/_shared/reportTemplates.ts (new): deterministic section
  builders for the five v1 templates (risk-posture, run-results,
  run-comparison, disruption-brief, data-readiness), each resolving through
  registered read tools / persisted runs ONLY.
- supabase/functions/report-render/index.ts (new): resolves the approved
  spec's sections at render time; XLSX via the SheetJS 'xlsx' package, PDF
  via pdf-lib (§10 Q24); narrative renders under an explicit "AI-drafted
  commentary" heading; uploads to the workspace bucket; inserts user_files;
  returns {file_ids, paths}.
- agent-apply: decision_report dispatch row — checkpoint-5 variant per
  §13.3: requires agent_proposals + reports (NOT agent_apply, and no
  data_editing — rendering mutates no project state); render quota 20/day
  per user (§10 Q25); applied_result = {file_ids, paths}; card flips to a
  file card.
- UI: in-thread file cards (emerald treatment from partStyles.ts: filename,
  format icon, size, expiry countdown, Download via 60-min signed URL, Keep
  toggle); "My files" panel in the Project Intelligence sidebar with
  per-project filter and the T-3-day expiry banner; admin rollup table on
  the admin usage surface.
- Retention: expires_at defaults now() + 14 days; lazy sweep on list plus a
  scheduled cleanup deleting row AND storage object; Keep sets retained=true
  under the 500 MB per-user cap; nothing retained is ever auto-deleted.
- Telemetry: report.rendered / report.downloaded / file.kept / file.expired
  event kinds (§16.3) — structured ids only, never message text (§7.5).
- Eval: eval/fixtures/report-builder/ rb-01..rb-08, including the render-
  determinism fixture (same spec + same data ⇒ identical XLSX cell values)
  and refusal-when-no-evidence-run.

FLAGS (default OFF): AGENT_ENABLED_IDS+=report-builder,
FILE_WORKSPACE_ENABLED. Either off ⇒ clean regression to Phase 2 behavior
(golden-transcript test still passes with flags off).

GUARDRAILS: the LLM drafts the report SPEC and narrative only — every number
in a rendered document is resolved from the database at render time by the
deterministic builders (a report can never disagree with the data it cites);
no public bucket, no unsigned URLs; org/user path law is not optional (the
admin rollup depends on it); retention deletes must remove BOTH the row and
the object. Deviations update ai-agents.md §16 in the same PR. Commit
trailer: "Phase B / §12 / AI agents: B6 reports + file workspace
(ai-agents.md §9.8 Phase 3)".

ACCEPTANCE (verify each, show evidence):
- rb-01..rb-08 green in the deterministic tier; a live model-scored run on
  every enabled model attached before any flag-flip recommendation.
- End-to-end on a seeded project WITH a completed disruption run: "write up
  the outage experiment for my team as a PDF" → decision_report card
  (template disruption-brief, narrative cited, deterministic sections as
  source refs) → Approve → PDF + XLSX in the bucket under the correct
  org/user/project path, user_files rows correct, file card downloads via
  signed URL, "AI-drafted commentary" heading present in the PDF.
- The chained flow: same ask WITHOUT an evidence run refuses naming the
  missing run; in review mode the follow-up experiment proposal → approve →
  run completes → re-ask produces the report citing the new run_id.
- Retention: a file with expires_at in the past disappears from list AND
  storage after sweep; a Kept file survives; the 501st MB of Keep fails
  typed; admin rollup shows correct per-org bytes; a user without 'reports'
  cannot approve a render (typed failure).
- An ask-mode thread CAN produce and apply a decision_report (the one
  permitted ask-mode artifact), and still cannot produce any other proposal.
```

---

## Phase 4 — *Extend* (B7–B9): not yet promptable

Blocked on §10 Q26–Q28 (owner-supplied methodology paper for the Cost
Estimator; source strategy for the Network Cartographer; feeds + corroboration
thresholds for the Disruption Sentinel) and on §18.4 for anything scheduled.
When those inputs arrive, the corresponding §18 subsection is elaborated to §5
altitude (verbatim prompt, schema, fixtures) **first**, and only then does a
Phase 4 prompt get written in the format above. Writing the prompt before the
spec would invert rule 1.
