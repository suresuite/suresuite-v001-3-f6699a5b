-- Account / §4 D205 — /profile's three RPCs name the user they act for, and the
-- password policy is stated once.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- `get_my_profile`, `update_own_profile` and `change_own_password`
-- (`20260527011429`) resolve their user through `get_current_user_id()` and nothing
-- else. This application does not use Supabase Auth: the browser calls as `anon`
-- with no session (D155), and `set_current_user_context` sets `app.current_user_id`
-- with is_local = true, so the setting ends with the login request's own
-- transaction. The NEXT request carries no session, no GUC and no email claim, and
-- all three functions raise `not_authenticated` for every user — D169's and D185's
-- shape, on the account page. What that cost, in order of severity:
--
--   1. PASSWORD EXPIRY AND FORCED CHANGE WERE NEVER ENFORCED. The login enriches the
--      user from `get_my_profile` and ignores its error, so `force_password_change`
--      and `password_expires_at` never reached the browser. `RoleGuard` redirected
--      on a flag that was always undefined, and the expiry banner never rendered.
--      An account an administrator created or reset with "must change on first
--      login" could be used indefinitely on the administrator's password.
--   2. A DEACTIVATED ACCOUNT COULD SIGN IN. `is_active` is checked in the same
--      ignored enrichment; `authenticate_approved_user` does not read it.
--   3. "Update password" and "Save changes" failed for everyone with
--      `not_authenticated`, so nobody could reset their own 90-day clock either.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
-- The precedent is `ingest_run_review` (`20260922000001`): the user arrives as a
-- PARAMETER, the GUC is set LOCAL to this transaction, and a refusal raises. It is
-- D28's client assertion, like every such RPC here, with one difference worth
-- stating: `change_own_password` also requires the CURRENT password, which the
-- database checks, so a password change cannot be made by asserting an id alone.
--
-- A session, when stage 1b makes one real, wins: if `get_current_user_id()` resolves
-- somebody and the parameter names somebody else, the call is refused rather than
-- quietly acting for either. The parameter is trailing and DEFAULT NULL, and each
-- old signature is DROPPED first so no overload is left behind (the PostgREST
-- ambiguity recorded in §16 · WP 6.2 slice 12). DROP takes the grants with it, so
-- they are re-granted explicitly below and `rehearsal/400` reads them from `proacl`.
--
-- ── THE POLICY, ONCE ────────────────────────────────────────────────────────
--
-- "90 days" was authored in the column default, in `change_own_password`, in
-- `admin_reset_user_password` and twice in the page's copy. `password_max_age()` is
-- now the one statement of it for the column default and the self-service change,
-- and `get_my_profile` returns it in days so the page reads its copy from the
-- database. `admin_reset_user_password` still writes its own 90 days; it also sets
-- `force_password_change`, so that date is never the one that expires a password.
-- `get_my_profile` also returns `password_expired`, computed on the SERVER clock, so a
-- browser with a wrong clock cannot read an expired password as valid at sign-in.
--
-- A new password equal to the current one is refused (`password_unchanged`): a forced
-- or expired change that accepts the same password resets the clock and changes
-- nothing. And a successful change writes `auth.password_changed` on the access plane,
-- next to `auth.sign_in`, never failing the change over it.

-- ── 1 · the policy ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.password_max_age()
RETURNS interval
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT interval '90 days' $$;

COMMENT ON FUNCTION public.password_max_age() IS
  'D205 — how long a password is valid after it is set. The one statement of the '
  'password-expiry policy: the approved_users.password_expires_at default and '
  'change_own_password read it, and get_my_profile returns it to the account page.';

REVOKE ALL ON FUNCTION public.password_max_age() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.password_max_age() TO anon, authenticated;

ALTER TABLE public.approved_users
  ALTER COLUMN password_expires_at SET DEFAULT (now() + public.password_max_age());

-- ── 2 · who the caller is ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.account_self_resolve(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session uuid := public.get_current_user_id();
  v_uid     uuid;
BEGIN
  IF p_user_id IS NOT NULL AND v_session IS NOT NULL AND v_session <> p_user_id THEN
    RAISE EXCEPTION 'not_authenticated: the call names a different user than the session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_uid := COALESCE(p_user_id, v_session);
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = v_uid) THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  -- LOCAL, so it cannot outlive this request on a pooled connection.
  PERFORM set_config('app.current_user_id', v_uid::text, true);
  RETURN v_uid;
