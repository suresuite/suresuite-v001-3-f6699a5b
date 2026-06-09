-- Revert RLS to allow inserts/selects without Supabase Auth (until auth is added)
DROP POLICY IF EXISTS "Authenticated users can view all supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Authenticated users can insert supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Authenticated users can update supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Authenticated users can delete supply chain data" ON public.supply_chain_data;

CREATE POLICY "Anyone can view supply chain data" 
ON public.supply_chain_data 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert supply chain data" 
ON public.supply_chain_data 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update supply chain data" 
ON public.supply_chain_data 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete supply chain data" 
ON public.supply_chain_data 
FOR DELETE 
USING (true);