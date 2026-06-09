-- Add columns to track zero-flow filtered nodes
ALTER TABLE public.supply_chain_data 
ADD COLUMN is_zero_flow_filtered BOOLEAN DEFAULT FALSE,
ADD COLUMN zero_flow_filter_applied_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN zero_flow_filter_reason TEXT DEFAULT 'zero_incoming_outgoing_flow';

-- Create index for efficient filtering queries
CREATE INDEX idx_supply_chain_data_zero_flow_filtered ON public.supply_chain_data(is_zero_flow_filtered);