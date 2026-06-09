import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ExternalSimulationResponse {
  job_id: string;
  status: string;
  kpis: {
    fill_rate: number;
    revenue: number;
    average_fill_rate: number;
    total_demand: number;
    total_produced: number;
    result_data: string;
    metrics: string;
    audit_summary: {
      orders_placed: number;
      production_events: number;
      total_units_produced: number;
      disruptions_recorded: number;
      inventory_changes: number;
      material_consumption_events: number;
      total_materials_consumed: number;
    };
    simulation_version: string;
    kpi_calculation_version: string;
    production_validation_enabled: boolean;
    revenue_validation_enabled: boolean;
  };
  summary: {
    simulation_engine_version: string;
    weeks_simulated: number;
    orders_placed: number;
    productions_completed: number;
    avg_fill_rate: number;
  };
  metadata: {
    response_type: string;
    note: string;
    generated_at: string;
  };
}

interface RequestPayload {
  job_id: string;
  project_id: string;
  organization: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id, project_id, organization }: RequestPayload = await req.json();

    console.log(`Processing external simulation for job ${job_id}, project ${project_id}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://wckdrutwkytwcomrlpib.supabase.co';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Update job status to running
    await supabase
      .from('simulation_jobs')
      .update({ 
        status: 'running',
        started_at: new Date().toISOString()
      })
      .eq('id', job_id);

    console.log(`Updated job ${job_id} status to running`);

    // Call external simulation API
    const externalApiUrl = `https://sc-sim-api-brbl.onrender.com/simulate/${job_id}`;
    console.log(`Calling external API: ${externalApiUrl}`);

    const apiResponse = await fetch(externalApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!apiResponse.ok) {
      throw new Error(`External API returned ${apiResponse.status}: ${apiResponse.statusText}`);
    }

    const simulationData: ExternalSimulationResponse = await apiResponse.json();
    console.log(`Received simulation data for job ${job_id}`);

    // Parse the stringified JSON fields
    let parsedMetrics = {};
    let parsedResultData = {};

    try {
      parsedMetrics = JSON.parse(simulationData.kpis.metrics);
    } catch (error) {
      console.warn('Failed to parse metrics JSON:', error);
      parsedMetrics = { error: 'Failed to parse metrics' };
    }

    try {
      parsedResultData = JSON.parse(simulationData.kpis.result_data);
    } catch (error) {
      console.warn('Failed to parse result_data JSON:', error);
      parsedResultData = { error: 'Failed to parse result_data' };
    }

    // Extract and calculate kpi_values summary from the ML API response
    let baselineKpiValues = {};
    let scenarioKpiValues = {};
    
    try {
      // First try to extract existing kpi_values
      const extractedKpiValues = simulationData.kpi_values || 
                                parsedResultData.kpi_values || 
                                parsedMetrics.kpi_values || 
                                simulationData.kpis?.kpi_values ||
                                {};
      
      // Extract baseline and scenario kpi_values
      baselineKpiValues = parsedMetrics.baseline?.kpi_values || extractedKpiValues;
      scenarioKpiValues = parsedMetrics.scenario?.kpi_values || extractedKpiValues;
      
      console.log('Initial baseline kpi_values:', baselineKpiValues);
      console.log('Initial scenario kpi_values:', scenarioKpiValues);
      
      // If kpi_values are empty, calculate from time series data
      if (Object.keys(baselineKpiValues).length === 0 && parsedMetrics.baseline?.kpi_time_series) {
        console.log('Calculating baseline KPI summaries from time series data...');
        baselineKpiValues = calculateKpiSummariesFromTimeSeries(parsedMetrics.baseline.kpi_time_series);
        console.log('Calculated baseline kpi_values:', baselineKpiValues);
      }
      
      if (Object.keys(scenarioKpiValues).length === 0 && parsedMetrics.scenario?.kpi_time_series) {
        console.log('Calculating scenario KPI summaries from time series data...');
        scenarioKpiValues = calculateKpiSummariesFromTimeSeries(parsedMetrics.scenario.kpi_time_series);
        console.log('Calculated scenario kpi_values:', scenarioKpiValues);
      }
      
    } catch (error) {
      console.warn('Failed to extract kpi_values:', error);
    }
    
    // Helper function to calculate KPI summaries from time series
    function calculateKpiSummariesFromTimeSeries(timeSeriesData: any): any {
      const summaries: any = {};
      
      if (!timeSeriesData || typeof timeSeriesData !== 'object') {
        return summaries;
      }
      
      for (const [kpiName, timeSeries] of Object.entries(timeSeriesData)) {
        if (Array.isArray(timeSeries) && timeSeries.length > 0) {
          if (kpiName === 'fill_rate') {
            // Calculate average fill rate (convert strings to numbers)
            const values = (timeSeries as any[]).map(item => {
              const value = typeof item.value === 'string' ? parseFloat(item.value) : item.value;
              return isNaN(value) ? 0 : value;
            });
            const sum = values.reduce((acc, val) => acc + val, 0);
            summaries[kpiName] = values.length > 0 ? sum / values.length : 0;
          } else if (kpiName === 'revenue') {
            // Calculate total revenue
            const sum = (timeSeries as any[]).reduce((acc, item) => {
              const value = typeof item.value === 'string' ? parseFloat(item.value) : item.value;
              return acc + (isNaN(value) ? 0 : value);
            }, 0);
            summaries[kpiName] = sum;
          } else {
            // For other KPIs, use the final value or average
            const finalItem = (timeSeries as any[])[timeSeries.length - 1];
            const finalValue = typeof finalItem?.value === 'string' ? parseFloat(finalItem.value) : finalItem?.value;
            summaries[kpiName] = isNaN(finalValue) ? 0 : finalValue;
          }
        }
      }
      
      return summaries;
    }

    // Transform external API response to internal format
    const transformedMetrics = {
      baseline: {
        ...parsedMetrics.baseline || {},
        kpi_values: baselineKpiValues  // Add calculated summary values to baseline
      },
      scenario: {
        ...parsedMetrics.scenario || {},
        kpi_values: scenarioKpiValues  // Add calculated summary values to scenario
      },
      simulation_period: {
        start_day: 0,
        end_day: simulationData.summary.weeks_simulated * 7 || 60
      },
      available_kpis: ['fill_rate', 'revenue'],
      // Include additional data from external API
      audit_summary: simulationData.kpis.audit_summary,
      simulation_version: simulationData.kpis.simulation_version,
      kpi_calculation_version: simulationData.kpis.kpi_calculation_version,
      production_validation_enabled: simulationData.kpis.production_validation_enabled,
      revenue_validation_enabled: simulationData.kpis.revenue_validation_enabled,
      external_api_metadata: simulationData.metadata,
      summary: simulationData.summary,
      raw_result_data: parsedResultData
    };

    // Get project and plant information
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('plant_name')
      .eq('id', project_id)
      .single();

    if (projectError) {
      throw new Error(`Failed to get project data: ${projectError.message}`);
    }

    // Get job data to get scenario_ids and user info for proper context
    const { data: jobData, error: jobDataError } = await supabase
      .from('simulation_jobs')
      .select('scenario_ids, created_by')
      .eq('id', job_id)
      .single();

    if (jobDataError) {
      console.warn('Failed to get job data:', jobDataError.message);
    }

    // Get user email for context setting (optional, can be null)
    let userEmail = null;
    if (jobData?.created_by) {
      const { data: userData } = await supabase
        .from('approved_users')
        .select('email')
        .eq('id', jobData.created_by)
        .single();
      userEmail = userData?.email;
    }

    // Set user context so RLS and triggers work properly
    if (jobData?.created_by) {
      console.log(`Setting user context for user ${jobData.created_by}`);
      await supabase.rpc('set_current_user_context', {
        user_id: jobData.created_by,
        user_email: userEmail || ''
      });
    }

    // Check if job already has a simulation result (idempotency check)
    const { data: jobWithResult } = await supabase
      .from('simulation_jobs')
      .select('simulation_result_id')
      .eq('id', job_id)
      .single();

    let simulationResult;

    if (jobWithResult?.simulation_result_id) {
      // Result already exists, update it instead of creating a new one
      console.log(`Updating existing simulation result ${jobWithResult.simulation_result_id}`);
      
      const { data: updatedResult, error: updateError } = await supabase
        .from('simulation_results')
        .update({
          status: simulationData.status,
          completed_at: simulationData.status === 'completed' ? new Date().toISOString() : null,
          metrics: transformedMetrics,
        })
        .eq('id', jobWithResult.simulation_result_id)
        .select()
        .single();

      if (updateError) {
        throw new Error(`Failed to update simulation result: ${updateError.message}`);
      }
      
      simulationResult = updatedResult;
    } else {
      // Create new simulation result record
      const { data: newResult, error: resultError } = await supabase
        .from('simulation_results')
        .insert({
          project_id,
          plant_name: projectData.plant_name,
          status: simulationData.status,
          scenario_ids: jobData?.scenario_ids || [],
          started_at: new Date().toISOString(),
          completed_at: simulationData.status === 'completed' ? new Date().toISOString() : null,
          metrics: transformedMetrics,
          organization,
          created_by: jobData?.created_by
        })
        .select()
        .single();

      if (resultError) {
        throw new Error(`Failed to create simulation result: ${resultError.message}`);
      }
      
      simulationResult = newResult;
    }

    console.log(`Processed simulation result ${simulationResult.id}`);

    // Update job status and link to simulation result
    const jobStatus = simulationData.status === 'completed' ? 'completed' : 'failed';
    await supabase
      .from('simulation_jobs')
      .update({ 
        status: jobStatus,
        completed_at: jobStatus === 'completed' ? new Date().toISOString() : null,
        simulation_result_id: simulationResult.id,
        error_message: jobStatus === 'failed' ? 'External simulation failed' : null
      })
      .eq('id', job_id);

    console.log(`Updated job ${job_id} status to ${jobStatus}`);

    return new Response(JSON.stringify({
      success: true,
      job_id,
      simulation_result_id: simulationResult.id,
      status: jobStatus
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in external simulation processor:', error);

    // Try to update job status to failed
    try {
      const { job_id } = await req.json();
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://wckdrutwkytwcomrlpib.supabase.co';
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      await supabase
        .from('simulation_jobs')
        .update({ 
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: error.message,
          error_details: { error: error.message, stack: error.stack }
        })
        .eq('id', job_id);
    } catch (updateError) {
      console.error('Failed to update job status:', updateError);
    }

    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});