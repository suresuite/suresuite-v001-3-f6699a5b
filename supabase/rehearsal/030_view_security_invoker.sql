-- D38 · the six views now run as their CALLER, and one of them had to be
-- proved rather than argued.
--
-- `security_invoker` is a one-word setting and its EFFECT is not: whether a
-- reader still sees what they need depends on policies on tables the view only
-- mentions in a FROM clause. WP 2.3 claimed the data-plane audit worked on the
-- strength of a migration that landed, and §15 found zero rows (D45). This file
-- is the same claim about views, made against a database instead.
--
-- Runs inside a transaction the rehearsal rolls back.

-- ── 1 · every view runs as its caller, or is the ONE declared exception ─────
--
-- `v_admin_user_usage` cannot take `security_invoker`: `approved_users` is
-- REVOKEd from `authenticated` (20250826015629), so a view running as its caller
-- raises "permission denied" for every reader including the super admins whose
-- pages are its only consumers. The rehearsal found that by executing it. It
-- keeps owner rights and carries `WHERE public.current_is_super_admin()`
-- instead — so the exception is allowed here ONLY while the predicate is in the
-- definition. Drop the predicate and this fails; add a seventh owner-view and
-- this fails.
DO $invoker$
DECLARE
  v_missing text;
  v_def     text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND c.relname <> 'v_admin_user_usage'
    AND NOT coalesce((SELECT option_value = 'true'
                        FROM pg_options_to_table(c.reloptions)
                       WHERE option_name = 'security_invoker'), false);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'D38: view(s) still run as their OWNER and bypass base-table RLS: %', v_missing;
  END IF;

  IF to_regclass('public.v_admin_user_usage') IS NOT NULL THEN
    v_def := pg_get_viewdef('public.v_admin_user_usage'::regclass, true);
    IF v_def NOT LIKE '%current_is_super_admin()%' THEN
      RAISE EXCEPTION
        'D38: v_admin_user_usage runs as its OWNER and no longer states its own authorization — the declared exception has lost the thing that made it one';
    END IF;
  END IF;

  RAISE NOTICE 'D38: every view runs as its caller, or states its own rule';
END $invoker$;

-- ── 2 · v_admin_user_usage: the per-person spend the view was leaking ───────
--
-- Two readers, one database, one query. A super admin must still see everyone's
-- month-to-date cost, because two admin pages depend on it; an ordinary user
-- must see NOTHING, because the view now states the same rule `ai_usage_logs`
-- enforces and this is the admin roll-up, not a user's own usage surface.
DO $usage$
DECLARE
  v_super uuid := '00000000-0000-4000-8000-00000000a001';
  v_plain uuid := '00000000-0000-4000-8000-00000000a002';
  v_seen  numeric;
  v_rows  integer;
BEGIN
  INSERT INTO public.approved_users (id, email, name, password_hash, role)
  VALUES (v_super, 'super@example.invalid', 'Super', 'x', 'super_admin'),
         (v_plain, 'plain@example.invalid', 'Plain', 'x', 'user')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.ai_usage_logs (user_id, total_tokens, cost_usd, created_at)
  VALUES (v_super, 100, 1.00, now()),
         (v_plain, 200, 2.00, now());

  -- The pages run as `authenticated`, not as the owner. SET ROLE is the only
  -- way to ask the question the page asks; querying as superuser answers a
  -- different one and answers it wrongly (RLS does not apply to a superuser).
  PERFORM set_config('app.current_user_id', v_super::text, true);
  SET LOCAL ROLE authenticated;
  SELECT coalesce(sum(mtd_cost_usd), 0), count(*) INTO v_seen, v_rows
    FROM public.v_admin_user_usage WHERE user_id IN (v_super, v_plain);
  RESET ROLE;

  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'D38: a super admin sees % of the 2 seeded users — the admin pages would break', v_rows;
  END IF;
  IF v_seen <> 3.00 THEN
    RAISE EXCEPTION 'D38: a super admin sees $% of the $3.00 seeded spend — `usage: super read` is not carrying the view', v_seen;
  END IF;

  PERFORM set_config('app.current_user_id', v_plain::text, true);
  SET LOCAL ROLE authenticated;
  SELECT coalesce(sum(mtd_cost_usd), 0), count(*) INTO v_seen, v_rows
    FROM public.v_admin_user_usage;
  RESET ROLE;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION
      'D38: an ordinary user reads % row(s) of the admin usage roll-up (worth $%) — the view is still handing out other people''s spend',
      v_rows, v_seen;
  END IF;

  RAISE NOTICE 'D38: v_admin_user_usage — super admin sees all spend, an ordinary user sees none';
END $usage$;

-- ── 3 · admin_org_file_usage: the policy that had to come first ─────────────
--
-- The flip alone would have turned an org roll-up into the reading admin's own
-- files, under headings that say "org". `user_files_super_read` is what stops
-- that, so the assertion is on the policy's effect, not on its existence.
DO $files$
DECLARE
  v_super uuid := '00000000-0000-4000-8000-00000000a001';
  v_other uuid := '00000000-0000-4000-8000-00000000a003';
  v_org   uuid := '00000000-0000-4000-8000-00000000a0f0';
  v_files bigint;
BEGIN
  IF to_regclass('public.user_files') IS NULL THEN
    RAISE NOTICE 'D38: user_files absent from this base — skipping the org roll-up assertion';
    RETURN;
  END IF;

  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org, 'D38 Org', 'd38-org') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.approved_users (id, email, name, password_hash, role)
  VALUES (v_other, 'other@example.invalid', 'Other', 'x', 'user')
  ON CONFLICT (id) DO NOTHING;

  -- Two files, neither owned by the reading admin. A roll-up that reports zero
  -- is the failure this assertion exists for.
  INSERT INTO public.user_files (user_id, org_id, kind, name, path, size_bytes, retained)
  VALUES (v_other, v_org, 'report_xlsx', 'a.xlsx', 'org/a/a.xlsx', 1000, true),
         (v_other, v_org, 'report_xlsx', 'b.xlsx', 'org/a/b.xlsx', 2000, false);

  PERFORM set_config('app.current_user_id', v_super::text, true);
  SET LOCAL ROLE authenticated;
  SELECT file_count INTO v_files
    FROM public.admin_org_file_usage WHERE org_id = v_org;
  RESET ROLE;

  IF coalesce(v_files, 0) <> 2 THEN
    RAISE EXCEPTION
      'D38: a super admin rolls up % of 2 org files — `security_invoker` without `user_files_super_read` turns an org total into the admin''s own',
      coalesce(v_files, 0);
  END IF;

  -- And the reader who is not a super admin gets their own files, which is
  -- zero here, rather than the organization's.
  PERFORM set_config('app.current_user_id', v_other::text, true);
  SET LOCAL ROLE authenticated;
  SELECT file_count INTO v_files
    FROM public.admin_org_file_usage WHERE org_id = v_org;
  RESET ROLE;

  IF coalesce(v_files, 0) <> 2 THEN
    RAISE EXCEPTION 'D38: the file owner sees % of their own 2 files', coalesce(v_files, 0);
  END IF;

  RAISE NOTICE 'D38: admin_org_file_usage — the org roll-up survives the flip because the policy came with it';
END $files$;
