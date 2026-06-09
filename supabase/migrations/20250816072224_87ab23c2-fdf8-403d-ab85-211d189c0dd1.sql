-- Temporarily disable RLS on supply_chain_data to allow application-level filtering
-- This fixes the issue where custom authentication doesn't work with JWT-based RLS policies

ALTER TABLE public.supply_chain_data DISABLE ROW LEVEL SECURITY;