END;
$$;

COMMENT ON FUNCTION public.account_self_resolve(uuid) IS
  'D205 — the user an account self-service RPC acts for: the named user, or the '
  'session''s when none is named; refuses a name that contradicts the session and an '
  'unknown user. Sets app.current_user_id LOCAL. Internal: no role may call it directly.';

REVOKE ALL ON FUNCTION public.account_self_resolve(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3 · read ─────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_my_profile();

CREATE FUNCTION public.get_my_profile(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  email text,
  name text,
  display_name text,
  phone text,
  avatar_url text,
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
  SELECT au.id, au.email, au.name, au.display_name, au.phone, au.avatar_url,
         au.role::text, au.organization, au.is_active, au.force_password_change,
         au.password_changed_at, au.password_expires_at,
         (au.password_expires_at <= now()),
         extract(day FROM public.password_max_age())::integer
    FROM public.approved_users au
   WHERE au.id = v_uid;
END;
$$;

COMMENT ON FUNCTION public.get_my_profile(uuid) IS
  'D205 — the signed-in user''s own account row, with password_expired computed on the '
  'server clock and the policy''s max age in days. The user is a parameter because the '
  'browser calls as anon (D155); a contradicting session is refused.';

-- ── 4 · profile write ────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.update_own_profile(text, text, text);

-- NULL leaves a field unchanged; a blank string CLEARS it. The previous body
-- COALESCEd every argument, so a phone number, once saved, could never be removed.
CREATE FUNCTION public.update_own_profile(
  p_display_name text DEFAULT NULL,
  p_phone        text DEFAULT NULL,
  p_avatar_url   text DEFAULT NULL,
  p_user_id      uuid DEFAULT NULL
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
         avatar_url   = CASE WHEN p_avatar_url IS NULL THEN avatar_url
                             ELSE NULLIF(btrim(p_avatar_url), '') END,
         updated_at   = now()
   WHERE id = v_uid;
END;
$$;

COMMENT ON FUNCTION public.update_own_profile(text, text, text, uuid) IS
  'D205 — the signed-in user edits their own display name, phone and avatar. NULL '
  'leaves a field unchanged, a blank string clears it. Refuses an inactive account.';

-- ── 5 · password write ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.change_own_password(text, text);

CREATE FUNCTION public.change_own_password(
  p_old_password text,
  p_new_password text,
  p_user_id      uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := public.account_self_resolve(p_user_id);
  v_hash    text;
  v_active  boolean;
  v_expires timestamptz;
BEGIN
  SELECT au.password_hash, au.is_active INTO v_hash, v_active
    FROM public.approved_users au WHERE au.id = v_uid;

  IF NOT v_active THEN
    RAISE EXCEPTION 'account_inactive' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN
    RAISE EXCEPTION 'password_too_short' USING ERRCODE = 'check_violation';
  END IF;
  IF v_hash IS NULL OR p_old_password IS NULL
     OR v_hash <> extensions.crypt(p_old_password, v_hash) THEN
    RAISE EXCEPTION 'invalid_current_password' USING ERRCODE = 'invalid_password';
  END IF;
  IF v_hash = extensions.crypt(p_new_password, v_hash) THEN
    RAISE EXCEPTION 'password_unchanged' USING ERRCODE = 'check_violation';
  END IF;

  v_expires := now() + public.password_max_age();
  UPDATE public.approved_users
     SET password_hash         = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         password_changed_at   = now(),
         password_expires_at   = v_expires,
         force_password_change = false,
         updated_at            = now()
   WHERE id = v_uid;

  BEGIN
    INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
    VALUES ('access', v_uid, 'auth.password_changed', 'approved_users', v_uid::text,
            jsonb_build_object('password_expires_at', v_expires));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'password-change audit skipped: %', SQLERRM;   -- never fail the change over it
  END;

  RETURN v_expires;
END;
$$;

COMMENT ON FUNCTION public.change_own_password(text, text, uuid) IS
  'D205 — the signed-in user sets a new password. Requires the current one (checked '
  'here, so an asserted id alone cannot change a password), refuses a new password '
  'equal to it, clears force_password_change and returns the new expiry, '
  'now() + password_max_age().';

-- ── 6 · grants — explicit, because DROP took the old ones ───────────────────
REVOKE ALL ON FUNCTION public.get_my_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_own_profile(text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_own_password(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_own_password(text, text, uuid) TO anon, authenticated;
