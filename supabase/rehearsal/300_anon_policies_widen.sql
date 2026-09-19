-- WP 7.1 stage 1 · A POLICY GRANTED TO `anon` ALONE REFUSES AN AUTHENTICATED CALLER.
--
-- The migration this file guards is additive and dull: sixteen policies gain a second
-- role and keep their predicates. What is NOT dull is the claim it rests on — that
-- without it, issuing a session would have broken those sixteen reads for exactly the
-- people who logged in. That claim is about what PostgreSQL DOES with a policy's `TO`
-- clause, so a source-level test cannot make it and this file must.
--
-- §2 proves the MECHANISM on a table this file builds, where it controls RLS: a policy
-- `TO anon` refuses `authenticated`, and widening it admits them. That is the assertion
-- the whole stage rests on, and it is proved rather than asserted because §14's own
-- "what it breaks if wrong" column said "nothing reads it, so nothing can break".
--
-- §1 and §3 then check the sixteen real ones — structurally, and behaviourally on one
-- of them.
--
-- NOTE ON THE BASE. The artifact records policies per table under `rls.policies`, and it
-- holds **11 of the 16** — five exist in production and in no migration (§4 D133), so a
-- base built from the artifact cannot have them. That is why the migration is
-- `DROP … IF EXISTS` + `CREATE` rather than `ALTER`: `ALTER` on an absent policy raises,
-- which would deploy cleanly to production and fail on every rehearsed database. The
-- artifact also records `rls.determinate: false` for these tables, so RLS is enforced on
-- none of them here — which is why §3 enables it itself before asking a behavioural
-- question. On a database where RLS is off every caller reads everything and the
-- assertion would pass for the wrong reason (§16 · WP 4.1 · E).

DO $wp71s1$
DECLARE
  v_expected text[] := ARRAY[
    'bom_multi_level:bom_multi_level_anon_read',
    'bom_single_level:bom_single_level_anon_read',
    'customers:customers_anon_read',
    'inbound_logistics:inbound_logistics_anon_read',
    'materials:materials_anon_read',
    'outbound_logistics:outbound_logistics_anon_read',
    'policy_defaults:Anon can read policy defaults',
    'policy_overrides:Anon can read policy overrides',
    'policy_presets:Anon can read policy presets',
    'policy_versions:policy_versions_anon_insert',
    'products:products_anon_read',
    'run_item_series:run_item_series_anon_write',
    'run_replications:run_replications_anon_write',
    'scenarios:scenarios_anon_all',
    'simulation_runs:sim_runs_anon_all',
    'suppliers:suppliers_anon_read'
  ];
  v_key     text;
  v_tbl     text;
  v_pol     text;
  v_roles   name[];
  v_qual    text;
  v_check   text;
  v_cmd     text;
  v_missing text[] := '{}';
  v_narrow  text[] := '{}';
  v_rows    integer;
  v_widened integer;
  v_user    uuid := gen_random_uuid();
  v_project uuid := gen_random_uuid();
