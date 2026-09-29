-- Account / §4 D207 — a user edits their own name on /profile, as a first and a
-- last name, and the account `name` stays the one full name every reader shows.
--
-- ── WHAT WAS MISSING ────────────────────────────────────────────────────────
--
-- `approved_users.name` is the name an administrator typed when the account was
-- approved. /profile showed it only as the Display name field's placeholder, and no
-- RPC let its owner change it: a misspelt or changed name could be corrected only by
-- an administrator. The owner asked for the user to edit it, and for the page to show
-- it as a First and a Last name.
--
-- ── ONE FACT, TWO SHAPES ────────────────────────────────────────────────────
--
-- Adding `first_name` / `last_name` beside `name` would author the person's name
-- twice, and every writer of `name` that is not this change — `admin_create_user`,
-- the admin edit paths, the base table's own inserts — would leave the parts behind
-- (`single-source`). So the parts and the full name are kept equal by ONE trigger,
-- whatever writes the row:
--
--   · a write that changes a PART sets `name` to the parts joined by one space;
--   · a write that changes only `name` (every admin path) re-derives the parts:
--     the first word is the first name, the rest is the last name.
--
-- The split is a derivation, not a claim about the person — "Mary Ann Smith" reads as
-- first "Mary", last "Ann Smith" until its owner corrects it on /profile, after which
-- the parts are exactly what they typed and `name` follows them. The backfill below
-- applies the same split (`split_person_name`, the one statement of it) to every
-- existing row, and runs before the trigger exists so no stored `name` is rewritten.
--
-- A first name is required: `name` is NOT NULL and the app has no branch for a blank
-- one (`20250815000000`). A last name may be blank — not everybody has one.
--
-- ── THE RPCS ────────────────────────────────────────────────────────────────
--
-- `update_own_profile` takes `p_first_name` / `p_last_name` AFTER `p_user_id`, so
-- every positional caller of the D206 signature keeps working, with D206's rule:
-- NULL leaves a part unchanged, a blank last name clears it, a blank first name is
-- refused (`first_name_required`). `get_my_profile` returns both parts. Each is a
-- DROP and CREATE — one changes its argument list, the other its result — so the
-- grants are re-stated explicitly and `rehearsal/420` reads them from `proacl`.

-- ── 1 · the columns ──────────────────────────────────────────────────────────
ALTER TABLE public.approved_users ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.approved_users ADD COLUMN IF NOT EXISTS last_name  text;

COMMENT ON COLUMN public.approved_users.first_name IS
  'D207 — the first part of `name`. Kept equal to `name` by approved_users_sync_name: '
  'editing a part rewrites `name`; writing only `name` re-derives the parts (first word '
  '/ the rest). Editable by its owner on /profile through update_own_profile.';
COMMENT ON COLUMN public.approved_users.last_name IS
  'D207 — the rest of `name` after the first name; NULL when the name is one word. '
  'Kept equal to `name` by approved_users_sync_name.';

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
  'D207 — a full name as {first word, the rest}, each NULL when empty. The one '
  'statement of how approved_users.name is derived into first_name / last_name.';

-- ── 3 · the backfill — BEFORE the trigger, so it writes the parts and leaves
-- every `name` exactly as it is. Idempotent: it touches only rows with no parts.
UPDATE public.approved_users au
   SET first_name = s.parts[1],
       last_name  = s.parts[2]
  FROM (SELECT id, public.split_person_name(name) AS parts FROM public.approved_users) s
 WHERE s.id = au.id
   AND au.first_name IS NULL AND au.last_name IS NULL;

-- ── 4 · the one rule ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approved_users_sync_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parts_changed boolean;
  v_parts         text[];
