-- Allow multiple rows per plant by removing incorrect unique constraint
ALTER TABLE public.supply_chain_data DROP CONSTRAINT IF EXISTS supply_chain_data_plant_key;