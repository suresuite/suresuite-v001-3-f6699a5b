import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { rows, userId, userEmail } = await req.json();

    if (!Array.isArray(rows) || !rows.length) {
      return new Response(JSON.stringify({ success: false, error: 'rows must be a non-empty array' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!userId || !userEmail) {
      return new Response(JSON.stringify({ success: false, error: 'Missing userId or userEmail' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Basic validation + normalize payload to only allowed columns
    const sanitized = rows.map((r: any) => ({
      customer_id: r.customer_id ?? null,
      product_id: r.product_id ?? null,
      volume: r.volume ?? null,
      time_unit: r.time_unit ?? null,
      expected_lead_time: r.expected_lead_time ?? null,
      unit_price: r.unit_price ?? null,
      plant_name: r.plant_name ?? null,
      project_id: r.project_id ?? null,
    }));

    // Insert in small batches to avoid timeouts
    const BATCH_SIZE = 100;
    let inserted = 0;

    for (let i = 0; i < sanitized.length; i += BATCH_SIZE) {
      const batch = sanitized.slice(i, i + BATCH_SIZE);
      console.log('[ingest-outbound-logistics] inserting batch', { size: batch.length, i });
      const { error } = await supabase.from('outbound_logistics').insert(batch, { returning: 'minimal' });
      if (error) {
        console.error('[ingest-outbound-logistics] insert error', error);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      inserted += batch.length;
      // small delay to ease load
      if (i + BATCH_SIZE < sanitized.length) {
        await new Promise((res) => setTimeout(res, 150));
      }
    }

    return new Response(JSON.stringify({ success: true, inserted }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[ingest-outbound-logistics] handler error', e);
    return new Response(JSON.stringify({ success: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});