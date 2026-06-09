import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  project_id: string;
  user_id: string;
  user_email: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    )

    const { project_id, user_id, user_email }: RequestBody = await req.json()

    if (!project_id || !user_id || !user_email) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('📡 Fetching multi-tier network data for:', {
      project_id,
      user_id,
      user_email
    })

    // Set user context for RLS
    await supabaseClient.rpc('set_current_user_context', {
      user_id: user_id,
      user_email: user_email
    })

    // Query multi-tier data
    const { data, error } = await supabaseClient
      .from('supply_chain_data_multi_tier')
      .select('*')
      .eq('project_id', project_id)
      .order('level', { ascending: true })

    if (error) {
      console.error('❌ Database error:', error)
      throw error
    }

    console.log('✅ Retrieved multi-tier data:', {
      recordCount: data?.length || 0,
      levels: data ? [...new Set(data.map(d => d.level))].sort() : []
    })

    return new Response(
      JSON.stringify(data || []),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )

  } catch (error) {
    console.error('❌ Function error:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})