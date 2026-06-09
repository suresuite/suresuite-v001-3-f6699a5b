import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StatusRequest {
  project_id?: string;
  job_id?: string;
  simulation_result_id?: string;
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
      job_id, 
      simulation_result_id 
    }: StatusRequest = await req.json();

    let jobs = [];

    if (job_id) {
      // Get specific job status with linked simulation result
      const { data: jobData, error: jobError } = await supabase
        .from('simulation_jobs')
        .select(`
          *,
          simulation_performance_metrics(*),
          simulation_results(*)
        `)
        .eq('id', job_id)
        .single();

      if (jobError) {
        throw new Error(`Failed to fetch job: ${jobError.message}`);
      }
      
      jobs = [jobData];
    } else if (simulation_result_id) {
      // Get jobs for specific simulation result with linked simulation result
      const { data: jobData, error: jobError } = await supabase
        .from('simulation_jobs')
        .select(`
          *,
          simulation_performance_metrics(*),
          simulation_results(*)
        `)
        .eq('simulation_result_id', simulation_result_id)
        .order('created_at', { ascending: false });

      if (jobError) {
        throw new Error(`Failed to fetch jobs: ${jobError.message}`);
      }
      
      jobs = jobData || [];
    } else if (project_id) {
      // Get all jobs for project with linked simulation results - NO RLS filtering
      const { data: jobData, error: jobError } = await supabase
        .from('simulation_jobs')
        .select(`
          *,
          simulation_performance_metrics(*),
          simulation_results(*)
        `)
        .eq('project_id', project_id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (jobError) {
        throw new Error(`Failed to fetch project jobs: ${jobError.message}`);
      }
      
      jobs = jobData || [];
    }

    // Get queue statistics for the project
    const { data: queueStats } = await supabase
      .from('simulation_jobs')
      .select('status')
      .eq('project_id', project_id || jobs[0]?.project_id)
      .in('status', ['pending', 'queued', 'running']);

    const queueInfo = {
      pending: queueStats?.filter(job => job.status === 'pending').length || 0,
      queued: queueStats?.filter(job => job.status === 'queued').length || 0,
      running: queueStats?.filter(job => job.status === 'running').length || 0
    };

    // Calculate performance insights
    const performanceInsights = calculatePerformanceInsights(jobs);

    return new Response(
      JSON.stringify({
        success: true,
        jobs: jobs.map(job => ({
          ...job,
          estimated_remaining_seconds: calculateRemainingTime(job),
          performance_summary: summarizeJobPerformance(job)
        })),
        queue_info: queueInfo,
        performance_insights: performanceInsights
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[simulation-status] Error:', error);
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

function calculateRemainingTime(job: any): number | null {
  if (job.status !== 'running' || !job.started_at) return null;
  
  const elapsed = (Date.now() - new Date(job.started_at).getTime()) / 1000;
  const progress = job.progress || 0;
  
  if (progress <= 0) return job.estimated_duration_seconds || null;
  
  const estimatedTotal = elapsed / (progress / 100);
  return Math.max(0, estimatedTotal - elapsed);
}

function summarizeJobPerformance(job: any): any {
  const metrics = job.simulation_performance_metrics?.[0];
  if (!metrics) return null;

  return {
    execution_time: metrics.execution_time_seconds,
    cache_efficiency: metrics.cache_hit_ratio,
    resource_usage: {
      memory_mb: metrics.memory_usage_mb,
      cpu_percent: metrics.cpu_usage_percent
    },
    service_calls: metrics.python_service_calls,
    database_queries: metrics.database_queries
  };
}

function calculatePerformanceInsights(jobs: any[]): any {
  const completedJobs = jobs.filter(job => 
    job.status === 'completed' && job.simulation_performance_metrics?.length > 0
  );

  if (completedJobs.length === 0) {
    return {
      average_execution_time: null,
      cache_hit_rate: null,
      success_rate: null,
      throughput: null
    };
  }

  const totalJobs = jobs.length;
  const successfulJobs = jobs.filter(job => job.status === 'completed').length;
  const totalExecutionTime = completedJobs.reduce((sum, job) => 
    sum + (job.simulation_performance_metrics[0]?.execution_time_seconds || 0), 0
  );
  const totalCacheHits = completedJobs.reduce((sum, job) => 
    sum + (job.simulation_performance_metrics[0]?.cache_hit_ratio || 0), 0
  );

  return {
    average_execution_time: totalExecutionTime / completedJobs.length,
    cache_hit_rate: totalCacheHits / completedJobs.length,
    success_rate: successfulJobs / totalJobs,
    throughput: completedJobs.length, // jobs completed
    recent_performance: completedJobs.slice(0, 5).map(job => ({
      job_id: job.id,
      execution_time: job.simulation_performance_metrics[0]?.execution_time_seconds,
      status: job.status,
      created_at: job.created_at
    }))
  };
}