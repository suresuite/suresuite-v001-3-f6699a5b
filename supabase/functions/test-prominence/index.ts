import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { project_id } = await req.json();

    if (!project_id) {
      return new Response(JSON.stringify({ error: 'Project ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`🧪 Testing prominence calculation for project: ${project_id}`);

    // Call the prominence calculation function directly
    const { data, error } = await supabaseClient.functions.invoke('calculate-node-prominence', {
      body: { project_id }
    });

    if (error) {
      console.error('❌ Error calling prominence function:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('✅ Prominence calculation result:', data);

    // Check how many nodes now have prominence values
    const { data: nodeCheck, error: nodeError } = await supabaseClient
      .from('network_nodes')
      .select('prominence')
      .eq('project_id', project_id)
      .not('prominence', 'is', null);

    if (nodeError) {
      console.error('❌ Error checking node prominence:', nodeError);
    } else {
      console.log(`📊 Nodes with prominence: ${nodeCheck?.length || 0}`);
    }

    return new Response(JSON.stringify({
      success: true,
      prominence_result: data,
      nodes_with_prominence: nodeCheck?.length || 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in test-prominence function:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      details: error.stack 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});