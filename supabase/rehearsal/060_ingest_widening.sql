-- WP 3.1 · THE WIDENING — what the rename was FOR.
--
-- `050` proves the connector path is unchanged. This file proves the three
-- things that were impossible before it, because a regression test that only
-- shows nothing broke cannot show that anything was gained:
--
--   1 · a run with NO ERP link is legal, and it is GOVERNED — the old schema
--       made `link_id` NOT NULL and routed every RLS decision through it, so a
--       CSV run was not merely unsupported, it was unreachable and had no
--       policy that could reach it either.
--   2 · `source_kind` and `fact_class` are CLOSED vocabularies, refused at the
--       database rather than validated hopefully in TypeScript.
--   3 · tier 0 is write-once, enforced by a trigger and not by a sentence in a
--       plan (PLAN.md §2).

DO $wp31w$
DECLARE
  v_user    uuid := '00000000-0000-4000-8000-000000031100';
  v_other   uuid := '00000000-0000-4000-8000-000000031101';
  v_project uuid := '00000000-0000-4000-8000-000000031102';
  v_run     uuid := '00000000-0000-4000-8000-000000031103';
  v_file    uuid;
  v_n       integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp31w@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash) VALUES
    (v_user,  'wp31w@example.invalid',          'WP31 widening', 'x'),
    (v_other, 'wp31w-stranger@example.invalid', 'Stranger',      'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name)
  VALUES (v_project, 'WP31 widening', v_user, 'WP31W');

  -- ── 1 · a CSV run: no link, and still governed ────────────────────────────
  INSERT INTO public.ingest_runs (id, project_id, link_id, source_kind, triggered_by, triggered_by_user_id, status)
  VALUES (v_run, v_project, NULL, 'csv', 'manual', v_user, 'running');

  INSERT INTO public.ingest_staged_products
    (ingest_run_id, link_id, source_kind, fact_class, external_id, sku, raw, diff_state)
  VALUES (v_run, NULL, 'csv', 'master', 'ROW-1', 'SKU-CSV', '{"sku":"SKU-CSV"}'::jsonb, 'new');

  PERFORM set_config('app.current_user_id', v_user::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ingest_staged_products WHERE ingest_run_id = v_run;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WP 3.1: the uploader cannot read their own link-less run''s staged rows (% of 1)', v_n;
  END IF;

  PERFORM set_config('app.current_user_id', v_other::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.ingest_staged_products WHERE ingest_run_id = v_run;
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.1: a link-less run''s staged rows are readable by a stranger — the widening opened a hole';
  END IF;

  -- ── 2 · the vocabularies are closed ───────────────────────────────────────
  BEGIN
    INSERT INTO public.ingest_runs (project_id, source_kind, triggered_by, status)
    VALUES (v_project, 'sap', 'manual', 'running');
    RAISE EXCEPTION 'WP 3.1: source_kind accepted "sap" — the CHECK is not holding';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.ingest_staged_products
      (ingest_run_id, source_kind, fact_class, external_id, raw)
    VALUES (v_run, 'csv', 'reference', 'ROW-2', '{}'::jsonb);
    RAISE EXCEPTION 'WP 3.1: fact_class accepted "reference" — the CHECK is not holding';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- A writer that says nothing at all is refused too. This is the half a
  -- DEFAULT would have hidden: with one, the row would have been recorded as
  -- `orbit-mrp` and nobody would ever have been told (§5 T1).
  BEGIN
    INSERT INTO public.ingest_runs (project_id, triggered_by, status)
    VALUES (v_project, 'manual', 'running');
    RAISE EXCEPTION 'WP 3.1: a run was accepted with no source_kind — the DEFAULT was not dropped';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;

  -- ── 3 · tier 0 lands, and never changes ───────────────────────────────────
  INSERT INTO public.ingest_files
    (ingest_run_id, source_kind, original_filename, storage_bucket, storage_path,
     content_type, byte_size, content_sha256, uploaded_by)
  VALUES (v_run, 'csv', 'inbound logistics.csv', 'ingest', 'proj/31/inbound.csv',
          'text/csv', 2048,
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', v_user)
  RETURNING id INTO v_file;

  BEGIN
    UPDATE public.ingest_files SET original_filename = 'renamed.csv' WHERE id = v_file;
    RAISE EXCEPTION 'WP 3.1: a tier-0 row was UPDATED — write-once is not enforced';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;

  -- Not immortal, though: deleting the run takes its landed files with it, or
  -- deleting a project would be impossible.
  DELETE FROM public.ingest_runs WHERE id = v_run;
  SELECT count(*) INTO v_n FROM public.ingest_files WHERE id = v_file;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'WP 3.1: a tier-0 row survived the deletion of its run — a project can no longer be deleted';
  END IF;

  RAISE NOTICE 'WP 3.1: a link-less run is legal and governed, both vocabularies are closed, tier 0 is write-once';
END $wp31w$;
