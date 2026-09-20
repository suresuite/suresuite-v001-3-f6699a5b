-- WP 6.5a precondition / §4 D156 — the ingestion actor points at the table it comes from
--
-- `ingest_land_file` RAISES when its actor is NULL — deliberately, with `audit-actor` (G4)
-- named in the message, because an unattributed file landing is the thing that invariant
-- exists to forbid — and then writes that actor into `ingest_runs.triggered_by_user_id`.
-- `ingest_apply_run` writes it into `applied_by_user_id`. Both columns carry a foreign key
-- to **`auth.users`**, from `20260829120000`, when the actor was expected to be a Supabase
-- Auth user.
--
-- This application authenticates against `public.approved_users`. §15 run `35466925117`
-- measured the consequence: `auth.users` holds **1** row, `approved_users` holds **14**,
-- and the overlap is **ZERO**. So the function can satisfy neither requirement — not NULL,
-- because it raises first, and not a real uploader either, because that uuid is in no
-- `auth.users` row. **Every CSV landing by a real person would abort on a foreign-key
-- violation.**
--
-- ── WHY NOBODY HAD SEEN IT ──────────────────────────────────────────────────
--
-- `ingest-file` is not deployed (D123), so nothing reaches the path in production: the
-- defect is LATENT, and WP 6.5 (a) is the package that would have published it straight
-- into this. And every rehearsal that exercises the landing — `050`, `060`, `070`, `080`,
-- `090`, `100`, `110`, `120` — INSERTs its actor into `auth.users` first, so each one
-- proves the path against a world in which `approved_users.id ∈ auth.users.id`. The
-- fixtures are not wrong; they are UNREPRESENTATIVE, and nothing compares a fixture's
-- premises to production's.
--
-- ── DROP, AND THEN POINT AT THE RIGHT TABLE ────────────────────────────────
--
-- `20260613000001_fix_snapshot_created_by.sql` hit exactly this in June for
-- `policy_versions.created_by` and DROPPED the key, with the clearest statement of the
-- problem anywhere in this repository. This goes one step further and re-adds the
-- constraint against `approved_users`, because a dropped key leaves the column unconstrained
-- and the honest shape is the one `ingest_files.uploaded_by` has had all along:
-- `REFERENCES public.approved_users(id) ON DELETE SET NULL`. `ON DELETE SET NULL` matches
-- that column and `audit_logs.actor_user_id` — deleting a person must not delete the record
-- of what they did, and the run survives with its actor unknown rather than vanishing.
--
-- Adding the constraint would FAIL on a row whose actor is in neither table, which is the
-- right behaviour and is why this is not `NOT VALID`: a constraint that governs future rows
-- while leaving the old ones unreachable and uncounted is D117's lesson. `ingest_runs` holds
-- **0 rows** in production (§15, every read since WP 3.1), so there is nothing to violate it.
--
-- Revert: drop the two new constraints and re-add them against `auth.users`.
-- §15's probe 0.9 goes from 8 keys to 6 and the run stops being red.

-- ── TWO NAMES FOR ONE KEY, WHICH IS §4 D160 ────────────────────────────────
--
-- PostgreSQL names an unnamed constraint `<table>_<column>_fkey` AT CREATION TIME, and
-- this table was created as `erp_sync_runs` and renamed to `ingest_runs` by WP 3.1. So
-- **production's keys are called `erp_sync_runs_*_fkey`** (§15 run `35467412134` read the
-- names out of `pg_constraint`) while a REHEARSED database builds the table fresh under
-- its current name and calls the same keys **`ingest_runs_*_fkey`**.
--
-- A `DROP CONSTRAINT IF EXISTS` naming one of those silently does nothing in the other
-- world — and `IF EXISTS` is what makes it silent. The first draft of this migration named
-- only production's, so in the rehearsal it dropped nothing, added a second key beside the
-- first, and the landing still failed on the old one. That is D52's family: a rename that
-- did not follow the foreign keys, surfacing four packages later in the one place the name
-- is load-bearing.
--
-- Both names are dropped, explicitly, rather than looked up in a `DO` block — a `DO` block's
-- DDL is invisible to `contract:introspect` (D99, and D117's first draft), so the
-- duplication here is the smaller cost. If a third name ever exists this is wrong again,
-- which is why `rehearsal/320` §2 counts the keys by TARGET rather than by name: it fails
-- whatever the constraint is called.

ALTER TABLE public.ingest_runs
  DROP CONSTRAINT IF EXISTS erp_sync_runs_triggered_by_user_id_fkey;
ALTER TABLE public.ingest_runs
  DROP CONSTRAINT IF EXISTS ingest_runs_triggered_by_user_id_fkey;
ALTER TABLE public.ingest_runs
  ADD CONSTRAINT ingest_runs_triggered_by_user_fkey
  FOREIGN KEY (triggered_by_user_id)
  REFERENCES public.approved_users(id) ON DELETE SET NULL;

ALTER TABLE public.ingest_runs
  DROP CONSTRAINT IF EXISTS erp_sync_runs_applied_by_user_id_fkey;
ALTER TABLE public.ingest_runs
  DROP CONSTRAINT IF EXISTS ingest_runs_applied_by_user_id_fkey;
ALTER TABLE public.ingest_runs
  ADD CONSTRAINT ingest_runs_applied_by_user_fkey
  FOREIGN KEY (applied_by_user_id)
  REFERENCES public.approved_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ingest_runs.triggered_by_user_id IS
  'The person who started this run, as public.approved_users(id). NULL for a scheduled '
  'connector run, which genuinely has no actor. Keyed to approved_users since WP 6.5a''s '
  'precondition (§4 D156) — it pointed at auth.users, where no user of this application '
  'exists, so a real CSV landing could not be recorded at all.';

COMMENT ON COLUMN public.ingest_runs.applied_by_user_id IS
  'The person who promoted this run into tier 2, as public.approved_users(id). Same '
  'correction as triggered_by_user_id (§4 D156).';
