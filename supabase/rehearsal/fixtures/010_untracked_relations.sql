-- PRODUCTION'S SHAPE, THE PART THE CONTRACT CANNOT DESCRIBE (D43).
--
-- The rehearsal base is generated from `build/schema.introspected.json`, which
-- records what the MIGRATIONS say. Production also holds relations that no
-- migration creates, and a migration written to ADOPT one has two paths: build
-- it (fresh database) and adopt it (production). The base always takes the
-- first. WP 1.4's first `risk_data` migration is what that costs — it read
-- correctly, it passed every local check, and it failed on the deploy at
-- statement 2 because `CREATE TABLE IF NOT EXISTS` had silently no-opped
-- against a table that was already there with different columns.
--
-- Applied with `npm run contract:rehearse -- --fixtures`. CI runs BOTH ways.
--
-- The definitions below are production's own, read back by §15's schema probe
-- (`information_schema.columns`, run 35062943621) rather than reconstructed:
-- no primary key, no unique constraint, no RLS, on either table. That absence
-- is the fixture's whole point.

CREATE TABLE IF NOT EXISTS public.customers (
  project_id         uuid                     NOT NULL,
  customer_id        text                     NOT NULL,
  name               text,
  segment            text                     NOT NULL DEFAULT 'default',
  priority_weight    numeric                  NOT NULL DEFAULT 1.0,
  sla_fill_floor_pct numeric,
  updated_at         timestamp with time zone NOT NULL DEFAULT now(),
  created_at         timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_code_map (
  id                    uuid                     NOT NULL DEFAULT gen_random_uuid(),
  project_id            uuid                     NOT NULL,
  plant_name            text                     NOT NULL,
  outbound_product_code text                     NOT NULL,
  bom_material_code     text                     NOT NULL,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now(),
  uploaded_by           uuid,
  organization          text                     NOT NULL DEFAULT 'default_org'
);

-- ROWS, because an adoption that adds a unique constraint has to survive the
-- rows that are already there, and `customers` holds six. An empty table would
-- let the ADD CONSTRAINT pass for the wrong reason.
INSERT INTO public.approved_users (id, email, name, password_hash)
VALUES ('00000000-0000-4000-8000-0000000f1000', 'fixture@example.invalid', 'Fixture', 'x')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.projects (id, name, modeler_id, plant_name)
VALUES ('00000000-0000-4000-8000-0000000f1001', 'Fixture project',
        '00000000-0000-4000-8000-0000000f1000', 'FIXTURE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.customers (project_id, customer_id, name, segment, priority_weight)
VALUES ('00000000-0000-4000-8000-0000000f1001', 'CUST-1', 'First',  'retail',    1.0),
       ('00000000-0000-4000-8000-0000000f1001', 'CUST-2', 'Second', 'retail',    1.5),
       ('00000000-0000-4000-8000-0000000f1001', 'CUST-3', 'Third',  'wholesale', 2.0);
