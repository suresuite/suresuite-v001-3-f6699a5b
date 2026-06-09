-- Ensure unique mapping per user and plant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'user_plant_access_user_id_plant_key'
  ) THEN
    ALTER TABLE public.user_plant_access
    ADD CONSTRAINT user_plant_access_user_id_plant_key UNIQUE (user_id, plant);
  END IF;
END$$;

-- Trigger function to upsert user_plant_access on dataset upload
CREATE OR REPLACE FUNCTION public.upsert_user_plant_access_from_scd()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only proceed when we know who uploaded and which plant was uploaded
  IF NEW.uploaded_by IS NOT NULL AND NEW.plant IS NOT NULL THEN
    INSERT INTO public.user_plant_access (user_id, plant, can_view, can_delete)
    VALUES (NEW.uploaded_by, NEW.plant, true, false)
    ON CONFLICT (user_id, plant) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger to run after inserting supply_chain_data rows
DROP TRIGGER IF EXISTS trg_upsert_user_plant_access_from_scd ON public.supply_chain_data;
CREATE TRIGGER trg_upsert_user_plant_access_from_scd
AFTER INSERT ON public.supply_chain_data
FOR EACH ROW
EXECUTE FUNCTION public.upsert_user_plant_access_from_scd();