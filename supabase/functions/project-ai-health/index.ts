import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('AI Health check requested');
    
    // Check if OpenAI API key is configured
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    const openaiConfigured = Boolean(openAIApiKey);
    
    // Test basic OpenAI connectivity if key exists
    let openaiReachable = false;
    if (openaiConfigured) {
      try {
        const response = await fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
          },
        });
        openaiReachable = response.ok;
      } catch (error) {
        console.log('OpenAI connectivity test failed:', error.message);
        openaiReachable = false;
      }
    }

    const healthStatus = {
      functionUp: true,
      openaiConfigured,
      openaiReachable,
      model: 'gpt-5-2025-08-07',
      timestamp: new Date().toISOString()
    };

    console.log('Health check completed:', healthStatus);

    return new Response(JSON.stringify(healthStatus), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Health check error:', error);
    return new Response(JSON.stringify({
      functionUp: false,
      openaiConfigured: false,
      openaiReachable: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});