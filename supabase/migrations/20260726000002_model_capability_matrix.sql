-- =====================================================================
-- ai_model_capabilities — the §23 per-model capability matrix store
-- (Phase H4; design: docs/design/ai-agents.md §23.1, §7.6).
-- One row per (model_code, capability_id): the newest model-scored eval
-- run upserts its measured score, the target it was measured against
-- (threshold changes never rewrite history), and pass. Writer:
-- run_model_eval.ts --matrix under the service role — NEVER a --mock run
-- (§7.4: mock is harness validation, not evidence). Reads go through
-- get_model_capability_matrix() below; consumed by index.ts (the §23.4
-- gate) and ModelPicker (§23.3 hints). It is quality metadata, not
-- project data — no project_id, no user attribution.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- §23.1 DDL, verbatim.
CREATE TABLE IF NOT EXISTS public.ai_model_capabilities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_code    text NOT NULL,            -- client model id, e.g. 'gemini-2.5-flash'
  capability_id text NOT NULL,            -- §23.2 vocabulary
  score         numeric NOT NULL,
  target        numeric NOT NULL,
  pass          boolean NOT NULL,
  eval_run_id   text NOT NULL,            -- the §7.4 'eval:<run-id>' correlator
  measured_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_code, capability_id)      -- newest run upserts
);
-- Writer: run_model_eval.ts --matrix (service role). Never written from a --mock run.
-- Reads: get_model_capability_matrix() — SECURITY DEFINER, returns the full matrix
-- (it is quality metadata, not project data); consumed by index.ts and ModelPicker.

ALTER TABLE public.ai_model_capabilities ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ai_model_capabilities TO service_role;
-- No client SELECT policy: every read goes through the RPC below, keeping
-- one consumer-facing shape the picker, the admin table and the gate share.

CREATE OR REPLACE FUNCTION public.get_model_capability_matrix()
RETURNS SETOF public.ai_model_capabilities
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT * FROM public.ai_model_capabilities
  ORDER BY model_code, capability_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_model_capability_matrix()
  TO anon, authenticated, service_role;

-- §23.4 telemetry: model.below_target joins the ai_chat_events CHECK — the
-- established per-phase extension pattern (20260721000001, 20260723000001,
-- 20260724000001, 20260726000001). Payload: model_code + capability_id only
-- (§7.5 — the single best signal for where the weakest tier actually stands).
ALTER TABLE public.ai_chat_events DROP CONSTRAINT IF EXISTS ai_chat_events_event_kind_check;
ALTER TABLE public.ai_chat_events ADD CONSTRAINT ai_chat_events_event_kind_check
  CHECK (event_kind IN (
    'chat.request','chat.reply','tool.call','router.decision',
    'proposal.created','proposal.viewed','proposal.approved',
    'proposal.rejected','proposal.applied','proposal.apply_failed',
    'proposal.expired',
    'mode.changed','mode.blocked_intent',
    'suggestion.shown','suggestion.clicked',
    'report.rendered','report.downloaded','file.kept','file.expired',
    'verifier.blocked_reply',
    'plan.created','plan.step_changed','plan.closed',
    'model.below_target'));

SELECT pg_notify('pgrst', 'reload schema');
