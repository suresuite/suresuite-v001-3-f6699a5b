-- Test a simple direct insert to network_summary to see if the table itself works
-- First, let's try to identify what's causing the "net" schema error by testing direct insertion

-- Set user context first
SELECT set_config('app.current_user_id', '6fb76f62-876b-4616-b926-006691742c49', true);
SELECT set_config('app.current_user_email', 'modeler1@gmail.com', true);

-- Now try a simple insert
INSERT INTO public.network_summary (
    project_id,
    plant_name,
    nodes_count,
    edges_count,
    tiers_data,
    created_by,
    uploaded_by,
    organization
) VALUES (
    '2f9e18a7-f044-4560-a6ce-e3ab9b128adc'::uuid,
    'Plan 4',
    664,
    799,
    '{"0":1,"1":135,"2":528}'::jsonb,
    '6fb76f62-876b-4616-b926-006691742c49'::uuid,
    '6fb76f62-876b-4616-b926-006691742c49'::uuid,
    'Company1'
);