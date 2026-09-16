-- WP 3.1 · AN MRP SYNC STILL STAGES, DIFFS AND PROMOTES.
--
-- §10 asks for this test and says to write it BEFORE the rename. It is here
-- rather than in `src/lib/policies/__tests__/` because the claim is about what
-- the DATABASE does — foreign keys, cascades, policies and a conflict target —
-- and a source-level test would repeat WP 2.3's mistake: `dataPlaneAudit.test.ts`
-- read the migration text and passed for the entire period during which the
-- audit had written zero rows.
--
-- THE SHAPE IT PINS is `erp-sync-orbit-mrp/index.ts`'s own three steps, in
-- order: `actionSync` opens a run and inserts staged rows with a `diff_state`;
-- `applyStagedRun` upserts every staged row that is not `removed_upstream` into
-- `products` on `(project_id, product_id)`; the run is marked applied. The
-- assertions below are that path executed in SQL, so a rename, a nullable
-- column or a rewritten policy cannot change it silently.
--
-- IT RAN BEFORE THE RENAME TOO. The same assertions, with the `erp_*` names and
-- without the three new columns, were run against the base as it stood at
-- `a80aaae` — green — and then again here. §16 · WP 3.1 records the output of
-- both. That is what "identically" means and it is not provable from one side.

DO $wp31$
DECLARE
  v_user    uuid := '00000000-0000-4000-8000-000000031000';
  v_other   uuid := '00000000-0000-4000-8000-000000031001';
  v_project uuid := '00000000-0000-4000-8000-000000031002';
  v_link    uuid := '00000000-0000-4000-8000-000000031003';
  v_run     uuid := '00000000-0000-4000-8000-000000031004';
  v_n       integer;
  v_row     public.products%ROWTYPE;
