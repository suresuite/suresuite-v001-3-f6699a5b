-- Audit / §4 D185, D186 — the audit log can be read, says who is using the product,
-- and is tamper-evident.
--
-- ── D185 · THE PAGE READ ZERO ROWS, FOR THE REASON D169 ALREADY NAMED ───────
--
-- `/admin/audit` read `audit_logs` straight through PostgREST. The table's two SELECT
-- policies resolve the reader through `current_is_super_admin()` →
-- `get_current_user_id()`, and this application does not use Supabase Auth: the
-- browser calls as `anon`, a PostgREST request carries no session, no GUC and no email
-- claim, so the predicate is false for every row and RLS answers with ZERO ROWS rather
-- than an error. The page rendered "No audit entries yet." over a table that was being
-- written the whole time. D169 is the same defect on the ingest review screen, and its
-- fix is the precedent taken here: the reader arrives as a PARAMETER, is authorized in
-- the function, and is refused rather than emptied. The table's own policies are left
-- exactly as they are.
--
-- The page also filtered to `plane = 'admin'`, so even a working read would have shown
-- only what super admins did — never what anybody did with their data. The read below
-- takes a window and an optional plane, and returns a per-person and per-action summary
-- over the WHOLE window, so "how is the product being used" is answered by the server
-- rather than by counting the first page of rows in the browser.
--
-- And a person's use of the product began nowhere on the record: nothing wrote a row
-- when somebody signed in. `authenticate_approved_user` now writes `auth.sign_in` (and,
-- for a registered address, `auth.sign_in_failed`) on the ACCESS plane. It writes it
-- AFTER the password has been checked by the database, so a sign-in row cannot be
-- forged by a client that does not hold the password — unlike a client-side "I signed
-- in" call would have been. Both are throttled to one row per person per minute,
-- because this log is append-only (below) and an unauthenticated caller must not be
-- able to grow it without bound. A logging failure never fails a login.
--
-- ── D186 · A DELETED OR EDITED AUDIT ROW LEFT NO TRACE ─────────────────────
--
-- The sidecar said it plainly: "nothing records reads of it, and a deletion would leave
-- no trace". Two layers close the deletion half.
--
--   1. WRITE-ONCE. `audit_logs_guard` refuses DELETE and TRUNCATE outright, and refuses
--      every UPDATE except the one the sealer makes (seq/prev_hash/row_hash going from
--      NULL to a value, every other column unchanged). An INSERT cannot pre-seal a row
--      or back-date it: the guard clears the chain columns and stamps `created_at`.
--
--   2. A HASH CHAIN. Every row is SEALED with `seq`, `prev_hash` and
--      `row_hash = sha256(prev_hash, seq, every content column)`. Editing a sealed row
--      breaks its own hash; deleting one breaks the next row's link and leaves a gap in
--      `seq`. `admin_audit_log_verify` walks the chain and names the first break.
--
-- WHAT THIS IS NOT, stated because over-claiming is the sin §5 forbids. A database
-- owner can disable triggers, and could then rewrite the chain from some row onward
-- consistently, or cut rows off its END. Neither is detectable from inside the database
-- alone. What detects them is the chain HEAD (seq + hash) recorded somewhere the
-- database owner does not control — the page shows it for exactly that reason. Until
-- somebody anchors it externally, this is tamper-EVIDENT against everybody who cannot
-- disable triggers, and against an owner who edits or deletes in the middle.
--
-- ── WHY SEALING IS NOT DONE IN THE WRITER'S BEFORE-INSERT ─────────────────
--
-- The obvious shape — compute the hash as each row is inserted — needs the previous
-- row's hash, so every audited write in the product would queue on one lock held until
-- its transaction commits. `audit_tier_write` fires on every tier 2/3/4 statement, so a
-- long ETL would stall every other user's writes, and a writer that also holds a row
-- lock another writer wants can deadlock. So rows are inserted UNSEALED and sealed in
-- order by `audit_log_seal()`, which runs after every audit insert under a
-- TRY-lock: if another transaction is sealing, this one skips and the next seal picks
-- its rows up. Nothing ever waits. The read and the verify seal too, so a quiet period
-- leaves nothing unsealed for long; unsealed rows are still covered by layer 1.
--
-- ── THE ACTOR KEY IS DROPPED, AND THAT IS WP 7.2's QUESTION ANSWERED FOR ONE TABLE
--
-- `audit_logs.actor_user_id` was `REFERENCES approved_users ON DELETE SET NULL`. With
-- the guard in place that cascade is an UPDATE of a sealed row, so deleting any person
-- who ever acted would fail — D161's shape exactly. The key is dropped instead: the row
-- keeps the uuid of whoever acted, the person's NAME and EMAIL leave with their
-- `approved_users` row, and the page shows "deleted user". A log that could be edited by
-- deleting the person it names would not be a log (`AuditLog.tsx` already promises this
-- about projects). WP 7.2 still owns erasure for every other actor column.
-- PostgreSQL names an inline key `<table>_<column>_fkey` at creation, so production's
-- is `admin_audit_logs_…` and a rehearsed base's is `audit_logs_…` (§4 D160) — both are
-- named below.
--
-- Revert: drop the three new functions and the four triggers, restore the key, and
-- `CREATE OR REPLACE` `authenticate_approved_user` and `audit_tier_write` with their
-- previous bodies. The chain columns can stay; nothing else reads them.

