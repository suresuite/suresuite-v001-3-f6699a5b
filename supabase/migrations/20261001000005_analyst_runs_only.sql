-- Profile / §4 D232 — the Analyst project role RUNS simulations and does nothing else.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────────
--
-- WP 2.2 (`20260915000005`) seeded the analyst as "may retune decisions, and may not rewrite
-- the measured inputs": Run Simulations, Edit Policies and Export, no Edit Input Data. The
-- owner asked for a role that can run a simulation without being able to change anything on
-- /policies, and chose to make that the analyst: "please change the right of the analyst from
-- able to edit policies to run simulation only".
--
--   analyst · simulation_lab      true   (unchanged)
--   analyst · data_edit_inputs    false  (unchanged)
--   analyst · data_edit_policies  false  (was true)
--   analyst · export              false  (was true — "run simulation only")
--
-- Since D230 these are the rights the app applies: an analyst's /policies is "View only",
-- its exports are off, and the Lab and Run & Validate still run. Saving a policy VERSION on
-- the way to a run stays allowed with Run Simulations (D230 decision 5) — it records the
-- current policies for the run to bind to and changes no value.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- Owner, editor and viewer are unchanged. A person-level override on /admin/users/:userId
-- still takes precedence over the role. The row shape is WP 2.2's VALUES list, so
-- `contract:capabilities` reads it (last seed wins) and the manual's role table and
-- /profile's legend follow without a second authoring.

-- The four keys exist wherever this deploys (seeded by `20260711000002` and `20260915000005`);
-- a database built from schema alone — the rehearsal base — has none, and the grant rows
-- reference them. Planted verbatim where missing, and a no-op everywhere else. Inside a DO
-- block so `contract:capabilities` keeps crediting the catalog to the migrations that own it.
DO $plant$
BEGIN
  INSERT INTO public.capabilities (key, kind, label, description, sort_order) VALUES
    ('simulation_lab',     'feature', 'Run Simulations', 'Configure and run simulation experiments',    220),
    ('export',             'feature', 'Export',          'Export data, reports and simulation results', 250),
    ('data_edit_inputs',   'feature', 'Edit Input Data',
     'Create and edit tier-2 project data — item master, BOM, logistics lanes', 241),
    ('data_edit_policies', 'feature', 'Edit Policies',
     'Create and edit tier-4 decisions — policies, overrides and scenarios',    242)
  ON CONFLICT (key) DO NOTHING;
END $plant$;

INSERT INTO public.project_role_capabilities (project_role, capability_key, allowed) VALUES
  ('analyst', 'data_edit_inputs',   false),
  ('analyst', 'data_edit_policies', false),
  ('analyst', 'export',             false),
  ('analyst', 'simulation_lab',     true)
ON CONFLICT (project_role, capability_key) DO UPDATE SET allowed = EXCLUDED.allowed;
