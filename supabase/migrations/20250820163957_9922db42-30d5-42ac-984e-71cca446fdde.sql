-- Fix security issues by enabling RLS on all public tables that have policies but RLS disabled

-- Check which tables have RLS enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables 
WHERE schemaname = 'public' AND tablename IN (
  SELECT tablename 
  FROM pg_policies 
  WHERE schemaname = 'public'
);

-- Enable RLS on all public tables that have policies but RLS disabled
ALTER TABLE public.approved_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_multi_level ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_single_level ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_logistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.multi_tier_supply_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_logistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_chain_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_plant_access ENABLE ROW LEVEL SECURITY;