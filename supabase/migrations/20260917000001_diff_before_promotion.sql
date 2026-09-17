-- Phase 3 / WP 3.4 / §10 — THE DIFF IS COMPUTED BEFORE THE PROMOTION.
--
-- §10's line for this package reads "compute `diff_state`", and the design point
-- it hides is WHEN. A `diff_state` written by `ingest_apply_run` is written AFTER
-- the decision it exists to inform: the review screen shows the diff so a person
-- can decide whether to promote, and a diff that only exists once the rows have
-- already landed in tier 2 answers a question nobody is still asking. So the diff
-- is computed against the CURRENT tier-2 rows at landing, recomputable on demand
-- at review time, and RE-COMPUTED at apply — because tier 2 can change between
-- the review and the click, and a promotion that reported the older answer would
-- be reporting a number it knows to be stale.
--
-- ── WHAT WAS WRONG, MEASURED RATHER THAN ASSERTED (§4 D62, D63, D64, D65) ────
--
--   · `ingest_staged_rows.diff_state` is `NOT NULL DEFAULT 'new'` and WP 3.3
--     NEVER WRITES IT. Grep `20260916000019`: the column appears zero times. So
--     every CSV row ever staged claims `new`, including the rows the upsert
--     UPDATED. A review screen reading that column today renders "340 new" for
--     340 unchanged rows — confidently, with a number, from a column that was
--     never computed. A DEFAULT that is present and wrong is worse than a NULL:
--     a NULL is a question, and this was an answer. (D62)
--
--   · `ingest_apply_run` sets `rows_new = v_total`, where `v_total` is inserts
--     AND updates, and never sets `rows_changed` or `rows_unchanged` at all. The
--     function RETURNS the split and does not PERSIST it, so the three columns
--     the review screen reads hold one number that is the sum of two and two
--     zeroes that are not measurements. (D63)
--
--   · `rows_removed` is set to the count of rows HELD BACK by an error finding.
--     Its own sidecar says it means `diff_state = removed_upstream` — rows the
--     source dropped. Two unrelated facts in one column, and the one that is
--     there is not the one the column is documented to hold. (D64)
--
--   · `ingest_apply_run` checks `has_project_access` only, which is
--     "modeler OR platform admin" — it never reads a project ROLE. §10's exit
--     check is "promotion by an analyst is REFUSED", and today an analyst with
--     access promotes. (D65)
--
-- ── AND ONE THING THE ROLE GATE COULD NOT LAND ON TOP OF (§4 D61) ────────────
--
-- `effective_project_role` reads `project_members`, and the ONLY writer that
-- table has ever had is WP 2.2's one-time backfill inside `20260915000005`.
-- Nothing inserts a member when a project is created. So every project created
-- after that migration has NO members, its own creator resolves to a NULL role,
-- and a role gate landed as-is would refuse the promotion of every file in every
-- new project — an outage, not a gate. Section 1 closes that first, with the
-- backfill's own rule, because the exit check is unlandable until it holds.

-- ── 1 · a project's modeler is a member of it, always, not once ─────────────
--
-- `20260915000005`:122 states the rule — "every project's modeler becomes its
-- owner. `modeler_id` has been the de-facto owner since the schema began" — and
-- then applies it exactly once, to the rows that existed that day. The rule is
-- right; what it lacked is a writer that keeps running. This is that writer, and
-- the backfill below is the same statement re-run for the projects created in
-- between (idempotent: `ON CONFLICT DO NOTHING` never demotes an existing row,
-- which matters because a member may since have been given a SMALLER role on
-- purpose and a re-backfill must not undo that).

CREATE OR REPLACE FUNCTION public.project_owner_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- The FK to `approved_users` is real, so a project whose `modeler_id` names no
  -- approved user must not be forced into one — §15 found exactly one such
  -- project and it is a data problem (D29's project), not a reason to fail every
  -- project creation.
  IF NEW.modeler_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.approved_users au WHERE au.id = NEW.modeler_id) THEN
    INSERT INTO public.project_members (project_id, user_id, project_role, rationale)
    VALUES (NEW.id, NEW.modeler_id, 'owner',
            'the project''s modeler, by projects_owner_membership (WP 3.4)')
    ON CONFLICT (project_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $fn$;

COMMENT ON FUNCTION public.project_owner_membership() IS
  'Phase 3 / WP 3.4 (§4 D61) — makes a new project''s modeler an owner in '
  'project_members. WP 2.2 backfilled that rule once and left no writer, so '
  'every project created since has had no members and its creator no role. '
  'AFTER INSERT rather than BEFORE: the membership row has a foreign key to '
  'projects.id and the project must exist first.';

DROP TRIGGER IF EXISTS projects_owner_membership ON public.projects;
CREATE TRIGGER projects_owner_membership
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.project_owner_membership();

INSERT INTO public.project_members (project_id, user_id, project_role, rationale)
SELECT p.id, p.modeler_id, 'owner',
       'backfilled from projects.modeler_id by WP 3.4 — the projects WP 2.2''s one-time backfill could not see'
  FROM public.projects p
 WHERE p.modeler_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.approved_users au WHERE au.id = p.modeler_id)
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ── 2 · `diff_state` stops claiming to know ─────────────────────────────────
--
-- The DEFAULT goes and the NOT NULL goes with it. They have to go together: a
-- NOT NULL column with no default cannot be inserted by `ingest_land_file`, and
-- a NOT NULL column with a default is the defect. What replaces them is the rule
-- the provenance columns already follow one tier down (`20260916000019`): a NULL
-- means "not computed", never "nothing to compute", and the screen must say
-- which. The CHECK is untouched, so the vocabulary is still the four states the
-- three connector staging tables use — `ingestion-contract` (I7) says one
-- component serves both sources, and a fifth token here would have been the
-- branch §10's gap check forbids.
--
-- The three CONNECTOR staging tables keep their NOT NULL DEFAULT 'new'. That is
-- not an inconsistency: `erp-sync-orbit-mrp` computes and writes `diff_state` on
-- every row it stages, so the default is never the value that survives. This
-- column's default was load-bearing precisely because nothing wrote it.

