-- WP 6.2 · §4 D117 — DELETING A PROJECT DELETES THE PROJECT.
--
-- `20260919000005` adds seven foreign keys. What only a running database can settle:
--
--   1. The cascade FIRES. A constraint that exists and does not cascade looks
--      identical in a migration and leaves the rows behind — which is the defect,
--      not the fix.
--   2. It fires on a PLAIN `DELETE FROM projects`, not only through
--      `delete-project`'s by-name list. That is the whole point: the declaration is
--      the schema's, so every path that deletes a project follows it.
--   3. The three LOG tables are NOT cascaded, deliberately. A rehearsal that only
--      checked the seven would pass if somebody quietly added an eighth, and the
--      decision to keep usage records would be lost with nothing noticing.
--   4. `chat_threads` and `user_files` DETACH rather than delete — `ON DELETE SET
--      NULL` — and that is a different, also-deliberate answer for something a
--      person owns.
--   5. The orphan sweep is what makes the constraint addable at all, and it is
--      DESTRUCTIVE. Proving it removes exactly the rows whose project is gone, and
--      nothing else, is not something a migration's text can claim.
--
-- Every comparison is `IS DISTINCT FROM` (rehearsal/260's lesson).

DO $wp62cascade$
DECLARE
  v_user  uuid := '00000000-0000-4000-8000-000000062300';
  v_keep  uuid := '00000000-0000-4000-8000-000000062301';
  v_gone  uuid := '00000000-0000-4000-8000-000000062302';
  v_n     bigint;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'wp62casc@example.invalid');
  INSERT INTO public.approved_users (id, email, name, password_hash)
    VALUES (v_user, 'wp62casc@example.invalid', 'WP62 cascade', 'x');
  INSERT INTO public.projects (id, name, modeler_id, plant_name) VALUES
    (v_keep, 'WP62 keep', v_user, 'KEEP'),
    (v_gone, 'WP62 gone', v_user, 'GONE');

  -- One row per cascaded table in BOTH projects, so the assertion after the delete
  -- distinguishes "cascaded correctly" from "deleted everything".
  INSERT INTO public.customers (project_id, customer_id, name) VALUES
    (v_keep, 'C-KEEP', 'Keep Co'), (v_gone, 'C-GONE', 'Gone Co');
  INSERT INTO public.network_summary (project_id, plant_name) VALUES (v_keep, 'KEEP'), (v_gone, 'GONE');
  -- `policy_defaults` needs no INSERT: `create_default_policy_defaults` writes one
  -- row per project on creation, which makes it the clearest case in the defect —
  -- EVERY project this product has ever created left a row behind when it was
  -- deleted, without anybody having to do anything.
  SELECT count(*) INTO v_n FROM public.policy_defaults WHERE project_id IN (v_keep, v_gone);
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'WP 6.2 §0: the project trigger wrote % policy_defaults row(s), expected 2', v_n;
  END IF;
  INSERT INTO public.policy_overrides (project_id, scope, target_key, family) VALUES
    (v_keep, 'node', 'K', 'sourcing'), (v_gone, 'node', 'G', 'sourcing');
  INSERT INTO public.tier2_suppliers (project_id, plant_name, supplier_id, upstream_supplier_id) VALUES
    (v_keep, 'KEEP', 'S-1', 'T2-KEEP'), (v_gone, 'GONE', 'S-1', 'T2-GONE');
  INSERT INTO public.tier3_suppliers (project_id, plant_name, supplier_id, upstream_supplier_id) VALUES
    (v_keep, 'KEEP', 'T2-KEEP', 'T3-KEEP'), (v_gone, 'GONE', 'T2-GONE', 'T3-GONE');

  -- ── 1 · A PLAIN DELETE CASCADES ──────────────────────────────────────────
  DELETE FROM public.projects WHERE id = v_gone;

  SELECT count(*) INTO v_n FROM public.customers WHERE project_id = v_gone;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'WP 6.2 §1: % customers row(s) outlived their project — the cascade did not fire', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.policy_overrides WHERE project_id = v_gone;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'WP 6.2 §1: % policy_overrides row(s) outlived their project — these are the decisions the user typed', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.policy_defaults WHERE project_id = v_gone;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'WP 6.2 §1: % policy_defaults row(s) outlived their project', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.network_summary WHERE project_id = v_gone;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'WP 6.2 §1: % network_summary row(s) outlived their project', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM (SELECT project_id FROM public.tier2_suppliers
          UNION ALL SELECT project_id FROM public.tier3_suppliers) q
   WHERE project_id = v_gone;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'WP 6.2 §1: % deep-tier supplier row(s) outlived their project', v_n;
  END IF;

  -- ── 2 · AND ONLY THAT PROJECT'S ROWS ─────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.customers WHERE project_id = v_keep;
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WP 6.2 §2: the surviving project has % customer row(s), expected 1 — the cascade took too much', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.policy_overrides WHERE project_id = v_keep;
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'WP 6.2 §2: the surviving project has % override(s), expected 1', v_n;
  END IF;

  -- ── 3 · SEVEN CASCADE, AND EXACTLY SEVEN ────────────────────────────────
  --
  -- Read from `pg_constraint`, so a table added to the list without a rehearsal
  -- change is visible, and so the LOG tables' absence is asserted rather than
  -- assumed. Three of them are meant to outlive a project and that decision has to
  -- be as hard to lose as the cascade itself.
  SELECT count(*) INTO v_n
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND c.contype = 'f'
     AND c.confdeltype = 'c'                      -- ON DELETE CASCADE
     AND c.confrelid = 'public.projects'::regclass
     AND t.relname IN ('customers','network_summary','policy_defaults','policy_overrides',
                       'simulation_job_magnitudes','tier2_suppliers','tier3_suppliers');
  IF v_n IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'WP 6.2 §3: % of 7 tables cascade from projects', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND c.contype = 'f'
     AND c.confdeltype = 'c'
     AND c.confrelid = 'public.projects'::regclass
     AND t.relname IN ('ai_chat_events','ai_usage_logs','api_request_logs');
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'WP 6.2 §3: % usage/log table(s) now cascade from a project — that was a decision, not an oversight', v_n;
  END IF;

  RAISE NOTICE 'WP 6.2 §4 D117: seven tables follow the project, three logs deliberately do not';
END $wp62cascade$;
