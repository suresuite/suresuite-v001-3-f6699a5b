-- Add critical node prediction fields to supply_chain_data table
ALTER TABLE public.supply_chain_data 
ADD COLUMN is_critical_node boolean DEFAULT NULL,
ADD COLUMN critical_node_score numeric(5,4) DEFAULT NULL,
ADD COLUMN prediction_timestamp timestamp with time zone DEFAULT NULL;