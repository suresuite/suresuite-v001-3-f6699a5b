-- D48 · the phantom overload is NOT in the database, and the two real ones are.
--
-- `20250827170942` declares `create_disruption_scenario_v2` with `p_user_id`
-- and `p_user_email` — neither defaulted — AFTER `p_status … DEFAULT 'draft'`.
-- PostgreSQL raises 42P13 at CREATE time, so that statement and everything
-- after it in the file never ran. The whole file rolled back, which means the
-- four `disruption_scenario_*` tables it appears to create were created by
-- `20250827171106` instead — 84 seconds later, carrying the literal comment
-- `-- FIXED: Put all parameters with defaults at the end`.
--
-- ── WHY THIS FILE DOES NOT NEED A BASE-DETECTION BRANCH ───────────────────
--
-- `170` and `180` had to detect a stale base because they assert that something
-- IS present, and in plain/`--fixtures` mode the base comes from the BASE
-- BRANCH's artifact, which predates the fix. Every section here asserts an
-- ABSENCE or a count that a stale base FAILS — which is the right way round:
-- a base built before the fix has the phantom overload, and §1 says so.
--
-- §4 is the exception and it says so in place.

DO $d48$
DECLARE
  v_n        integer;
  v_sigs     text;
  v_creator  text;
BEGIN
  -- ── 1 · exactly two overloads, and neither is the one that cannot exist ──
  --
  -- The phantom takes `p_status` FOURTH. Both real ones take `p_user_id`
  -- fourth, so the fourth argument's type is the discriminator: the phantom is
  -- `public.disruption_status`, the real ones `uuid`.
  SELECT count(*), string_agg(pg_get_function_identity_arguments(p.oid), E'\n  ' ORDER BY p.oid)
    INTO v_n, v_sigs
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_disruption_scenario_v2';

  IF v_n <> 2 THEN
    RAISE EXCEPTION
      'D48 §1 — % overload(s) of `create_disruption_scenario_v2`, expected 2. '
      'The third is `20250827170942`''s, which PostgreSQL refuses with 42P13, so '
      'it has never existed in any database. Found:%  %', v_n, E'\n  ', v_sigs;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_disruption_scenario_v2'
      AND p.proargtypes[3] = 'public.disruption_status'::regtype
  ) THEN
    RAISE EXCEPTION
      'D48 §1 — an overload takes `p_status` as its FOURTH argument. That is the '
      'definition `20250827170942` aborted on; the artifact recorded it anyway '
      'and `rehearsal-schema.mjs` emitted it.';
  END IF;

  -- ── 2 · the overload the ONE call site reaches actually exists ───────────
  --
  -- `DisruptionDialog.tsx` sends `p_disruption_start` and `p_disruption_end`.
  -- PostgREST resolves an RPC by NAMED arguments, so an overload without those
  -- names cannot serve the call however many others it has.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_disruption_scenario_v2'
      AND p.proargnames @> ARRAY['p_disruption_start', 'p_disruption_end']
  ) THEN
    RAISE EXCEPTION
      'D48 §2 — no overload takes `p_disruption_start`/`p_disruption_end`, so the '
      'single call site in `DisruptionDialog.tsx` resolves to nothing. That is '
      '`20250828005114`''s definition and it must survive.';
  END IF;

  -- ── 3 · the four tables exist and came from the RETRY ────────────────────
  --
  -- The point of the abort is not that the tables vanish — it is that they were
  -- created by a DIFFERENT migration than the artifact said. A reader sent to
  -- `20250827170942` to learn why a column is shaped as it is was being sent to
  -- a file that never ran (§5 T1).
  SELECT string_agg(t, ', ' ORDER BY t) INTO v_sigs
  FROM unnest(ARRAY['disruption_scenario_profiles', 'disruption_scenario_targets',
                    'disruption_scenario_effects',  'disruption_scenario_settings']) AS t
  WHERE to_regclass('public.' || t) IS NULL;
  IF v_sigs IS NOT NULL THEN
    RAISE EXCEPTION
      'D48 §3 — % missing. Aborting `20250827170942` must NOT remove them: '
      '`20250827171106` re-issues all four, which is what makes it a retry '
      'rather than a different change.', v_sigs;
  END IF;

  -- ── 4 · and the 42P13 files' OTHER statements are not in the database ────
  --
  -- `20250904122241` and `20250904122347` each abort on `get_network_nodes`,
  -- and each also defines `get_network_edges` and `get_network_summary` with
  -- the same illegal ordering. None of the six can exist. This is the section
  -- a stale base fails, which is the right way round.
  -- `proargnames` carries the RETURNS TABLE column names after the input
  -- parameters, so `array_length(proargnames, 1)` is NOT the last input — the
  -- first draft of this section indexed past the arguments into the result
  -- columns and accused three correct functions. `pronargs` is the count that
  -- stops at the inputs.
  SELECT count(*) INTO v_n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('get_network_nodes', 'get_network_edges', 'get_network_summary')
    AND p.pronargdefaults > 0
    AND p.proargnames[p.pronargs] <> 'p_plant_name';
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'D48 §4 — % network function(s) put their defaulted `p_plant_name` before '
      '`p_user_id`. PostgreSQL refuses that ordering; `20250904124537` is the '
      'definition that works and it puts `p_plant_name` last.', v_n;
  END IF;

  RAISE NOTICE 'D48 · 190 — two overloads, the caller''s target present, the '
               'four tables from the retry, no illegal network ordering.';
END
$d48$;
