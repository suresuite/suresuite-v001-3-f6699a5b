-- The manual, released section by section — and a Q&A section with prepared answers.
--
-- Until now who could read /docs was ONE compile-time flag, `DOCS_SUPER_ADMIN_ONLY`
-- in `src/lib/ui/docsVisibility.ts`: super admins or everybody, and changing it
-- meant a deploy. This migration makes the answer a per-SECTION setting a super
-- admin changes from /admin/docs:
--
--   public        anyone, signed in or not
--   internal      any signed-in account
--   confidential  super admins, and accounts granted `docs_confidential`
--
-- Every account that can sign in is an `approved_users` row (there is no
-- self-sign-up), so "approved user" cannot be a level of its own — it is the same
-- set as "signed in". CONFIDENTIAL is therefore a GRANT: the `docs_confidential`
-- feature capability, seeded super_admin-only, and grantable per role, per
-- organization or per user from the screens that already edit capabilities.
--
-- NOTHING CHANGES ON DEPLOY. Every section is seeded `confidential` and nobody but
-- a super admin holds the grant, which is exactly the old flag's answer. A section
-- with no row is read as `confidential` by both this file and the client, so a
-- section added to the registry later is closed until somebody opens it.
--
-- WHAT THE SETTING PROTECTS, STATED PLAINLY (T3). Page bodies are React components
-- compiled into the app bundle, so a section's audience decides what a reader is
-- SHOWN, not what a determined person can download. The Q&A answers are different:
-- they live in `docs_faq`, have no read policy, and reach a browser only through
-- `docs_list_faq`, which filters by audience in the database. And that filter is as
-- strong as this application's sign-in — the reader id is client-asserted (§4 D28).

-- ── 1 · the capability ──────────────────────────────────────────────────────
INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
  ('docs_confidential', 'feature', 'Confidential Documentation',
   'Read the documentation sections marked Confidential', 400)
ON CONFLICT (key) DO UPDATE
  SET kind = EXCLUDED.kind, label = EXCLUDED.label,
      description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.role_capabilities (role, capability_key, allowed)
SELECT r.role, 'docs_confidential', r.role = 'super_admin'
FROM (VALUES ('super_admin'),('admin'),('modeler'),('user')) AS r(role)
ON CONFLICT (role, capability_key) DO NOTHING;

