// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[combine-project-into-supply-chain] DEPRECATED: This function is now a proxy to combine-project');
    
    const body = await req.json();
    const { project_id, user_id, user_email } = body;

    if (!project_id || !user_id || !user_email) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: project_id, user_id, user_email' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Proxy to the unified combine-project function in sync mode
    console.log(`[combine-project-into-supply-chain] Proxying to combine-project for project ${project_id}`);
    
    const { data, error } = await supabase.functions.invoke('combine-project', {
      body: {
        project_id,
        user_id,
        user_email,
        sync: true // Force sync mode for backward compatibility
      },
      headers: {
        Authorization: req.headers.get('Authorization') || ''
      }
    });

    if (error) {
      console.error(`[combine-project-into-supply-chain] Proxy error:`, error);
      return new Response(
        JSON.stringify({ error: error.message ?? error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[combine-project-into-supply-chain] Proxy completed successfully for project ${project_id}`);

    // Return the response in the same format as the original function
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Project data combined successfully',
        total_records: data?.total_records || 0,
        project_id
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[combine-project-into-supply-chain] Proxy Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});