BEGIN
  -- ── the actors ────────────────────────────────────────────────────────────
  INSERT INTO auth.users (id, email) VALUES
    (v_user,  'wp31@example.invalid'),
    (v_other, 'wp31-stranger@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES
    (v_user,  'wp31@example.invalid',          'WP31',     'x'),
    (v_other, 'wp31-stranger@example.invalid', 'Stranger', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
  VALUES (v_project, 'WP31 sync', v_user, 'WP31PLANT');

  INSERT INTO public.project_erp_links
    (id, project_id, external_system, external_company_id, linked_by_user_id, external_oauth_token_ref)
  VALUES (v_link, v_project, 'orbit-mrp', 'COMPANY-31', v_user, 'vault://wp31');

  -- ── 1 · the run opens ─────────────────────────────────────────────────────
  -- `source_kind` is the widening and it is stated, never defaulted: the column
  -- carries no DEFAULT precisely so a CSV run cannot be recorded as an MRP one
  -- by omission (§5 T1 — there is no fourth option to "data, rule or default").
  INSERT INTO public.ingest_runs
    (id, project_id, link_id, source_kind, triggered_by, triggered_by_user_id, status)
  VALUES (v_run, v_project, v_link, 'orbit-mrp', 'manual', v_user, 'running');

  -- ── 2 · staging, with the diff the sync computed ──────────────────────────
  -- Three rows and three states, because the promote step treats them
  -- differently and a test with one state cannot see that.
  INSERT INTO public.ingest_staged_products
    (ingest_run_id, link_id, source_kind, fact_class, external_id, sku, name, raw, diff_state)
  VALUES (v_run, v_link, 'orbit-mrp', 'master', 'EXT-1', 'SKU-1', 'First',  '{"id":"EXT-1"}'::jsonb, 'new'),
         (v_run, v_link, 'orbit-mrp', 'master', 'EXT-2', 'SKU-2', 'Second', '{"id":"EXT-2"}'::jsonb, 'changed'),
         (v_run, v_link, 'orbit-mrp', 'master', 'EXT-3', NULL,    NULL,     '{}'::jsonb,             'removed_upstream');

  SELECT count(*) INTO v_n FROM public.ingest_staged_products WHERE ingest_run_id = v_run;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'WP 3.1: staging kept % of 3 rows', v_n;
  END IF;

  UPDATE public.ingest_runs
     SET status = 'staged', rows_fetched = '{"products": 2}'::jsonb,
         rows_new = 1, rows_changed = 1, rows_removed = 1,
         diff_summary = '{"products": {"new": 1, "changed": 1, "unchanged": 0}}'::jsonb
   WHERE id = v_run;

  SELECT count(*) INTO v_n FROM public.ingest_runs
   WHERE id = v_run AND status = 'staged' AND rows_new = 1 AND rows_changed = 1 AND rows_removed = 1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.1: the run did not record the diff it staged';
  END IF;

  -- NOTHING REACHED TIER 2 YET. The staging tables exist so that a sync is a
  -- proposal until somebody approves it (`no-tier-skip`, I2, and the connector
  -- migration's own comment: "Nothing lands in materials/products/bom_*
  -- directly"). A rename that quietly wired staging to the live table would
  -- still pass every later assertion in this file, so it is checked here.
  SELECT count(*) INTO v_n FROM public.products WHERE project_id = v_project;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.1: % product row(s) exist before anything was promoted', v_n;
  END IF;

  -- ── 3 · promotion — `applyStagedRun`, in SQL ──────────────────────────────
  INSERT INTO public.products (project_id, product_id, name, source_system, source_external_id, source_synced_at)
  SELECT v_project, COALESCE(s.sku, s.external_id), s.name, 'orbit-mrp', s.external_id, s.staged_at
    FROM public.ingest_staged_products s
   WHERE s.ingest_run_id = v_run AND s.diff_state <> 'removed_upstream'
  ON CONFLICT (project_id, product_id) DO UPDATE
     SET name = EXCLUDED.name,
         source_system = EXCLUDED.source_system,
         source_external_id = EXCLUDED.source_external_id,
         source_synced_at = EXCLUDED.source_synced_at;

  SELECT count(*) INTO v_n FROM public.products WHERE project_id = v_project;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 3.1: promotion produced % product row(s), expected 2 — a removed_upstream row must never promote', v_n;
  END IF;

  SELECT * INTO v_row FROM public.products WHERE project_id = v_project AND product_id = 'SKU-1';
  IF v_row.source_system <> 'orbit-mrp' OR v_row.source_external_id <> 'EXT-1' THEN
    RAISE EXCEPTION 'WP 3.1: the promoted row lost its provenance (system=%, external=%)',
      v_row.source_system, v_row.source_external_id;
  END IF;

  -- Applying the same run twice is the operator's own retry, and it must be a
  -- no-op rather than a duplicate. The conflict target is the table's key.
  INSERT INTO public.products (project_id, product_id, name, source_system, source_external_id, source_synced_at)
  SELECT v_project, COALESCE(s.sku, s.external_id), s.name, 'orbit-mrp', s.external_id, s.staged_at
    FROM public.ingest_staged_products s
   WHERE s.ingest_run_id = v_run AND s.diff_state <> 'removed_upstream'
  ON CONFLICT (project_id, product_id) DO UPDATE
     SET name = EXCLUDED.name;

  SELECT count(*) INTO v_n FROM public.products WHERE project_id = v_project;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'WP 3.1: re-applying the run produced % product row(s), expected 2', v_n;
  END IF;

  UPDATE public.ingest_runs SET status = 'applied', applied_at = now(), applied_by_user_id = v_user
   WHERE id = v_run;

  -- ── 4 · who can see the staged rows ───────────────────────────────────────
  -- The policy is the part of the rename most likely to break silently: the
  -- original routed every staging read through `project_erp_links`, and a run
  -- that has no link — which is what `source_kind = 'csv'` means — cannot be
  -- reached that way at all.
  PERFORM set_config('app.current_user_id', v_user::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ingest_staged_products WHERE ingest_run_id = v_run;
  RESET ROLE;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'WP 3.1: the project''s own modeler reads % of 3 staged rows — the rename revoked access', v_n;
  END IF;

  PERFORM set_config('app.current_user_id', v_other::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ingest_staged_products WHERE ingest_run_id = v_run;
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.1: a stranger reads % staged row(s) of somebody else''s project', v_n;
  END IF;

  PERFORM set_config('app.current_user_id', v_other::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ingest_runs WHERE id = v_run;
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.1: a stranger reads somebody else''s ingest run';
  END IF;

  -- ── 5 · the run owns its staged rows ──────────────────────────────────────
  -- ON DELETE CASCADE, which a rename carries only if it renames the table and
  -- not the constraint. Deleting a run must not leave orphaned staging.
  DELETE FROM public.ingest_runs WHERE id = v_run;
  SELECT count(*) INTO v_n FROM public.ingest_staged_products WHERE ingest_run_id = v_run;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.1: % staged row(s) survived the deletion of their run', v_n;
  END IF;

  RAISE NOTICE 'WP 3.1: an MRP sync stages, diffs and promotes — and a stranger sees none of it';
END $wp31$;
