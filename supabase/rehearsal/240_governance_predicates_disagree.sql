-- WP 6.2 · THE TWO GOVERNANCE PREDICATES DISAGREE, AND THE ORG STAMP HAS HOLES.
--
-- This file adds NO capability. It pins two facts that decide whether a later
-- package may ship a one-line change, and both are facts about what live
-- functions DO — which is why they are here and not in a source-level test.
--
-- ── WHY IT EXISTS ───────────────────────────────────────────────────────────
--
-- §4 D66 says `min_project_role` is declared on every table and read by nothing,
-- and its "Closed by" cell proposes the remedy: "Moving RLS onto
-- `effective_project_role` is `min_project_role` finally being enforced rather
-- than declared, and it is a per-table change with tests, the same shape as D38."
--
-- WP 6.2 measured that and the premise is FALSE. The two predicates disagree in
-- BOTH directions, and one of the disagreements takes access away from a live
-- class of user:
--
--   · an organization ADMIN who is not the project's modeler passes
--     `has_project_access` — the predicate 59 project-scoped policies call — and
--     holds NO project role at all;
--   · a genuine project EDITOR who is not the modeler holds `editor` and FAILS
--     `has_project_access`.
--
-- §4 D66 records only the second. The first is what makes the remedy
-- product-breaking rather than per-table: swapping the predicate revokes every
-- admin's access to every project they did not create. `20260917000005` already
-- found this on `combine-project`'s live path and removed a role gate for it — so
-- the evidence existed and was never written down as D66's blocker.
--
-- §4 D96 asks for `NOT NULL` on `approved_users.organization_id` and says it needs
-- a FRESH §15 read. The read is clean (14 rows, 0 null, 2026-09-19) and the
-- constraint is STILL unsafe, because that read measures EXISTING rows and the
-- constraint governs FUTURE inserts. Sections 3 and 4 are the measurement that
-- actually decides.
--
-- ── WHAT ONLY A DATABASE CAN SAY ────────────────────────────────────────────
--
-- Every claim below is about what a function RETURNS for a principal that exists.
-- `has_project_access` reads a session GUC, resolves an `approved_users` row and
-- compares a role; `effective_project_role` unions membership with live
-- delegations and applies expiry. Reading both bodies tells you they ask different
-- questions. Only executing them tells you the ANSWERS differ for a real user, in
-- which direction, and for whom.

DO $wp62gov$
DECLARE
  v_org      uuid;
  v_modeler  uuid;
  v_admin    uuid;
  v_editor   uuid;
  v_project  uuid;
  v_access   boolean;
  v_role     text;
  v_org_id   uuid;
  v_txt      text;