-- ── 1 · the actor key ────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS admin_audit_logs_actor_user_id_fkey;
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_fkey;

-- ── 2 · the chain columns ────────────────────────────────────────────────────
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS seq       bigint;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS row_hash  text;

-- A fork (two rows claiming one position) must be an error, not a second chain.
CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_seq_key ON public.audit_logs (seq);
-- What the sealer scans for; small, because a row leaves it the moment it is sealed.
CREATE INDEX IF NOT EXISTS audit_logs_unsealed_idx ON public.audit_logs (created_at, id)
  WHERE seq IS NULL;

-- ── 3 · the digest ───────────────────────────────────────────────────────────
-- A JSON array is the canonical encoding: every field is delimited and escaped, and
-- jsonb's text form is deterministic (keys sorted, one spacing). `created_at` is
-- rendered in UTC to the microsecond so the session's TimeZone cannot change a hash.
CREATE OR REPLACE FUNCTION public.audit_log_digest(r public.audit_logs)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    r.prev_hash, r.seq, r.id, r.plane, r.actor_user_id, r.action,
    r.target_type, r.target_id, r.before, r.after, r.ip::text, r.user_agent,
    to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text, 'UTF8')), 'hex');
$$;
COMMENT ON FUNCTION public.audit_log_digest(public.audit_logs) IS
  'D186 — sha256 over the previous row''s hash, the row''s position and every content '
  'column of one audit_logs row. What audit_log_seal writes and admin_audit_log_verify '
  're-computes.';

-- ── 4 · write-once ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.audit_logs_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: TRUNCATE refused. The audit log is never emptied.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A row arrives unsealed and stamped by the server, whatever the writer sent.
    NEW.seq := NULL;
    NEW.prev_hash := NULL;
    NEW.row_hash := NULL;
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND current_setting('app.audit_sealing', true) = 'on'
     AND OLD.seq IS NULL AND NEW.seq IS NOT NULL
     AND (to_jsonb(NEW) - 'seq' - 'prev_hash' - 'row_hash')
         = (to_jsonb(OLD) - 'seq' - 'prev_hash' - 'row_hash') THEN
    RETURN NEW;   -- the sealer, and only the sealer
  END IF;

  RAISE EXCEPTION
    'audit_logs is append-only: % refused (row %). The audit log is never edited or deleted.',
    TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END; $$;

DROP TRIGGER IF EXISTS audit_logs_guard_insert ON public.audit_logs;
CREATE TRIGGER audit_logs_guard_insert BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_guard();
DROP TRIGGER IF EXISTS audit_logs_guard_change ON public.audit_logs;
CREATE TRIGGER audit_logs_guard_change BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_guard();
DROP TRIGGER IF EXISTS audit_logs_guard_truncate ON public.audit_logs;
CREATE TRIGGER audit_logs_guard_truncate BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_logs_guard();