BEGIN
  -- ══ §1 · all sixteen exist and name BOTH roles, with their predicates intact ══
  --
  -- `roles` is compared as a SET rather than by position: PostgreSQL stores the array
  -- in the order the statement gave, and an assertion that depends on that order would
  -- fail on a future migration that writes `TO authenticated, anon` and changes nothing.
  FOREACH v_key IN ARRAY v_expected LOOP
    v_tbl := split_part(v_key, ':', 1);
    v_pol := substr(v_key, length(v_tbl) + 2);

    SELECT roles, qual, with_check, cmd
      INTO v_roles, v_qual, v_check, v_cmd
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = v_tbl AND policyname = v_pol;

    IF NOT FOUND THEN
      v_missing := v_missing || v_key;
      CONTINUE;
    END IF;

    IF NOT ('anon' = ANY(v_roles) AND 'authenticated' = ANY(v_roles)) THEN
      v_narrow := v_narrow || (v_key || ' -> ' || array_to_string(v_roles, ','));
    END IF;

    -- The predicates must be exactly what §15 run 35467910110 printed. A widening that
    -- quietly tightened a predicate would pass a roles-only check and change behaviour.
    IF v_cmd = 'INSERT' THEN
      IF v_qual IS NOT NULL OR coalesce(v_check, '') <> 'true' THEN
        RAISE EXCEPTION
          'WP 7.1/300 §1: % is INSERT and should be USING NULL / WITH CHECK true, got % / %',
          v_key, coalesce(v_qual, 'NULL'), coalesce(v_check, 'NULL');
      END IF;
    ELSIF v_cmd = 'ALL' THEN
      IF coalesce(v_qual, '') <> 'true' OR coalesce(v_check, '') <> 'true' THEN
        RAISE EXCEPTION
          'WP 7.1/300 §1: % is FOR ALL and should be true/true, got % / %',
          v_key, coalesce(v_qual, 'NULL'), coalesce(v_check, 'NULL');
      END IF;
    ELSE
      IF coalesce(v_qual, '') <> 'true' OR v_check IS NOT NULL THEN
        RAISE EXCEPTION
          'WP 7.1/300 §1: % is SELECT and should be USING true / no WITH CHECK, got % / %',
          v_key, coalesce(v_qual, 'NULL'), coalesce(v_check, 'NULL');
      END IF;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 7.1/300 §1: % of the sixteen policies do not exist after the migration: %',
      array_length(v_missing, 1), array_to_string(v_missing, ', ');
  END IF;

  IF array_length(v_narrow, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'WP 7.1/300 §1: % policy/policies still do not name both roles: % — stage 1 would refuse these reads to whoever logged in (D130)',
      array_length(v_narrow, 1), array_to_string(v_narrow, '; ');
  END IF;

  RAISE NOTICE 'WP 7.1/300 §1: all 16 policies name anon AND authenticated, predicates unchanged';

  -- ══ §2 · THE MECHANISM, on a table this file controls ══
  --
  -- This is the assertion the stage rests on. Without it, "a policy TO anon refuses an
  -- authenticated caller" is a claim about PostgreSQL read from the documentation.
  CREATE TABLE public._wp71_role_probe (id integer primary key, payload text);
  INSERT INTO public._wp71_role_probe VALUES (1, 'visible');
  ALTER TABLE public._wp71_role_probe ENABLE ROW LEVEL SECURITY;
  GRANT SELECT ON public._wp71_role_probe TO anon, authenticated;

  CREATE POLICY probe_anon_only ON public._wp71_role_probe
    FOR SELECT TO anon USING (true);

  -- `anon` reads it: the policy applies.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_rows FROM public._wp71_role_probe;
  RESET ROLE;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'WP 7.1/300 §2: anon reads % row(s) through its own policy, expected 1 — the probe is not measuring RLS', v_rows;
  END IF;

  -- `authenticated` does NOT: no policy applies to that role, and RLS denies by default.
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_rows FROM public._wp71_role_probe;
  RESET ROLE;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      'WP 7.1/300 §2: authenticated read % row(s) through a policy granted TO anon ALONE — the premise of this whole stage is wrong and D130 must be re-measured',
      v_rows;
  END IF;

  -- Widen it exactly as the migration widens the sixteen, and the same caller reads.
  ALTER POLICY probe_anon_only ON public._wp71_role_probe TO anon, authenticated;

  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_rows FROM public._wp71_role_probe;
  RESET ROLE;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'WP 7.1/300 §2: after widening, authenticated reads % row(s), expected 1', v_rows;
  END IF;

  RAISE NOTICE 'WP 7.1/300 §2: a policy TO anon ALONE refuses authenticated (0 rows), and widening admits it (1 row) — the mechanism, proved';

  -- ══ §3 · and the shipped policy does it on a REAL table ══
  --
  -- RLS is enabled here because the rehearsal base does not enable it (see the note at
  -- the top). Without this line `authenticated` would read the row whatever the policy
  -- said, and §3 would pass for the wrong reason — which is §16 · WP 4.1 · E's lesson.
  ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

  -- A real project and a real approved user, because `suppliers.project_id` and
  -- `projects.modeler_id` are foreign keys and a fabricated uuid is a different test.
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp71@example.invalid');
  INSERT INTO public.approved_users (id, name, email, password_hash, role)
    VALUES (v_user, 'WP71', 'wp71@example.invalid', 'x', 'user');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
    VALUES (v_project, 'WP71 widen', v_user, 'WP71');

  INSERT INTO public.suppliers (project_id, supplier_id, name)
    VALUES (v_project, 'WP71-SUP', 'WP71 Supplier');

  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_widened FROM public.suppliers WHERE supplier_id = 'WP71-SUP';
  RESET ROLE;

  IF v_widened <> 1 THEN
    RAISE EXCEPTION
      'WP 7.1/300 §3: an authenticated caller reads % of 1 supplier row through suppliers_anon_read — the shipped widening does not work',
      v_widened;
  END IF;

  RAISE NOTICE 'WP 7.1/300 §3: suppliers_anon_read admits an authenticated caller on a real table';

  RAISE NOTICE 'WP 7.1 · 300: sixteen policies widened, the mechanism proved, and one shipped policy exercised — 3 section(s)';
END $wp71s1$;
