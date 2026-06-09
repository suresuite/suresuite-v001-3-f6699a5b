-- Fix authentication by updating the get_current_approved_user function to work with our custom auth
-- and update RLS policies to use it properly

-- First, drop existing function and recreate it
DROP FUNCTION IF EXISTS public.get_current_approved_user();

-- Create a new function that works with our custom authentication
CREATE OR REPLACE FUNCTION public.get_current_approved_user()
RETURNS TABLE(user_id uuid, user_email text, user_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Try to get user from JWT token if available
  IF auth.jwt() IS NOT NULL AND auth.jwt() ->> 'email' IS NOT NULL THEN
    RETURN QUERY
    SELECT au.id, au.email, au.role
    FROM public.approved_users au
    WHERE au.email = (auth.jwt() ->> 'email'::text);
  END IF;
  
  -- Return empty if no valid authentication
  RETURN;
END;
$$;

-- Also create a simpler function to get current user ID
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

-- Update supply_chain_data RLS policies to use the new function
DROP POLICY IF EXISTS "Users can view supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Users can update their own supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Users can delete their own supply chain data" ON public.supply_chain_data;

-- Recreate policies with cleaner logic
CREATE POLICY "Users can view supply chain data" 
ON public.supply_chain_data 
FOR SELECT 
USING (
  uploaded_by = public.get_current_user_id() OR
  (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin' OR
  plant IN (
    SELECT upa.plant
    FROM public.user_plant_access upa
    WHERE upa.user_id = public.get_current_user_id() AND upa.can_view = true
  )
);

CREATE POLICY "Users can update their own supply chain data" 
ON public.supply_chain_data 
FOR UPDATE 
USING (
  uploaded_by = public.get_current_user_id() OR
  (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
);

CREATE POLICY "Users can delete their own supply chain data" 
ON public.supply_chain_data 
FOR DELETE 
USING (
  uploaded_by = public.get_current_user_id() OR
  (SELECT user_role FROM public.get_current_approved_user() LIMIT 1) = 'admin'
);