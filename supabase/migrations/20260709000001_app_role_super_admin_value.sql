-- Add the super_admin value to app_role in its OWN migration (= its own
-- transaction). Postgres forbids using an enum value added in the same
-- transaction (SQLSTATE 55P04), which is exactly what the original
-- 20260705000001_super_admin_phase1.sql did — it also shared its version
-- number with open_logistics_reads, so once that one was recorded the CLI
-- would silently skip this. The phase-1 body now lives in 20260709000002.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'super_admin'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'super_admin';
  END IF;
END $$;
