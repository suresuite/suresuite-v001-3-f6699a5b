-- Phase 7 / WP 7.1 stage 2 / §14 — `get_current_user_id()` prefers the session
--
-- Today the resolution order is: the `app.current_user_id` GUC first, then a JWT-EMAIL
-- lookup through `get_current_approved_user()`. §14's stage 2 flips it to prefer
-- `auth.uid()`, so that the moment stage 1b issues a session every predicate in the
-- schema starts reading it without a second migration.
--
-- ── WHY THIS IS SAFE TO LAND BEFORE STAGE 1b, WHICH §14 DID NOT SAY ────────
--
-- §14 ordered stage 2 after stage 1 and justified it with "behaviour is identical while
-- the two agree, which stage 1 proved". The stronger and simpler reason is that
-- **`auth.uid()` is NULL for every caller in production today**: nothing in this
-- application ever calls `supabase.auth.signIn`, the browser presents the anon key,
-- whose JWT carries a `role` and no `sub`, and §15 run `35466925117` measured the
-- consequence — 13 policies name `auth.uid()` and are effectively dead, while 54 read
-- the GUC. So branch 1 below cannot fire, and this migration is a no-op on the live
-- system until the day a session exists. That makes it the cheapest stage in the plan
-- to take early, and taking it early means stage 1b is a login change only.
--
-- ── AND IT PREFERS THE SESSION ONLY WHEN THE SESSION NAMES SOMEBODY REAL ───
--
-- `auth.uid()` returning non-NULL does not mean it names a user of this product. This
-- application authenticates against `approved_users`, and production holds **1** row in
-- `auth.users` against **14** in `approved_users` with an overlap of **ZERO** (§4 D155).
-- So a bare `COALESCE(auth.uid(), guc)` would, for any caller who somehow held a real
-- Supabase session, return an id that is in no `approved_users` row — and every
-- predicate downstream compares against exactly that table. The result would not be an
-- error; it would be a caller silently resolving to a person who does not exist, which
-- is worse than resolving to nobody.
--
-- The `EXISTS` below closes that. A session is preferred when it names an approved user
-- and ignored otherwise, so the flip cannot invent an identity. When stage 1b signs a
-- JWT whose `sub` is the `approved_users.id`, this passes on the first try.
--
-- ── AND IT IS NOW `STABLE`, WHICH PAYS FOR THE LOOKUP ──────────────────────
--
-- The function was VOLATILE by omission, so PostgreSQL had to call it **once per row**
-- in every policy predicate that names it — 54 policies do. Adding a table lookup to a
-- per-row function would be a real cost. It is `STABLE` because it is: within one
-- statement the GUC and the JWT claims do not change, which is the definition. So the
-- planner evaluates it once per statement and the new lookup is free — the same change
-- that makes this migration honest also makes the predicate cheaper than it was.
--
-- Revert: `CREATE OR REPLACE` with the previous body (GUC first, no EXISTS, VOLATILE).

CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_claim uuid;
  v_guc   text;
  v_id    uuid;
BEGIN
  -- 1 · THE SESSION, when there is one and it names somebody this product knows.
  v_claim := auth.uid();
  IF v_claim IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.approved_users WHERE id = v_claim) THEN
    RETURN v_claim;
  END IF;

  -- 2 · The GUC. Today this is the only branch that ever fires, and it stays the
  --     fallback rather than being deleted: stage 6 removes it, after stage 1b has
  --     been live long enough to show branch 1 carrying the traffic.
  v_guc := current_setting('app.current_user_id', true);
  IF v_guc IS NOT NULL AND v_guc <> '' THEN
    RETURN v_guc::uuid;
  END IF;

  -- 3 · The legacy JWT-EMAIL lookup, untouched. It is a different mechanism from
  --     branch 1 — it matches `approved_users.email` against the token's email rather
  --     than its subject — and removing it belongs with stage 6, not here.
  SELECT user_id INTO v_id FROM public.get_current_approved_user() LIMIT 1;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.get_current_user_id() IS
  'Resolves the acting user: a Supabase session that names an approved user, else the '
  'app.current_user_id GUC, else a legacy JWT-email lookup. STABLE — the GUC and the JWT '
  'do not change within a statement, and 54 policies call this per predicate. '
  'WP 7.1 stage 2; the GUC branch goes at stage 6.';
