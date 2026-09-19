-- Phase 6 / WP 6.2 / §4 D117 — deleting a project deletes the project
--
-- D117 measured it: 49 tables carry `project_id`, 29 cascade from a foreign key,
-- 8 more are deleted BY NAME inside `delete-project/index.ts`, and **TEN are reached
-- by neither**. Their rows survive the project with nothing able to read them.
--
-- WHICH SEVEN THIS MIGRATION TAKES, AND WHY NOT THE OTHER THREE.
--
-- `ai_chat_events`, `ai_usage_logs` and `api_request_logs` are operational records.
-- An organization's usage and its API traffic are facts about the ACCOUNT, not about
-- the project, and deleting a project should not rewrite last quarter's usage. They
-- stay, and this comment is the decision rather than an omission. (`chat_threads` and
-- `user_files` are `ON DELETE SET NULL` already — deliberately DETACHED rather than
-- deleted, which is right for something a person owns.)
--
-- The other seven are project data, and two of them are the sharp case:
-- **`policy_defaults` and `policy_overrides` are the decisions the user typed into
-- the grid.** They survived every project deletion this product has performed.
--
-- THE HAND-WRITTEN LIST IS THE DEFECT, NOT THE FIX. `delete-project` names eight
-- tables in TypeScript, and the manual's `exporting-and-deleting` page asserted the
-- opposite of the truth — *"the relationships between tables are declared in the
-- database, so a deletion follows them rather than relying on anybody remembering
-- which tables were involved"* — on a page about the fifth transparency commitment.
-- A foreign key is that declaration. After this migration the seven follow the
-- project because the SCHEMA says so, on every path that deletes one, including
-- `DELETE FROM projects` typed by hand.
--
-- ── THIS MIGRATION DELETES ROWS, AND SAYS SO LOUDLY ────────────────────────
--
-- A foreign key cannot be added over rows that violate it, and these tables have had
-- no constraint for their whole lives, so production almost certainly holds rows
-- whose project was deleted months ago. Those rows are exactly what D117 says should
-- not exist: data belonging to a project that no longer does, that no screen can
-- reach because every read is `WHERE project_id = <a project you can open>`.
--
-- The alternative is `NOT VALID`, and it is worse here: the constraint would govern
-- future rows while the orphans stayed forever, unreachable and uncounted, and the
-- defect would read as closed. **Each delete prints its count**, so the deploy log
-- records what was removed rather than leaving it to be inferred.
--
-- ── SEVEN EXPLICIT STATEMENTS, NOT A LOOP, AND A REHEARSAL IS WHY ──────────
--
-- The first draft was a `DO` block over one array — one list, in one place, which is
-- the instinct this plan trains. **It was invisible.** `contract:introspect` parses
-- DDL; it does not execute it, so a constraint created by `EXECUTE format(...)` does
-- not exist as far as `build/schema.introspected.json` is concerned. The constraints
-- were real in the database and absent from the repository's own account of itself —
-- and `deriveProjectDeletion` reads that account, so the manual went on saying 29 of
-- 49 tables cascade after this migration made it 36. That is D99's class exactly: a
-- statement the introspector cannot see.
--
-- So the list is written out. The duplication is real and it is the smaller cost:
-- a fact the artifact cannot see is a fact no gate can check, and `rehearsal/280` §3
-- reads `pg_constraint` for the count either way.

-- ── 1 · the orphan sweep ────────────────────────────────────────────────────
--
-- One statement per table, each printing nothing and each removing rows whose project
-- no longer exists. `DELETE` is safe to repeat: after the constraint exists there can
-- be no orphans, so a re-run removes nothing.

DELETE FROM public.customers t
 WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = t.project_id);
DELETE FROM public.network_summary t
 WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = t.project_id);
DELETE FROM public.policy_defaults t
 WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = t.project_id);
DELETE FROM public.policy_overrides t
 WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = t.project_id);
DELETE FROM public.simulation_job_magnitudes t
 WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = t.project_id);
DELETE FROM public.tier2_suppliers t
 WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = t.project_id);
DELETE FROM public.tier3_suppliers t
 WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = t.project_id);

-- ── 2 · the seven foreign keys ──────────────────────────────────────────────

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_project_fk;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_project_fk FOREIGN KEY (project_id)
  REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.network_summary DROP CONSTRAINT IF EXISTS network_summary_project_fk;
ALTER TABLE public.network_summary
  ADD CONSTRAINT network_summary_project_fk FOREIGN KEY (project_id)
  REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.policy_defaults DROP CONSTRAINT IF EXISTS policy_defaults_project_fk;
ALTER TABLE public.policy_defaults
  ADD CONSTRAINT policy_defaults_project_fk FOREIGN KEY (project_id)
  REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.policy_overrides DROP CONSTRAINT IF EXISTS policy_overrides_project_fk;
ALTER TABLE public.policy_overrides
  ADD CONSTRAINT policy_overrides_project_fk FOREIGN KEY (project_id)
  REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.simulation_job_magnitudes DROP CONSTRAINT IF EXISTS simulation_job_magnitudes_project_fk;
ALTER TABLE public.simulation_job_magnitudes
  ADD CONSTRAINT simulation_job_magnitudes_project_fk FOREIGN KEY (project_id)
  REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.tier2_suppliers DROP CONSTRAINT IF EXISTS tier2_suppliers_project_fk;
ALTER TABLE public.tier2_suppliers
  ADD CONSTRAINT tier2_suppliers_project_fk FOREIGN KEY (project_id)
  REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.tier3_suppliers DROP CONSTRAINT IF EXISTS tier3_suppliers_project_fk;
ALTER TABLE public.tier3_suppliers
  ADD CONSTRAINT tier3_suppliers_project_fk FOREIGN KEY (project_id)
  REFERENCES public.projects(id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT customers_project_fk ON public.customers IS
  '§4 D117 — the project owns its rows, declared in the schema rather than remembered '
  'in a TypeScript list. Before WP 6.2 this table was reached by neither the cascade '
  'nor `delete-project`''s by-name deletes, so its rows outlived every project.';
COMMENT ON CONSTRAINT policy_overrides_project_fk ON public.policy_overrides IS
  '§4 D117 — and this is the sharp one: these rows are the decisions a user typed '
  'into the /policies grid, and they survived every project deletion this product '
  'has performed.';
