-- Fix security warnings from the lockdown

-- 1) Create minimal RLS policy since table needs one (even though direct access is revoked)
CREATE POLICY "No direct access - use RPCs" ON public.approved_users
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- 2) Fix function search_path issues by ensuring all functions have it set
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;