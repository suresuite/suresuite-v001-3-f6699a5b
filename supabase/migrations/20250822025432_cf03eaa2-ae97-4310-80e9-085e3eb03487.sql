-- Rename plant column to plant_name in supply_chain_data table for consistency
ALTER TABLE public.supply_chain_data RENAME COLUMN plant TO plant_name;