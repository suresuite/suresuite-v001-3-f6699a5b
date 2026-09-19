-- WP 7.1 stage 2 · THE RESOLUTION ORDER, AND THE ONE CASE THE FLIP MUST NOT TAKE.
--
-- `get_current_user_id()` now prefers `auth.uid()` over the GUC. Three things have to be
-- true and none of them can be read off the source:
--
--   §1  a session that names an approved user WINS over a GUC naming somebody else —
--       otherwise the flip did not happen;
--   §2  a session that names a uuid NO approved user has is IGNORED, and the GUC still
--       answers — otherwise the flip invents an identity, which is the failure mode
--       production is actually exposed to (1 auth.users row, 14 approved users, overlap
--       ZERO — §4 D130);
--   §3  with no session at all, the answer is exactly what it was before this migration.
--
-- The harness models `auth.uid()` off `request.jwt.claims` (`rehearsal-schema.mjs`), so a
-- session can be simulated with `set_config`. That is what makes this stage rehearsable
-- at all — and it is worth saying that stage 1b is NOT, because minting a real token
-- needs GoTrue and this database has none.

DO $wp71s2$
DECLARE
  v_session uuid := gen_random_uuid();  -- an approved user who will hold the session
  v_guc     uuid := gen_random_uuid();  -- a DIFFERENT approved user named by the GUC
  v_stranger uuid := gen_random_uuid(); -- in auth.users only, like production's one row
  v_got     uuid;
  v_volatility "char";
BEGIN
  INSERT INTO public.approved_users (id, name, email, password_hash, role) VALUES
    (v_session, 'WP71 session', 'wp71-session@example.invalid', 'x', 'user'),
    (v_guc,     'WP71 guc',     'wp71-guc@example.invalid',     'x', 'user');

  -- ══ §1 · the session wins ══
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_session::text, 'role', 'authenticated')::text,
                     true);
  PERFORM set_config('app.current_user_id', v_guc::text, true);

  v_got := public.get_current_user_id();
  IF v_got IS DISTINCT FROM v_session THEN
    RAISE EXCEPTION
      'WP 7.1/310 §1: with a session for % and a GUC for %, the resolver answered % — the flip did not happen',
      v_session, v_guc, coalesce(v_got::text, 'NULL');
  END IF;
  RAISE NOTICE 'WP 7.1/310 §1: a session naming an approved user beats a GUC naming another';

  -- ══ §2 · A SESSION NAMING A STRANGER IS IGNORED ══
  --
  -- This is the assertion the EXISTS clause exists for. Production's single `auth.users`
  -- row matches no approved user, so a bare COALESCE would resolve a caller to a person
  -- who does not exist — silently, because every predicate downstream compares against
  -- `approved_users` and would simply match nothing.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text,
                     true);
  PERFORM set_config('app.current_user_id', v_guc::text, true);

  v_got := public.get_current_user_id();
  IF v_got IS DISTINCT FROM v_guc THEN
    RAISE EXCEPTION
      'WP 7.1/310 §2: a session for %, who is in NO approved_users row, resolved to % instead of falling back to the GUC (%) — the flip can invent an identity',
      v_stranger, coalesce(v_got::text, 'NULL'), v_guc;
  END IF;
  RAISE NOTICE 'WP 7.1/310 §2: a session naming a non-approved uuid is ignored; the GUC still answers';

  -- ══ §3 · no session — today's production, unchanged ══
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('app.current_user_id', v_guc::text, true);

  v_got := public.get_current_user_id();
  IF v_got IS DISTINCT FROM v_guc THEN
    RAISE EXCEPTION
      'WP 7.1/310 §3: with no session the resolver answered % instead of the GUC (%) — this migration is NOT the no-op it claims to be on production',
      coalesce(v_got::text, 'NULL'), v_guc;
  END IF;

  -- …and with neither, NULL rather than an exception. `has_project_access` and the audit
  -- preamble both branch on NULL, so an exception here would turn "nobody is acting" into
  -- a failed statement.
  PERFORM set_config('app.current_user_id', '', true);
  v_got := public.get_current_user_id();
  IF v_got IS NOT NULL THEN
    RAISE EXCEPTION 'WP 7.1/310 §3: with neither a session nor a GUC the resolver answered %, expected NULL', v_got;
  END IF;
  RAISE NOTICE 'WP 7.1/310 §3: no session — the GUC answers exactly as before, and NULL when there is neither';

  -- ══ §3b · IT IS BRANCH 2 ANSWERING, NOT BRANCH 3 WEARING ITS CLOTHES ══
  --
  -- §3 above passes even if the GUC fallback is DELETED, and that is not a hypothetical:
  -- the mutation that removed it passed the first draft of this file. The reason is that
  -- branch 3 — `get_current_approved_user()` — reads `app.current_user_id` too, and
  -- returns the same uuid by a different route, so §3 cannot tell the two apart.
  --
  -- They differ in exactly one observable way: branch 2 returns the GUC's value without
  -- checking it, while branch 3 JOINS `approved_users` and yields NULL for a uuid with no
  -- row. So a GUC naming a stranger separates them. (That asymmetry is today's behaviour
  -- and is left alone: making branch 2 verify membership would be a behaviour change
  -- outside stage 2, and stage 6 deletes the branch anyway.)
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('app.current_user_id', v_stranger::text, true);

  v_got := public.get_current_user_id();
  IF v_got IS DISTINCT FROM v_stranger THEN
    RAISE EXCEPTION
      'WP 7.1/310 §3b: a GUC naming % (no approved_users row) resolved to % — the GUC branch is gone and branch 3 is answering in its place, which changes what an unknown actor resolves to',
      v_stranger, coalesce(v_got::text, 'NULL');
  END IF;
  RAISE NOTICE 'WP 7.1/310 §3b: the GUC branch itself answers — proved by a uuid only it would return';

  -- ══ §4 · and it is STABLE, which is what pays for §1's lookup ══
  --
  -- 54 policies call this function in a predicate. While it was VOLATILE by omission,
  -- PostgreSQL called it once per ROW; adding an EXISTS to a per-row function would have
  -- been a real cost. This assertion exists because the volatility is load-bearing and
  -- invisible — a later `CREATE OR REPLACE` that omits STABLE would restore the per-row
  -- call and nothing would complain.
  SELECT provolatile INTO v_volatility
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_current_user_id' AND p.pronargs = 0;

  IF v_volatility <> 's' THEN
    RAISE EXCEPTION
      'WP 7.1/310 §4: get_current_user_id is provolatile=% (expected s/STABLE) — it is called once per ROW in 54 policy predicates and the approved_users lookup is not free',
      v_volatility;
  END IF;
  RAISE NOTICE 'WP 7.1/310 §4: the resolver is STABLE, so the predicate evaluates it once per statement';

  RAISE NOTICE 'WP 7.1 · 310: the session wins, a stranger does not, no session is unchanged, and the function is STABLE — 5 section(s)';
END $wp71s2$;