-- ── 2 · a section's audience ────────────────────────────────────────────────
-- Keyed by the registry's section KEY, not its number: §6.3's numbers are an
-- ordering, and renumbering a section must not silently hand its audience to
-- another one. The key set is the registry's to own — a CHECK listing it would
-- need a migration for every new section — so the column checks the SHAPE, and
-- `docsRelease.test.ts` checks the seed below against the registry.
CREATE TABLE IF NOT EXISTS public.docs_section_releases (
  section_key text PRIMARY KEY
    CONSTRAINT docs_section_releases_key_shape CHECK (section_key ~ '^[a-z][a-z0-9-]*$'),
  audience    text NOT NULL
    CONSTRAINT docs_section_releases_audience CHECK (audience IN ('public','internal','confidential')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES public.approved_users(id) ON DELETE SET NULL
);

ALTER TABLE public.docs_section_releases ENABLE ROW LEVEL SECURITY;
-- Readable by everyone, signed in or not: the gate needs it before sign-in to know
-- whether a public section may render, and the rows say only which sections are
-- open — their titles are already in the bundle.
DROP POLICY IF EXISTS docs_section_releases_read ON public.docs_section_releases;
CREATE POLICY docs_section_releases_read ON public.docs_section_releases
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.docs_section_releases TO anon, authenticated;
-- No write policy: the only writer is `admin_set_docs_section_audience` below.

INSERT INTO public.docs_section_releases (section_key, audience)
SELECT k, 'confidential'
FROM unnest(ARRAY[
  'overview', 'getting-started', 'input-tables', 'computed-tables', 'policies',
  'verification', 'experiments', 'networks', 'project-intelligence', 'connectors',
  'results', 'exports', 'access', 'developer-api', 'reference', 'questions'
]) AS k
ON CONFLICT (section_key) DO NOTHING;

-- ── 3 · questions and prepared answers ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.docs_faq (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question      text NOT NULL CONSTRAINT docs_faq_question_nonblank CHECK (btrim(question) <> ''),
  -- Markdown, rendered with raw HTML disabled.
  answer        text NOT NULL CONSTRAINT docs_faq_answer_nonblank CHECK (btrim(answer) <> ''),
  -- The manual section the question is ABOUT. Its audience applies on top of the
  -- Q&A section's own, so an answer about a confidential section stays
  -- confidential even when the Q&A section is public. NULL: general.
  section_key   text CONSTRAINT docs_faq_section_key_shape CHECK (section_key ~ '^[a-z][a-z0-9-]*$'),
  related_slugs text[] NOT NULL DEFAULT '{}',
  sort_order    integer NOT NULL DEFAULT 0,
  is_published  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.approved_users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES public.approved_users(id) ON DELETE SET NULL,
  CONSTRAINT docs_faq_question_key UNIQUE (question)
);

ALTER TABLE public.docs_faq ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policy: an unpublished answer, or one about a section the reader
-- may not open, must not be one PostgREST query away. Reads go through
-- `docs_list_faq` (readers) and `admin_list_docs_faq` (super admins).

-- ── 4 · who is reading ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.docs_audience_rank(p_audience text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_audience WHEN 'public' THEN 0 WHEN 'internal' THEN 1 ELSE 2 END;
$$;

-- The highest audience a reader may see. Nobody named, or an account that is not
-- an active approved user: public. A super admin, or an account holding
-- `docs_confidential` through any layer the resolver reads: confidential.
-- Everyone else signed in: internal.
CREATE OR REPLACE FUNCTION public.docs_reader_level(p_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  IF p_user_id IS NULL THEN RETURN 'public'; END IF;
  SELECT role::text INTO v_role FROM public.approved_users
   WHERE id = p_user_id AND is_active;
  IF v_role IS NULL THEN RETURN 'public'; END IF;
  IF v_role = 'super_admin' THEN RETURN 'confidential'; END IF;
  IF COALESCE((public.capabilities_for_user(p_user_id) -> 'features' ->> 'docs_confidential')::boolean, false) THEN
    RETURN 'confidential';
  END IF;
  RETURN 'internal';
END; $$;
REVOKE ALL ON FUNCTION public.docs_reader_level(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.docs_reader_level(uuid) TO anon, authenticated;

-- A section with no row is confidential.
CREATE OR REPLACE FUNCTION public.docs_section_audience(p_section_key text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT audience FROM public.docs_section_releases WHERE section_key = p_section_key),
    'confidential');
$$;
REVOKE ALL ON FUNCTION public.docs_section_audience(text) FROM PUBLIC;

-- ── 5 · the reader's list ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.docs_list_faq(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, question text, answer text, section_key text,
  related_slugs text[], sort_order integer, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rank integer := public.docs_audience_rank(public.docs_reader_level(p_user_id));
BEGIN
  IF public.docs_audience_rank(public.docs_section_audience('questions')) > v_rank THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT f.id, f.question, f.answer, f.section_key, f.related_slugs, f.sort_order, f.updated_at
      FROM public.docs_faq f
     WHERE f.is_published
       AND (f.section_key IS NULL
            OR public.docs_audience_rank(public.docs_section_audience(f.section_key)) <= v_rank)
     ORDER BY f.sort_order, f.question;
END; $$;
REVOKE ALL ON FUNCTION public.docs_list_faq(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.docs_list_faq(uuid) TO anon, authenticated;

-- ── 6 · the super admin's verbs ─────────────────────────────────────────────
-- Each asserts an ACTIVE super admin (which also sets the session actor) and
-- writes an `admin_audit_logs` row naming them, the pattern of every admin_* RPC.
CREATE OR REPLACE FUNCTION public.admin_set_docs_section_audience(
  p_actor_id uuid, p_actor_email text, p_section_key text, p_audience text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before text;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_audience IS NULL OR p_audience NOT IN ('public','internal','confidential') THEN
    RAISE EXCEPTION 'invalid audience %', p_audience USING ERRCODE = '22023';
  END IF;
  IF p_section_key IS NULL OR p_section_key !~ '^[a-z][a-z0-9-]*$' THEN
    RAISE EXCEPTION 'invalid section key %', p_section_key USING ERRCODE = '22023';
  END IF;
  SELECT audience INTO v_before FROM public.docs_section_releases WHERE section_key = p_section_key;
  IF v_before IS NOT DISTINCT FROM p_audience THEN RETURN; END IF;
  INSERT INTO public.docs_section_releases (section_key, audience, updated_at, updated_by)
  VALUES (p_section_key, p_audience, now(), p_actor_id)
  ON CONFLICT (section_key) DO UPDATE
    SET audience = EXCLUDED.audience, updated_at = now(), updated_by = EXCLUDED.updated_by;
  PERFORM public.log_admin_action('docs.section_audience', 'docs_section_releases', p_section_key,
    jsonb_build_object('audience', COALESCE(v_before, 'confidential')),
    jsonb_build_object('audience', p_audience));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_docs_section_audience(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_docs_section_audience(uuid, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_docs_faq(p_actor_id uuid, p_actor_email text)
RETURNS SETOF public.docs_faq
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  RETURN QUERY SELECT * FROM public.docs_faq ORDER BY sort_order, question;
END; $$;
REVOKE ALL ON FUNCTION public.admin_list_docs_faq(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_docs_faq(uuid, text) TO anon, authenticated;

-- Create (p_id NULL) or update one entry. Returns its id.
CREATE OR REPLACE FUNCTION public.admin_save_docs_faq(
  p_actor_id uuid, p_actor_email text, p_id uuid,
  p_question text, p_answer text, p_section_key text,
  p_related_slugs text[], p_sort_order integer, p_is_published boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before public.docs_faq; v_id uuid;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  IF p_id IS NULL THEN
    INSERT INTO public.docs_faq
      (question, answer, section_key, related_slugs, sort_order, is_published, created_by, updated_by)
    VALUES (btrim(p_question), p_answer, NULLIF(btrim(p_section_key), ''),
            COALESCE(p_related_slugs, '{}'), COALESCE(p_sort_order, 0),
            COALESCE(p_is_published, false), p_actor_id, p_actor_id)
    RETURNING id INTO v_id;
    PERFORM public.log_admin_action('docs.faq_create', 'docs_faq', v_id::text, NULL,
      jsonb_build_object('question', btrim(p_question), 'is_published', COALESCE(p_is_published, false)));
  ELSE
    SELECT * INTO v_before FROM public.docs_faq WHERE id = p_id FOR UPDATE;
    IF v_before.id IS NULL THEN RAISE EXCEPTION 'question not found' USING ERRCODE = '42704'; END IF;
    UPDATE public.docs_faq
       SET question = btrim(p_question), answer = p_answer,
           section_key = NULLIF(btrim(p_section_key), ''),
           related_slugs = COALESCE(p_related_slugs, '{}'),
           sort_order = COALESCE(p_sort_order, 0),
           is_published = COALESCE(p_is_published, false),
           updated_at = now(), updated_by = p_actor_id
     WHERE id = p_id;
    v_id := p_id;
    PERFORM public.log_admin_action('docs.faq_update', 'docs_faq', v_id::text,
      jsonb_build_object('question', v_before.question, 'is_published', v_before.is_published),
      jsonb_build_object('question', btrim(p_question), 'is_published', COALESCE(p_is_published, false)));
  END IF;
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_save_docs_faq(uuid, text, uuid, text, text, text, text[], integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_docs_faq(uuid, text, uuid, text, text, text, text[], integer, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_docs_faq(p_actor_id uuid, p_actor_email text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before public.docs_faq;
BEGIN
  PERFORM public._assert_super_admin(p_actor_id, p_actor_email);
  DELETE FROM public.docs_faq WHERE id = p_id RETURNING * INTO v_before;
  IF v_before.id IS NULL THEN RAISE EXCEPTION 'question not found' USING ERRCODE = '42704'; END IF;
  PERFORM public.log_admin_action('docs.faq_delete', 'docs_faq', p_id::text,
    jsonb_build_object('question', v_before.question, 'is_published', v_before.is_published), NULL);
END; $$;
REVOKE ALL ON FUNCTION public.admin_delete_docs_faq(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_docs_faq(uuid, text, uuid) TO anon, authenticated;

-- ── 7 · the prepared answers ────────────────────────────────────────────────
-- Seeded PUBLISHED, inside a section that is itself seeded confidential, so no
-- reader sees them until a super admin opens the Q&A section. Each answer points
-- at the page that owns the fact rather than restating it (PLAN.md §6.1 rule 2):
-- a column name or a unit copied into an answer is the drift the manual was
-- rebuilt to end. `ON CONFLICT DO NOTHING` — an answer an admin has since edited
-- is theirs, and a re-run must not put the original back.
INSERT INTO public.docs_faq (question, answer, section_key, related_slugs, sort_order, is_published) VALUES
(
  'What is SuReSuite, in one sentence?',
  'A digital twin of your supply chain: you describe the chain with your own data, set the policies that govern it, and simulate disruptions to see how it holds up — with every number traceable to where it came from. [What SuReSuite is](/docs/what-suresuite-is) is the one-page version.',
  'overview', ARRAY['what-suresuite-is', 'how-suresuite-is-designed'], 10, true
),
(
  'What is the minimum data I need to get started?',
  'A list of the materials you buy, the products you make, and the bill of materials connecting them. Everything else can be added later, and the software tells you what is missing rather than failing silently. [Your first project](/docs/your-first-project) walks through it end to end.',
  'getting-started', ARRAY['your-first-project', 'uploading-data'], 20, true
),
(
  'Why was my upload rejected?',
  'Almost always a header. Headers are checked exactly, so download the dataset''s template before you fill it in. The file is checked in three passes — can it be read, are the required headers there, does each row make sense — and stops at the first that fails, reporting every problem in that pass by name or row number. A spreadsheet saved as .xlsx must be exported as CSV first. See [Uploading data](/docs/uploading-data).',
  'getting-started', ARRAY['uploading-data', 'verify-your-inputs'], 30, true
),
(
  'Where do I find what a column in my CSV means?',
  'Every input dataset has its own page in [Input tables](/docs/inbound-logistics), leading with the header you type. For a single field, the [Field index](/docs/field-index) lists every field A to Z and links to the table it belongs to.',
  'input-tables', ARRAY['field-index', 'data-model'], 40, true
),
(
  'What happens when a value I need is missing?',
  'The system either derives a value by a named rule, uses an explicit default, or tells you it cannot — and it always marks which of those happened, next to the number. It never fills a gap silently. [When a value is missing](/docs/when-a-value-is-missing) lists every substitution; [Where a number came from](/docs/where-a-number-came-from) explains the markers.',
  'policies', ARRAY['when-a-value-is-missing', 'where-a-number-came-from'], 50, true
),
(
  'What do block, warn and info findings mean?',
  'Block findings stop a simulation until they are cleared. Warnings are worth reading — most are worth fixing, some are genuinely fine. Info is context. [Verify your inputs](/docs/verify-your-inputs) explains how to clear each kind.',
  'verification', ARRAY['verify-your-inputs', 'data-trust-report'], 60, true
),
(
  'Why does the same simulation give a range instead of a single number?',
  'Because the simulation is stochastic: demand is drawn and lead times vary, so one run is one sample. Several replications are run and the spread is reported, which is what lets you tell a real difference from noise. [Seeds, replications & confidence](/docs/seeds-replications-confidence) explains how wide the range is and why.',
  'experiments', ARRAY['seeds-replications-confidence', 'reading-your-results'], 70, true
),
(
  'Can I rerun exactly what someone else ran?',
  'Yes, when the run carries its reproducibility record — the dataset, policy, scenario and engine versions, and the seed, that produced it. The same inputs under the same seed give the same result on any machine. See [Reproducibility record](/docs/reproducibility-record).',
  'exports', ARRAY['reproducibility-record', 'verifiable-exports'], 80, true
),
(
  'Should I upload CSVs or connect my ERP?',
  'CSV upload is always available and is the default. A connector keeps your item masters in sync with a system you already run, and every sync is reviewed before it lands. [CSV or connector — which to use](/docs/csv-vs-connector) states the trade-off plainly.',
  'connectors', ARRAY['csv-vs-connector', 'connecting-erp'], 90, true
),
(
  'Who can see my project''s data?',
  'People in your organization who have been given access to your project, and the people who operate this system. [Who can see your data](/docs/who-can-see-your-data) is the long answer — including where each boundary is actually enforced and where it is still only described.',
  'access', ARRAY['who-can-see-your-data', 'roles-and-capabilities'], 100, true
),
(
  'Can the AI assistant change my data?',
  'Not on its own. The assistant proposes; you apply. A plan says what it would change before it changes anything, and a proposal waits for your decision — one you never look at simply stays a proposal. See [Plans and proposals](/docs/plans-and-proposals) and [The AI assistant](/docs/ai-assistant).',
  'project-intelligence', ARRAY['plans-and-proposals', 'ai-assistant'], 110, true
),
(
  'What does SuReSuite not model?',
  'The manual publishes its own blind spots before you rely on it. [Known limits](/docs/known-limits) lists them.',
  'overview', ARRAY['known-limits'], 120, true
),
(
  'How do I get my data out, or have it deleted?',
  '[Exporting and deleting your data](/docs/exporting-and-deleting) covers getting everything out and having it removed.',
  'exports', ARRAY['exporting-and-deleting'], 130, true
),
(
  'Why can''t I see some sections of this manual?',
  'The manual is released section by section. Some sections are public, some are open to every signed-in account, and some are confidential and open only to accounts that have been granted access. If you need a section you cannot see, ask your administrator.',
  NULL, ARRAY['what-suresuite-is'], 140, true
)
ON CONFLICT (question) DO NOTHING;

SELECT pg_notify('pgrst', 'reload schema');
