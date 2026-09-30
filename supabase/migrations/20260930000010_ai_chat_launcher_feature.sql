-- Access control — the floating AI assistant launcher is its own feature.
--
-- The robot button in the bottom-right corner (`FloatingChatBubble`) was gated
-- on `ai_chat` alone, so the only way to hide it was to revoke the assistant
-- everywhere. `ai_chat_launcher` lets /admin → Role defaults → Features (and the
-- org/user override layers, which read the same catalog) switch the floating
-- button off while the assistant stays reachable from its own page.
--
-- The launcher needs BOTH keys: `ai_chat_launcher` without `ai_chat` shows
-- nothing, because the panel it opens would refuse every message.
--
-- Seeded from whatever `ai_chat` holds per role — the same shape as `reports` in
-- 20260723000001 — so nobody's screen changes on deploy.

INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
  ('ai_chat_launcher', 'feature', 'AI Assistant Button', 'Show the floating AI assistant button on every page', 211)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, label = EXCLUDED.label,
      description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'ai_chat_launcher',
       COALESCE((SELECT rc.allowed FROM public.role_capabilities rc
                  WHERE rc.role = r.role AND rc.capability_key = 'ai_chat'), false)
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key) DO NOTHING;
