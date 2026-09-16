-- Phase 3 / WP 3.0 / §8.2 — UNDOING D1'S DAMAGE (D44).
--
-- WP 0.1 closed the write path that auto-seeded `safety_stock_days = 0` as a
-- saved override. It never cleaned what the path had already written. §15's
-- first execution counted the residue: **477 `policy_overrides` rows across 477
-- distinct targets** still carry it, and nothing distinguishes one of them from
-- a decision a human made — so every simulation over those targets still runs
-- with zero safety stock while both the policy bundle and the engine's own
-- default say seven days.
--
-- D1 is correctly marked ✅: the defect that wrote them is gone. The damage is a
-- separate thing and this file is it.
--
-- ── WHY 477 IS AUTOMATION AND NOT 477 DECISIONS ────────────────────────────
--
-- 477 rows across 477 DISTINCT targets — one per target, with no target
-- overridden twice. That is what a loop writes. A human setting a deliberate
-- zero does it for the item that needs it, not for every item exactly once.
-- Combined with the mechanism WP 0.1 documented — the prefill froze whatever
-- the grid resolved, and the grid resolved a blank cell to 0 — this is the
-- residue of the old rule and not a body of choices.
--
-- ── WHY IT REMOVES A KEY AND NOT A ROW ─────────────────────────────────────
--
-- §10 calls for "a migration that deletes only rows the old rule would have
-- written". A ROW-level delete is wider than the evidence: `policy_overrides`
-- is keyed `(project_id, scope, target_key, family)`, so ONE row carries the
-- whole inventory patch for a target. Deleting it to remove a frozen
-- `safety_stock_days` would also discard every other key in that patch — the
-- reorder point, the holding cost, whatever the user actually chose — and those
-- are not D1's damage.
--
-- So this removes the KEY. Where the patch has nothing else left, the row is an
-- override that overrides nothing and it goes. That is strictly narrower than
-- what §10 asks for, and narrower is the only direction in which a deletion may
-- be wrong.
--
-- ONLY EXACTLY ZERO. `= 0` is the value the old rule wrote; any other value,
-- including a small non-zero one, is somebody's number and is left alone.

DO $unseed$
DECLARE
  v_rows_before        integer;
  v_targets_before     integer;
  v_keys_removed       integer;
  v_rows_deleted       integer;
  v_rows_after         integer;
  v_audit_id           uuid;
BEGIN
  SELECT count(*), count(DISTINCT target_key)
    INTO v_rows_before, v_targets_before
    FROM public.policy_overrides
   WHERE family = 'inventory'
     AND patch ? 'safety_stock_days'
     AND (patch ->> 'safety_stock_days') ~ '^-?[0-9]+(\.[0-9]+)?$'
     AND (patch ->> 'safety_stock_days')::numeric = 0;

  RAISE NOTICE 'D44: % row(s) across % distinct target(s) carry safety_stock_days = 0',
    v_rows_before, v_targets_before;

  -- 1 · strip the key, keeping everything else the patch says
  WITH stripped AS (
    UPDATE public.policy_overrides
       SET patch = patch - 'safety_stock_days'
     WHERE family = 'inventory'
       AND patch ? 'safety_stock_days'
       AND (patch ->> 'safety_stock_days') ~ '^-?[0-9]+(\.[0-9]+)?$'
       AND (patch ->> 'safety_stock_days')::numeric = 0
    RETURNING 1)
  SELECT count(*) INTO v_keys_removed FROM stripped;

  -- 2 · an override with an empty patch overrides nothing
  WITH emptied AS (
    DELETE FROM public.policy_overrides
     WHERE family = 'inventory' AND patch = '{}'::jsonb
    RETURNING 1)
  SELECT count(*) INTO v_rows_deleted FROM emptied;

  SELECT count(*) INTO v_rows_after
    FROM public.policy_overrides
   WHERE family = 'inventory'
     AND patch ? 'safety_stock_days'
     AND (patch ->> 'safety_stock_days') ~ '^-?[0-9]+(\.[0-9]+)?$'
     AND (patch ->> 'safety_stock_days')::numeric = 0;

  -- ── the audit row §10 asks for ────────────────────────────────────────────
  --
  -- The statement triggers WP 2.3 installed already write one row per statement
  -- above, and they are generic: "update, policy_overrides, N rows". This one
  -- says WHAT and WHY, because a reader finding a user's saved override gone
  -- needs the reason and not only the count.
  --
  -- `actor_user_id` is NULL and that is the truth, not an omission: a migration
  -- has no user. `actor_known: false` is recorded in the payload the same way
  -- `audit_tier_write` records it, so nobody later reads the NULL as a bug
  -- (D36).
  SELECT public.log_data_action(
    NULL,
    'data',
    'remediate',
    'policy_overrides',
    NULL,
    jsonb_build_object(
      'rows_carrying_zero', v_rows_before,
      'distinct_targets',   v_targets_before),
    jsonb_build_object(
      'defect',             'D1 via D44',
      'migration',          '20260916000004_unseed_d1_zero_safety_stock',
      'keys_removed',       v_keys_removed,
      'rows_deleted_empty', v_rows_deleted,
      'rows_still_zero',    v_rows_after,
      'restores',           'the engine default of 7 days for the affected targets',
      'actor_known',        false)
  ) INTO v_audit_id;

  RAISE NOTICE 'D44: % key(s) removed, % empty row(s) deleted, % remaining; audit row %',
    v_keys_removed, v_rows_deleted, v_rows_after, v_audit_id;

  -- The count is the check. If any row still carries the frozen zero after the
  -- UPDATE, the predicate and the data disagree and the deploy should say so
  -- rather than report a clean run.
  IF v_rows_after <> 0 THEN
    RAISE EXCEPTION 'D44: % row(s) still carry safety_stock_days = 0 after the sweep', v_rows_after;
  END IF;
END $unseed$;