ALTER TABLE public.ingest_staged_rows
  ALTER COLUMN diff_state DROP DEFAULT,
  ALTER COLUMN diff_state DROP NOT NULL;

COMMENT ON COLUMN public.ingest_staged_rows.diff_state IS
  'What this row is relative to the CURRENT tier-2 table, computed at landing '
  'by ingest_diff_run and recomputed at promotion. NULL means the diff has not '
  'been computed for this row — a row held back by an error finding has no '
  'resolvable key to compare, and rows staged before WP 3.4 were never compared '
  'at all. NULL is unknown, never "new": until WP 3.4 this column was NOT NULL '
  'DEFAULT ''new'' and nothing ever wrote it (PLAN.md §4 D62).';

-- Rows staged before this migration claim `new` and were never compared. The
-- claim is withdrawn rather than left standing — production holds none of them
-- today (§15: `staged_rows 0`), and a statement that is a no-op in production is
-- still the statement that makes the column honest on any database that has any.
UPDATE public.ingest_staged_rows SET diff_state = NULL WHERE diff_state IS NOT NULL;

-- ── 3 · the run carries every count the review screen reads ────────────────
--
-- `rows_new`, `rows_changed`, `rows_unchanged` and `rows_removed` already exist
-- and already mean what their sidecar says. Two facts had nowhere to go and were
-- therefore squatting in `rows_removed` or returned and discarded, which is why
-- they are columns now rather than a jsonb blob: the review screen reads them,
-- `contract:check` describes them, and a count in a blob is a count no gate can
-- see.

ALTER TABLE public.ingest_runs
  ADD COLUMN IF NOT EXISTS rows_held       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rows_superseded integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ingest_runs.rows_held IS
  'Staged rows carrying an `error` finding, which are never promoted. Until '
  'WP 3.4 this number was written into `rows_removed`, whose documented meaning '
  'is the unrelated `removed_upstream` (PLAN.md §4 D64).';
COMMENT ON COLUMN public.ingest_runs.rows_superseded IS
  'Staged rows a LATER line of the same file superseded on the natural key. '
  'Promotion collapses them (DISTINCT ON) and each carries a '
  '`superseded_by_later_line` finding naming the line that beat it — the one '
  'case where the uploader''s own file disagreed with itself.';

