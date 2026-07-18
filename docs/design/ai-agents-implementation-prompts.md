# AI-agents — implementation prompts (v1.2 Phases 1–3 · v1.4 Phases H1–H4)

These are the executable prompts for the §9.8 delivery phases of
`docs/design/ai-agents.md` (v1.2) and the §24.3 hardening phases (v1.4).
Each is written to be handed verbatim to any
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

---

# v1.4 hardening phases (H1–H4)

Executable prompts for the §24.3 phases of `docs/design/ai-agents.md` v1.4
("production-grade hardening"). Same three rules as above. Run in order —
H2 assumes H1 merged, H3 assumes H2, H4 assumes H3. Do not run two phases in
one session. v1.2 Phases 1–3 are merged prerequisites for all of them.

## Phase H1 — *Ground*: every answer grounded or refused

```
Implement Phase H1 of the SureSuite AI-agent v1.4 plan (ai-agents.md §24.3):
the §19.3 coverage read tools, the §22 verifiable-evidence contract (hardened
persona prompt, citations resolver, pre-send verifier, honest templates), and
the §7.7 entity-fabrication gate. v1.2 Phases 1-3 are merged — build on them,
do not redo or refactor them.

AUTHORITY — read fully before writing any code:
1. CLAUDE.md
2. docs/design/ai-agents.md — §19 IN FULL (the coverage law, taxonomy
   I1-I15, §19.3 tool specs VERBATIM, §19.4 grammar, §19.7 eval), §22 IN
   FULL (claim classes, citation shape v2 + resolver contract, the §22.3
   verifier algorithm incl. the two layers / one-retry / server-fallback
   rules, the §22.4 buildSystemPrompt v2 VERBATIM, the §22.5 templates
   VERBATIM, §22.6 prompt inventory), §7.7 items 1 and the judge prompt,
   §11.3 (the coverage fixture row), §24.1 rows 1-3 (the EXISTS evidence
   you must reuse, not rebuild)
3. docs/design/ai-agent-accuracy-audit.md + scripts/audit/audit_tools.mjs
   (the incident you are closing; the audit's tool-port style is the
   fixture-truth style)
4. The as-built surfaces: supabase/functions/project-ai-chat/tools.ts (the
   envelope/clamp/empty idioms, registerToolHandler, toolDeclarations),
   providers.ts::buildSystemPrompt (lines 62-108 — the v1 text you are
   replacing behind the flag), vvTools.ts / configuratorTools.ts /
   draftTools.ts (the six existing reads you EXPOSE, never duplicate),
   index.ts (where the verifier hooks in, after the persona/agent turn and
   before the reply returns + chat-store append), src/hooks/useStageRows +
   the get_supply_chain_data read path (what the relation tools mirror).

SCOPE:
- tools.ts: register the four NEW read tools per §19.3 VERBATIM
  (get_supplier_materials, get_material_suppliers, get_bom_relations,
  get_entity_detail) — service-role project-scoped reads over
  inbound_logistics / bom_multi_level / outbound_logistics / masters, the
  standard envelope, top_n clamps, the truncation note carrying the TRUE
  total ("supplier X supplies N materials; showing top k"). Append them plus
  the six existing reads (get_policy_config, get_policy_catalog,
  get_data_completeness, get_validation_status, get_run_results,
  get_project_memory where PROJECT_MEMORY_ENABLED) to the persona
  toolDeclarations behind COVERAGE_TOOLS_ENABLED.
- providers.ts: buildSystemPrompt v2 per §22.4 VERBATIM behind
  VERIFIER_ENABLED (flag off ⇒ the v1 text byte-identically — the golden
  transcript pins it).
- supabase/functions/_shared/citations.ts (new): resolveCitation per §22.2
  (run / validation_card / table_rows / tool_call#hash / registry /
  document / user_message), pure function over an injected client.
- project-ai-chat/verifier.ts (new): verifyReply per §22.3 — layer 1
  membership (grounded vocabulary from THIS turn's envelopes + CONTEXT +
  the user message; entity-id-shaped tokens learned from the envelopes at
  request time, NEVER a hardcoded id regex; numeric claims ≥ 3 significant
  digits or %/currency, rounding-tolerant), layer 2 resolution (markers →
  citations → resolver), the one corrective retry (counts against the LLM
  budget), the deterministic §22.5 refusal fallback (typed parts still
  render), the verifier.blocked_reply event (ids and counts only, §7.5).
- index.ts: wire the verifier for persona AND agent replies when
  VERIFIER_ENABLED; assemble the {kind:"evidence"} part from the recorded
  toolCalls per §22.2 (the model never mints citation entries).
- UI: EvidenceList.tsx + the evidence part class in partStyles.ts (§17.2
  extension); the "grounded — N sources" chip; fallback replies render
  under the existing errors-and-refusals treatment.
- Eval: eval/fixtures/coverage/ cov-01..cov-12 per §7.7-1 — cov-01 IS
  cov-supplier-materials (the supplier-10 pinned regression: expected =
  the grounded list via get_supplier_materials OR the §19.4 bounded
  refusal; forbidden = any entity id absent from that turn's tool
  results); planted-fabrication and planted-unresolvable-citation corpora
  driving the verifier module directly; run_model_eval.ts grows the
  coverage battery + the fabrication metric (target 0, one fabrication
  fails the run) + the §7.7 judge prompt VERBATIM (scoring only, never a
  gate).

FLAGS (all default OFF; §9 conventions): COVERAGE_TOOLS_ENABLED,
VERIFIER_ENABLED. Both off ⇒ byte-identical pre-H1 behavior, proven by the
existing golden-transcript test.

GUARDRAILS: the four new tools are READ-ONLY and wrap reads the policies
page already performs — no new privileged path, no RLS change, no schema
change; the verifier NEVER edits a reply (pass / retry-once / replace-with-
template are the only outcomes); data the tools returned is never withheld
from the parts channel; the judge is nightly-scoring only; no provider or
model changes (D1/Q32). Deviations update ai-agents.md §19/§22 in the same
PR. Commit trailer: "Phase B / §12 / AI agents: H1 ground — coverage tools
+ evidence contract (ai-agents.md §24.3 H1)".

ACCEPTANCE (verify each, show evidence):
- cov-01..cov-12 green in the deterministic tier; the verifier unit corpus
  catches EVERY planted violation and passes EVERY clean reply.
- Re-run scripts/audit/audit_tools.mjs battery mapping: no I1-I10 family
  remains ❌ (the §19.2 target column achieved).
- A live model-scored run on EVERY enabled model including
  gemini-2.5-flash with fabrication rate = 0, attached before any
  flag-flip recommendation (§7.4: --mock is never flag-flip evidence).
- Demo transcript on a seeded TRON-ver2-shaped project: "what does
  supplier 10 supply?" → the grounded 187-material answer (truncated,
  noted) with the evidence chip; the same ask with the relation tool
  disabled → the §19.4 bounded refusal; a forced-fabrication mock →
  verifier fallback, user never sees the ids.
- Golden-transcript byte-identity with both flags off.
```

