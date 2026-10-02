-- Phase 12 / WP 12.4 / G15 §12: the PRIVATE bucket the engine is distributed from.
--
-- `GET /v1/engine` signs short-lived URLs to the engine wheels in this bucket for an
-- API key; `scripts/publish_engine_wheels.mjs` (CI, main only) fills it, at
-- content-addressed paths plus `index.json`. Private: no storage policy grants
-- `anon` or `authenticated` anything, so the service role (the gateway, the
-- publisher) is the only reader and writer — the same shape as `ingest`.
--
-- Guarded like `20260916000014`'s `ingest` bucket: a database without the storage
-- schema (the rehearsal) skips it.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE $ins$
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('engine', 'engine', false)
      ON CONFLICT (id) DO UPDATE SET public = false
    $ins$;
  END IF;
END $$;
