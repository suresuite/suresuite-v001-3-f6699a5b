-- Phase 1 / WP 1.4 / §8.3 — reconstruct `approved_users`, the authentication table.
--
-- WHY THIS FILE SORTS FIRST. `approved_users` is the table every other one keys
-- off: `organizations.owner_user_id`, `organization_members.user_id`,
-- `user_ai_permissions.user_id` and `user_capabilities.user_id` all REFERENCE it,
-- `get_current_approved_user()` reads it, and every RLS policy in the repo
-- resolves a role through one of those. It is created by NO migration: the
-- earliest file in the history (`20250815225910`) OPENS by dropping one of its
-- policies, so the table already existed when migration tracking began — created
-- by hand, or by a console session nobody kept.
--
-- The consequence is not cosmetic. `supabase db reset` against an empty database
-- fails on the first file, so the migration history cannot build the schema it
-- describes, and no reviewer can read the authentication model without querying
-- production. WP 1.1 found it (the third orphan); this file closes it.
--
-- WHAT IS EVIDENCE AND WHAT IS INFERENCE (§5 T1/T3 — a reconstruction that does
-- not say which is which is a guess wearing a migration's clothes):
--
--   EVIDENCE — read out of statements the history does carry:
--     id             `organizations.owner_user_id uuid REFERENCES approved_users(id)`
--                    (`20260709000002:30`) — uuid, and the primary key.
--     name           `SELECT au.name` in `authenticate_approved_user`
--                    (`20250815225910`), returned as `user_name text`.
--     email          `WHERE au.email = user_email` (same function, arg is text);
--                    `(SELECT id FROM approved_users WHERE email = …)` is used as
--                    a SCALAR subquery in four RLS policies (`20250816052311`),
--                    which errors at runtime unless email is unique — so UNIQUE
--                    is load-bearing, not tidiness.
--     password_hash  `au.password_hash = crypt(user_password, au.password_hash)`;
--                    `SET password_hash = crypt('…', gen_salt('bf'))`
--                    (`20250815232919`) — text, bcrypt.
--     role           `ALTER COLUMN role DROP DEFAULT` … `TYPE public.app_role
--                    USING (CASE WHEN role = 'admin' … ELSE 'user' END)` …
--                    `SET DEFAULT 'user'` (`20250820145734`). Comparing `role` to
--                    the bare literals 'admin'/'modeler' proves it was TEXT here,
--                    and that it had a default before that file dropped it.
--     created_at     `au.created_at` is selected by `list_users_admin`
--     updated_at     and the admin RPCs (`20250830231617`, `20260711000003`).
--
--   INFERENCE — stated here so a later reader can challenge it:
--     · `role NOT NULL DEFAULT 'user'`. The conversion's `ELSE` branch maps every
--       non-admin, non-modeler value to 'user', which is total but does not prove
--       NOT NULL; the DROP/SET DEFAULT pair proves only that a default existed,
--       not which. 'user' is chosen because that is the value the same file
--       restores one statement later.
--     · `name NOT NULL`. Never observed NULL; `authenticate_approved_user`
--       returns it as the display name and the app has no null branch for it.
--     · column ORDER. Unknowable, and irrelevant: nothing here uses positional
--       INSERT.
--
--   NOT REPRODUCED HERE, because a later migration already carries it:
--     organization (`20250820163748`), display_name / avatar_url / phone /
--     password_changed_at / password_expires_at / force_password_change /
--     is_active (`20260527011429`), organization_id (`20260709000002`),
--     RLS enable (`20250820163957`), the policies, and
--     `idx_approved_users_organization`. Restating any of them would create the
--     second source of truth this phase exists to remove (I1).
--
-- IF NOT EXISTS, and nothing else. The deployed table is the one the product
-- authenticates against; this file must be a no-op there. It does not DROP, it
-- does not ALTER, and it adds no constraint to an existing table — including the
-- UNIQUE on email, which a fresh database gets from the CREATE and a deployed one
-- keeps or lacks as it already does. Whether the deployed table's constraint set
-- matches this reconstruction is UNVERIFIED: no database has been reachable from
-- a work-package session yet (PLAN.md §16). Confirm it with the §15 baseline
-- before trusting this file as a description of production, rather than as what
-- it is — the definition a fresh database is built from.

CREATE TABLE IF NOT EXISTS public.approved_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'user',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.approved_users IS
  'Authentication and identity. Reconstructed in Phase 1 / WP 1.4 from the ALTERs '
  'the migration history carries — the table predates migration tracking and was '
  'created outside it. See this file''s header for which columns are evidence and '
  'which are inference (PLAN.md §4, §16 WP 1.4).';