## Phase H2 — *Reuse*: the cache answers before compute

```
Implement Phase H2 of the SureSuite AI-agent v1.4 plan (ai-agents.md §24.3):
the §20.2 cache-first read (find_completed_run + the cache_hit draft guard),
the §6.6 router v2 signals, and the §20.3 single-turn closed-loop branches.
H1 is merged — cited replies already flow through the verifier.

AUTHORITY — read fully before writing any code:
1. CLAUDE.md
2. docs/design/ai-agents.md — §20 IN FULL (the five steps + interfaces
   table, §20.2 tool spec + identity VERBATIM, §20.3 branch table, §20.4
   prompt VERBATIM, §20.5 backoff, §20.6 fixtures, §20.7 generalization),
   §6.6 (RouteDecision extension + classifier block VERBATIM + targets),
   §13.6 (the authorization table the fixtures assert), §10 Q32-Q33,
   §5.4 + its v1.4 upgrade note
3. The deterministic surfaces: supabase/functions/_shared/dispatch.ts —
   the G17 reuse predicate (lines ~262-308) you EXTRACT into a shared
   query (both dispatch and the tool must call ONE function so read-hit
   and apply-hit can never disagree); the hash RPCs
   (current_graph_hash 20260703000001, scenario_fingerprint_hash
   20260710000001, policy_versions.policy_hash); experimentTools.ts (the
   draft handler that gains the cache_hit guard); router.ts (the schemas
   and parser you extend); agentTurn.ts (the B4 turn the §20.4 prompt
   swaps into behind the flag).

SCOPE:
- _shared/dispatch.ts: extract the G17 candidate lookup into
  findReuseCandidate(deps, {projectId, scenarioId, policyVersion,
  replications}) with UNCHANGED semantics (status done, three hashes,
  rep_count_done >= n, scenario-row-unchanged guard); dispatchExperimentRun
  calls it; behavior byte-identical (existing dispatch tests pin it).
- tools.ts / experimentTools.ts: find_completed_run per §20.2 — scenario
  name-fragment resolution (ambiguity ⇒ the §22.5 disambiguation
  template), default newest saved policy version, hit table (≤5 rows,
  Validated badge via the vvTools badge logic), meta.note carrying the
  12-hex triple, cache_miss vs cache_stale (naming the drifted hash)
  distinct notes. Registered to the B4 set always and the persona set when
  the router says cache_checkable.
- experimentTools.ts: the deterministic cache_hit guard in
  draft_experiment_spec per §20.2 (no prior find_completed_run call for
  the same scenario+version ⇒ the handler runs the lookup itself; a hit
  returns error_code "cache_hit" success-data pointing at the run, files
  NO proposal — the code is already in the §4.5 taxonomy table).
- router.ts: RouteDecision + parser + both provider schemas gain needs_run
  / cache_checkable per §6.6 (absent ⇒ false); the classifier prompt block
  VERBATIM behind ROUTER_V2_SIGNALS; index.ts consumes the two
  deterministic rules (§6.6 items 1-2).
- agentTurn.ts / experimentTools.ts: behind CLOSED_LOOP_ENABLED the B4
  turn uses the §20.4 prompt (steps 1,3,4,5 — step 2/plans is H3; the
  update_task_plan references are inert until H3 registers the tool) and
  the §20.3 single-turn branches: hit → get_run_results + cited answer;
  stale → drift statement; miss → spec card; no-version → the §5.4
  dependency_missing unchanged.
- providers.ts: the §20.5 retry/backoff (one retry, 1s→2s ±25% jitter, on
  429/5xx, counted against wall budget — the budget COUNTERS land in H3;
  here just implement the retry and log it).
- Eval: fixtures/closed-loop/ cl-01, cl-02, cl-03, cl-05, cl-06, cl-07,
  cl-08 per §20.6 (cl-04/09/10 land with H3); routing.golden.jsonl rows
  gain expect.needs_run / expect.cache_checkable labels; run_model_eval
  scores the §6.6 targets (needs-run recall ≥ 0.80, cache-checkable
  precision ≥ 0.85) per model.

FLAGS (default OFF): ROUTER_V2_SIGNALS, CLOSED_LOOP_ENABLED. Off ⇒ v1
router schemas and the §5.4 v1 prompt byte-identically.

GUARDRAILS: find_completed_run is READ-ONLY — no parameter reaches a
dispatch; the reuse identity is the SINGLE extracted predicate (never two
implementations); a cache hit files no proposal, spends no quota, needs no
approval; a miss NEVER dispatches — only the approved card's agent-apply
path does (assert on the stub DB, not the transcript); no silent model
substitution on rate-limit (the §20.5 typed error); simulation numbers in
replies come only from get_run_results/find_completed_run envelopes
(platform law). Deviations update ai-agents.md §20/§6.6 in the same PR.
Commit trailer: "Phase C-adj / G17 / AI agents: H2 reuse — cache-first
closed loop (ai-agents.md §24.3 H2)".

ACCEPTANCE (verify each, show evidence):
- cl-01/02/03/05/06/07/08 green in the deterministic tier (stub-DB
  assertions: zero run rows without approval; zero proposals on hits);
  existing dispatch tests green (extraction changed nothing).
- Router v2 targets met on the extended golden set on every enabled model.
- Live demo transcripts: (a) a project with a completed matching run —
  "what did the 6-week outage do?" answers INSTANTLY citing the stored
  run id + hashes, no card; (b) same ask on a project without the run —
  spec card appears, nothing dispatches until Approve; (c) after a CSV
  re-upload — the cache_stale reply names the drifted hash.
- Golden-transcript byte-identity with both flags off.
```

