import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SimulationRequest {
  project_id: string;
  scenario_ids: string[];
  config?: {
    baseline_enabled?: boolean;
    priority?: number;
    simulation_days?: number;
    convergence_threshold?: number;
  };
  user_id: string;
  user_email: string;
  current_magnitudes?: { [scenario_id: string]: number };
  availability_check?: boolean; // Indicates baseline simulation
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { 
      project_id, 
      scenario_ids, 
      config = {}, 
      user_id, 
      user_email,
      current_magnitudes = {},
      availability_check = false
    }: SimulationRequest = await req.json();

    console.log('[simulation-runner] Starting simulation:', { project_id, scenario_ids, config, current_magnitudes });

    // Set user context for RLS
    await supabase.rpc('set_current_user_context', {
      user_id: user_id,
      user_email: user_email
    });

    // 1. Validate project access and get project data
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', project_id)
      .single();

    if (projectError || !project) {
      throw new Error(`Project not found: ${projectError?.message}`);
    }

    // 2. Get supply chain data for simulation
    console.log('[simulation-runner] Fetching supply chain data for project:', project_id);
    const { data: supplyChainData, error: dataError } = await supabase
      .rpc('get_supply_chain_data', {
        p_project_id: project_id,
        p_plant_name: project.plant_name,
        p_user_id: user_id,
        p_user_email: user_email
      });

    if (dataError) {
      console.error('[simulation-runner] Supply chain data error:', dataError);
      throw new Error(`Failed to fetch supply chain data: ${dataError.message}`);
    }

    console.log('[simulation-runner] Retrieved supply chain data:', supplyChainData?.length, 'records');

    // Fetch scenario details with magnitudes for job tracking
    const scenarioDetails = await fetchScenarioDetails(supabase, scenario_ids, current_magnitudes);

    // Determine job type based on availability_check parameter
    const jobType = availability_check ? 'baseline' : 'scenarios';

    // Create job only (no simulation result yet - external-simulation-processor will create it)
    const { data: simulationJob, error: jobError } = await supabase
      .from('simulation_jobs')
      .insert({
        project_id,
        job_type: jobType,
        status: 'queued',
        priority: config.priority ?? 1,
        config: { 
          simulation_days: config.simulation_days ?? 60,
          convergence_threshold: config.convergence_threshold ?? 0.001,
          scenario_details: scenarioDetails
        },
        scenario_ids,
        baseline_enabled: availability_check,
        estimated_duration_seconds: 60,
        created_by: user_id,
        organization: project.organization
      })
      .select()
      .single();

    if (jobError) {
      throw new Error(`Failed to create simulation job: ${jobError.message}`);
    }

    console.log('[simulation-runner] Created job:', simulationJob.id);

    // Store magnitude snapshots for future availability checking
    await storeMagnitudeSnapshots(supabase, simulationJob.id, project_id, scenarioDetails);

    // Call external-simulation-processor to handle the actual simulation
    EdgeRuntime.waitUntil(callExternalSimulationProcessor(supabase, simulationJob, project));

    return new Response(
      JSON.stringify({
        success: true,
        job_id: simulationJob.id,
        status: 'queued',
        estimated_duration_seconds: 60
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[simulation-runner] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.stack 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

// Call external-simulation-processor edge function to handle the simulation
async function callExternalSimulationProcessor(
  supabase: any,
  simulationJob: any,
  project: any
) {
  try {
    console.log('[simulation-runner] Calling external-simulation-processor for job:', simulationJob.id);

    // Call the external-simulation-processor edge function
    const { data, error } = await supabase.functions.invoke('external-simulation-processor', {
      body: {
        job_id: simulationJob.id,
        project_id: simulationJob.project_id,
        organization: project.organization
      }
    });

    if (error) {
      console.error('[simulation-runner] External processor error:', error);
      
      // Update job status to failed
      await supabase
        .from('simulation_jobs')
        .update({
          status: 'failed',
          error_message: error.message,
          error_details: { error: error.message, timestamp: new Date().toISOString() },
          completed_at: new Date().toISOString()
        })
        .eq('id', simulationJob.id);
    } else {
      console.log('[simulation-runner] External processor completed successfully:', data);
    }

  } catch (error) {
    console.error('[simulation-runner] Failed to call external processor:', error);
    
    // Update job status to failed
    await supabase
      .from('simulation_jobs')
      .update({
        status: 'failed',
        error_message: error.message,
        error_details: { error: error.message, stack: error.stack, timestamp: new Date().toISOString() },
        completed_at: new Date().toISOString()
      })
      .eq('id', simulationJob.id);
  }
}

// Note: Synthetic data generation functions removed - now using external ML API

// Fetch scenario details with current magnitudes for job tracking
async function fetchScenarioDetails(supabase: any, scenario_ids: string[], current_magnitudes: { [key: string]: number }) {
  const details = [];
  
  for (const scenario_id of scenario_ids) {
    // Get scenario profile
    const { data: profile } = await supabase
      .from('disruption_scenario_profiles')
      .select('scenario_name, description, status')
      .eq('id', scenario_id)
      .single();
    
    // Get scenario effects with current magnitudes
    const { data: effects } = await supabase
      .from('disruption_scenario_effects')
      .select('effect_type, magnitude, unit')
      .eq('profile_id', scenario_id)
      .order('effect_type');
    
    // Use current UI magnitude if provided, otherwise use DB value
    const updatedEffects = (effects || []).map(effect => ({
      ...effect,
      magnitude: current_magnitudes[scenario_id] !== undefined ? current_magnitudes[scenario_id] : effect.magnitude,
      magnitude_source: current_magnitudes[scenario_id] !== undefined ? 'ui_current' : 'database'
    }));
    
    details.push({
      scenario_id,
      scenario_name: profile?.scenario_name || `Scenario ${scenario_id}`,
      description: profile?.description,
      status: profile?.status,
      effects: updatedEffects,
      ui_magnitude_override: current_magnitudes[scenario_id]
    });
  }
  
  return details;
}

// Store magnitude snapshots for future availability checking
async function storeMagnitudeSnapshots(supabase: any, job_id: string, project_id: string, scenarioDetails: any[]) {
  try {
    const magnitudeRecords = [];
    
    for (const scenario of scenarioDetails) {
      for (const effect of scenario.effects) {
        magnitudeRecords.push({
          job_id,
          project_id,
          scenario_id: scenario.scenario_id,
          magnitude: effect.magnitude,
          magnitude_source: effect.magnitude_source,
          effect_type: effect.effect_type,
          unit: effect.unit
        });
      }
    }
    
    if (magnitudeRecords.length > 0) {
      const { error } = await supabase
        .from('simulation_job_magnitudes')
        .insert(magnitudeRecords);
      
      if (error) {
        console.error('[simulation-runner] Failed to store magnitude snapshots:', error);
        // Don't throw - this is not critical for simulation execution
      } else {
        console.log(`[simulation-runner] Stored ${magnitudeRecords.length} magnitude snapshots for job ${job_id}`);
      }
    }
  } catch (error) {
    console.error('[simulation-runner] Error storing magnitude snapshots:', error);
    // Don't throw - this is not critical for simulation execution
  }
}