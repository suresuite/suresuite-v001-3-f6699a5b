-- Drop policies first, then fix the function
DROP POLICY IF EXISTS "Users can view supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Users can delete their own supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Users can update their own supply chain data" ON public.supply_chain_data;

-- Now drop and recreate the function with proper security settings
DROP FUNCTION IF EXISTS public.get_current_approved_user() CASCADE;

CREATE OR REPLACE FUNCTION public.get_current_approved_user()
RETURNS TABLE(user_id uuid, user_email text, user_role text) 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  -- Try to get user from JWT first
  IF auth.jwt() IS NOT NULL THEN
    RETURN QUERY
    SELECT au.id, au.email, au.role
    FROM public.approved_users au
    WHERE au.email = (auth.jwt() ->> 'email'::text);
  END IF;
  
  -- Return nothing if no valid JWT
  RETURN;
END;
$$;

-- Recreate the policies with the fixed function
CREATE POLICY "Users can view supply chain data" ON public.supply_chain_data
FOR SELECT USING (
  -- Allow if user uploaded the data
  uploaded_by = (SELECT user_id FROM public.get_current_approved_user() LIMIT 1)
  OR
  -- Allow if user has view access to the plant
  plant IN (
    SELECT upa.plant 
    FROM public.user_plant_access upa 
    WHERE upa.user_id = (SELECT user_id FROM public.get_current_approved_user() LIMIT 1)
    AND upa.can_view = true
  )
  OR
  -- Allow if user is admin
  (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
);

CREATE POLICY "Users can delete their own supply chain data" ON public.supply_chain_data
FOR DELETE USING (
  uploaded_by = (SELECT user_id FROM public.get_current_approved_user() LIMIT 1)
  OR
  (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
);

CREATE POLICY "Users can update their own supply chain data" ON public.supply_chain_data
FOR UPDATE USING (
  uploaded_by = (SELECT user_id FROM public.get_current_approved_user() LIMIT 1)
  OR
  (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
);