-- D1'S SURVIVING DAMAGE, reproduced so the migration that removes it can be
-- watched removing it (D44).
--
-- Production holds 477 `policy_overrides` rows carrying the auto-seeded
-- `safety_stock_days = 0` (§15, run 35062943621). The rehearsal base is built
-- from the schema, not from the data, so without this fixture
-- `20260916000004_unseed_d1_zero_safety_stock.sql` would run against an empty
-- table and report a clean sweep of nothing — which is the shape of every gate
-- that passes for the wrong reason.
--
-- Four rows, one per case the predicate has to get right. `030_d1_unseeded.sql`
-- asserts the outcome of each.

INSERT INTO public.approved_users (id, email, name, password_hash)
VALUES ('00000000-0000-4000-8000-0000000d1000', 'd1@example.invalid', 'D1 fixture', 'x')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.projects (id, name, modeler_id, plant_name)
VALUES ('00000000-0000-4000-8000-0000000d1001', 'D1 fixture project',
        '00000000-0000-4000-8000-0000000d1000', 'D1PLANT')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.policy_overrides (project_id, scope, target_key, family, patch) VALUES
  -- 1 · the plain case: the frozen zero is the whole patch. Row goes.
  ('00000000-0000-4000-8000-0000000d1001', 'material', 'D44-ONLY-ZERO', 'inventory',
   '{"safety_stock_days": 0}'::jsonb),

  -- 2 · the case a row-level DELETE would get wrong: the frozen zero sits
  --     beside a number somebody chose. The key goes, the row and the other
  --     key stay.
  ('00000000-0000-4000-8000-0000000d1001', 'material', 'D44-ZERO-PLUS', 'inventory',
   '{"safety_stock_days": 0, "reorder_point": 42}'::jsonb),

  -- 3 · a deliberate non-zero. Untouched.
  ('00000000-0000-4000-8000-0000000d1001', 'material', 'D44-NONZERO', 'inventory',
   '{"safety_stock_days": 3}'::jsonb),

  -- 4 · a zero in a DIFFERENT family. D1 wrote inventory patches; the predicate
  --     must not wander.
  ('00000000-0000-4000-8000-0000000d1001', 'material', 'D44-OTHER-FAMILY', 'sourcing',
   '{"safety_stock_days": 0}'::jsonb)
ON CONFLICT (project_id, scope, target_key, family) DO NOTHING;