## Phase H3 — *Plan*: the loop spans approvals and runs visibly

```
Implement Phase H3 of the SureSuite AI-agent v1.4 plan (ai-agents.md §24.3):
the §21 harness — update_task_plan, the chat_plans store, the PlanCard
checklist, resume-on-approval and resume-on-run-completion, and the §21.5
turn budgets. H1-H2 are merged: the closed loop already answers hits and
files cards; this phase makes it span the wait.

AUTHORITY — read fully before writing any code:
1. CLAUDE.md
2. docs/design/ai-agents.md — §21 IN FULL (§21.1 tool schema + handler
   rules VERBATIM, §21.2 DDL + RPC contracts + PlanCard/progress-line UX,
   §21.3 integrity law, §21.4 resume mechanics, §21.5 budget table
   NORMATIVE, §21.6 fixtures), §20.3-20.4 (the plan-shaped branches +
   step 2 of the prompt now live), §13.6 (rules 3 and 5), §10 Q33-Q35,
   §7.7 items 3-4
3. Patterns to mirror: the proposals fabric (20260715000001 — the
   row+part+realtime+RPC posture §21.2 copies), useProposals.tsx (the
   card hook whose approve flow gains the resume trigger),
   MessageBubble.tsx + partStyles.ts (where the "plan" part class lands),
   the run realtime subscription (20260709000003; the UI already receives
   rep_count_done live — worker.py::_stream_replication), summaries.ts
   (the fire-and-forget posture the resume trigger must NOT copy — resume
   is a normal request, never a background job).

SCOPE:
- Migration 20260726000001_chat_plans.sql per §21.2 VERBATIM (table,
  indexes, realtime publication) + RPCs upsert_chat_plan (service path) /
  get_chat_plan / list_chat_plans (owner, Q20 p_user_id idiom) /
  expire_chat_plans (lazy TTL sweep).
- tools.ts / a new planTools.ts: update_task_plan per §21.1 — the schema
  VERBATIM, the five handler rules (create-vs-update + supersede,
  append-only steps, one active, waiting-refs, the plan envelope), the
  {kind:"plan"} ToolKind. Registered to the B4 closed-loop set behind
  PLAN_TOOL_ENABLED (which requires CHAT_STORE_ENABLED — refuse to
  register otherwise, and the closed loop caps itself to single-turn
  shapes in unsynced threads per Q34).
- index.ts: the §21.3 integrity sweep after every agent turn (dangling
  active ⇒ failed:interrupted; plan status recomputed); the §21.4 resume
  pre-step (resume_plan_id in the body; owner check; zero-LLM templated
  progress reply while the run is queued/running; advance + read-and-cite
  on done; failed ⇒ honest step failure); the §21.5 budget counters
  (MAX_LLM_CALLS_PER_REQUEST 4, MAX_TOOL_CALLS_PER_REQUEST 15,
  MAX_COMPLETION_CHARS_PER_REQUEST 48000, WALL_BUDGET_MS 60000 soft)
  enforced at the named seams and logged on chat.reply
  ({llm_calls, tool_calls, wall_ms, budget_hit}).
- providers.ts: accept the injected call/wall counters (the H2 retry now
  counts against them); executeTool consumes the tool-call counter via
  ToolContext.
- UI: PlanCard.tsx (live checklist per §21.2: status glyphs, embedded
  proposal status pill on awaiting_approval via ref.proposal_id, the
  "run dispatched — {done}/{target} replications" progress line from the
  existing run subscription, indigo rail in partStyles.ts, aria-live
  polite); useProposals.tsx approve flow advances the bound step and
  posts the resume turn; the run subscription posts ONE debounced resume
  per run-id transition to done/failed.
- Telemetry: plan.created / plan.step_changed / plan.closed join the
  ai_chat_events CHECK (migration above; ids and counts only, §7.5).
- Eval: fixtures/plans/ pi-01..pi-08 per §21.6; fixtures/closed-loop/
  cl-04 (approve → resume → cited answer, citations resolved against the
  stub), cl-09 (multi-sourced project), cl-10 (quota pause, no
  apply_attempts increment); the §7.7-4 budget tests (fake providers +
  mocked clock, each budget's honest-degradation behavior + telemetry).

FLAGS (default OFF): PLAN_TOOL_ENABLED (requires CHAT_STORE_ENABLED).
Budgets ship UNFLAGGED per §21.5's rationale — but their DEFAULT values
must be generous enough that pre-H3 single-turn behavior never hits them
(prove with the golden transcript).

GUARDRAILS: update_task_plan writes ONLY chat_plans (owner-scoped thread
state — it can never touch project data and sits outside §13.3 by
construction); a plan is never a pre-authorization (resume re-runs
checkpoints 1-2; revoked grants ⇒ typed error + step failed); no
server-side timer, queue, or background continuation (D2/Q33 — resume is
client-caused, full stop); steps never vanish (append-only, tested);
budget exhaustion is ALWAYS named to the user, never silent truncation.
Deviations update ai-agents.md §21 in the same PR. Commit trailer:
"Phase B / §12 / AI agents: H3 plan — harness, resume, budgets
(ai-agents.md §24.3 H3)".

ACCEPTANCE (verify each, show evidence):
- pi-01..pi-08, cl-04, cl-09, cl-10, and the budget tests green in the
  deterministic tier; golden-transcript byte-identity with
  PLAN_TOOL_ENABLED off.
- Live end-to-end demo: "test a 6-week outage of S1 with 30 reps and tell
  me the fill-rate impact" → plan checklist renders → spec card →
  Approve → the awaiting_run step shows the LIVE replication count
  climbing → run completes → the thread resumes itself → cited answer
  with the evidence chip → every plan step terminal. Reload the page
  mid-run: the checklist is current (the plan is server state).
- A revoked-capability resume fails typed with the step marked failed.
- chat.reply telemetry rows carry the spend keys; one fixture forces
  budget_hit and the reply names the exhausted meter.
```

