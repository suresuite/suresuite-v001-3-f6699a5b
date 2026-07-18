-- Phase H1 (ai-agents.md §22.3, §7.7-1): the pre-send verifier's telemetry
-- kind joins the ai_chat_events CHECK — the established per-phase extension
-- pattern (20260721000001, 20260723000001). No new store, no RLS change:
-- verifier.blocked_reply is server-emitted (service role) with a §7.5-safe
-- payload (violation counts by class + retried flag; never reply text).

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
    'verifier.blocked_reply'));

SELECT pg_notify('pgrst', 'reload schema');
