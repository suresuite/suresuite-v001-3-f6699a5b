-- Revert permissive policy and restore secure RLS aligned with custom approved_users + Supabase JWT

-- Drop overly permissive policy if exists
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.supply_chain_data;

-- Ensure helper exists
CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
BEGIN
  SELECT user_id INTO current_user_id 
  FROM public.get_current_approved_user() 
  LIMIT 1;
  RETURN current_user_id;
END;
$$;

-- Recreate policies
DROP POLICY IF EXISTS "Anyone can insert supply chain data" ON public.supply_chain_data;
CREATE POLICY "Anyone can insert supply chain data" 
ON public.supply_chain_data 
FOR INSERT 
WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view supply chain data" ON public.supply_chain_data;
CREATE POLICY "Users can view supply chain data" 
ON public.supply_chain_data 
FOR SELECT 
USING (
  uploaded_by = public.get_current_user_id()
  OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
  OR plant IN (
    SELECT upa.plant FROM public.user_plant_access upa
    WHERE upa.user_id = public.get_current_user_id() AND upa.can_view = true
  )
);

DROP POLICY IF EXISTS "Users can update their own supply chain data" ON public.supply_chain_data;
CREATE POLICY "Users can update their own supply chain data" 
ON public.supply_chain_data 
FOR UPDATE 
USING (
  uploaded_by = public.get_current_user_id()
  OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
);

DROP POLICY IF EXISTS "Users can delete their own supply chain data" ON public.supply_chain_data;
CREATE POLICY "Users can delete their own supply chain data" 
ON public.supply_chain_data 
FOR DELETE 
USING (
  uploaded_by = public.get_current_user_id()
  OR (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
);