BEGIN
  v_parts_changed := CASE TG_OP
    WHEN 'INSERT' THEN NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL
    ELSE NEW.first_name IS DISTINCT FROM OLD.first_name
      OR NEW.last_name  IS DISTINCT FROM OLD.last_name
  END;

  IF v_parts_changed THEN
    NEW.first_name := NULLIF(btrim(NEW.first_name), '');
    NEW.last_name  := NULLIF(btrim(NEW.last_name), '');
    IF NEW.first_name IS NULL THEN
      RAISE EXCEPTION 'first_name_required' USING ERRCODE = 'check_violation';
    END IF;
    NEW.name := concat_ws(' ', NEW.first_name, NEW.last_name);
  ELSIF TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name THEN
    v_parts := public.split_person_name(NEW.name);
    NEW.first_name := v_parts[1];
    NEW.last_name  := v_parts[2];
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.approved_users_sync_name() IS
  'D207 — keeps approved_users.name and its first_name / last_name parts one fact: a '
  'changed part rewrites name (parts joined by one space; a blank first name raises '
  'first_name_required); a changed name alone re-derives the parts through '
  'split_person_name.';

DROP TRIGGER IF EXISTS approved_users_sync_name ON public.approved_users;
CREATE TRIGGER approved_users_sync_name
  BEFORE INSERT OR UPDATE OF name, first_name, last_name ON public.approved_users
  FOR EACH ROW EXECUTE FUNCTION public.approved_users_sync_name();

-- ── 5 · read ─────────────────────────────────────────────────────────────────
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
  password_max_age_days integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.account_self_resolve(p_user_id);
BEGIN
  RETURN QUERY
  SELECT au.id, au.email, au.name, au.first_name, au.last_name, au.display_name,
         au.phone, au.avatar_color,
         au.role::text, au.organization, au.is_active, au.force_password_change,
         au.password_changed_at, au.password_expires_at,
         (au.password_expires_at <= now()),
         extract(day FROM public.password_max_age())::integer
    FROM public.approved_users au
   WHERE au.id = v_uid;
END;
$$;

COMMENT ON FUNCTION public.get_my_profile(uuid) IS
  'D206/D207 — the signed-in user''s own account row, with their name as a whole and '
  'as first/last parts, password_expired computed on the server clock and the policy''s '
  'max age in days. The user is a parameter because the browser calls as anon (D155); '
  'a contradicting session is refused.';

-- ── 6 · write ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.update_own_profile(text, text, text, uuid);

-- NULL leaves a field unchanged; a blank string CLEARS it — except the first name,
-- which the trigger refuses to clear (`first_name_required`).
CREATE FUNCTION public.update_own_profile(
  p_display_name text DEFAULT NULL,
  p_phone        text DEFAULT NULL,
  p_avatar_color text DEFAULT NULL,
  p_user_id      uuid DEFAULT NULL,
  p_first_name   text DEFAULT NULL,
  p_last_name    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.account_self_resolve(p_user_id);
BEGIN
  IF NOT (SELECT au.is_active FROM public.approved_users au WHERE au.id = v_uid) THEN
    RAISE EXCEPTION 'account_inactive' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.approved_users
     SET display_name = CASE WHEN p_display_name IS NULL THEN display_name
                             ELSE NULLIF(btrim(p_display_name), '') END,
         phone        = CASE WHEN p_phone IS NULL THEN phone
                             ELSE NULLIF(btrim(p_phone), '') END,
         avatar_color = CASE WHEN p_avatar_color IS NULL THEN avatar_color
                             ELSE NULLIF(btrim(p_avatar_color), '') END,
         -- The trigger trims, refuses a blank first name and rewrites `name`.
         first_name   = COALESCE(p_first_name, first_name),
         last_name    = CASE WHEN p_last_name IS NULL THEN last_name ELSE p_last_name END,
         updated_at   = now()
   WHERE id = v_uid;
END;
$$;

COMMENT ON FUNCTION public.update_own_profile(text, text, text, uuid, text, text) IS
  'D206/D207 — the signed-in user edits their own first and last name (which rewrite '
  'the account name), display name, phone and avatar colour. NULL leaves a field '
  'unchanged, a blank string clears it; a blank first name is refused. Refuses an '
  'inactive account.';

-- ── 7 · grants — explicit, because DROP took the old ones ───────────────────
REVOKE ALL ON FUNCTION public.get_my_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_own_profile(text, text, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text, text, uuid, text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.approved_users_sync_name() FROM PUBLIC;
