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

    // The project comes from the payload, as it always has, but it is now read
    // ONCE and passed as a scalar: the RPC sets `project_id` and `plant_name`
    // on every row from the PROJECT, so a payload that disagreed with itself
    // can no longer write two projects' rows in one call.
    const projectIds = Array.from(new Set(rows.map((r: any) => r.project_id).filter(Boolean)));
    if (projectIds.length !== 1) {
      return new Response(JSON.stringify({
        success: false,
        error: `rows must belong to exactly one project; got ${projectIds.length}`,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const projectId = projectIds[0] as string;

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
    let updated = 0;

    for (let i = 0; i < sanitized.length; i += BATCH_SIZE) {
      const batch = sanitized.slice(i, i + BATCH_SIZE);
      console.log('[ingest-outbound-logistics] inserting batch', { size: batch.length, i });
      // WP 4.1 — D36 CLOSED HERE, AND IT IS NOT THE ONE-LINE FIX.
      // The write goes through an RPC that takes the actor as a PARAMETER and
      // sets `app.current_user_id` LOCAL to its own transaction, so the tier-2
      // audit trigger sees it. A `.upsert()` over PostgREST cannot do that: the
      // GUC would have to survive into a different statement on a pooled
      // connection, which `projectLanes.ts`'s header records that it does not.
      //
      // THREE OTHER THINGS MOVE WITH IT, and they are the reason this is worth
      // more than an audit column:
      //   * the natural key is no longer spelled here. `ingest_legacy_upsert_lane`
      //     reads the arbiter from `pg_index`, so there is ONE copy of the key
      //     and it cannot drift from the index `ON CONFLICT` infers from;
      //   * the RPC AUTHENTICATES and does not AUTHORIZE. An earlier draft
      //     refused below project role `editor` and it came out: an
      //     organization admin who is not a project member resolves to NULL
      //     from `effective_project_role`, and `combine-project` has always
      //     permitted that user — see `20260917000005`. This function keeps
      //     the authorization it already had; making `min_project_role` the
      //     one live answer is D66, and WP 6.2's;
      //   * `no-tier-skip` (I2) stops being a property of this file. While this
      //     function held a PostgREST client it was one `.upsert()` away from
      //     any tier-2 table in the schema. Now the set it can reach is a
      //     whitelist in a migration.
      // One statement for the whole batch, so the statement-grain audit writes
      // ONE row saying "n rows" rather than n rows saying one (WP 2.3).
      const { data: written, error } = await supabase.rpc('ingest_legacy_upsert_lane', {
        _project_id: projectId,
        _actor_user_id: userId,
        _target: 'outbound_logistics',
        _rows: batch,
      });
      if (error) {
        console.error('[ingest-outbound-logistics] insert error', error);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // THE COUNT COMES FROM THE STATEMENT, not from the batch length. The two
      // differ whenever a batch carries the same natural key twice — the upsert
      // folds those to one row — and reporting the input size as the number
      // written is a number with no source (§5 T1).
      inserted += Number((written as { rows_written?: number } | null)?.rows_written ?? 0);
      updated  += Number((written as { rows_updated?: number } | null)?.rows_updated ?? 0);
      // small delay to ease load
      if (i + BATCH_SIZE < sanitized.length) {
        await new Promise((res) => setTimeout(res, 150));
      }
    }

    return new Response(JSON.stringify({ success: true, inserted, updated }), {
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