-- THE MANUAL, RELEASED SECTION BY SECTION — and the Q&A's answers filtered in the database.
--
-- `20261001000002` replaces the compile-time `DOCS_SUPER_ADMIN_ONLY` with a per-section
-- audience (public / internal / confidential) and adds `docs_faq`. What only a running
-- database can settle, with every reader call made AS anon — the browser's role (D155):
--
--   §1 NOTHING CHANGES ON DEPLOY: every seeded section is confidential, and an anonymous
--      reader, a signed-in user and an admin all get an empty Q&A list.
--   §2 WHO IS READING: nobody / a suspended account → public; a signed-in account →
--      internal; a super admin, or an account granted `docs_confidential` → confidential.
--   §3 REFUSAL: a non-super-admin cannot change an audience or save an answer; a bad
--      audience is refused by name.
--   §4 THE FILTER: with the Q&A section public, an anonymous reader sees the general
--      answers and those about public sections, never one about an internal or
--      confidential section, and never an unpublished one.
--   §5 AUDIT: each change writes one `admin_audit_logs` row naming the super admin.
--   §6 NO SIDE DOOR: `docs_faq` itself returns no rows to anon.

DO $docs$
DECLARE
  v_org    uuid := gen_random_uuid();
  v_super  uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_cleared uuid := gen_random_uuid();   -- a user granted docs_confidential
  v_gone   uuid := gen_random_uuid();    -- suspended
  v_draft  uuid;
  v_code   text;
  v_n      integer;
  v_level  text;
