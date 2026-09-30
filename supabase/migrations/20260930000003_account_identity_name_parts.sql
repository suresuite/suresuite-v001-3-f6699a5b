-- Account / §4 D209 — /profile shows who the account belongs to (first and last name,
-- user ID) and lets its owner change only their user name.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
--
-- `approved_users.name` is the full name an administrator typed when the account was
-- approved. /profile showed it only as the Display name field's placeholder, so the
-- page never said, in plain view, whose account it is. The owner asked for the page to
-- show the account holder's First and Last name and user ID, and to let the user
-- change their USER NAME only: the first and last name must stay as the administrator
-- recorded them, so every action stays attributable to an identified person.
--
-- ── THE IDENTITY IS NOT THE USER'S TO EDIT ──────────────────────────────────
--
-- The user name is `display_name` — "the name the user chose for themselves", already
-- the one field `update_own_profile` lets its owner write (D206), and what the nav bar
-- shows. It is RENAMED on the page, not added in the schema: a second self-chosen name
-- column would author one fact twice. `update_own_profile` is NOT changed by this
-- migration — it never wrote `name`, and after it `first_name` / `last_name` cannot be
-- written by anybody, because:
--
-- ── ONE FACT, READ TWO WAYS ─────────────────────────────────────────────────
--
-- `first_name` / `last_name` are DERIVED from `name`, never authored beside it. Every
-- write to the row that names any of the three re-derives both parts from `name`
-- through `split_person_name` (first word / the rest), so a write that tries to set a
-- part directly is overwritten and the parts cannot drift from `name`
-- (`single-source`). The only way to change them is to change `name`, which only the
-- administrator paths do. Existing rows are backfilled by the same function BEFORE the
-- trigger exists, so no stored `name` is rewritten.
--
-- The split is a reading, not a claim about the person: "Mary Ann Smith" reads as
-- first "Mary", last "Ann Smith". An administrator who needs it read otherwise edits
-- `name`. (A GENERATED column would say the same thing more structurally, but the
-- contract's introspector records no generation expression, so a rehearsal base built
-- from the artifact would get two plain, writable columns — D52's class.)

-- ── 1 · the columns ──────────────────────────────────────────────────────────
ALTER TABLE public.approved_users ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.approved_users ADD COLUMN IF NOT EXISTS last_name  text;

COMMENT ON COLUMN public.approved_users.first_name IS
  'D209 — the first word of `name`, derived by approved_users_derive_name_parts on every '
  'write; not writable on its own. Shown read-only on /profile.';
COMMENT ON COLUMN public.approved_users.last_name IS
  'D209 — `name` after its first word; NULL when the name is one word. Derived by '
  'approved_users_derive_name_parts on every write; not writable on its own.';

-- ── 2 · the split, stated once ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.split_person_name(p_name text)
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT ARRAY[
    NULLIF(substring(p_name FROM '^\s*(\S+)'), ''),
    NULLIF(regexp_replace(p_name, '^\s*\S+\s*|\s+$', '', 'g'), '')
  ]
$$;

COMMENT ON FUNCTION public.split_person_name(text) IS
  'D209 — a full name as {first word, the rest}, each NULL when empty. The one '
  'statement of how approved_users.name is read as first_name / last_name.';

-- ── 3 · the backfill — BEFORE the trigger, so no stored `name` is touched.
-- Idempotent: it touches only rows whose parts are not yet derived.
UPDATE public.approved_users au
   SET first_name = s.parts[1],
       last_name  = s.parts[2]
  FROM (SELECT id, public.split_person_name(name) AS parts FROM public.approved_users) s
 WHERE s.id = au.id
   AND (au.first_name IS DISTINCT FROM s.parts[1] OR au.last_name IS DISTINCT FROM s.parts[2]);

-- ── 4 · the one rule ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approved_users_derive_name_parts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parts text[] := public.split_person_name(NEW.name);
BEGIN
  -- Whatever the statement wrote into a part, the part is what `name` says.
  NEW.first_name := v_parts[1];
  NEW.last_name  := v_parts[2];
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.approved_users_derive_name_parts() IS
  'D209 — derives approved_users.first_name / last_name from name on every write that '
  'names any of the three, overwriting a part written directly: the parts are a reading '
  'of name, never a second statement of it.';

REVOKE ALL ON FUNCTION public.approved_users_derive_name_parts() FROM PUBLIC;

DROP TRIGGER IF EXISTS approved_users_derive_name_parts ON public.approved_users;
CREATE TRIGGER approved_users_derive_name_parts
  BEFORE INSERT OR UPDATE OF name, first_name, last_name ON public.approved_users
  FOR EACH ROW EXECUTE FUNCTION public.approved_users_derive_name_parts();

-- ── 5 · read — `20260929000004`'s columns, plus the two parts ────────────────
DROP FUNCTION IF EXISTS public.get_my_profile(uuid);

CREATE FUNCTION public.get_my_profile(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  email text,
  name text,
  first_name text,
  last_name text,
  display_name text,
  phone text,
  avatar_color text,
  role text,
  organization text,
  is_active boolean,
  force_password_change boolean,
  password_changed_at timestamptz,
  password_expires_at timestamptz,
  password_expired boolean,
  password_max_age_days integer,
  access_period text,
  access_valid_from timestamptz,
  access_valid_until timestamptz,
  access_expired boolean,
  access_exempt boolean,
  project_limit integer,
  projects_used bigint,
  user_limit integer,
  users_used bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.account_self_resolve(p_user_id);
BEGIN
  RETURN QUERY
  SELECT au.id, au.email, au.name, au.first_name, au.last_name,
         au.display_name, au.phone, au.avatar_color,
         au.role::text, au.organization, au.is_active, au.force_password_change,
         au.password_changed_at, au.password_expires_at,
         (au.password_expires_at <= now()),
         extract(day FROM public.password_max_age())::integer,
         o.access_period, o.access_valid_from, o.access_valid_until,
         -- Expired FOR THIS ACCOUNT: the organization's period ended and the account is
         -- not a super admin (`20260929000004` header §3).
         COALESCE(o.access_valid_until <= now(), false) AND au.role <> 'super_admin'::public.app_role,
         au.role = 'super_admin'::public.app_role,
         o.project_limit,
         CASE WHEN o.id IS NULL THEN NULL
              ELSE (SELECT count(*) FROM public.projects p WHERE p.organization_id = o.id) END,
         o.user_limit,
         CASE WHEN o.id IS NULL THEN NULL
              ELSE (SELECT count(*) FROM public.approved_users u WHERE u.organization_id = o.id) END
    FROM public.approved_users au
    LEFT JOIN public.organizations o ON o.id = au.organization_id
   WHERE au.id = v_uid;
END;
$$;

COMMENT ON FUNCTION public.get_my_profile(uuid) IS
  'D206, D207, D209 — the signed-in user''s own account row: their name whole and as '
  'first/last parts (read-only, D209), password_expired computed on the server clock, the '
  'password policy''s max age in days, and the plan of the account''s organization: its '
  'access period and end, whether it has ended for this account (access_expired; a super '
  'admin is exempt, access_exempt), and its project and user limits with the counts they '
  'are measured by. The user is a parameter because the browser calls as anon (D155); a '
  'contradicting session is refused.';

-- ── 6 · grants — explicit, because DROP took the old ones ───────────────────
REVOKE ALL ON FUNCTION public.get_my_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile(uuid) TO anon, authenticated;
