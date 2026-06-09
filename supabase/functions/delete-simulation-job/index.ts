import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type DeleteRequest = {
  job_id?: string;
  user_id?: string;
  user_email?: string;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { job_id, user_id, user_email }: DeleteRequest = await req.json();

    if (!job_id || !user_id || !user_email) {
      return new Response(
        JSON.stringify({ success: false, error: 'missing_parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1) Verify user exists and capture role/org
    const { data: userRow, error: userErr } = await supabase
      .from('approved_users')
      .select('id, email, role, organization')
      .eq('id', user_id)
      .eq('email', user_email)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!userRow) {
      return new Response(
        JSON.stringify({ success: false, error: 'unauthorized_user' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2) Fetch job
    const { data: job, error: jobErr } = await supabase
      .from('simulation_jobs')
      .select('id, project_id, simulation_result_id')
      .eq('id', job_id)
      .maybeSingle();

    if (jobErr) throw jobErr;
    if (!job) {
      return new Response(
        JSON.stringify({ success: false, error: 'job_not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3) Fetch project and authorize
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('id, modeler_id, organization')
      .eq('id', job.project_id)
      .maybeSingle();

    if (projErr) throw projErr;
    if (!project) {
      return new Response(
        JSON.stringify({ success: false, error: 'project_not_found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (project.organization !== userRow.organization) {
      return new Response(
        JSON.stringify({ success: false, error: 'forbidden_wrong_org' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isAdmin = (userRow.role as string) === 'admin';
    const isOwner = project.modeler_id === user_id;
    if (!isAdmin && !isOwner) {
      return new Response(
        JSON.stringify({ success: false, error: 'forbidden_not_owner' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4) Cleanup related records (best-effort)
    const deletes: Record<string, number | null> = {
      performance_metrics_deleted: null,
      magnitudes_deleted: null,
      results_deleted: null,
      jobs_deleted: null,
    };

    // Delete performance metrics linked to this job
    const { count: perfCount, error: perfErr } = await supabase
      .from('simulation_performance_metrics')
      .delete({ count: 'exact' })
      .eq('simulation_job_id', job.id)
      .eq('project_id', project.id);
    if (perfErr) {
      console.warn('[delete-simulation-job] perf delete error:', perfErr);
    }
    deletes.performance_metrics_deleted = perfCount ?? 0;

    // Delete magnitudes linked to this job
    const { count: magCount, error: magErr } = await supabase
      .from('simulation_job_magnitudes')
      .delete({ count: 'exact' })
      .eq('job_id', job.id)
      .eq('project_id', project.id);
    if (magErr) {
      console.warn('[delete-simulation-job] magnitudes delete error:', magErr);
    }
    deletes.magnitudes_deleted = magCount ?? 0;

    // Delete simulation result if exists
    if (job.simulation_result_id) {
      const { count: resCount, error: resErr } = await supabase
        .from('simulation_results')
        .delete({ count: 'exact' })
        .eq('id', job.simulation_result_id)
        .eq('project_id', project.id);
      if (resErr) {
        console.warn('[delete-simulation-job] results delete error:', resErr);
      }
      deletes.results_deleted = resCount ?? 0;
    }

    // Finally delete the job
    const { count: jobCount, error: jobDelErr } = await supabase
      .from('simulation_jobs')
      .delete({ count: 'exact' })
      .eq('id', job.id);
    if (jobDelErr) throw jobDelErr;
    deletes.jobs_deleted = jobCount ?? 0;

    return new Response(
      JSON.stringify({ success: true, deletes }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[delete-simulation-job] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
