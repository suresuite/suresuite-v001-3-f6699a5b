-- Forgotten passwords: the person ASKS, a super admin RESETS (PLAN.md §4 D251).
--
-- Until now "Forgot password?" on the sign-in page was a link to `#`, and a person who
-- forgot their password had to know to email somebody. `admin_reset_user_password`
-- (`20260711000003`) has existed since July and nothing in the app called it.
--
-- This application signs people in against `approved_users`, not Supabase Auth, so
-- Supabase's own reset e-mail cannot reach them, and nothing here sends e-mail. So the
-- reset is ADMIN-ASSISTED, with the super admin as the one administrator for now:
--
--   1 · the person types their email on the sign-in page → `request_password_reset`
--       records ONE open request, if and only if the email is an active account;
--   2 · a super admin sees open requests on /admin/users
--       (`admin_list_password_reset_requests`), confirms with the person through a
--       channel already known to belong to them, and either resets the password or
--       dismisses the request (`admin_dismiss_password_reset_request`);
--   3 · `admin_reset_user_password` sets a temporary password, forces a change at the
--       next sign-in (D206's lock), and now CLOSES the person's open request.
--
-- ── WHAT A REQUEST CAN AND CANNOT DO ────────────────────────────────────────
--
-- Anyone can type anyone's email, so a request changes NOTHING about the account. It is
-- a note for a super admin, who decides. And the answer to the caller is the same in
-- every case — known, unknown, suspended, already open — so the form cannot be used to
-- find out which emails have accounts. Nothing is stored for an email that is not an
-- active account: an unknown address has no person to attribute a row to, and storing
-- it would let anyone write rows (the reasoning `auth.sign_in_failed` already follows).
-- At most ONE request per account is open at a time (a partial unique index), so
-- repeating the request adds nothing; a new one can be made only after a super admin
-- has closed the last.
--
-- The temporary password is generated in the super admin's browser and reaches this
-- database only as the `p_new_password` argument, where it is hashed; nothing stores or
-- returns it in clear. The super admin's identity is D28's client assertion, like every
-- `admin_*` verb.
--
-- Organization admins are NOT routed requests yet, by the owner's choice: "in the early
-- stage, I think it is best to use the superadmin". The account's organization is read
-- at list time rather than copied into the request, so routing to org admins later is a
-- change to who may LIST, not to what a request records.

-- ── 1 · the request ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.approved_users(id) ON DELETE CASCADE,
  status       text NOT NULL
    CONSTRAINT password_reset_requests_status CHECK (status IN ('open', 'resolved', 'dismissed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  closed_by    uuid REFERENCES public.approved_users(id) ON DELETE SET NULL,
  CONSTRAINT password_reset_requests_closed_shape CHECK ((status = 'open') = (closed_at IS NULL))
);

-- One OPEN request per account: repeating the form adds nothing.
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_requests_one_open
  ON public.password_reset_requests (user_id) WHERE status = 'open';

ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policy and no table grant: which accounts asked for a reset is not
-- one PostgREST query away. The writers and the one reader are the functions below.
REVOKE ALL ON TABLE public.password_reset_requests FROM anon, authenticated;

-- ── 2 · the person asks ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_password_reset(p_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid; v_req uuid;
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' OR length(p_email) > 320 THEN RETURN; END IF;
  SELECT au.id INTO v_user FROM public.approved_users au
   WHERE lower(au.email) = lower(btrim(p_email)) AND au.is_active
   LIMIT 1;
  IF v_user IS NULL THEN RETURN; END IF;

  INSERT INTO public.password_reset_requests (user_id, status)
  VALUES (v_user, 'open')
  ON CONFLICT (user_id) WHERE status = 'open' DO NOTHING
  RETURNING id INTO v_req;

  IF v_req IS NOT NULL THEN
    BEGIN
      -- The ACTOR is unknown — whoever typed the email is not proven to be the account
      -- holder — so it is the TARGET that names the account, as `auth.sign_in_failed`.
      INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
      VALUES ('access', NULL, 'auth.password_reset_requested', 'approved_users', v_user::text,
              jsonb_build_object('request_id', v_req));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'password-reset request audit skipped: %', SQLERRM;   -- never fail the request over it
    END;
  END IF;
END; $$;
COMMENT ON FUNCTION public.request_password_reset(text) IS
  'D251 — the sign-in page''s "Forgot password?". Records one open request for an active '
  'account and returns nothing in every case, so the caller cannot tell which emails exist.';
REVOKE ALL ON FUNCTION public.request_password_reset(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_password_reset(text) TO anon, authenticated;

-- ── 3 · the super admin's list ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_password_reset_requests(p_actor_id uuid, p_actor_email text)
RETURNS TABLE (
  id uuid, user_id uuid, email text, name text, role text, is_active boolean,
  organization text, requested_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY
    SELECT r.id, r.user_id, au.email, au.name, au.role::text, au.is_active,
           o.name, r.requested_at
      FROM public.password_reset_requests r
      JOIN public.approved_users au ON au.id = r.user_id
      LEFT JOIN public.organizations o ON o.id = au.organization_id
     WHERE r.status = 'open'
     ORDER BY r.requested_at;
END; $$;
REVOKE ALL ON FUNCTION public.admin_list_password_reset_requests(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_password_reset_requests(uuid, text) TO anon, authenticated;

-- ── 4 · dismiss: the request was not genuine, or was handled elsewhere ─────
CREATE OR REPLACE FUNCTION public.admin_dismiss_password_reset_request(
  p_actor_id uuid, p_actor_email text, p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  UPDATE public.password_reset_requests
     SET status = 'dismissed', closed_at = now(), closed_by = p_actor_id
   WHERE id = p_request_id AND status = 'open'
  RETURNING user_id INTO v_user;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'request not found or already closed' USING ERRCODE = '42704';
  END IF;
  PERFORM public.log_admin_action('user.reset_request_dismissed', 'approved_users', v_user::text,
    NULL, jsonb_build_object('request_id', p_request_id));
END; $$;
REVOKE ALL ON FUNCTION public.admin_dismiss_password_reset_request(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dismiss_password_reset_request(uuid, text, uuid) TO anon, authenticated;

-- ── 5 · the reset closes the request ────────────────────────────────────────
-- Same signature, so the grants stand; restated below anyway. Two changes from
-- `20260711000003`: the person's open request is closed as `resolved` in the same
-- transaction, and the expiry is `password_max_age()` (D206's one statement of the
-- policy) instead of a second "90 days". `force_password_change` is still set, so the
-- temporary password only ever opens /profile.
CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  p_actor_id uuid, p_actor_email text, p_target_user_id uuid, p_new_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_closed uuid[];
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN RAISE EXCEPTION 'password_too_short'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.approved_users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'user not found';
  END IF;
  UPDATE public.approved_users
     SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         password_changed_at = now(),
         password_expires_at = now() + public.password_max_age(),
         force_password_change = true,
         updated_at = now()
   WHERE id = p_target_user_id;
  WITH closed AS (
    UPDATE public.password_reset_requests
       SET status = 'resolved', closed_at = now(), closed_by = p_actor_id
     WHERE user_id = p_target_user_id AND status = 'open'
    RETURNING id
  )
  SELECT array_agg(id) INTO v_closed FROM closed;
  PERFORM public.log_admin_action('user.reset_password', 'approved_users', p_target_user_id::text, NULL,
    CASE WHEN v_closed IS NULL THEN NULL
         ELSE jsonb_build_object('resolved_request_id', v_closed[1]) END);
END; $$;
REVOKE ALL ON FUNCTION public.admin_reset_user_password(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(uuid, text, uuid, text) TO anon, authenticated;
