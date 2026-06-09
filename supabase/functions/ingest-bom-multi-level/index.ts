import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
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

    // Normalize and validate payload to allowed columns with strict parsing
    const validRows: any[] = [];
    const invalidRows: Array<{ index: number; reason: string }> = [];

    rows.forEach((r: any, idx: number) => {
      const project_id = r.project_id ?? null;
      const plant_name = (r.plant_name ?? '').toString().trim() || null;
      const material_id = (r.material_id ?? '').toString().trim() || null;
      const higher_level_component_id = (r.higher_level_component_id ?? '').toString().trim() || null;

      // Parse level allowing 0
      const rawLevel = r.level ?? r.Level ?? r.bom_level;
      const parsedLevel = (rawLevel === 0 || rawLevel === '0')
        ? 0
        : Number.parseInt((rawLevel ?? '').toString().trim(), 10);

      // Parse consumption_rate (optional)
      const rawRate = r.consumption_rate ?? r.rate ?? null;
      const parsedRate = rawRate === null || rawRate === undefined || rawRate === ''
        ? null
        : Number.parseFloat(rawRate);

      // Required fields check (level can be 0)
      if (!project_id) {
        invalidRows.push({ index: idx, reason: 'Missing project_id' });
        return;
      }
      if (!plant_name) {
        invalidRows.push({ index: idx, reason: 'Missing plant_name' });
        return;
      }
      if (!material_id) {
        invalidRows.push({ index: idx, reason: 'Missing material_id' });
        return;
      }
      if (!Number.isFinite(parsedLevel)) {
        invalidRows.push({ index: idx, reason: 'Invalid level' });
        return;
      }

      validRows.push({
        project_id,
        plant_name,
        material_id,
        higher_level_component_id: higher_level_component_id || null,
        level: parsedLevel,
        consumption_rate: parsedRate,
      });
    });

    if (validRows.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No valid rows to insert', invalid_count: invalidRows.length, invalid_rows: invalidRows.slice(0, 10) }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Batch insert to avoid timeouts
    const BATCH_SIZE = 100;
    let inserted = 0;

    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const batch = validRows.slice(i, i + BATCH_SIZE);
      console.log('[ingest-bom-multi-level] inserting batch', { size: batch.length, i });
      const { error } = await supabase.from('bom_multi_level').insert(batch, { returning: 'minimal' });
      if (error) {
        console.error('[ingest-bom-multi-level] insert error', error);
        return new Response(JSON.stringify({ success: false, error: error.message, inserted, invalid_count: invalidRows.length }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      inserted += batch.length;
      if (i + BATCH_SIZE < validRows.length) {
        await new Promise((res) => setTimeout(res, 150));
      }
    }

    return new Response(JSON.stringify({ success: true, inserted }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[ingest-bom-multi-level] handler error', e);
    return new Response(JSON.stringify({ success: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});