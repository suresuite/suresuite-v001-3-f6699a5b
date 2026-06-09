import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AvailabilityRequest {
  project_id: string;
  scenario_ids: string[];
  user_id: string;
  user_email: string;
  current_magnitudes?: { [scenario_id: string]: number }; // Current UI magnitude values
}

interface AvailabilityResponse {
  baseline_available: boolean;
  scenarios_available: boolean;
  baseline_result_id?: string;
  scenario_result_ids?: string[];
  baseline_cache_key?: string;
  message: string;
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
      user_id, 
      user_email,
      current_magnitudes = {}
    }: AvailabilityRequest = await req.json();

    console.log('[availability-checker] Checking availability for:', { project_id, scenario_ids, current_magnitudes });

    // Set user context for RLS
    await supabase.rpc('set_current_user_context', {
      user_id,
      user_email
    });

    // 1. Validate project access
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', project_id)
      .single();

    if (projectError || !project) {
      throw new Error(`Project not found: ${projectError?.message}`);
    }

    // 2. Generate baseline cache key (only depends on supply chain data structure)
    const supplyChainHash = await generateSupplyChainHash(supabase, project_id, user_id, user_email);
    const baselineKey = `baseline_${project_id}_${supplyChainHash}`;

    // 3. Check for existing baseline simulation results
    const { data: baselineResult } = await supabase
      .from('simulation_results')
      .select('id, metrics')
      .eq('project_id', project_id)
      .eq('status', 'completed')
      .not('metrics->baseline', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 4. Check simulation cache for baseline (only cache baseline data)
    const { data: baselineCache } = await supabase
      .from('simulation_cache')
      .select('*')
      .eq('project_id', project_id)
      .eq('cache_key', baselineKey)
      .eq('cache_type', 'baseline_data')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    // 5. Check for existing scenario results with matching configurations
    let scenarioResults = null;
    if (scenario_ids.length > 0) {
      // First, get current scenario configurations (use UI values if provided, otherwise DB values)
      const currentScenarios = await fetchCurrentScenarioConfigurations(supabase, scenario_ids, current_magnitudes);
      
      // Look for completed simulation results
      const { data: existingResults } = await supabase
        .from('simulation_results')
        .select('id, scenario_ids, metrics, created_at')
        .eq('project_id', project_id)
        .eq('status', 'completed')
        .not('metrics->scenario', 'is', null)
        .order('created_at', { ascending: false });

      // Find a result that matches our exact scenario configuration
      if (existingResults) {
        for (const result of existingResults) {
          if (await scenarioConfigurationsMatch(supabase, result.scenario_ids, currentScenarios, project_id)) {
            scenarioResults = result;
            break;
          }
        }
      }
    }

    // 6. Determine availability
    const baseline_available = !!(baselineResult || baselineCache);
    const scenarios_available = !!scenarioResults;

    let message = '';
    if (baseline_available && scenarios_available) {
      message = 'Both baseline and scenario results are available';
    } else if (baseline_available) {
      message = 'Baseline is cached, only scenario simulation needed';
    } else {
      message = 'New baseline and scenario simulations needed';
    }

    const response: AvailabilityResponse = {
      baseline_available,
      scenarios_available,
      baseline_result_id: baselineResult?.id,
      scenario_result_ids: scenarioResults ? [scenarioResults.id] : undefined,
      baseline_cache_key: baselineKey,
      message
    };

    console.log('[availability-checker] Result:', response);

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[availability-checker] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        baseline_available: false,
        scenarios_available: false,
        message: 'Error checking availability'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

// Generate a hash for supply chain data to detect changes
async function generateSupplyChainHash(supabase: any, project_id: string, user_id: string, user_email: string) {
  try {
    const { data: supplyChainData } = await supabase
      .rpc('get_supply_chain_data', {
        p_project_id: project_id,
        p_plant_name: null,
        p_user_id: user_id,
        p_user_email: user_email
      });

    // Create a simplified hash based on key supply chain characteristics
    const hashInput = {
      node_count: supplyChainData?.length || 0,
      critical_nodes: supplyChainData?.filter((n: any) => n.is_critical_node).length || 0,
      data_sources: [...new Set(supplyChainData?.map((n: any) => n.data_source) || [])].sort()
    };
    
    return await hashObject(hashInput);
  } catch (error) {
    console.error('Error generating supply chain hash:', error);
    return 'default_hash';
  }
}

// Fetch current scenario configurations including magnitudes
async function fetchCurrentScenarioConfigurations(supabase: any, scenario_ids: string[], current_magnitudes: { [key: string]: number }) {
  const configurations = [];
  
  for (const scenario_id of scenario_ids) {
    const { data: effects } = await supabase
      .from('disruption_scenario_effects')
      .select('effect_type, magnitude, unit')
      .eq('profile_id', scenario_id)
      .order('effect_type');
    
    // Use current UI magnitude if provided, otherwise use DB value
    const updatedEffects = (effects || []).map(effect => ({
      ...effect,
      magnitude: current_magnitudes[scenario_id] !== undefined ? current_magnitudes[scenario_id] : effect.magnitude
    }));
    
    configurations.push({
      scenario_id,
      effects: updatedEffects
    });
  }
  
  console.log('[availability-checker] Current scenario configurations with UI magnitudes:', configurations);
  return configurations;
}

// Check if scenario configurations match exactly
async function scenarioConfigurationsMatch(supabase: any, existingScenarioIds: string[], currentConfigurations: any[], project_id: string) {
  if (!existingScenarioIds || existingScenarioIds.length !== currentConfigurations.length) {
    return false;
  }
  
  // Sort both arrays by scenario_id for comparison
  const sortedExisting = [...existingScenarioIds].sort();
  const sortedCurrent = currentConfigurations.sort((a, b) => a.scenario_id.localeCompare(b.scenario_id));
  
  // Check if scenario IDs match
  for (let i = 0; i < sortedExisting.length; i++) {
    if (sortedExisting[i] !== sortedCurrent[i].scenario_id) {
      return false;
    }
  }
  
  // Get the most recent simulation result for these scenarios to find the job that was used
  const { data: recentResults } = await supabase
    .from('simulation_results')
    .select('id, scenario_ids')
    .eq('project_id', project_id)
    .eq('status', 'completed')
    .contains('scenario_ids', existingScenarioIds)
    .order('completed_at', { ascending: false })
    .limit(1);
  
  if (!recentResults || recentResults.length === 0) {
    return false;
  }
  
  // Find the job associated with this result
  const { data: recentJobs } = await supabase
    .from('simulation_jobs')
    .select('id')
    .eq('simulation_result_id', recentResults[0].id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1);
  
  if (!recentJobs || recentJobs.length === 0) {
    // Fallback to old comparison method if no job found
    return await scenarioConfigurationsMatchLegacy(supabase, existingScenarioIds, currentConfigurations);
  }
  
  // Get the actual magnitudes used in the previous simulation
  const { data: usedMagnitudes } = await supabase
    .from('simulation_job_magnitudes')
    .select('scenario_id, magnitude, effect_type, unit, magnitude_source')
    .eq('job_id', recentJobs[0].id)
    .in('scenario_id', existingScenarioIds)
    .order('scenario_id, effect_type');
  
  if (!usedMagnitudes || usedMagnitudes.length === 0) {
    // Fallback to old comparison method if no magnitude snapshots found
    return await scenarioConfigurationsMatchLegacy(supabase, existingScenarioIds, currentConfigurations);
  }
  
  // Compare current configurations against the actual magnitudes used in the previous simulation
  for (const currentConfig of sortedCurrent) {
    const scenarioUsedMagnitudes = usedMagnitudes.filter(m => m.scenario_id === currentConfig.scenario_id);
    
    if (scenarioUsedMagnitudes.length !== currentConfig.effects.length) {
      return false;
    }
    
    // Sort both by effect_type for comparison
    const sortedUsed = scenarioUsedMagnitudes.sort((a, b) => a.effect_type.localeCompare(b.effect_type));
    const sortedCurrentEffects = currentConfig.effects.sort((a, b) => a.effect_type.localeCompare(b.effect_type));
    
    // Compare effects (type, magnitude, unit)
    for (let i = 0; i < sortedUsed.length; i++) {
      const used = sortedUsed[i];
      const current = sortedCurrentEffects[i];
      
      if (used.effect_type !== current.effect_type ||
          used.unit !== current.unit ||
          Math.abs(parseFloat(used.magnitude) - parseFloat(current.magnitude)) > 0.001) {
        return false;
      }
    }
  }
  
  return true;
}

// Legacy comparison method (fallback for old simulations without magnitude snapshots)
async function scenarioConfigurationsMatchLegacy(supabase: any, existingScenarioIds: string[], currentConfigurations: any[]) {
  // For each existing scenario, check if configuration matches current
  for (const currentConfig of currentConfigurations) {
    const { data: existingEffects } = await supabase
      .from('disruption_scenario_effects')
      .select('effect_type, magnitude, unit')
      .eq('profile_id', currentConfig.scenario_id)
      .order('effect_type');
    
    if (!existingEffects || existingEffects.length !== currentConfig.effects.length) {
      return false;
    }
    
    // Compare effects (type, magnitude, unit)
    for (let i = 0; i < existingEffects.length; i++) {
      const existing = existingEffects[i];
      const current = currentConfig.effects[i];
      
      if (existing.effect_type !== current.effect_type ||
          existing.unit !== current.unit ||
          Math.abs(parseFloat(existing.magnitude) - parseFloat(current.magnitude)) > 0.001) {
        return false;
      }
    }
  }
  
  return true;
}

// Simple hash function for objects
async function hashObject(obj: any): Promise<string> {
  const jsonString = JSON.stringify(obj, Object.keys(obj).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}