-- ── 5 · the sealer ───────────────────────────────────────────────────────────
-- One sealer at a time, by a transaction-scoped advisory lock. `_wait = false` (every
-- automatic call) skips when another transaction holds it, so no writer ever queues.
-- Only under READ COMMITTED: a REPEATABLE READ snapshot could predate a seal that has
-- since committed, read a stale head, and collide on `audit_logs_seq_key` — which
-- would fail the WRITER's transaction for the sake of a hash.
CREATE OR REPLACE FUNCTION public.audit_log_seal(_wait boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seq  bigint;
  v_hash text;
  r      public.audit_logs;
  n      integer := 0;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RETURN 0;
  END IF;
  IF _wait THEN
    PERFORM pg_advisory_xact_lock(hashtext('public.audit_logs.chain'));
  ELSIF NOT pg_try_advisory_xact_lock(hashtext('public.audit_logs.chain')) THEN
    RETURN 0;
  END IF;

  SELECT l.seq, l.row_hash INTO v_seq, v_hash
    FROM public.audit_logs l WHERE l.seq IS NOT NULL ORDER BY l.seq DESC LIMIT 1;
  v_seq  := COALESCE(v_seq, 0);
  v_hash := COALESCE(v_hash, repeat('0', 64));

  PERFORM set_config('app.audit_sealing', 'on', true);
  FOR r IN
    SELECT * FROM public.audit_logs l WHERE l.seq IS NULL
     ORDER BY l.created_at, l.id
       FOR UPDATE
  LOOP
    v_seq := v_seq + 1;
    r.seq := v_seq;
    r.prev_hash := v_hash;
    v_hash := public.audit_log_digest(r);
    UPDATE public.audit_logs
       SET seq = r.seq, prev_hash = r.prev_hash, row_hash = v_hash
     WHERE id = r.id;
    n := n + 1;
  END LOOP;
  PERFORM set_config('app.audit_sealing', '', true);
  RETURN n;
END; $$;
COMMENT ON FUNCTION public.audit_log_seal(boolean) IS
  'D186 — chains every committed, unsealed audit_logs row onto the head. Runs '
  'after every audit insert under a try-lock (skips rather than waits), and from the '
  'read and the verify. Returns how many rows it sealed.';
REVOKE ALL ON FUNCTION public.audit_log_seal(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_log_seal(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.audit_logs_seal_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.audit_log_seal(false);
  EXCEPTION WHEN OTHERS THEN
    -- Sealing is never a reason to fail the write being audited. The row stays
    -- unsealed, still write-once, and the next seal chains it.
    RAISE WARNING 'audit_log_seal skipped: %', SQLERRM;
  END;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS audit_logs_seal ON public.audit_logs;
CREATE TRIGGER audit_logs_seal AFTER INSERT ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_logs_seal_after_insert();

-- Chain everything that already exists, oldest first.
SELECT public.audit_log_seal(true);

-- ── 6 · the data plane names its projects ────────────────────────────────────
-- Unchanged except for `projects`: the distinct `project_id`s the statement touched
-- (at most 20), so the log can say WHERE somebody was working. Read generically
-- through to_jsonb because not every audited table has the column.
CREATE OR REPLACE FUNCTION public.audit_tier_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n_new integer := 0;
  n_old integer := 0;
  actor uuid;
  v_projects jsonb := '[]'::jsonb;
BEGIN
  actor := public.get_current_user_id();

  IF TG_OP IN ('INSERT','UPDATE') THEN SELECT count(*) INTO n_new FROM new_rows; END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN SELECT count(*) INTO n_old FROM old_rows; END IF;

  -- A statement that touched nothing is not a tier transition.
  IF GREATEST(n_new, n_old) = 0 THEN RETURN NULL; END IF;

  IF TG_OP IN ('INSERT','UPDATE') THEN
    SELECT COALESCE(jsonb_agg(p), '[]'::jsonb) INTO v_projects
      FROM (SELECT DISTINCT to_jsonb(x) ->> 'project_id' AS p FROM new_rows x
             WHERE to_jsonb(x) ->> 'project_id' <> '' LIMIT 20) s;
  ELSE
    SELECT COALESCE(jsonb_agg(p), '[]'::jsonb) INTO v_projects
      FROM (SELECT DISTINCT to_jsonb(x) ->> 'project_id' AS p FROM old_rows x
             WHERE to_jsonb(x) ->> 'project_id' <> '' LIMIT 20) s;
  END IF;

  INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
  VALUES ('data', actor, lower(TG_OP), TG_TABLE_NAME, NULL,
          jsonb_build_object(
            'tier', TG_ARGV[0],
            'rows_after',  n_new,
            'rows_before', n_old,
            'projects',    v_projects,
            -- said in the row rather than inferred from a NULL actor later
            'actor_known', actor IS NOT NULL));
  RETURN NULL;
END; $$;
COMMENT ON FUNCTION public.audit_tier_write() IS
  'Statement-level audit for every tier 2/3/4 write. One row per STATEMENT with a '
  'row count and the projects it touched, not one per row: a bulk upload would '
  'otherwise write tens of thousands of audit rows and an audit log nobody can read '
  'is no audit log.';

-- ── 7 · sign-ins ─────────────────────────────────────────────────────────────
-- The body is the previous one (`20250820152955`) with the record added around it.
-- Same signature, same rows returned, same refusal (an empty result) — the client and
-- `session-mint` see no difference.
CREATE OR REPLACE FUNCTION public.authenticate_approved_user(user_email text, user_password text)
RETURNS TABLE(user_id uuid, user_name text, user_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id   uuid;
  v_name text;
  v_role text;
  v_known uuid;
BEGIN
  SELECT au.id, au.name, au.role::text INTO v_id, v_name, v_role
    FROM public.approved_users au
   WHERE lower(au.email) = lower(user_email)
     AND au.password_hash = extensions.crypt(user_password, au.password_hash)
   LIMIT 1;

  BEGIN
    IF v_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                      WHERE plane = 'access' AND action = 'auth.sign_in'
                        AND actor_user_id = v_id
                        AND created_at > now() - interval '1 minute') THEN
        INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
        VALUES ('access', v_id, 'auth.sign_in', 'approved_users', v_id::text,
                jsonb_build_object('outcome', 'allowed'));
      END IF;
    ELSE
      -- Recorded only for an address that is registered: an unknown address has no
      -- person to attribute it to, and recording it would let anyone write rows.
      SELECT au.id INTO v_known FROM public.approved_users au
       WHERE lower(au.email) = lower(user_email) LIMIT 1;
      IF v_known IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.audit_logs
                          WHERE plane = 'access' AND action = 'auth.sign_in_failed'
                            AND target_id = v_known::text
                            AND created_at > now() - interval '1 minute') THEN
        -- The ACTOR is unknown — whoever typed the wrong password is not proven to be
        -- the account holder — so it is the TARGET that names the account.
        INSERT INTO public.audit_logs (plane, actor_user_id, action, target_type, target_id, after)
        VALUES ('access', NULL, 'auth.sign_in_failed', 'approved_users', v_known::text,
                jsonb_build_object('outcome', 'refused', 'reason', 'wrong password'));
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sign-in audit skipped: %', SQLERRM;   -- never fail a login over it
  END;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, v_name, v_role;
  END IF;
END;
$$;

-- ── 8 · the read ─────────────────────────────────────────────────────────────
-- The reader is a PARAMETER, authorized as a super admin exactly as every other
-- /admin RPC is (`_assert_super_admin`, which is D28's client assertion and says so).
-- Returns one jsonb object: the newest `p_limit` rows in the window, and a summary over
-- the WHOLE window — per person and per action — so the counts are never those of a
-- truncated page.
CREATE OR REPLACE FUNCTION public.admin_audit_log_read(
  p_actor_id    uuid,
  p_actor_email text,
  p_since       timestamptz,
  p_plane       text    DEFAULT NULL,
  p_limit       integer DEFAULT 1000
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000);
  v_out   jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_since IS NULL THEN
    RAISE EXCEPTION 'admin_audit_log_read: a window must name its start' USING ERRCODE = '22023';
  END IF;
  IF p_plane IS NOT NULL AND p_plane NOT IN ('admin','data','access') THEN
    RAISE EXCEPTION 'admin_audit_log_read: unknown plane %', p_plane USING ERRCODE = '22023';
  END IF;

  PERFORM public.audit_log_seal(false);

  WITH w AS (
    SELECT l.* FROM public.audit_logs l
     WHERE l.created_at >= p_since
       AND (p_plane IS NULL OR l.plane = p_plane)
  ),
  people AS (
    SELECT u.id, u.name, u.email, COALESCE(o.name, u.organization) AS org
      FROM public.approved_users u
      LEFT JOIN public.organizations o ON o.id = u.organization_id
     WHERE u.id IN (SELECT w.actor_user_id FROM w
                    UNION SELECT (w.target_id)::uuid FROM w
                     WHERE w.action LIKE 'auth.%' AND w.target_id ~ '^[0-9a-f-]{36}$')
  ),
  newest AS (
    SELECT w.* FROM w ORDER BY w.created_at DESC, w.seq DESC NULLS FIRST LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'since',    p_since,
    'plane',    p_plane,
    'total',    (SELECT count(*) FROM w),
    'returned', (SELECT count(*) FROM newest),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', n.id, 'seq', n.seq, 'plane', n.plane,
               'actor_user_id', n.actor_user_id,
               'actor_name',  COALESCE(p.name, p.email),
               'actor_email', p.email,
               'actor_deleted', n.actor_user_id IS NOT NULL AND p.id IS NULL,
               'action', n.action, 'target_type', n.target_type, 'target_id', n.target_id,
               'target_name', CASE WHEN n.target_type = 'approved_users' THEN
                                (SELECT COALESCE(u.name, u.email) FROM public.approved_users u
                                  WHERE u.id::text = n.target_id) END,
               'before', n.before, 'after', n.after, 'created_at', n.created_at,
               'sealed', n.seq IS NOT NULL,
               'projects', (SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name))
                              FROM public.projects pr
                             WHERE pr.id::text IN (SELECT jsonb_array_elements_text(
                                     CASE WHEN jsonb_typeof(n.after -> 'projects') = 'array'
                                          THEN n.after -> 'projects' ELSE '[]'::jsonb END))))
             ORDER BY n.created_at DESC, n.seq DESC NULLS FIRST)
        FROM newest n LEFT JOIN people p ON p.id = n.actor_user_id), '[]'::jsonb),
    'by_actor', COALESCE((
      SELECT jsonb_agg(a ORDER BY (a ->> 'total')::int DESC) FROM (
        SELECT jsonb_build_object(
                 'actor_user_id', w.actor_user_id,
                 'actor_name',  COALESCE(p.name, p.email),
                 'actor_email', p.email,
                 'actor_org',   p.org,
                 'actor_deleted', w.actor_user_id IS NOT NULL AND p.id IS NULL,
                 'total',     count(*),
                 'sign_ins',  count(*) FILTER (WHERE w.action = 'auth.sign_in'),
                 'data_writes', count(*) FILTER (WHERE w.plane = 'data'),
                 'rows_written', COALESCE(sum(GREATEST((w.after ->> 'rows_after')::bigint,
                                                       (w.after ->> 'rows_before')::bigint))
                                          FILTER (WHERE w.plane = 'data'), 0),
                 'admin_actions', count(*) FILTER (WHERE w.plane = 'admin'),
                 'exports',   count(*) FILTER (WHERE w.action LIKE 'export.%'),
                 'first_at',  min(w.created_at),
                 'last_at',   max(w.created_at)) AS a
          FROM w LEFT JOIN people p ON p.id = w.actor_user_id
         GROUP BY w.actor_user_id, p.id, p.name, p.email, p.org) s), '[]'::jsonb),
    'by_action', COALESCE((
      SELECT jsonb_agg(a ORDER BY (a ->> 'n')::int DESC) FROM (
        SELECT jsonb_build_object(
                 'plane', w.plane, 'action', w.action, 'target_type', w.target_type,
                 'n', count(*), 'people', count(DISTINCT w.actor_user_id),
                 'last_at', max(w.created_at)) AS a
          FROM w GROUP BY w.plane, w.action, w.target_type
         ORDER BY count(*) DESC LIMIT 50) s), '[]'::jsonb),
    'failed_sign_ins', COALESCE((
      SELECT jsonb_agg(a ORDER BY (a ->> 'n')::int DESC) FROM (
        SELECT jsonb_build_object(
                 'account_id', w.target_id,
                 'account', COALESCE(p.name, p.email, 'deleted user'),
                 'n', count(*), 'last_at', max(w.created_at)) AS a
          FROM w LEFT JOIN people p ON p.id::text = w.target_id
         WHERE w.action = 'auth.sign_in_failed'
         GROUP BY w.target_id, p.name, p.email) s), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END; $$;
COMMENT ON FUNCTION public.admin_audit_log_read(uuid, text, timestamptz, text, integer) IS
  'D185 — /admin/audit''s read. The reader is a parameter and must be a super admin, '
  'because the browser calls as anon and audit_logs'' RLS returns it nothing. Returns '
  'the newest rows in [p_since, now] (optionally one plane) and a per-person and '
  'per-action summary over the whole window.';
REVOKE ALL ON FUNCTION public.admin_audit_log_read(uuid, text, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_audit_log_read(uuid, text, timestamptz, text, integer)
  TO anon, authenticated, service_role;

-- ── 9 · the verify ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_audit_log_verify(p_actor_id uuid, p_actor_email text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        public.audit_logs;
  v_seq    bigint := 0;
  v_hash   text   := repeat('0', 64);
  v_n      bigint := 0;
  v_break  jsonb;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  PERFORM public.audit_log_seal(false);

  FOR r IN SELECT * FROM public.audit_logs l WHERE l.seq IS NOT NULL ORDER BY l.seq LOOP
    IF r.seq <> v_seq + 1 THEN
      v_break := jsonb_build_object('seq', v_seq + 1, 'id', NULL,
        'reason', format('rows %s to %s are missing — deleted after they were sealed',
                         v_seq + 1, r.seq - 1));
      EXIT;
    END IF;
    IF r.prev_hash IS DISTINCT FROM v_hash THEN
      v_break := jsonb_build_object('seq', r.seq, 'id', r.id,
        'reason', 'this row does not follow the one before it — a row was removed or replaced');
      EXIT;
    END IF;
    IF r.row_hash IS DISTINCT FROM public.audit_log_digest(r) THEN
      v_break := jsonb_build_object('seq', r.seq, 'id', r.id,
        'reason', 'this row''s content no longer matches its seal — it was edited');
      EXIT;
    END IF;
    v_seq := r.seq;
    v_hash := r.row_hash;
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',          v_break IS NULL,
    'checked',     v_n,
    'head_seq',    CASE WHEN v_break IS NULL THEN v_seq END,
    'head_hash',   CASE WHEN v_break IS NULL THEN v_hash END,
    'unsealed',    (SELECT count(*) FROM public.audit_logs WHERE seq IS NULL),
    'first_break', v_break,
    'verified_at', now());
END; $$;
COMMENT ON FUNCTION public.admin_audit_log_verify(uuid, text) IS
  'D186 — walks the audit_logs hash chain and names the first gap, broken link or edited '
  'row. Super admin only (the reader is a parameter, as for every /admin RPC). Returns the '
  'chain head, which is what must be recorded OUTSIDE the database to detect a rewrite '
  'or a truncated tail.';
REVOKE ALL ON FUNCTION public.admin_audit_log_verify(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_audit_log_verify(uuid, text) TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
