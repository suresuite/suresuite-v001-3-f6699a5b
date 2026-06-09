-- Create a helper function to verify dataset presence per project using SECURITY DEFINER to avoid RLS false negatives
create or replace function public.get_project_dataset_status(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bom_level text;
  v_org text;
  v_bom boolean := false;
  v_inbound boolean := false;
  v_outbound boolean := false;
  v_multi boolean := false;
begin
  -- Fetch project context
  select organization, bom_level
  into v_org, v_bom_level
  from public.projects
  where id = p_project_id;

  if v_org is null then
    return jsonb_build_object('error', 'project_not_found');
  end if;

  -- Ensure caller belongs to same organization
  if v_org <> get_current_user_org() then
    return jsonb_build_object('error', 'forbidden');
  end if;

  -- BOM presence depends on bom_level
  if v_bom_level = 'single' then
    select exists(select 1 from public.bom_single_level where project_id = p_project_id)
    into v_bom;
  else
    select exists(select 1 from public.bom_multi_level where project_id = p_project_id)
    into v_bom;
  end if;

  -- Other datasets
  select exists(select 1 from public.inbound_logistics where project_id = p_project_id)
  into v_inbound;

  select exists(select 1 from public.outbound_logistics where project_id = p_project_id)
  into v_outbound;

  select exists(select 1 from public.multi_tier_supply_chain where project_id = p_project_id)
  into v_multi;

  return jsonb_build_object(
    'bom', v_bom,
    'inbound', v_inbound,
    'outbound', v_outbound,
    'multiTier', v_multi
  );
end;
$$;

-- Grant execute to clients
grant execute on function public.get_project_dataset_status(uuid) to anon, authenticated;