## Phase H4 — *Prove*: per-model quality published and enforced

```
Implement Phase H4 of the SureSuite AI-agent v1.4 plan (ai-agents.md §24.3):
the §23 per-model capability matrix — store, --matrix writer, picker hints,
and the below-target honest template. H1-H3 are merged: the matrix scores
capabilities that now exist (coverage, fabrication, loop, plans).

AUTHORITY — read fully before writing any code:
1. CLAUDE.md
2. docs/design/ai-agents.md — §23 IN FULL (DDL, §23.2 capability
   vocabulary CLOSED SET, §23.3 publication, §23.4 enforcement + fail-open
   rules + never-auto-switch), §7.6 (matrix run cadence + staleness), the
   §22.5 needs-a-stronger-model template VERBATIM (server-instantiated),
   §10 Q32 (the revisit trigger this matrix feeds)
3. The as-built surfaces: eval/run_model_eval.ts (the runner you extend —
   its targets, its ai_chat_events recording, its --mock stamp),
   src/components/chat/ModelPicker.tsx (where hints render),
   src/pages/admin/ (the rollup home per the §16.2 precedent), index.ts
   (the routing boundary where §23.4 enforces).

SCOPE:
- Migration 20260726000002_model_capability_matrix.sql per §23.1 VERBATIM
  (table + unique upsert key + get_model_capability_matrix read RPC).
- run_model_eval.ts: --matrix — after scoring, upsert one row per
  (model_code, capability_id) with score/target/pass/eval_run_id; the
  §23.2 vocabulary EXACTLY (router, router.needs_run,
  router.cache_checkable, agent:<slug> ×5, loop:cache_hit,
  loop:run_needed, plan:integrity, coverage:relations,
  coverage:policy_reads, coverage:run_reads, fabrication, faithfulness);
  a --mock run MUST refuse to write the matrix.
- index.ts: the §23.4 gate at the routing boundary — fresh (≤7d) failing
  row for the routed (model, capability) ⇒ no agent turn; the server
  instantiates the §22.5 template naming the best passing model; emit
  model.below_target (add the event kind to the ai_chat_events CHECK in
  the same migration). Fail-open on no-row / stale-row / advisory routes
  exactly per §23.4.
- UI: ModelPicker per-model capability summary + stale marker from the
  read RPC; the admin matrix table on the existing admin usage surface
  (aggregates only).
- Eval: a deterministic fixture seeding a failing fresh row and asserting
  the template fires with the agent turn unexecuted; a passing/stale/no-
  row trio asserting fail-open; matrix-writer unit tests (upsert, mock
  refusal, target snapshotting).

FLAGS (default OFF): MODEL_MATRIX_ENABLED (gates the §23.4 enforcement and
the picker hints; the store + writer are inert data when off).

GUARDRAILS: the matrix INFORMS and REFUSES honestly — it never hides a
model (the allowlist owns that), never auto-switches, and never blocks on
absent/stale data; capability ids are the closed §23.2 set (a new suite
adds an id via a doc change first); production replies are never judged
(§7.7 — the faithfulness score comes from the eval battery only).
Deviations update ai-agents.md §23 in the same PR. Commit trailer:
"Phase B / §12 / AI agents: H4 prove — per-model capability matrix
(ai-agents.md §24.3 H4)".

ACCEPTANCE (verify each, show evidence):
- Matrix rows exist for EVERY enabled model × EVERY §23.2 capability from
  a LIVE run (gemini-2.5-flash included); the report and the table agree.
- The seeded below-target fixture: the routed ask returns the verbatim
  template naming the best passing model, no agent turn ran, telemetry
  recorded; the fail-open trio passes.
- ModelPicker shows the hints; a >7-day-old matrix renders stale and
  stops gating (proven by a clock-mocked test).
- Golden-transcript byte-identity with the flag off.
```
