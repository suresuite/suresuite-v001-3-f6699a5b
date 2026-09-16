-- THE CONNECTOR AS PRODUCTION HAS IT, WHICH IS NOT WHAT THE CONTRACT DESCRIBES.
--
-- Two divergences, both of them invisible to every static gate in this
-- repository, and WP 3.1's rename has to survive both.
--
--   1 · THE THREE STAGING POLICIES DO NOT EXIST IN THE BASE.
--       `20260829120000_erp_connector_phase1_2.sql` creates them inside a
--       `DO $$ … EXECUTE format(…) $$` loop. `introspect.mjs` skips DO blocks —
--       correctly, it is a column-schema reader, not an interpreter — so the
--       contract records `erp_staged_*` with RLS ENABLED and ZERO policies,
--       while production has one policy on each. That is the same blind spot
--       D28 records for `20260614000001`'s dynamic grants, reached from the
--       other side: there it hid an exposure, here it hides the protection.
--       A rename tested against the base alone therefore proves nothing about
--       the policies, because the base has none to break.
--
--   2 · THE TABLES HAVE ROWS.
--       The base is a schema, not a database. `ingest_runs.project_id` is
--       backfilled from the link and then set NOT NULL, and against an empty
--       table both statements succeed no matter what the backfill says. WP 3.0
--       hit this exact shape with `customers` and recorded it: an empty table
--       lets a constraint pass for the wrong reason.
--
-- SHAPE-CONDITIONAL, per fixtures/README.md: every statement is guarded on
-- `erp_sync_runs` still existing. Once WP 3.1's rename is in the base artifact,
-- this whole file is a no-op — which is the property WP 3.0's two fixtures
-- lacked and the reason `main` went red the day they merged.

DO $erp_shape$
BEGIN
  IF to_regclass('public.erp_sync_runs') IS NULL THEN
    RAISE NOTICE 'fixture 030: erp_sync_runs is gone — the rename is in the base, nothing to reproduce';
    RETURN;
  END IF;

  -- ── 1 · production's three staging policies, as the DO block writes them ──
  EXECUTE $p$
    CREATE POLICY "erp_staged_products: project access" ON public.erp_staged_products
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.project_erp_links l
                     WHERE l.id = link_id AND public.has_project_access(l.project_id)))
      WITH CHECK (EXISTS (SELECT 1 FROM public.project_erp_links l
                           WHERE l.id = link_id AND public.has_project_access(l.project_id)))
  $p$;
  EXECUTE $p$
    CREATE POLICY "erp_staged_bom_versions: project access" ON public.erp_staged_bom_versions
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.project_erp_links l
                     WHERE l.id = link_id AND public.has_project_access(l.project_id)))
      WITH CHECK (EXISTS (SELECT 1 FROM public.project_erp_links l
                           WHERE l.id = link_id AND public.has_project_access(l.project_id)))
  $p$;
  EXECUTE $p$
    CREATE POLICY "erp_staged_bom_lines: project access" ON public.erp_staged_bom_lines
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.project_erp_links l
                     WHERE l.id = link_id AND public.has_project_access(l.project_id)))
      WITH CHECK (EXISTS (SELECT 1 FROM public.project_erp_links l
                           WHERE l.id = link_id AND public.has_project_access(l.project_id)))
  $p$;

  -- ── 2 · a link, a run and three staged rows, so the widening meets data ───
  INSERT INTO auth.users (id, email)
  VALUES ('00000000-0000-4000-8000-00000031f000', 'connector@example.invalid')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.approved_users (id, email, name, password_hash)
  VALUES ('00000000-0000-4000-8000-00000031f000', 'connector@example.invalid', 'Connector fixture', 'x')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.projects (id, name, modeler_id, plant_name)
  VALUES ('00000000-0000-4000-8000-00000031f001', 'Connector fixture project',
          '00000000-0000-4000-8000-00000031f000', 'CONNECTOR')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.project_erp_links
    (id, project_id, external_system, external_company_id, linked_by_user_id, external_oauth_token_ref)
  VALUES ('00000000-0000-4000-8000-00000031f002', '00000000-0000-4000-8000-00000031f001',
          'orbit-mrp', 'COMPANY-1', '00000000-0000-4000-8000-00000031f000', 'vault://fixture')
  ON CONFLICT (project_id, external_system, external_company_id) DO NOTHING;

  INSERT INTO public.erp_sync_runs (id, link_id, triggered_by, triggered_by_user_id, status)
  VALUES ('00000000-0000-4000-8000-00000031f003', '00000000-0000-4000-8000-00000031f002',
          'manual', '00000000-0000-4000-8000-00000031f000', 'staged')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.erp_staged_products (sync_run_id, link_id, external_id, sku, name, raw, diff_state)
  VALUES ('00000000-0000-4000-8000-00000031f003', '00000000-0000-4000-8000-00000031f002',
          'EXT-1', 'SKU-1', 'First',  '{"id":"EXT-1"}'::jsonb, 'new'),
         ('00000000-0000-4000-8000-00000031f003', '00000000-0000-4000-8000-00000031f002',
          'EXT-2', 'SKU-2', 'Second', '{"id":"EXT-2"}'::jsonb, 'changed'),
         ('00000000-0000-4000-8000-00000031f003', '00000000-0000-4000-8000-00000031f002',
          'EXT-3', NULL,    NULL,     '{}'::jsonb,             'removed_upstream');

  RAISE NOTICE 'fixture 030: production''s connector shape applied — 3 policies, 1 link, 1 run, 3 staged rows';
END $erp_shape$;