-- ── 4 · the promotion plan, authored ONCE and read by both sides ───────────
--
-- The diff and the promotion have to agree on three things or they are two
-- different opinions wearing one vocabulary: which columns a promotion writes,
-- what value each one gets (normalized, cast to the column's own type), and
-- which columns the upsert matches on. WP 3.3 built all three INSIDE
-- `ingest_apply_run`'s loop. Computing the diff meant either restating them —
-- a fourth copy, and `ingestSpecParity.test.ts` already pins three — or lifting
-- them out. They are lifted out. `ingest_apply_run` below is the same statement
-- it was, reading its fragments from here instead of building them inline.
--
-- IT RETURNS THE EXPRESSIONS AS AN ARRAY AS WELL AS A JOINED STRING, because the
-- two callers need different shapes of the same fact: the promotion needs
-- `a, b, c` for a VALUES list, the diff needs them one at a time to build
-- `tgt.a IS NOT DISTINCT FROM <expr for a>`. Both orderings are `ORDER BY
-- attname` so `write_names[i]` and `write_exprs[i]` are the same column.

CREATE OR REPLACE FUNCTION public.ingest_promotion_plan(
  _run_id uuid,
  _target text,
  OUT natural_key text[],   -- the arbiter, read from pg_index by the catalog
  OUT file_key    text,     -- the arbiter columns the FILE supplies, as expressions
  OUT server_cols text,     -- 'plant_name, project_id' — whichever the target has
  OUT server_vals text,     -- '$2, $1', aligned with server_cols
  OUT write_cols  text,     -- quoted column list the statement writes
  OUT write_vals  text,     -- the value expression for each, in the same order
  OUT write_names text[],   -- the same columns, unquoted
  OUT write_exprs text[])   -- the same expressions, aligned with write_names
LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
DECLARE
  v_seen  integer;
  v_known integer;
BEGIN
  natural_key := public.ingest_target_natural_key(_target);

  -- Which server-set columns this target HAS. The item masters have no
  -- `plant_name` (D55), so the list cannot be hard-coded without a second code
  -- path for them — and a second path is what §10 forbids.
  SELECT string_agg(quote_ident(c), ', ' ORDER BY c),
         string_agg(CASE c WHEN 'project_id' THEN '$1' ELSE '$2' END, ', ' ORDER BY c)
    INTO server_cols, server_vals
    FROM unnest(ARRAY['project_id','plant_name']) AS c
   WHERE EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = format('public.%I', _target)::regclass
                    AND a.attname = c AND a.attnum > 0 AND NOT a.attisdropped);

  -- WHICH COLUMNS THE STATEMENT WRITES, and it is not simply "the keys the file
  -- carried". Three sources, unioned:
  --
  --   · the parsed keys that are real columns of the target;
  --   · plus the UNIT COLUMN of any normalized column present, even when the
  --     file omitted it. A file with no `time_unit` still produces a weekly
  --     volume (an absent unit means weekly — `20260915000001`'s own default),
  --     and a row holding a weekly number under a NULL unit is a number whose
  --     source a reader has to know rather than read. §5 T1 says there is no
  --     such option, so the canonical token is written either way.
  --
  -- `format_type` gives a cast the column will accept, so nothing guesses a type
  -- from a name.
  WITH parsed_keys AS (
    SELECT DISTINCT k AS key
      FROM public.ingest_staged_rows s, jsonb_object_keys(s.parsed) k
     WHERE s.ingest_run_id = _run_id
       AND s.target_table = _target
       AND NOT (s.findings @> '[{"level": "error"}]'::jsonb)
  ),
  checked AS (
    SELECT pk.key, a.attname
      FROM parsed_keys pk
      LEFT JOIN pg_attribute a
             ON a.attrelid = format('public.%I', _target)::regclass
            AND a.attname  = pk.key
            AND a.attnum   > 0
            AND NOT a.attisdropped
  ),
  unit_cols AS (
    SELECT DISTINCT n.unit_column AS attname
      FROM public.ingest_normalize_at_promotion(_target) n
     WHERE n.column_name IN (SELECT attname FROM checked WHERE attname IS NOT NULL)
  ),
  writing AS (
    SELECT attname FROM checked WHERE attname IS NOT NULL
    UNION
    SELECT attname FROM unit_cols
  ),
  resolved AS (
    SELECT w.attname,
           -- THE VALUE EXPRESSION IS WHERE NORMALIZATION HAPPENS (I3). A column
           -- the contract calls a rate or a duration over another column's unit
           -- is converted HERE, by the one unit table's own functions; the unit
           -- column itself becomes the canonical token, so the tier-2 row STATES
           -- that it is weekly.
           CASE
             WHEN uc.canonical IS NOT NULL THEN
               format('%L::%s', uc.canonical, format_type(a.atttypid, a.atttypmod))
             WHEN nc.conversion = 'rate' THEN
               format('public.rate_to_weekly((s.parsed ->> %L)::numeric, s.parsed ->> %L)::%s',
                      w.attname, nc.unit_column, format_type(a.atttypid, a.atttypmod))
             WHEN nc.conversion = 'duration' THEN
               format('public.duration_to_weeks((s.parsed ->> %L)::numeric, s.parsed ->> %L)::%s',
                      w.attname, nc.unit_column, format_type(a.atttypid, a.atttypmod))
             ELSE
               format('(s.parsed ->> %L)::%s', w.attname, format_type(a.atttypid, a.atttypmod))
           END AS expr
      FROM writing w
      JOIN pg_attribute a
        ON a.attrelid = format('public.%I', _target)::regclass
       AND a.attname  = w.attname
      LEFT JOIN LATERAL (SELECT n.canonical FROM public.ingest_normalize_at_promotion(_target) n
                          WHERE n.unit_column = w.attname LIMIT 1) uc ON true
      LEFT JOIN LATERAL (SELECT n.conversion, n.unit_column FROM public.ingest_normalize_at_promotion(_target) n
                          WHERE n.column_name = w.attname LIMIT 1) nc ON true
  )
  SELECT (SELECT count(*)::int        FROM checked),
         (SELECT count(attname)::int  FROM checked),
         string_agg(quote_ident(attname), ', ' ORDER BY attname),
         string_agg(expr, ', ' ORDER BY attname),
         array_agg(attname ORDER BY attname),
         array_agg(expr    ORDER BY attname)
    INTO v_seen, v_known, write_cols, write_vals, write_names, write_exprs
    FROM resolved;

  IF v_seen IS NOT NULL AND v_known <> v_seen THEN
    RAISE EXCEPTION 'ingest_promotion_plan: staged rows for % name % column(s) that table does not have',
      _target, v_seen - v_known USING ERRCODE = 'undefined_column';
  END IF;

  -- The arbiter's own columns, as they appear in the file. `project_id` and
  -- `plant_name` are constant within a run, so `DISTINCT ON` partitions on the
  -- rest — the part the uploader controls. NULL when the arbiter is entirely
  -- server-set, which no promotable target is today and which the callers still
  -- handle rather than assume away.
  SELECT string_agg(format('s.parsed ->> %L', c), ', ' ORDER BY c)
    INTO file_key
    FROM unnest(natural_key) AS c
   WHERE c <> ALL (ARRAY['project_id', 'plant_name']);

  RETURN;
END; $fn$;

REVOKE ALL ON FUNCTION public.ingest_promotion_plan(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_promotion_plan(uuid,text) TO service_role;

COMMENT ON FUNCTION public.ingest_promotion_plan(uuid,text) IS
  'Phase 3 / WP 3.4 — the columns a promotion of this run into this target '
  'writes, the value expression for each (normalized at promotion, I3) and the '
  'arbiter it upserts on. Lifted out of ingest_apply_run so that '
  'ingest_diff_run compares exactly what the promotion would write, rather than '
  'a fourth restatement of the same three facts.';

-- ── 5 · the diff itself ─────────────────────────────────────────────────────
--
-- Called at landing (by `ingest-file`, right after `ingest_land_file`), again on
-- demand when the review screen is opened, and again INSIDE `ingest_apply_run`
-- immediately before the upsert. The last of those is the one that makes the
-- number honest: tier 2 can change between the review and the click — another
-- run, the /policies grid, an admin — and a promotion that reported the review's
-- answer would be reporting a number it already knows to be stale.
--
-- IT IS IDEMPOTENT, and that is a requirement rather than a property: three
-- callers means a row is diffed repeatedly, and a second pass must not append a
-- second `superseded_by_later_line` finding or leave a stale one behind. The
-- strip-then-recompute below is why.
--
-- `removed_upstream` — DECIDED HERE, IN WRITING, BECAUSE §10 ASKED. It is in the
-- CHECK vocabulary and this function never writes it. A connector PULL is a
-- statement about the whole source: the row is gone from the system of record,
-- and `erp-sync-orbit-mrp` marks it (and still does not delete it — the sidecar
-- for `ingest_staged_products` says "a source dropping a row is not authority to
-- delete the project's row"). A FILE is not that statement. Nothing about
-- `inbound-january.csv` says it is the complete set of this project's lanes; a
-- user uploading one plant's arcs would otherwise be told their other plants had
-- been "removed upstream", and the only honest reading of a row absent from a
-- file is that the file does not mention it. So `rows_removed` is 0 for every
-- file run, and the review screen SAYS an upload cannot remove rows rather than
-- showing a zero that looks like a measurement (§5 T1: no number without a
-- source, and that includes a zero).

CREATE OR REPLACE FUNCTION public.ingest_diff_run(
  _run_id        uuid,
  _actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run       public.ingest_runs%ROWTYPE;
  v_role      text;
  v_plant     text;
  v_target    text;
  v_plan      record;
  v_pred      text;
  v_lhs       text;
  v_rhs       text;
  v_staged    integer;
  v_new       integer := 0;
  v_changed   integer := 0;
  v_unchanged integer := 0;
  v_supers    integer := 0;
  v_held      integer := 0;
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ingest_diff_run: a diff must name the person asking for it'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  SELECT * INTO v_run FROM public.ingest_runs WHERE id = _run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ingest_diff_run: no run %', _run_id USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM set_config('app.current_user_id', _actor_user_id::text, true);

  -- REVIEWING IS THE READ SIDE, so the gate is "may this person reach the
  -- project at all", not "may they promote". It takes TWO predicates and that is
  -- not belt and braces — it is the honest shape of a half-migrated governance
  -- plane, found by `supabase/rehearsal/100` rather than by reading:
  --
  --   · `has_project_access` is "the modeler, or a platform admin". Every RLS
  --     policy on `ingest_runs`, `ingest_files` and `ingest_staged_rows` uses it,
  --     so it is what actually decides who can SELECT a staged row today.
  --   · `effective_project_role` is WP 2.2's membership, and it is the only one
  --     of the two that HAS a role — which is why the promotion below uses it
  --     alone. An EDITOR who is not the project's modeler passes that gate and
  --     fails the first one, so a diff checking only `has_project_access` would
  --     refuse the very person §10 says may promote. The first run of
  --     `rehearsal/100` failed on exactly that, inside `ingest_apply_run`.
  --
  -- The union is the read gate until the ingest RLS moves onto
  -- `effective_project_role`, which is `min_project_role` finally being enforced
  -- rather than declared — 37 sidecars declare it and nothing reads it
  -- (PLAN.md §4 D66, WP 6.2).
  v_role := public.effective_project_role(_actor_user_id, v_run.project_id);
  IF public.project_role_rank(v_role) < public.project_role_rank('viewer')
     AND NOT public.has_project_access(v_run.project_id) THEN
    RAISE EXCEPTION 'ingest_diff_run: % has no access to project %', _actor_user_id, v_run.project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A CONNECTOR RUN STAGES NOTHING HERE, and leaving its counts alone is not a
  -- branch on `source_kind` — §10's gap check forbids that and this is not one.
  -- It is a branch on whether this run has row-shaped staging at all, which is a
  -- structural question with a structural answer. `erp-sync-orbit-mrp` computes
  -- its own diff over the three typed staging tables and writes its own counts;
  -- zeroing them from here would be this function claiming to have measured
  -- something it never looked at.
  SELECT count(*) INTO v_staged FROM public.ingest_staged_rows WHERE ingest_run_id = _run_id;
  IF v_staged = 0 THEN
    RETURN jsonb_build_object('run_id', _run_id, 'rows_compared', 0,
      'actor_role', v_role,
      'actor_may_promote',
        public.project_role_rank(v_role) >= public.project_role_rank('editor'),
      'note', 'this run stages no ingest_staged_rows; its counts were not touched');
  END IF;

  SELECT plant_name INTO v_plant FROM public.projects WHERE id = v_run.project_id;

  -- A row held back by an error finding has no diff. Its key may be one of the
  -- fields that failed, so there is nothing to compare it against, and NULL says
  -- exactly that (D62).
  UPDATE public.ingest_staged_rows
     SET diff_state = NULL
   WHERE ingest_run_id = _run_id
     AND findings @> '[{"level": "error"}]'::jsonb
     AND diff_state IS NOT NULL;

  -- Idempotence, first half: a previous pass's superseded findings go before a
  -- new pass adds them, so re-diffing a run never doubles them.
  UPDATE public.ingest_staged_rows
     SET findings = COALESCE(
           (SELECT jsonb_agg(f) FROM jsonb_array_elements(findings) f
             WHERE f ->> 'code' IS DISTINCT FROM 'superseded_by_later_line'),
           '[]'::jsonb)
   WHERE ingest_run_id = _run_id
     AND findings @> '[{"code": "superseded_by_later_line"}]'::jsonb;

  FOR v_target IN
    SELECT DISTINCT target_table FROM public.ingest_staged_rows WHERE ingest_run_id = _run_id
  LOOP
    IF NOT public.ingest_target_is_promotable(v_target) THEN
      RAISE EXCEPTION 'ingest_diff_run: % is not a promotable target', v_target
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT * INTO v_plan FROM public.ingest_promotion_plan(_run_id, v_target);
    CONTINUE WHEN v_plan.write_names IS NULL;   -- every row for this target was rejected

    -- THE KEY PREDICATE USES `IS NOT DISTINCT FROM`, NOT `=`, AND THE REASON IS
    -- D5. Three of the seven natural keys contain a nullable column whose NULL is
    -- meaningful, so every index is `NULLS NOT DISTINCT` and `ON CONFLICT` treats
    -- two NULLs as the SAME key. A diff joining with `=` would find no match for
    -- exactly those rows, call them `new`, and then watch the upsert UPDATE them
    -- — the review screen and the promotion disagreeing about the same row, in
    -- the one case no constraint had ever covered before WP 3.3.
    SELECT string_agg(
             CASE k.c
               WHEN 'project_id' THEN 'tgt.project_id IS NOT DISTINCT FROM $1'
               WHEN 'plant_name' THEN 'tgt.plant_name IS NOT DISTINCT FROM $2'
               ELSE format('tgt.%I IS NOT DISTINCT FROM %s', k.c, COALESCE(e.expr, 'NULL'))
             END, ' AND ' ORDER BY k.ord)
      INTO v_pred
      FROM unnest(v_plan.natural_key) WITH ORDINALITY AS k(c, ord)
      LEFT JOIN LATERAL (
        SELECT u.expr FROM unnest(v_plan.write_names, v_plan.write_exprs) AS u(nm, expr)
         WHERE u.nm = k.c LIMIT 1) e ON true;

    -- What "changed" means: any column the promotion WOULD write, other than the
    -- arbiter's own, differs from what is in the row today — compared AFTER
    -- normalization and cast to the column's own type, because that is the value
    -- that would land. Comparing the raw cell would report a change every time a
    -- file restated 7/week as 30.4375/month, which is the same fact twice.
    SELECT string_agg(format('tgt.%I', u.nm), ', ' ORDER BY u.nm),
           string_agg(u.expr, ', ' ORDER BY u.nm)
      INTO v_lhs, v_rhs
      FROM unnest(v_plan.write_names, v_plan.write_exprs) AS u(nm, expr)
     WHERE u.nm <> ALL (v_plan.natural_key);

    EXECUTE format(
      'UPDATE public.ingest_staged_rows t
          SET diff_state = d.state
         FROM (
           SELECT s.id,
                  CASE WHEN x.found IS NULL THEN ''new''
                       WHEN x.differs      THEN ''changed''
                       ELSE                     ''unchanged'' END AS state
             FROM public.ingest_staged_rows s
             LEFT JOIN LATERAL (
                  SELECT true AS found, (%s) AS differs
                    FROM public.%I tgt
                   WHERE %s
                   LIMIT 1) x ON true
            WHERE s.ingest_run_id = $3
              AND s.target_table  = $4
              AND NOT (s.findings @> ''[{"level": "error"}]''::jsonb)) d
        WHERE t.id = d.id',
      -- A PURE-KEY TARGET has no non-arbiter column to compare, so a row that
      -- matches is `unchanged` by construction rather than by measurement.
      CASE WHEN v_lhs IS NULL THEN 'false'
           ELSE format('ROW(%s) IS DISTINCT FROM ROW(%s)', v_lhs, v_rhs) END,
      v_target, v_pred)
      USING v_run.project_id, v_plant, _run_id, v_target;

    -- Idempotence, second half — and this MOVED here from `ingest_apply_run`
    -- (WP 3.3, `20260916000019`) rather than being added beside it. The finding
    -- is what the review screen shows for the third row state, so it has to
    -- exist BEFORE the promotion, not as a side effect of it. Its wording is
    -- present-tense for the same reason: the same sentence is true at review
    -- time and after the apply.
    IF v_plan.file_key IS NOT NULL THEN
      EXECUTE format(
        'WITH g AS (
           SELECT s.id, s.source_row_number,
                  max(s.source_row_number) OVER (PARTITION BY %s) AS kept
             FROM public.ingest_staged_rows s
            WHERE s.ingest_run_id = $1 AND s.target_table = $2
              AND NOT (s.findings @> ''[{"level": "error"}]''::jsonb)
         )
         UPDATE public.ingest_staged_rows t
            SET findings = t.findings || jsonb_build_array(jsonb_build_object(
                  ''level'',   ''warning'',
                  ''code'',    ''superseded_by_later_line'',
                  ''row'',     g.source_row_number,
                  ''message'', format(
                     ''Row %%s repeats a row already in this file; row %%s carries the '' ||
                     ''same %s and supersedes it. This row is not promoted.'',
                     g.source_row_number, g.kept)))
           FROM g
          WHERE t.id = g.id AND g.source_row_number < g.kept',
        v_plan.file_key, array_to_string(v_plan.natural_key, ' + '))
        USING _run_id, v_target;
    END IF;
  END LOOP;

  -- THE COUNTS THE REVIEW SCREEN READS, and they partition the run exactly:
  -- new + changed + unchanged + superseded + held = rows staged. A screen whose
  -- categories do not add up to the file is a screen that has lost rows, so the
  -- three diff states are counted over the rows that will ACTUALLY promote —
  -- a superseded row is reported as superseded and not also as `changed`.
  SELECT count(*) FILTER (WHERE r.state = 'new'),
         count(*) FILTER (WHERE r.state = 'changed'),
         count(*) FILTER (WHERE r.state = 'unchanged'),
         count(*) FILTER (WHERE r.superseded),
         count(*) FILTER (WHERE r.held)
    INTO v_new, v_changed, v_unchanged, v_supers, v_held
    FROM (
      SELECT CASE WHEN s.findings @> '[{"level": "error"}]'::jsonb THEN NULL
                  WHEN s.findings @> '[{"code": "superseded_by_later_line"}]'::jsonb THEN NULL
                  ELSE s.diff_state END AS state,
             s.findings @> '[{"code": "superseded_by_later_line"}]'::jsonb AS superseded,
             s.findings @> '[{"level": "error"}]'::jsonb                   AS held
        FROM public.ingest_staged_rows s
       WHERE s.ingest_run_id = _run_id) r;

  UPDATE public.ingest_runs
     SET rows_new        = v_new,
         rows_changed    = v_changed,
         rows_unchanged  = v_unchanged,
         -- Not a measurement that came back zero: a file run cannot express
         -- `removed_upstream` at all. See the header.
         rows_removed    = 0,
         rows_superseded = v_supers,
         rows_held       = v_held
   WHERE id = _run_id;

  RETURN jsonb_build_object(
    'run_id',          _run_id,
    'rows_staged',     v_staged,
    -- THE CALLER'S OWN ROLE, ANSWERED BY THE DATABASE THAT WILL ENFORCE IT.
    -- The review screen disables its Promote button from this, and the reason it
    -- comes back with the counts rather than from a separate lookup is that
    -- there must not be a SECOND opinion about who may promote: the button and
    -- the refusal read the same function, so a disabled button is a preview of
    -- what `ingest_apply_run` would do and never a substitute for it.
    'actor_role',      v_role,
    'actor_may_promote',
      public.project_role_rank(v_role) >= public.project_role_rank('editor'),
    'rows_new',        v_new,
    'rows_changed',    v_changed,
    'rows_unchanged',  v_unchanged,
    'rows_superseded', v_supers,
    'rows_held',       v_held);
END; $fn$;

REVOKE ALL ON FUNCTION public.ingest_diff_run(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_diff_run(uuid,uuid) TO service_role;

COMMENT ON FUNCTION public.ingest_diff_run(uuid,uuid) IS
  'Phase 3 / WP 3.4 — classifies every staged row of a run against the CURRENT '
  'tier-2 table (new / changed / unchanged, NULL when the row is held back by an '
  'error) and persists the split into ingest_runs. Idempotent, because it runs '
  'at landing, again when the review screen asks, and again inside '
  'ingest_apply_run immediately before the upsert. It never writes '
  '`removed_upstream`: a file is not a statement about the rows it omits.';

-- ── 6 · the promotion: role-gated, diffed first, counts persisted ───────────
--
-- THE STATEMENT IS THE SAME STATEMENT. WP 3.3 left the seam one statement wide
-- and §10 said it still is; this replaces the fragments around it, not the
-- upsert. What changes:
--
--   1. A ROLE GATE. `has_project_access` is a REACHABILITY test — "the modeler,
--      or a platform admin" — and §10's exit check asks for a role: "promotion
--      by an analyst is REFUSED". It is REPLACED rather than added to, because
--      two authorities for one question is `single-source` (I1) broken in the
--      governance plane: `effective_project_role` is WP 2.2's single answer, it
--      applies expiry and subtractive delegation, and section 1 above is what
--      makes it return `owner` for a project's own modeler. Keeping both would
--      also have refused an editor who is not the modeler, which is the entire
--      point of having editors.
--
--   2. THE DIFF RUNS FIRST, in this transaction, immediately before the upsert.
--      The review screen's counts were computed when the screen was opened and
--      tier 2 can have changed since. Recomputing costs one pass over the staged
--      rows and is the difference between a reported number and a true one.
--
--   3. THE COUNTS ARE PERSISTED BY THE DIFF, not by this function's `v_total`.
--      `rows_new = v_total` was inserts AND updates (D63); the split now comes
--      from the column that measured it.
--
--   4. THE TWO COUNTS ARE CROSS-CHECKED. `xmax = 0` in the RETURNING clause says
--      how many rows the upsert INSERTED versus UPDATED; the diff says how many
--      keys it expected to find. They are computed by completely different
--      means — one from a tuple header, one from a catalog-driven join — and
--      they must agree. When they do not, something that was true when the diff
--      ran stopped being true before the upsert, and the honest response is to
--      abort rather than to write a report of a promotion that did something
--      else. That check is also what would catch a bug in the diff's own key
--      predicate, which is the part of this file most able to be subtly wrong.
--
-- The superseded marking moved OUT of this function into `ingest_diff_run`,
-- where it belongs: the review screen shows the third row state, so the finding
-- has to exist before the decision, not as a consequence of it.

CREATE OR REPLACE FUNCTION public.ingest_apply_run(
  _run_id        uuid,
  _actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_run       public.ingest_runs%ROWTYPE;
  v_role      text;
  v_plant     text;
  v_target    text;
  v_plan      record;
  v_update    text;
  v_written   integer;
  v_upd       integer;
  v_diff      jsonb;
  v_expect    integer;
  v_total     integer := 0;
  v_updated   integer := 0;
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ingest_apply_run: a promotion must name its actor (invariant audit-actor)'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- FOR UPDATE, so two clicks on "apply" cannot both find the run `staged`.
  SELECT * INTO v_run FROM public.ingest_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ingest_apply_run: no run %', _run_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_run.status <> 'staged' THEN
    RAISE EXCEPTION 'ingest_apply_run: run % is %, not staged — a run is promoted once',
      _run_id, v_run.status USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('app.current_user_id', _actor_user_id::text, true);

  -- THE EXIT CHECK, AS A STATEMENT ABOUT WHAT THE DATABASE DOES. A disabled
  -- button is not a refusal: the button is in a bundle anyone can read and the
  -- RPC is reachable without it. `supabase/rehearsal/100` asserts this against a
  -- real database, with an analyst who has genuine project access.
  v_role := public.effective_project_role(_actor_user_id, v_run.project_id);
  IF public.project_role_rank(v_role) < public.project_role_rank('editor') THEN
    RAISE EXCEPTION
      'ingest_apply_run: promoting a run into project % needs project role editor or higher; % has %',
      v_run.project_id, _actor_user_id, COALESCE(v_role, 'no role on this project')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Fresh, in this transaction, against tier 2 as it is NOW.
  v_diff := public.ingest_diff_run(_run_id, _actor_user_id);

  -- `project_id` and `plant_name` come from the PROJECT and never from the file
  -- — the contract says so for every lane column (`set from the selected project,
  -- never from the CSV`), and `ensure_dataset_plant_matches_project` refuses the
  -- row otherwise.
  SELECT plant_name INTO v_plant FROM public.projects WHERE id = v_run.project_id;

  FOR v_target IN
    SELECT DISTINCT target_table FROM public.ingest_staged_rows WHERE ingest_run_id = _run_id
  LOOP
    IF NOT public.ingest_target_is_promotable(v_target) THEN
      RAISE EXCEPTION 'ingest_apply_run: % is not a promotable target', v_target
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT * INTO v_plan FROM public.ingest_promotion_plan(_run_id, v_target);
    CONTINUE WHEN v_plan.write_names IS NULL;   -- every row for this target was rejected

    -- Everything that is not part of the arbiter is overwritten by the incoming
    -- row. A key column must NOT appear: `ON CONFLICT DO UPDATE` forbids
    -- assigning to the columns it matched on, and it would be meaningless anyway
    -- — they are equal by construction.
    -- Empty when every written column is part of the arbiter — a pure-key table,
    -- where the upsert has nothing to change but must still stamp the provenance.
    -- The trailing comma belongs to this fragment so the statement is valid
    -- either way; `DO UPDATE SET` always has the three provenance assignments.
    SELECT COALESCE(string_agg(format('%I = EXCLUDED.%I,', c, c), ' ' ORDER BY c), '')
      INTO v_update
      FROM unnest(v_plan.write_names) AS c
     WHERE c <> ALL (v_plan.natural_key);

    -- ONE STATEMENT per target, which is what makes the tier-2 audit trigger
    -- write ONE row saying "n rows" rather than n rows saying one (WP 2.3).
    --
    -- `DISTINCT ON` IS NOT DECORATION. `ON CONFLICT DO UPDATE` raises 21000 —
    -- "cannot affect row a second time" — when ONE statement carries two rows
    -- with the same arbiter key, which is exactly what a CSV containing the same
    -- arc twice produces. Without it the whole promotion aborts on a duplicate
    -- LINE, with an error naming nothing the uploader can act on. With it the
    -- last line for a key wins — the same rule `20260916000017` applies to rows
    -- already in the table — and the superseded lines carry the finding
    -- `ingest_diff_run` gave them, which the review screen showed BEFORE this
    -- ran (§5 T2).
    --
    -- `xmax = 0` DISTINGUISHES AN INSERT FROM AN UPDATE in the RETURNING clause,
    -- and it is cross-checked against the diff below.
    EXECUTE format(
      'WITH up AS (
         INSERT INTO public.%I (%s, %s, ingest_run_id, source_row_id)
           SELECT DISTINCT ON (%s) %s, %s, $3, s.id
             FROM public.ingest_staged_rows s
            WHERE s.ingest_run_id = $3
              AND s.target_table  = $4
              AND NOT (s.findings @> ''[{"level": "error"}]''::jsonb)
            ORDER BY %s, s.source_row_number DESC
         ON CONFLICT (%s) DO UPDATE SET %s
              ingest_run_id = EXCLUDED.ingest_run_id,
              source_row_id = EXCLUDED.source_row_id,
              updated_at    = now()
         RETURNING (xmax = 0) AS inserted
       )
       SELECT count(*)::int, count(*) FILTER (WHERE NOT inserted)::int FROM up',
      v_target, v_plan.server_cols, v_plan.write_cols,
      COALESCE(v_plan.file_key, '1'), v_plan.server_vals, v_plan.write_vals,
      COALESCE(v_plan.file_key, '1'),
      (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_plan.natural_key) AS c),
      v_update)
      INTO v_written, v_upd
      USING v_run.project_id, v_plant, _run_id, v_target;

    v_total   := v_total + v_written;
    v_updated := v_updated + v_upd;
  END LOOP;

  -- THE TWO INDEPENDENT ANSWERS TO "HOW MANY OF THESE ROWS ALREADY EXISTED".
  -- One came from a tuple header, one from a catalog-driven join against tier 2.
  -- They are allowed to be equal and nothing else.
  v_expect := (v_diff ->> 'rows_changed')::int + (v_diff ->> 'rows_unchanged')::int;
  IF v_updated <> v_expect THEN
    RAISE EXCEPTION
      'ingest_apply_run: the diff expected % existing row(s) and the upsert updated % — '
      'tier 2 changed between the diff and the upsert, or the diff''s key predicate is wrong. '
      'Nothing is promoted; re-open the review.',
      v_expect, v_updated USING ERRCODE = 'serialization_failure';
  END IF;

  -- The counts are `ingest_diff_run`'s; this statement records only the
  -- transition. `rows_new` is the DIFF's rows_new — rows with no counterpart in
  -- tier 2 — and no longer `v_total`, which was inserts and updates together
  -- under a column named for one of them (D63).
  UPDATE public.ingest_runs
     SET status = 'applied', applied_at = now(), applied_by_user_id = _actor_user_id
   WHERE id = _run_id;

  RETURN jsonb_build_object(
    'run_id',          _run_id,
    'rows_promoted',   v_total,
    -- of those, how many already existed under this natural key. A second upload
    -- of an unchanged file promotes the same count and updates ALL of it, which
    -- is "uploading the same file twice is a no-op" as a number.
    'rows_updated',    v_updated,
    -- AND THE SPLIT THE PREVIOUS LINE CANNOT MAKE. `rows_updated` counts rows
    -- the upsert touched; it cannot say whether touching them changed anything,
    -- because an UPDATE that writes identical values is still an UPDATE. §16 ·
    -- WP 3.3's handoff said "12 new, 340 unchanged needs no second pass" — it
    -- does, and this is it (D63).
    'rows_new',        (v_diff ->> 'rows_new')::int,
    'rows_changed',    (v_diff ->> 'rows_changed')::int,
    'rows_unchanged',  (v_diff ->> 'rows_unchanged')::int,
    -- lines the file repeated; each one carries a finding in tier 1 naming the
    -- line that superseded it.
    'rows_superseded', (v_diff ->> 'rows_superseded')::int,
    'rows_held',       (v_diff ->> 'rows_held')::int,
    'promoted_by_role', v_role);
END; $fn$;

REVOKE ALL ON FUNCTION public.ingest_apply_run(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_apply_run(uuid,uuid) TO service_role;

COMMENT ON FUNCTION public.ingest_apply_run(uuid,uuid) IS
  'Phase 3 / WP 3.4 — promotes a staged run''s clean rows into their tier-2 '
  'table with an UPSERT on the natural key, normalizing units inside the same '
  'statement (I3) and stamping ingest_run_id + source_row_id so every canonical '
  'row traces to the line of the file it came from. One statement per target, so '
  'the statement-level audit trigger names the actor once with a count. Requires '
  'project role editor or higher (WP 3.4), re-runs the diff in the same '
  'transaction so the persisted counts are true at the moment of promotion, and '
  'refuses if the diff and the upsert disagree about how many rows already '
  'existed. Rows carrying an `error` finding stay in tier 1.';

SELECT pg_notify('pgrst', 'reload schema');
