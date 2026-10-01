-- §4 D257 · `project_freshness` NAMES ITS READER — `20261001000018`.
--
-- The browser calls as `anon`, and no session says who it is (D155). `project_freshness`
-- asked `has_project_access`, which learns the caller from the session or the
-- `app.current_user_id` setting, so a real browser call arrived with neither and was
-- refused for EVERYONE (PostgREST 401). `rehearsal/140` sets the setting by hand before
-- every call, which is why it never saw it. This file calls the way the browser does:
-- AS anon, with the user NAMED and nothing set beforehand. Each DO block is its own
-- transaction (the runner does not wrap a file), so the setting never carries over.
--
--   §1 ONE OF THEM: exactly one `project_freshness` exists, and it takes the user.
--   §2 NAMED, AS ANON: the project's owner, an admin and a super admin are answered, with
--      the project's id and the graph hash in the payload.
--   §3 STILL REFUSED: a modeler who is not the owner is refused, naming the project.
--   §4 UNNAMED: with no user and nothing set, the call is refused — the defect, pinned,
--      so removing the parameter's effect turns §2 red and adding a default user turns
--      this red.
--   §5 OMISSION: a caller whose transaction already set the actor and names no one (the
--      one-argument form every older caller uses) is NOT blanked by the omission.
--   §6 GRANTS: anon, authenticated and service_role are EXPLICIT grantees; PUBLIC is not.

-- ── seed (committed) ─────────────────────────────────────────────────────────
DO $d257seed$
DECLARE
  v_org uuid := '00000000-0000-4000-8000-000000025701';
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'D257 Org', 'd257-org')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.approved_users (id, name, email, password_hash, role, organization, organization_id, is_active) VALUES
    ('00000000-0000-4000-8000-000000025711', 'D257 owner',  'd257o@example.invalid', 'x', 'modeler',     'D257 Org', v_org, true),
    ('00000000-0000-4000-8000-000000025712', 'D257 admin',  'd257a@example.invalid', 'x', 'admin',       'D257 Org', v_org, true),
    ('00000000-0000-4000-8000-000000025713', 'D257 super',  'd257s@example.invalid', 'x', 'super_admin', 'D257 Org', v_org, true),
    ('00000000-0000-4000-8000-000000025714', 'D257 other',  'd257x@example.invalid', 'x', 'modeler',     'D257 Org', v_org, true)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level)
    VALUES ('00000000-0000-4000-8000-000000025721', 'D257 project', '00000000-0000-4000-8000-000000025711',
            'D257 plant', 'D257 Org', v_org, 'single')
    ON CONFLICT (id) DO NOTHING;
END $d257seed$;

-- ── §1 · one of them, taking the user ────────────────────────────────────────
DO $d257a$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'project_freshness'
        AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'D257/650 §1: project_freshness has more than one overload';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'project_freshness'
                   AND pronamespace = 'public'::regnamespace AND pronargs = 2
                   AND proargnames @> ARRAY['p_user_id']) THEN
    RAISE EXCEPTION 'D257/650 §1: project_freshness does not take p_user_id';
  END IF;
END $d257a$;

-- ── §2 · named, as the browser calls it ──────────────────────────────────────
DO $d257b$
DECLARE
  v_proj uuid := '00000000-0000-4000-8000-000000025721';
  v_who  uuid;
  v_out  jsonb;
BEGIN
  SET LOCAL ROLE anon;
  FOREACH v_who IN ARRAY ARRAY[
      '00000000-0000-4000-8000-000000025711'::uuid,   -- owner
      '00000000-0000-4000-8000-000000025712'::uuid,   -- admin
      '00000000-0000-4000-8000-000000025713'::uuid]   -- super_admin
  LOOP
    v_out := public.project_freshness(p_project_id => v_proj, p_user_id => v_who);
    IF (v_out ->> 'project_id')::uuid IS DISTINCT FROM v_proj OR NOT (v_out ? 'tables') THEN
      RAISE EXCEPTION 'D257/650 §2: the answer for % is not a freshness payload: %', v_who, v_out;
    END IF;
  END LOOP;
  RESET ROLE;

  -- ── §3 · still refused for a reader who may not see the project ──
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.project_freshness(p_project_id => v_proj,
              p_user_id => '00000000-0000-4000-8000-000000025714');
    RAISE EXCEPTION 'D257/650 §3: a modeler who is not the owner was answered';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
END $d257b$;

-- ── §4 · unnamed, nothing set: refused (a fresh transaction, so nothing is set) ──
DO $d257c$
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.project_freshness(p_project_id => '00000000-0000-4000-8000-000000025721');
    RAISE EXCEPTION 'D257/650 §4: an unnamed anon caller was answered';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
END $d257c$;

-- ── §5 · naming no one does not blank an actor already set ──
DO $d257d$
BEGIN
  PERFORM set_config('app.current_user_id', '00000000-0000-4000-8000-000000025711', true);
  PERFORM public.project_freshness(p_project_id => '00000000-0000-4000-8000-000000025721');
  PERFORM public.project_freshness('00000000-0000-4000-8000-000000025721');
END $d257d$;

-- ── §6 · grants ──
DO $d257e$
DECLARE v_acl text;
BEGIN
  SELECT p.proacl::text INTO v_acl FROM pg_proc p
   WHERE p.proname = 'project_freshness' AND p.pronamespace = 'public'::regnamespace;
  IF v_acl IS NULL OR v_acl !~ 'anon=X' OR v_acl !~ 'authenticated=X' OR v_acl !~ 'service_role=X' THEN
    RAISE EXCEPTION 'D257/650 §6: anon, authenticated and service_role are not all explicit grantees: %', v_acl;
  END IF;
  IF v_acl ~ '(^\{|,)=X' THEN
    RAISE EXCEPTION 'D257/650 §6: PUBLIC still holds EXECUTE: %', v_acl;
  END IF;
END $d257e$;