BEGIN
  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org, 'DOCS Org', 'docs-' || substr(v_org::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_super,   'docs-s@example.invalid', 'Docs Super',   'x', 'super_admin', 'DOCS Org', v_org, true),
    (v_user,    'docs-u@example.invalid', 'Docs User',    'x', 'user',        'DOCS Org', v_org, true),
    (v_admin,   'docs-a@example.invalid', 'Docs Admin',   'x', 'admin',       'DOCS Org', v_org, true),
    (v_cleared, 'docs-c@example.invalid', 'Docs Cleared', 'x', 'user',        'DOCS Org', v_org, true),
    (v_gone,    'docs-g@example.invalid', 'Docs Gone',    'x', 'user',        'DOCS Org', v_org, false);
  -- The rehearsal base is schema, not seed. On the branch that ADDS `20261001000002` the
  -- migration runs here and seeds its rows; on every branch after it merged, it is in the
  -- base and its rows are not, and §1/§4 read those rows. So plant them where they are
  -- missing — the capability, the role rows and the sixteen releases verbatim from the
  -- migration, and one published answer for each audience §4 reads (general, overview,
  -- getting-started, access) — and plant nothing when the migration seeded them (D50's rule:
  -- a planted row must no-op once its migration is in the base).
  INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
    ('docs_confidential', 'feature', 'Confidential Documentation',
     'Read the documentation sections marked Confidential', 400)
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.role_capabilities (role, capability_key, allowed)
  SELECT r.role, 'docs_confidential', r.role = 'super_admin'
    FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
  ON CONFLICT (role, capability_key) DO NOTHING;
  INSERT INTO public.docs_section_releases (section_key, audience)
  SELECT k, 'confidential'
    FROM unnest(ARRAY[
      'overview', 'getting-started', 'input-tables', 'computed-tables', 'policies',
      'verification', 'experiments', 'networks', 'project-intelligence', 'connectors',
      'results', 'exports', 'access', 'developer-api', 'reference', 'questions'
    ]) AS k
  ON CONFLICT (section_key) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.docs_faq) THEN
    INSERT INTO public.docs_faq (question, answer, section_key, related_slugs, sort_order, is_published) VALUES
      ('DOCS/540 general?',         'Planted.', NULL,              '{}', 10, true),
      ('DOCS/540 overview?',        'Planted.', 'overview',        '{}', 20, true),
      ('DOCS/540 getting started?', 'Planted.', 'getting-started', '{}', 30, true),
      ('DOCS/540 access?',          'Planted.', 'access',          '{}', 40, true);
  END IF;
  INSERT INTO public.user_capabilities (user_id, capability_key, allowed)
  VALUES (v_cleared, 'docs_confidential', true);

  PERFORM set_config('app.current_user_id', '', true);

  -- ══ §1 · nothing changes on deploy ══
  SELECT count(*) INTO v_n FROM public.docs_section_releases WHERE audience <> 'confidential';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'DOCS/540 §1: % seeded sections are not confidential', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.docs_faq WHERE is_published;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'DOCS/540 §1: no prepared answers were seeded';
  END IF;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.docs_list_faq(NULL);
  IF v_n <> 0 THEN RAISE EXCEPTION 'DOCS/540 §1: anonymous reader saw % answers on deploy', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.docs_list_faq(v_user);
  IF v_n <> 0 THEN RAISE EXCEPTION 'DOCS/540 §1: a signed-in user saw % answers on deploy', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.docs_list_faq(v_admin);
  IF v_n <> 0 THEN RAISE EXCEPTION 'DOCS/540 §1: an admin saw % answers on deploy', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.docs_list_faq(v_super);
  IF v_n = 0 THEN RAISE EXCEPTION 'DOCS/540 §1: the super admin saw no answers'; END IF;
  RESET ROLE;

  -- ══ §2 · who is reading ══
  SET LOCAL ROLE anon;
  v_level := public.docs_reader_level(NULL);
  IF v_level <> 'public' THEN RAISE EXCEPTION 'DOCS/540 §2: nobody read as %', v_level; END IF;
  v_level := public.docs_reader_level(gen_random_uuid());
  IF v_level <> 'public' THEN RAISE EXCEPTION 'DOCS/540 §2: an unknown id read as %', v_level; END IF;
  v_level := public.docs_reader_level(v_gone);
  IF v_level <> 'public' THEN RAISE EXCEPTION 'DOCS/540 §2: a suspended account read as %', v_level; END IF;
  v_level := public.docs_reader_level(v_user);
  IF v_level <> 'internal' THEN RAISE EXCEPTION 'DOCS/540 §2: a user read as %', v_level; END IF;
  v_level := public.docs_reader_level(v_admin);
  IF v_level <> 'internal' THEN RAISE EXCEPTION 'DOCS/540 §2: an ungranted admin read as %', v_level; END IF;
  v_level := public.docs_reader_level(v_cleared);
  IF v_level <> 'confidential' THEN RAISE EXCEPTION 'DOCS/540 §2: a granted user read as %', v_level; END IF;
  v_level := public.docs_reader_level(v_super);
  IF v_level <> 'confidential' THEN RAISE EXCEPTION 'DOCS/540 §2: the super admin read as %', v_level; END IF;
  RESET ROLE;

  -- ══ §3 · refusal ══
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_docs_section_audience(v_admin, 'docs-a@example.invalid', 'questions', 'public');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'DOCS/540 §3: an admin changing an audience got %, expected forbidden', COALESCE(v_code, 'success');
  END IF;
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_save_docs_faq(v_admin, 'docs-a@example.invalid', NULL, 'Q?', 'A.', NULL, '{}', 0, true);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'DOCS/540 §3: an admin saving an answer got %, expected forbidden', COALESCE(v_code, 'success');
  END IF;
  v_code := NULL;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.admin_set_docs_section_audience(v_super, 'docs-s@example.invalid', 'questions', 'everyone');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'invalid audience everyone' THEN
    RAISE EXCEPTION 'DOCS/540 §3: a bad audience got %', COALESCE(v_code, 'success');
  END IF;

  -- ══ §4 · the filter ══
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_docs_section_audience(v_super, 'docs-s@example.invalid', 'questions', 'public');
  PERFORM public.admin_set_docs_section_audience(v_super, 'docs-s@example.invalid', 'overview', 'public');
  PERFORM public.admin_set_docs_section_audience(v_super, 'docs-s@example.invalid', 'getting-started', 'internal');
  v_draft := public.admin_save_docs_faq(v_super, 'docs-s@example.invalid', NULL,
    'DOCS/540 draft question', 'Not yet.', NULL, '{}', 0, false);
  RESET ROLE;

  SET LOCAL ROLE anon;
  -- anonymous: general answers and overview answers only
  SELECT count(*) INTO v_n FROM public.docs_list_faq(NULL)
   WHERE section_key IS NOT NULL AND section_key <> 'overview';
  IF v_n <> 0 THEN RAISE EXCEPTION 'DOCS/540 §4: anonymous reader saw % answers about closed sections', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.docs_list_faq(NULL) WHERE section_key = 'overview';
  IF v_n = 0 THEN RAISE EXCEPTION 'DOCS/540 §4: anonymous reader saw no overview answers'; END IF;
  SELECT count(*) INTO v_n FROM public.docs_list_faq(NULL) WHERE section_key IS NULL;
  IF v_n = 0 THEN RAISE EXCEPTION 'DOCS/540 §4: anonymous reader saw no general answers'; END IF;
  -- signed in: internal sections too, confidential ones still not
  SELECT count(*) INTO v_n FROM public.docs_list_faq(v_user) WHERE section_key = 'getting-started';
  IF v_n = 0 THEN RAISE EXCEPTION 'DOCS/540 §4: a user saw no getting-started answers'; END IF;
  SELECT count(*) INTO v_n FROM public.docs_list_faq(v_user)
   WHERE section_key IS NOT NULL AND section_key NOT IN ('overview', 'getting-started');
  IF v_n <> 0 THEN RAISE EXCEPTION 'DOCS/540 §4: a user saw % confidential answers', v_n; END IF;
  -- granted: everything published
  SELECT count(*) INTO v_n FROM public.docs_list_faq(v_cleared) WHERE section_key = 'access';
  IF v_n = 0 THEN RAISE EXCEPTION 'DOCS/540 §4: a granted user saw no confidential answers'; END IF;
  -- nobody sees a draft
  SELECT count(*) INTO v_n FROM public.docs_list_faq(v_super) WHERE id = v_draft;
  IF v_n <> 0 THEN RAISE EXCEPTION 'DOCS/540 §4: an unpublished answer was listed to a reader'; END IF;
  -- and the admin list does
  SELECT count(*) INTO v_n FROM public.admin_list_docs_faq(v_super, 'docs-s@example.invalid') WHERE id = v_draft;
  IF v_n <> 1 THEN RAISE EXCEPTION 'DOCS/540 §4: the admin list did not include the draft'; END IF;
  RESET ROLE;

  -- ══ §5 · audit ══
  SELECT count(*) INTO v_n FROM public.admin_audit_logs
   WHERE action = 'docs.section_audience' AND target_id = 'questions' AND actor_user_id = v_super;
  IF v_n <> 1 THEN RAISE EXCEPTION 'DOCS/540 §5: % audit rows for the questions audience, expected 1', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.admin_audit_logs
   WHERE action = 'docs.faq_create' AND target_id = v_draft::text AND actor_user_id = v_super;
  IF v_n <> 1 THEN RAISE EXCEPTION 'DOCS/540 §5: % audit rows for the draft, expected 1', v_n; END IF;
  -- a no-op change writes nothing
  SET LOCAL ROLE anon;
  PERFORM public.admin_set_docs_section_audience(v_super, 'docs-s@example.invalid', 'questions', 'public');
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.admin_audit_logs
   WHERE action = 'docs.section_audience' AND target_id = 'questions';
  IF v_n <> 1 THEN RAISE EXCEPTION 'DOCS/540 §5: a no-op change wrote an audit row'; END IF;
  SET LOCAL ROLE anon;
  PERFORM public.admin_delete_docs_faq(v_super, 'docs-s@example.invalid', v_draft);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.docs_faq WHERE id = v_draft;
  IF v_n <> 0 THEN RAISE EXCEPTION 'DOCS/540 §5: the delete left the row'; END IF;

  -- ══ §6 · no side door ══
  SET LOCAL ROLE anon;
  v_code := NULL;
  BEGIN
    SELECT count(*) INTO v_n FROM public.docs_faq;
  EXCEPTION WHEN insufficient_privilege THEN v_n := 0; v_code := 'denied';
  END;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'DOCS/540 §6: anon read % rows of docs_faq directly', v_n; END IF;

  RAISE NOTICE 'DOCS/540: section audiences and the Q&A filter hold';
END $docs$;
