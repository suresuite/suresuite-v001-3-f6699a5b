-- Add prominence tracking columns to network_nodes table
ALTER TABLE public.network_nodes 
ADD COLUMN prominence numeric,
ADD COLUMN prominence_updated_at timestamp with time zone;

-- Create index on prominence for better query performance
CREATE INDEX idx_network_nodes_prominence ON public.network_nodes(prominence);

-- Add comments for documentation
COMMENT ON COLUMN public.network_nodes.prominence IS 'Calculated prominence score based on connections, revenue, balance, and centrality';
COMMENT ON COLUMN public.network_nodes.prominence_updated_at IS 'Timestamp when prominence was last calculated';