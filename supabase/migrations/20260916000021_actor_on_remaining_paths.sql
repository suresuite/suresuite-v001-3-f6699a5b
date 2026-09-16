-- Phase 3 / WP 3.3 / §10 · D36 — THE ACTOR ON THE PATHS THAT CAN CARRY ONE.
--
-- D36 is that a trigger cannot attribute a service-role write, so several
-- ingest/ETL paths audit WHAT but not WHO. WP 3.2 closed two of them with the
-- pattern this file reuses: take the actor as a PARAMETER and set
-- `app.current_user_id` LOCAL to the function's own transaction, so the trigger
-- reads it because it is in the same transaction and not because a connection
-- happened to be reused.
--
-- THE DIVIDING LINE IS NOT EFFORT, IT IS WHETHER THE WRITE IS IN A TRANSACTION
-- THE WRITER CONTROLS. A SQL function already runs in one and can set the GUC
-- before it writes. A PostgREST call from an edge function cannot: the setting
-- would have to survive into a different statement on a pooled connection, which
-- `projectLanes.ts`'s own header records that it does not. That is precisely why
-- D36 says the "one-line fix" is not one, and it is why this file closes the SQL
-- writers and leaves the PostgREST writers named rather than pretended-closed
-- (PLAN.md §16 · WP 3.3 · I).
--
-- `assign_material_supplier` IS ONE OF THE SQL WRITERS, and it was not in D36's
-- list of six because nothing had looked at it. It writes THREE tier-2/3 tables
-- — `inbound_logistics`, `supply_chain_data` and `suppliers` — takes `p_user_id`,
-- and never told the audit who was acting. It is reached from the /policies grid
-- every time somebody assigns a supplier to a material.
--
-- THE BODY IS OTHERWISE UNCHANGED, deliberately. Its three `WHERE NOT EXISTS`
-- guards already make it idempotent, so `20260916000018`'s unique index cannot
-- fire on it — verified rather than assumed, because a package that adds unique
-- indexes owes every existing writer that check.

CREATE OR REPLACE FUNCTION public.assign_material_supplier(
  p_project_id  uuid,
  p_material_id text,
  p_supplier_id text,
  p_user_id     uuid,
  p_user_email  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_plant text;
  v_org   text;
BEGIN
  IF NULLIF(p_material_id, '') IS NULL OR NULLIF(p_supplier_id, '') IS NULL THEN
    RAISE EXCEPTION 'material_id and supplier_id are required';
  END IF;

  -- D36, closed for this path (WP 3.3). LOCAL to this transaction, set BEFORE
  -- any tier-2 write, so `audit_tier_write`'s `get_current_user_id()` resolves
  -- and the three audit rows below name the person who clicked rather than
  -- recording `actor_known: false`. The actor was always a parameter here; only
  -- the one line telling the trigger about it was missing.
  IF p_user_id IS NOT NULL THEN
    PERFORM set_config('app.current_user_id', p_user_id::text, true);
  END IF;

  SELECT plant_name, organization INTO v_plant, v_org
  FROM public.projects WHERE id = p_project_id;
  IF v_plant IS NULL THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  -- 1) Lane row (the engine + grid enrichment source).
  --
  -- The `WHERE NOT EXISTS` is what keeps this compatible with the natural-key
  -- unique index `20260916000018` creates: assigning a supplier that is already
  -- assigned writes nothing, rather than raising 23505 at a user who did nothing
  -- wrong. Left as a guard rather than rewritten as ON CONFLICT because the two
  -- behave identically here and the guard is what production has already run.
  INSERT INTO public.inbound_logistics
    (project_id, plant_name, supplier_id, material_id)
  SELECT p_project_id, v_plant, p_supplier_id, p_material_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.inbound_logistics
    WHERE project_id = p_project_id
      AND supplier_id = p_supplier_id
      AND material_id = p_material_id
  );

  -- 2) Edge row so get_supply_chain_data reflects the pair immediately.
  INSERT INTO public.supply_chain_data
    (project_id, plant_name, data_source, from_location, to_location,
     material_consumption_rate, sourcing_ratio, weighted, uploaded_by, organization)
  SELECT p_project_id, v_plant, 'inbound', p_supplier_id, p_material_id,
         0, 1.0, 0, p_user_id, v_org
  WHERE NOT EXISTS (
    SELECT 1 FROM public.supply_chain_data
    WHERE project_id = p_project_id
      AND data_source = 'inbound'
      AND from_location = p_supplier_id
      AND to_location = p_material_id
  );

  -- 3) Supplier master row so capacity/reliability are editable right away.
  INSERT INTO public.suppliers (project_id, supplier_id)
  VALUES (p_project_id, p_supplier_id)
  ON CONFLICT (project_id, supplier_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_material_supplier TO anon, authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
