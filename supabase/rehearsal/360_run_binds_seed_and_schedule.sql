-- Audit 2026-09-22 · WP 8 · F-11 — a run can record the seed and schedule it ran.
--
-- §1 both columns exist on simulation_runs with the declared types.
-- §2 both are NULLABLE with NO DEFAULT: a run dispatched before the stamp must
--    read NULL ("not stamped"), which the export resolves only through the
--    row-unchanged guard. A default would bind a value no dispatcher wrote.
DO $wp8seed$
DECLARE
  v_type text;
  v_null text;
  v_def  text;
BEGIN
  SELECT data_type, is_nullable, column_default INTO v_type, v_null, v_def
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'simulation_runs' AND column_name = 'seed';
  IF v_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 'WP 8 §1: simulation_runs.seed is %, expected bigint', coalesce(v_type, 'MISSING');
  END IF;
  IF v_null <> 'YES' OR v_def IS NOT NULL THEN
    RAISE EXCEPTION 'WP 8 §2: simulation_runs.seed must be nullable with no default (nullable=%, default=%)', v_null, v_def;
  END IF;

  SELECT data_type, is_nullable, column_default INTO v_type, v_null, v_def
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'simulation_runs' AND column_name = 'disruption_schedule';
  IF v_type IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'WP 8 §1: simulation_runs.disruption_schedule is %, expected jsonb', coalesce(v_type, 'MISSING');
  END IF;
  IF v_null <> 'YES' OR v_def IS NOT NULL THEN
    RAISE EXCEPTION 'WP 8 §2: simulation_runs.disruption_schedule must be nullable with no default';
  END IF;

  RAISE NOTICE 'WP 8 · run seed/schedule stamp columns: OK';
END
$wp8seed$;
