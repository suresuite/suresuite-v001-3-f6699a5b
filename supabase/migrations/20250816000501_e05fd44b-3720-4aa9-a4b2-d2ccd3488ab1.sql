-- Update RLS policies to require authentication
DROP POLICY IF EXISTS "Users can view all supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Users can insert supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Users can update supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Users can delete supply chain data" ON public.supply_chain_data;

-- Create new policies that require authentication
CREATE POLICY "Authenticated users can view all supply chain data" 
ON public.supply_chain_data 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert supply chain data" 
ON public.supply_chain_data 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update supply chain data" 
ON public.supply_chain_data 
FOR UPDATE 
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete supply chain data" 
ON public.supply_chain_data 
FOR DELETE 
USING (auth.uid() IS NOT NULL);