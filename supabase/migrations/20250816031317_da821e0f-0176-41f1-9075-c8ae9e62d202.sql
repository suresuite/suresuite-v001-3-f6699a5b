-- Increase precision to prevent numeric overflow during bulk inserts
BEGIN;

-- Adjust numeric precision/scale for supply_chain_data numeric columns
ALTER TABLE public.supply_chain_data
  ALTER COLUMN weighted TYPE numeric(16,6) USING weighted::numeric(16,6),
  ALTER COLUMN material_consumption_rate TYPE numeric(16,6) USING material_consumption_rate::numeric(16,6),
  ALTER COLUMN sourcing_ratio TYPE numeric(16,6) USING sourcing_ratio::numeric(16,6);

COMMIT;