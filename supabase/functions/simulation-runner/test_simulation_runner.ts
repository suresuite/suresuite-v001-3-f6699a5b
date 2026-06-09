// Test file for simulation-runner edge function
// This verifies that created_by and organization are properly set

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

Deno.test("simulation-runner creates job with correct created_by and organization", async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  // Test data
  const testUserId = '550e8400-e29b-41d4-a716-446655440000'; // Mock UUID
  const testUserEmail = 'test@example.com';
  const testProjectId = '550e8400-e29b-41d4-a716-446655440001'; // Mock UUID
  const testOrganization = 'test_org';
  
  try {
    // 1. Create a test project with known organization
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        id: testProjectId,
        name: 'Test Project for Simulation',
        plant_name: 'Test Plant',
        supply_chain_model: 'Make-To-Order',
        modeler_id: testUserId,
        organization: testOrganization,
        completed: true
      })
      .select()
      .single();

    if (projectError) {
      console.log('Project creation error (might already exist):', projectError.message);
    }

    // 2. Create some minimal supply chain data
    await supabase
      .from('supply_chain_data')
      .insert([
        {
          project_id: testProjectId,
          data_source: 'inbound',
          plant_name: 'Test Plant',
          from_location: 'Supplier1',
          to_location: 'Material1',
          material_consumption_rate: 1.0,
          organization: testOrganization,
          uploaded_by: testUserId
        }
      ]);

    // 3. Call the simulation-runner function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/simulation-runner`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        project_id: testProjectId,
        scenario_ids: [], // Empty for baseline only
        config: {
          baseline_enabled: true,
          priority: 1,
          simulation_days: 30
        },
        user_id: testUserId,
        user_email: testUserEmail
      })
    });

    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(`Function call failed: ${JSON.stringify(result)}`);
    }

    assertEquals(result.success, true);
    console.log('Simulation job created:', result.job_id);

    // 4. Verify the simulation_jobs record has correct created_by and organization
    const { data: simulationJob, error: jobError } = await supabase
      .from('simulation_jobs')
      .select('created_by, organization, project_id')
      .eq('id', result.job_id)
      .single();

    if (jobError) {
      throw new Error(`Failed to fetch simulation job: ${jobError.message}`);
    }

    // Assert the fields are correctly set
    assertEquals(simulationJob.created_by, testUserId, 'created_by should match user_id');
    assertEquals(simulationJob.organization, testOrganization, 'organization should match project organization');
    assertEquals(simulationJob.project_id, testProjectId, 'project_id should match');

    console.log('✅ Test passed: simulation_jobs record has correct created_by and organization');

  } finally {
    // Cleanup: Remove test data
    await supabase.from('simulation_jobs').delete().eq('project_id', testProjectId);
    await supabase.from('simulation_results').delete().eq('project_id', testProjectId);
    await supabase.from('supply_chain_data').delete().eq('project_id', testProjectId);
    await supabase.from('projects').delete().eq('id', testProjectId);
  }
});