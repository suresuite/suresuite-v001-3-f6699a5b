-- D44 · the unseed removed D1's damage and nothing else.
--
-- Only meaningful when `020_d1_zero_safety_stock.sql` has been applied, i.e.
-- under `npm run contract:rehearse -- --fixtures`. Without the fixture there is
-- nothing to check and the file says so rather than passing silently — a
-- skipped assertion that reads like a green one is the failure mode R7 was
-- written for.

DO $d44$
DECLARE
  v_project uuid := '00000000-0000-4000-8000-0000000d1001';
  v_patch   jsonb;
  v_n       integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project) THEN
    RAISE NOTICE 'D44: fixture absent — run with --fixtures to assert the unseed';
    RETURN;
  END IF;

  -- 1 · the frozen zero alone: the row is gone, so the field resolves live
  --     through the bundle again and the engine's 7-day default applies.
  SELECT count(*) INTO v_n FROM public.policy_overrides
   WHERE project_id = v_project AND target_key = 'D44-ONLY-ZERO';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'D44: the override whose only key was safety_stock_days = 0 survived';
  END IF;

  -- 2 · the zero beside a real choice: key removed, choice kept, row kept.
  SELECT patch INTO v_patch FROM public.policy_overrides
   WHERE project_id = v_project AND target_key = 'D44-ZERO-PLUS';
  IF v_patch IS NULL THEN
    RAISE EXCEPTION 'D44: a row-level delete took an override that held a deliberate key';
  END IF;
  IF v_patch ? 'safety_stock_days' THEN
    RAISE EXCEPTION 'D44: safety_stock_days survived on a mixed patch: %', v_patch;
  END IF;
  IF (v_patch ->> 'reorder_point')::numeric <> 42 THEN
    RAISE EXCEPTION 'D44: the deliberate key did not survive: %', v_patch;
  END IF;

  -- 3 · a non-zero value is somebody's number.
  SELECT patch INTO v_patch FROM public.policy_overrides
   WHERE project_id = v_project AND target_key = 'D44-NONZERO';
  IF v_patch IS NULL OR (v_patch ->> 'safety_stock_days')::numeric <> 3 THEN
    RAISE EXCEPTION 'D44: a non-zero safety_stock_days was altered: %', v_patch;
  END IF;

  -- 4 · D1 wrote inventory patches. The predicate must not wander to another
  --     family, whatever the key is called there.
  SELECT patch INTO v_patch FROM public.policy_overrides
   WHERE project_id = v_project AND target_key = 'D44-OTHER-FAMILY';
  IF v_patch IS NULL OR (v_patch ->> 'safety_stock_days')::numeric <> 0 THEN
    RAISE EXCEPTION 'D44: the sweep reached outside family = inventory: %', v_patch;
  END IF;

  -- 5 · the remediation said so in the audit log, with the counts.
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE plane = 'data' AND action = 'remediate' AND target_type = 'policy_overrides'
     AND after ->> 'defect' = 'D1 via D44';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'D44: expected exactly 1 remediation audit row, found %', v_n;
  END IF;

  RAISE NOTICE 'D44: the unseed removed the frozen zeros, kept every deliberate key, and audited itself';
END $d44$;
