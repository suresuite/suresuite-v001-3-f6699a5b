-- Fix function overloading conflicts by dropping old signatures and keeping only the new ones

-- Drop the old function signatures that have different parameter orders
DROP FUNCTION IF EXISTS public.get_network_nodes(p_project_id uuid, p_plant_name text, p_user_id uuid, p_user_email text);
DROP FUNCTION IF EXISTS public.get_network_edges(p_project_id uuid, p_plant_name text, p_user_id uuid, p_user_email text);  
DROP FUNCTION IF EXISTS public.get_network_summary(p_project_id uuid, p_plant_name text, p_user_id uuid, p_user_email text);

-- The correct functions with proper parameter order are already created:
-- public.get_network_nodes(p_project_id uuid, p_user_id uuid, p_user_email text, p_plant_name text DEFAULT NULL)
-- public.get_network_edges(p_project_id uuid, p_user_id uuid, p_user_email text, p_plant_name text DEFAULT NULL)
-- public.get_network_summary(p_project_id uuid, p_user_id uuid, p_user_email text, p_plant_name text DEFAULT NULL)