-- §4 D278 · AN ACCOUNT ROLE CHANGE REACHES THE ORGANIZATION ROLE, SAYS WHAT IT DID NOT
-- CHANGE, AND THE ACCOUNTS IT LEFT BEHIND ARE READABLE.
--
-- `20261002000006` re-creates `admin_set_user_role` (now returning a summary) and adds
-- `admin_list_account_role_gaps`. What only a running database can settle:
--
--   §1 PROMOTION: user → admin lifts the ACTIVE organization's `member` to `admin`, and
--      leaves the account's membership of a second organization at `member`.
--   §2 THE SUMMARY: it names the organization move, a planted person override and a
--      planted organization override that now differ from the admin default, and the
--      Viewer project whose role refuses what the account now allows — with exactly the
--      keys D276's rule says, not the ones an override decides.
--   §3 OWNER: an organization `owner` stays `owner` through admin and back.
--   §4 DEMOTION: admin → modeler lowers the active `admin` to `member`, the second
--      organization still untouched; an account created as admin (whose membership the
--      trigger made `admin`) demoted to `user` loses organization key management
--      (`_api_key_caller.can_manage`), which before D278 it kept.
--   §5 ATTRIBUTION: every `user.org_role_change` row names the actor the caller passed,
--      with the session GUC POISONED before each call — and none names the poison.
--   §6 THE GAP READ: an admin account left at `member` is listed; a fixed one is not; a
--      non-super actor is refused.
--   §7 GRANTS: DROP and CREATE kept `anon` and `authenticated` as EXPLICIT grantees in
--      `proacl` (never `has_function_privilege`, which PUBLIC's default makes vacuous),
--      and PUBLIC holds nothing. Measured, not assumed: deleting the migration's GRANT line
--      stays GREEN, because Supabase's default privileges (which `rehearsal-schema.mjs`
--      reproduces) grant `anon` and `authenticated` EXECUTE on every new function. The GRANT
--      is kept as the record of intent; what §7 can catch is a REVOKE, and the PUBLIC half.