BEGIN
  INSERT INTO public.organizations (name, slug)
    VALUES ('WP62 Governance', 'wp62-governance') RETURNING id INTO v_org;

  INSERT INTO public.approved_users (name, email, password_hash, role, organization_id)
    VALUES ('WP62 Modeler', 'wp62-modeler@example.invalid', 'x', 'user', v_org)
    RETURNING id INTO v_modeler;
  -- `role` here is the APPLICATION role (`app_role`), not a project role. An
  -- `admin` is an organization administrator; `super_admin` is the platform.
  INSERT INTO public.approved_users (name, email, password_hash, role, organization_id)
    VALUES ('WP62 Admin', 'wp62-admin@example.invalid', 'x', 'admin', v_org)
    RETURNING id INTO v_admin;
  INSERT INTO public.approved_users (name, email, password_hash, role, organization_id)
    VALUES ('WP62 Editor', 'wp62-editor@example.invalid', 'x', 'user', v_org)
    RETURNING id INTO v_editor;

  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (gen_random_uuid(), 'WP62 Governance', v_modeler, 'WP62G')
    RETURNING id INTO v_project;

  -- A GENUINE member, not a delegation: `project_members` with a standing role.
  INSERT INTO public.project_members (project_id, user_id, project_role, rationale)
    VALUES (v_project, v_editor, 'editor', 'WP 6.2 · D66 measurement')
    ON CONFLICT (project_id, user_id) DO UPDATE SET project_role = 'editor';

  -- ── 1 · THE MODELER IS THE CASE THE TWO PREDICATES AGREE ON ───────────────
  --
  -- Asserted first because it is the baseline: if this failed, the disagreements
  -- below would be evidence of a broken fixture rather than of a divergence.
  PERFORM set_config('app.current_user_id', v_modeler::text, true);
  IF NOT public.has_project_access(v_project) THEN
    RAISE EXCEPTION 'WP 6.2 / D66: the project''s own modeler fails has_project_access — the fixture is wrong, not the finding';
  END IF;
  IF public.effective_project_role(v_modeler, v_project) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'WP 6.2 / D66: the modeler holds project role %, expected owner (the D61 trigger did not fire)',
      COALESCE(public.effective_project_role(v_modeler, v_project), '(NULL)');
  END IF;

  -- ── 2a · THE DIVERGENCE §4 D66 ALREADY RECORDS ────────────────────────────
  --
  -- An editor who is a genuine member and is not the modeler: holds a role, and
  -- the row rules refuse them. This is the half `rehearsal/100` found by running.
  PERFORM set_config('app.current_user_id', v_editor::text, true);
  v_access := public.has_project_access(v_project);
  v_role   := public.effective_project_role(v_editor, v_project);
  IF v_role IS DISTINCT FROM 'editor' THEN
    RAISE EXCEPTION 'WP 6.2 / D66: the editor holds project role %, expected editor', COALESCE(v_role, '(NULL)');
  END IF;
  IF v_access THEN
    RAISE EXCEPTION
      'WP 6.2 / D66: a genuine editor now PASSES has_project_access. That is an '
      'improvement and it changes the remedy — re-measure the divergence and '
      'correct §4 D66 rather than deleting this assertion.';
  END IF;

  -- ── 2b · THE DIVERGENCE §4 D66 DOES NOT RECORD, AND IT IS THE BLOCKER ─────
  --
  -- An organization admin who is not the modeler and holds NO membership:
  -- `has_project_access` says yes (its second branch is
  -- `get_current_approved_user().user_role = 'admin'`), and
  -- `effective_project_role` says NULL — its only unconditional grant is
  -- `is_super_admin`, which an `admin` is not.
  --
  -- SO MOVING RLS ONTO `effective_project_role` WOULD REVOKE EVERY ADMIN'S ACCESS
  -- TO EVERY PROJECT THEY DID NOT CREATE. That is not a per-table change with
  -- tests; it needs `effective_project_role` to learn what an organization admin
  -- is in project terms first, which is a governance-vocabulary decision and
  -- belongs with the auth model (D28 / WP 7.1).
  PERFORM set_config('app.current_user_id', v_admin::text, true);
  v_access := public.has_project_access(v_project);
  v_role   := public.effective_project_role(v_admin, v_project);
  IF NOT v_access THEN
    RAISE EXCEPTION
      'WP 6.2 / D66: an organization admin no longer passes has_project_access. '
      'If that is deliberate, the RLS move may now be possible — re-measure and '
      'correct §4 D66.';
  END IF;
  IF v_role IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 6.2 / D66: an organization admin now holds project role %, so '
      'effective_project_role has learned about the admin role. THE BLOCKER IS '
      'GONE and the RLS move is back on the table — say so in §16 rather than '
      'removing this assertion.', v_role;
  END IF;

  -- ── 2c · THE RANK COMPARISON IS THE THING THAT WOULD BE WRITTEN ───────────
  --
  -- `min_project_role` would be enforced as
  -- `project_role_rank(effective_project_role(…)) >= project_role_rank(<declared>)`.
  --
  -- THE FIRST DRAFT OF THIS SECTION ASSERTED THE WRONG MECHANISM, and the
  -- rehearsal said so on its first run. It claimed the admin's rank would be NULL
  -- and the predicate would deny by three-valued logic. `project_role_rank` ends
  -- `ELSE 0 -- unknown or NULL ranks below every real role`, so the rank is 0 and
  -- the comparison is a clean, deterministic FALSE.
  --
  -- That is a better fact than the one intended: the deny is unambiguous, not a
  -- NULL propagating through a USING clause. It also means the enforcement would
  -- silently lock the admin out rather than erroring — no exception, no log line,
  -- just rows that stop being visible. Which is exactly why this measurement had
  -- to be taken before the change and not after it.
  IF public.project_role_rank(public.effective_project_role(v_admin, v_project)) <> 0 THEN
    RAISE EXCEPTION
      'WP 6.2 / D66: project_role_rank of a non-member is %, expected 0 — the '
      'enforcement shape changed and the blast radius must be re-measured',
      public.project_role_rank(public.effective_project_role(v_admin, v_project));
  END IF;
  -- And 0 loses to every declared minimum, `viewer` included — so the enforcement
  -- would deny an admin even on a table declared at the loosest role in the
  -- vocabulary. The disagreement is total, not marginal.
  IF public.project_role_rank(public.effective_project_role(v_admin, v_project))
       >= public.project_role_rank('viewer') THEN
    RAISE EXCEPTION 'WP 6.2 / D66: a non-member now outranks viewer — the rank vocabulary changed';
  END IF;

  -- ── 3 · D96 · THE ORG STAMP CANNOT FILL THE DEFAULT PATH ──────────────────
  --
  -- §4 D96 wants `NOT NULL` on `approved_users.organization_id` and gates it on a
  -- fresh §15 read. The read is clean and the constraint is still unsafe, because
  -- the read measures EXISTING rows while the constraint governs FUTURE inserts.
  --
  -- `approved_users_stamp_organization_id` fills a blank only when the
  -- `organization` TEXT matches exactly one organization. The column's DEFAULT is
  -- `'default_org'`, and production has no organization of that name — so the
  -- ordinary create-a-user path produces a NULL uuid, and `NOT NULL` would REJECT
  -- IT. That is D96's own lesson turned on D96's own proposed check: a measurement
  -- is not an invariant, and this measurement was of the wrong population.
  INSERT INTO public.approved_users (name, email, password_hash)
    VALUES ('WP62 Default Org', 'wp62-default@example.invalid', 'x')
    RETURNING organization, organization_id INTO v_txt, v_org_id;
  IF v_txt <> 'default_org' THEN
    RAISE EXCEPTION 'WP 6.2 / D96: the organization text default is now "%", not default_org — re-measure', v_txt;
  END IF;
  IF v_org_id IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 6.2 / D96: the DEFAULT insert path now resolves an organization uuid '
      '(%). Something created an organization named default_org, or the trigger '
      'changed — either way NOT NULL may now be safe, which is a §16 entry and '
      'not a deleted assertion.', v_org_id;
  END IF;

  -- The trigger DOES work where the text is unambiguous, and asserting that is
  -- what stops this section reading as "the trigger is broken". It is not broken;
  -- it refuses to guess, which is correct (D13 — the uuid is the authority).
  INSERT INTO public.approved_users (name, email, password_hash, organization)
    VALUES ('WP62 Matched', 'wp62-matched@example.invalid', 'x', 'WP62 Governance')
    RETURNING organization_id INTO v_org_id;
  IF v_org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'WP 6.2 / D96: an unambiguous organization name stamped %, expected %', v_org_id, v_org;
  END IF;

  -- ── 4 · D96 · AND IT REFUSES TO CHOOSE BETWEEN TWO NAMESAKES ─────────────
  --
  -- D29's collision is latent — `organizations.name` has no unique constraint —
  -- and it is the second hole in the stamp. Refusing is right; the consequence is
  -- that `NOT NULL` would reject this insert too.
  INSERT INTO public.organizations (name, slug) VALUES ('WP62 Twin', 'wp62-twin-a');
  INSERT INTO public.organizations (name, slug) VALUES ('WP62 Twin', 'wp62-twin-b');
  INSERT INTO public.approved_users (name, email, password_hash, organization)
    VALUES ('WP62 Ambiguous', 'wp62-ambiguous@example.invalid', 'x', 'WP62 Twin')
    RETURNING organization_id INTO v_org_id;
  IF v_org_id IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 6.2 / D96: two organizations share a name and the stamp chose % anyway. '
      'A trigger that guesses which organization a user belongs to is worse than '
      'a NULL, because the NULL is visible (D13).', v_org_id;
  END IF;

  -- ── 5 · D96 · THE TWO COLUMNS ARE STAMPED BY TWO DIFFERENT MECHANISMS ────
  --
  -- The second unowned read in D96 is "whether the same one-off-backfill shape
  -- exists on the other uuid columns D27 introduced". It does, on exactly ONE
  -- other column — `projects.organization_id` — and this section is the part that
  -- was got wrong by reading rather than running.
  --
  -- THE FIRST DRAFT ASSERTED `projects` HAS NO STAMP. It has one, and a better
  -- one: `set_project_defaults` fills the uuid from THE CREATING USER'S OWN
  -- `organization_id` (`get_current_user_org_id`), not from a text match. No name
  -- ambiguity is possible, so D29's collision cannot reach it.
  --
  -- What it does inherit is the OTHER column's hole, through the creator: a user
  -- whose own `organization_id` is NULL creates a project whose uuid is NULL. That
  -- is the chain behind §15's "1 of 10 projects with a NULL org uuid", and it is
  -- why the two columns cannot be constrained independently — fixing
  -- `approved_users` fixes both, and `NOT NULL` on either alone breaks creation.
  --
  -- It also needs `app.current_user_id`: a project inserted with no session GUC
  -- gets no uuid at all, whatever organizations exist.
  PERFORM set_config('app.current_user_id', v_modeler::text, true);
  INSERT INTO public.projects (name, modeler_id, plant_name)
    VALUES ('WP62 Creator Has Org', v_modeler, 'WP62O')
    RETURNING organization_id INTO v_org_id;
  IF v_org_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION
      'WP 6.2 / D96: a project created by a user whose own org uuid is % got %. '
      'set_project_defaults no longer inherits the creator''s organization.',
      v_org, COALESCE(v_org_id::text, '(NULL)');
  END IF;

  -- The inherited hole: the creator has no org uuid, so neither does the project.
  -- `WP62 Default Org` was inserted in section 3 through the DEFAULT path and
  -- carries NULL, which makes it exactly the right creator for this case.
  DECLARE
    v_orgless uuid;
  BEGIN
    SELECT id INTO v_orgless FROM public.approved_users
     WHERE email = 'wp62-default@example.invalid';
    IF (SELECT organization_id FROM public.approved_users WHERE id = v_orgless) IS NOT NULL THEN
      RAISE EXCEPTION 'WP 6.2 / D96: the section-3 user gained an org uuid — the fixture no longer tests the chain';
    END IF;
    PERFORM set_config('app.current_user_id', v_orgless::text, true);
    INSERT INTO public.projects (name, modeler_id, plant_name)
      VALUES ('WP62 Creator Has No Org', v_orgless, 'WP62X')
      RETURNING organization_id INTO v_org_id;
    IF v_org_id IS NOT NULL THEN
      RAISE EXCEPTION
        'WP 6.2 / D96: a creator with NO org uuid produced a project with uuid %. '
        'The chain is broken — which may be an improvement; measure it and say so '
        'in §16 rather than deleting this assertion.', v_org_id;
    END IF;
  END;

  -- And with no session at all, the stamp has nothing to read.
  PERFORM set_config('app.current_user_id', '', true);
  INSERT INTO public.projects (name, modeler_id, plant_name)
    VALUES ('WP62 No Session', v_modeler, 'WP62Z')
    RETURNING organization, organization_id INTO v_txt, v_org_id;
  IF v_org_id IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 6.2 / D96: a project inserted with no `app.current_user_id` was stamped '
      '% anyway — the stamp found an organization without a session to read it '
      'from, which is a guess.', v_org_id;
  END IF;

  -- ── 6 · D58 · THE TABLE WITH "NO READER AND NO WRITER" HAS BOTH ──────────
  --
  -- §4 D58 and the `multi_tier_supply_chain` sidecar both said "no reader and no
  -- writer", and the SAME SIDECAR listed three confirmed `surfaces` entries
  -- twenty lines away. Nothing compared the two, and the generated manual page
  -- renders the PROSE — so the contradiction was published to users. That is §4
  -- D101's shape one scope tighter: not two files disagreeing, ONE file
  -- disagreeing with itself. `contract:check` R15 refuses it now.
  --
  -- Both paths are asserted here because both decide whether the table can be
  -- dropped, and reading the two function bodies is what produced the wrong
  -- answer in the first place.
  DECLARE
    v_ds   jsonb;
    v_del  integer;
    v_mtp  uuid;
  BEGIN
    PERFORM set_config('app.current_user_id', v_admin::text, true);
    INSERT INTO public.projects (name, modeler_id, plant_name, organization_id)
      VALUES ('WP62 Multi Tier', v_admin, 'WP62M', v_org) RETURNING id INTO v_mtp;
    INSERT INTO public.multi_tier_supply_chain
      (project_id, plant_name, from_firm_id, to_firm_id, to_firm_tier)
      VALUES (v_mtp, 'WP62M', 'FIRM-A', 'FIRM-B', 2);

    -- 6a · THE READER. `get_project_datasets` SELECTs this table and returns its
    -- rows; `projectLanes.ts` calls it from /policies and /simulation-lab. So the
    -- table has a live reader feeding two pages, and dropping it would break
    -- them — which is what the sidecar's own `surfaces` block said all along.
    v_ds := public.get_project_datasets(v_mtp, v_admin, 'wp62-admin@example.invalid');
    IF v_ds IS NULL THEN
      RAISE EXCEPTION 'WP 6.2 / D58: get_project_datasets returned NULL — the fixture cannot test the reader';
    END IF;
    -- THE KEY IS `multiTier`, NOT `multi_tier`. Read from the running function
    -- rather than guessed from the table name, which is what the first draft did.
    IF NOT (v_ds ? 'multiTier') THEN
      RAISE EXCEPTION
        'WP 6.2 / D58: get_project_datasets no longer returns a `multiTier` key. '
        'If the reader was removed, the table may now be droppable — say so in §16 '
        'and re-take the decision. Keys: %', (SELECT string_agg(k, ',') FROM jsonb_object_keys(v_ds) k);
    END IF;
    IF jsonb_array_length(COALESCE(v_ds -> 'multiTier', '[]'::jsonb)) <> 1 THEN
      RAISE EXCEPTION 'WP 6.2 / D58: the reader returned % multiTier row(s), expected the 1 just inserted',
        jsonb_array_length(COALESCE(v_ds -> 'multiTier', '[]'::jsonb));
    END IF;

    -- 6b · THE DELETE PATH, exactly as `DataManager.tsx` invokes it: the "Delete
    -- ALL data" button passes `p_dataset := 'all'`.
    v_del := public.delete_project_dataset(v_mtp, 'all', v_admin, 'wp62-admin@example.invalid');
    IF v_del < 1 THEN
      RAISE EXCEPTION 'WP 6.2 / D58: delete_project_dataset(all) reported % row(s); the multi_tier row was not counted', v_del;
    END IF;
    IF EXISTS (SELECT 1 FROM public.multi_tier_supply_chain WHERE project_id = v_mtp) THEN
      RAISE EXCEPTION
        'WP 6.2 / D58: the "Delete ALL data" RPC left multi_tier_supply_chain rows '
        'behind. If that branch was removed the table is closer to droppable — §16, '
        'not a deleted assertion.';
    END IF;

    -- 6c · AND THE "NO WRITER" HALF IS FALSE TOO, ONE LAYER DOWN.
    --
    -- The first draft of this section asserted that NOTHING inserts into the
    -- table — the one part of D58's claim that looked safe. It fired immediately:
    -- `bulk_insert_multi_tier_supply_chain` exists, and it is already on
    -- `dataPlaneAudit.test.ts`'s list of tier-2 writers.
    --
    -- The distinction that makes the claim salvageable is the one this repository
    -- keeps having to make: NO APPLICATION CODE CALLS IT. Nothing in `src/` or
    -- `supabase/functions/` names it, so no screen and no edge function can put a
    -- row here — which is why the reader in 6a is answered with an empty array on
    -- every real project.
    --
    -- But an RPC with no caller is not an absent write path. This application runs
    -- as `anon` against permissive grants (D28), so anyone holding a PostgREST
    -- client is one call away from writing this table — the same sentence WP 4.1
    -- wrote about the three legacy `ingest-*` functions before
    -- `ingest_legacy_upsert_lane` turned their target list into a whitelist in a
    -- migration. So the honest form of D58's claim is APPLICATION-level, and the
    -- database-level write path is a fact about the grant surface, which is
    -- WP 7.1's subject.
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'bulk_insert_multi_tier_supply_chain'
    ) THEN
      RAISE EXCEPTION
        'WP 6.2 / D58: bulk_insert_multi_tier_supply_chain is gone. If the write '
        'path was removed the table is closer to droppable and the sidecar''s '
        'account of it is stale — §16, not a deleted assertion.';
    END IF;

    -- It really does write, and asserting that is what stops "an RPC with no
    -- caller" being read as "an RPC that does nothing".
    -- The signature is `(p_rows jsonb, p_user_id uuid, p_user_email text)` and the
    -- project comes from INSIDE the rows — read off `pg_get_function_identity_arguments`
    -- rather than assumed from the other bulk writers, which take it as a parameter.
    PERFORM public.bulk_insert_multi_tier_supply_chain(
      jsonb_build_array(jsonb_build_object(
        'project_id', v_mtp, 'plant_name', 'WP62M',
        'from_firm_id', 'FIRM-C', 'to_firm_id', 'FIRM-D', 'to_firm_tier', 3)),
      v_admin, 'wp62-admin@example.invalid');
    IF NOT EXISTS (
      SELECT 1 FROM public.multi_tier_supply_chain
       WHERE project_id = v_mtp AND from_firm_id = 'FIRM-C'
    ) THEN
      RAISE EXCEPTION 'WP 6.2 / D58: the bulk insert RPC wrote no row — the signature or the body changed';
    END IF;
  END;

  RAISE NOTICE 'WP 6.2 · 240: D66 diverges both ways; two org stamps; and the table with "no reader" has two — 6 section(s)';
END $wp62gov$;