DO $d278$
DECLARE
  v_org_a   uuid := gen_random_uuid();
  v_org_b   uuid := gen_random_uuid();
  v_super   uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();   -- modeler, owns p; organization OWNER of A
  v_prom    uuid := gen_random_uuid();   -- 'user', active in A, also a member of B; viewer on p
  v_born    uuid := gen_random_uuid();   -- created as 'admin' in A (membership admin by the trigger)
  v_gap     uuid := gen_random_uuid();   -- 'admin' whose A membership is 'member' (the old body's leftover)
  v_plain   uuid := gen_random_uuid();   -- 'modeler', not a super admin
  v_p       uuid := gen_random_uuid();
  v_poison  uuid := gen_random_uuid();
  v_r       jsonb;
  v_n       integer;
  v_s       text;
  v_code    text;
  v_manage  boolean;
  v_base    integer;   -- organization-role rows the setup itself wrote
BEGIN
  -- ── the catalog the base lacks, as the migrations seed it ────────────────
  INSERT INTO public.capabilities (key, kind, label, sort_order) VALUES
    ('simulation_lab', 'feature', 'Run Simulations', 220),
    ('data_edit_inputs', 'feature', 'Edit Input Data', 241),
    ('data_edit_policies', 'feature', 'Edit Policies', 242),
    ('export', 'feature', 'Export', 250)
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.project_role_capabilities (project_role, capability_key, allowed) VALUES
    ('owner',   'data_edit_inputs', true),  ('owner',   'data_edit_policies', true),
    ('owner',   'export', true),            ('owner',   'simulation_lab', true),
    ('editor',  'data_edit_inputs', true),  ('editor',  'data_edit_policies', true),
    ('editor',  'export', true),            ('editor',  'simulation_lab', true),
    ('analyst', 'data_edit_inputs', false), ('analyst', 'data_edit_policies', false),
    ('analyst', 'export', false),           ('analyst', 'simulation_lab', true),
    ('viewer',  'data_edit_inputs', false), ('viewer',  'data_edit_policies', false),
    ('viewer',  'export', false),           ('viewer',  'simulation_lab', false)
  ON CONFLICT (project_role, capability_key) DO NOTHING;
  INSERT INTO public.role_capabilities (role, capability_key, allowed)
  SELECT r.role, k.key, r.role <> 'user' OR k.key = 'export'
    FROM (VALUES ('super_admin'), ('admin'), ('modeler'), ('user')) r(role)
    CROSS JOIN (VALUES ('data_edit_inputs'), ('data_edit_policies'), ('export'), ('simulation_lab')) k(key)
  ON CONFLICT (role, capability_key) DO NOTHING;
  -- This rehearsal asserts against the seed's admin column; pin it where an earlier file planted others.
  UPDATE public.role_capabilities SET allowed = true
   WHERE role = 'admin' AND capability_key IN ('data_edit_inputs', 'data_edit_policies', 'export', 'simulation_lab');

  INSERT INTO public.organizations (id, name, slug) VALUES
    (v_org_a, 'D278 Org A', 'd278a-' || substr(v_org_a::text, 1, 8)),
    (v_org_b, 'D278 Org B', 'd278b-' || substr(v_org_b::text, 1, 8));
  INSERT INTO public.approved_users (id, email, name, password_hash, role, organization, organization_id, is_active) VALUES
    (v_super, 'd278s@example.invalid', 'D278 Super',    'x', 'super_admin', 'D278 Org A', v_org_a, true),
    (v_owner, 'd278o@example.invalid', 'D278 Owner',    'x', 'modeler',     'D278 Org A', v_org_a, true),
    (v_prom,  'd278u@example.invalid', 'D278 Promoted', 'x', 'user',        'D278 Org A', v_org_a, true),
    (v_born,  'd278b@example.invalid', 'D278 Born',     'x', 'admin',       'D278 Org A', v_org_a, true),
    (v_gap,   'd278g@example.invalid', 'D278 Gap',      'x', 'admin',       'D278 Org A', v_org_a, true),
    (v_plain, 'd278m@example.invalid', 'D278 Plain',    'x', 'modeler',     'D278 Org A', v_org_a, true);
  INSERT INTO public.projects (id, name, modeler_id, plant_name, organization, organization_id, bom_level) VALUES
    (v_p, 'D278 p', v_owner, 'D278P', 'D278 Org A', v_org_a, 'single');

  PERFORM public.admin_add_org_member(v_super, 'd278s@example.invalid', v_prom, v_org_b, 'member');
  PERFORM public.admin_set_user_org_role(v_super, 'd278s@example.invalid', v_owner, v_org_a, 'owner');
  PERFORM public.admin_set_project_member(v_super, 'd278s@example.invalid', v_prom, v_p, 'viewer', NULL, 'D278');
  -- The old body's leftover, planted the way it arose: an admin account, a member membership.
  UPDATE public.organization_members SET org_role = 'member' WHERE user_id = v_gap AND org_id = v_org_a;
  -- A person override (Run Simulations off) and an organization override (Export off),
  -- both against the admin default of on.
  INSERT INTO public.user_capabilities (user_id, capability_key, allowed) VALUES (v_prom, 'simulation_lab', false);
  INSERT INTO public.org_capabilities (org_id, capability_key, allowed) VALUES (v_org_a, 'export', false);

  IF (SELECT org_role FROM public.organization_members WHERE user_id = v_prom AND org_id = v_org_a) IS DISTINCT FROM 'member'
     OR (SELECT org_role FROM public.organization_members WHERE user_id = v_born AND org_id = v_org_a) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'D278/740 setup: the membership trigger did not map the account roles as assumed';
  END IF;
  -- The setup's own `admin_set_user_org_role` (the owner) wrote one; §5 counts what follows.
  SELECT count(*) INTO v_base FROM public.admin_audit_logs
   WHERE action = 'user.org_role_change' AND actor_user_id = v_super
     AND target_id IN (v_prom::text, v_born::text, v_owner::text);

  -- ── §1 promotion ─────────────────────────────────────────────────────────
  PERFORM set_config('app.current_user_id', v_poison::text, true);
  v_r := public.admin_set_user_role(v_super, 'd278s@example.invalid', v_prom, 'admin');
  IF (SELECT org_role FROM public.organization_members WHERE user_id = v_prom AND org_id = v_org_a) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'D278/740 §1: promotion to admin left the active organization membership at %',
      (SELECT org_role FROM public.organization_members WHERE user_id = v_prom AND org_id = v_org_a);
  END IF;
  IF (SELECT org_role FROM public.organization_members WHERE user_id = v_prom AND org_id = v_org_b) IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'D278/740 §1: promotion moved the membership of an organization that is not active';
  END IF;

  -- ── §2 the summary ───────────────────────────────────────────────────────
  IF v_r ->> 'role_before' IS DISTINCT FROM 'user' OR v_r ->> 'role_after' IS DISTINCT FROM 'admin'
     OR v_r -> 'org' ->> 'org_id' IS DISTINCT FROM v_org_a::text
     OR v_r -> 'org' ->> 'org_role_before' IS DISTINCT FROM 'member'
     OR v_r -> 'org' ->> 'org_role_after' IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'D278/740 §2: the summary misreports the change: %', v_r;
  END IF;
  IF NOT (v_r -> 'overrides') @> '[{"key":"simulation_lab","layer":"person","allowed":false,"role_default":true}]'
     OR NOT (v_r -> 'overrides') @> '[{"key":"export","layer":"organization","allowed":false,"role_default":true}]'
     OR jsonb_array_length(v_r -> 'overrides') <> 2 THEN
    RAISE EXCEPTION 'D278/740 §2: the overrides that still decide read as %', v_r -> 'overrides';
  END IF;
  -- Viewer on p: Edit Input Data and Edit Policies are the project role's refusals of
  -- rights the admin account holds. Run Simulations is the person override's, and Export
  -- the organization's, so neither belongs here.
  SELECT string_agg(k ->> 'key', ',' ORDER BY k ->> 'key') INTO v_s
    FROM jsonb_array_elements(v_r -> 'narrowed_projects') np,
         jsonb_array_elements(np -> 'keys') k
   WHERE np ->> 'project_id' = v_p::text AND np ->> 'project_role' = 'viewer';
  IF v_s IS DISTINCT FROM 'data_edit_inputs,data_edit_policies' OR jsonb_array_length(v_r -> 'narrowed_projects') <> 1 THEN
    RAISE EXCEPTION 'D278/740 §2: the narrowed projects read as % (keys %)', v_r -> 'narrowed_projects', v_s;
  END IF;

  -- ── §3 owner is never touched ────────────────────────────────────────────
  PERFORM set_config('app.current_user_id', v_poison::text, true);
  v_r := public.admin_set_user_role(v_super, 'd278s@example.invalid', v_owner, 'admin');
  IF (SELECT org_role FROM public.organization_members WHERE user_id = v_owner AND org_id = v_org_a) IS DISTINCT FROM 'owner'
     OR v_r -> 'org' ->> 'org_role_after' IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'D278/740 §3: promoting an organization owner changed the owner role (%)', v_r -> 'org';
  END IF;
  PERFORM set_config('app.current_user_id', v_poison::text, true);
  PERFORM public.admin_set_user_role(v_super, 'd278s@example.invalid', v_owner, 'user');
  IF (SELECT org_role FROM public.organization_members WHERE user_id = v_owner AND org_id = v_org_a) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'D278/740 §3: demoting an organization owner from admin changed the owner role';
  END IF;

  -- ── §4 demotion ──────────────────────────────────────────────────────────
  PERFORM set_config('app.current_user_id', v_poison::text, true);
  v_r := public.admin_set_user_role(v_super, 'd278s@example.invalid', v_prom, 'modeler');
  IF (SELECT org_role FROM public.organization_members WHERE user_id = v_prom AND org_id = v_org_a) IS DISTINCT FROM 'member'
     OR v_r -> 'org' ->> 'org_role_before' IS DISTINCT FROM 'admin'
     OR v_r -> 'org' ->> 'org_role_after' IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'D278/740 §4: leaving admin did not revert the active membership (%)', v_r -> 'org';
  END IF;
  IF (SELECT org_role FROM public.organization_members WHERE user_id = v_prom AND org_id = v_org_b) IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'D278/740 §4: demotion moved the membership of an organization that is not active';
  END IF;
  -- The right the old body let a demoted admin keep.
  SELECT c.can_manage INTO v_manage FROM public._api_key_caller(v_born, NULL) c;
  IF v_manage IS NOT TRUE THEN
    RAISE EXCEPTION 'D278/740 §4 setup: an admin account does not manage its organization''s keys';
  END IF;
  PERFORM set_config('app.current_user_id', v_poison::text, true);
  PERFORM public.admin_set_user_role(v_super, 'd278s@example.invalid', v_born, 'user');
  SELECT c.can_manage INTO v_manage FROM public._api_key_caller(v_born, NULL) c;
  IF v_manage IS NOT FALSE
     OR (SELECT org_role FROM public.organization_members WHERE user_id = v_born AND org_id = v_org_a) IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'D278/740 §4: an admin demoted to user still manages the organization''s API keys';
  END IF;
  PERFORM set_config('app.current_user_id', '', true);

  -- ── §5 attribution ───────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.admin_audit_logs
   WHERE action = 'user.org_role_change' AND actor_user_id = v_super
     AND target_id IN (v_prom::text, v_born::text, v_owner::text);
  IF v_n - v_base <> 3 THEN
    RAISE EXCEPTION 'D278/740 §5: % organization-role audit row(s) name the super admin, expected 3 (promote, demote, born-admin demote; none for the owner)', v_n - v_base;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_audit_logs
                  WHERE action = 'user.org_role_change' AND target_id = v_prom::text
                    AND before = jsonb_build_object('org_id', v_org_a, 'org_role', 'member')
                    AND after  = jsonb_build_object('org_id', v_org_a, 'org_role', 'admin')) THEN
    RAISE EXCEPTION 'D278/740 §5: the promotion''s audit row is not in admin_set_user_org_role''s shape';
  END IF;
  SELECT count(*) INTO v_n FROM public.admin_audit_logs WHERE actor_user_id = v_poison;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'D278/740 §5: % audit row(s) name the poisoned session instead of the actor', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.admin_audit_logs
   WHERE action = 'user.role_change' AND actor_user_id = v_super
     AND target_id IN (v_prom::text, v_born::text, v_owner::text);
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'D278/740 §5: % account-role audit row(s), expected 5', v_n;
  END IF;

  -- ── §6 the gap read ──────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.admin_list_account_role_gaps(v_super, 'd278s@example.invalid') g
   WHERE g.user_id = v_gap AND g.org_id = v_org_a AND g.org_role = 'member';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D278/740 §6: the admin account left at member is not listed';
  END IF;
  SELECT count(*) INTO v_n FROM public.admin_list_account_role_gaps(v_super, 'd278s@example.invalid') g
   WHERE g.user_id IN (v_prom, v_born, v_owner, v_super, v_plain);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'D278/740 §6: % account(s) without the gap are listed', v_n;
  END IF;
  PERFORM public.admin_set_user_org_role(v_super, 'd278s@example.invalid', v_gap, v_org_a, 'admin');
  IF EXISTS (SELECT 1 FROM public.admin_list_account_role_gaps(v_super, 'd278s@example.invalid') g WHERE g.user_id = v_gap) THEN
    RAISE EXCEPTION 'D278/740 §6: the one-click fix did not clear the gap';
  END IF;
  v_code := NULL;
  BEGIN
    PERFORM * FROM public.admin_list_account_role_gaps(v_plain, 'd278m@example.invalid');
  EXCEPTION WHEN OTHERS THEN v_code := SQLERRM;
  END;
  IF v_code IS DISTINCT FROM 'forbidden' THEN
    RAISE EXCEPTION 'D278/740 §6: a non-super actor read the gaps (%)', COALESCE(v_code, 'success');
  END IF;
  PERFORM set_config('app.current_user_id', '', true);

  -- ── §7 grants ────────────────────────────────────────────────────────────
  SELECT string_agg(f.fn || '/' || f.nargs || ' → ' || f.role, ', ' ORDER BY f.fn, f.role) INTO v_s
  FROM (VALUES
    ('admin_set_user_role',          4, 'anon'),
    ('admin_set_user_role',          4, 'authenticated'),
    ('admin_list_account_role_gaps', 2, 'anon'),
    ('admin_list_account_role_gaps', 2, 'authenticated')
  ) AS f(fn, nargs, role)
  WHERE NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
     WHERE n.nspname = 'public' AND p.proname = f.fn AND p.pronargs = f.nargs
       AND acl.privilege_type = 'EXECUTE'
       AND pg_get_userbyid(acl.grantee) = f.role);
  IF v_s IS NOT NULL THEN
    RAISE EXCEPTION 'D278/740 §7: these EXPLICIT grants are missing: %', v_s;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
     WHERE n.nspname = 'public'
       AND p.proname IN ('admin_set_user_role', 'admin_list_account_role_gaps')
       AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'D278/740 §7: PUBLIC holds EXECUTE on a super-admin verb';
  END IF;
  IF (SELECT format_type(p.prorettype, NULL) FROM pg_proc p
       WHERE p.proname = 'admin_set_user_role' AND p.pronamespace = 'public'::regnamespace) IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'D278/740 §7: admin_set_user_role does not return its summary';
  END IF;

  RAISE NOTICE 'D278/740: an account role change moves the active organization''s member/admin role and nothing else, names what still decides, and is attributed';
END $d278$;
