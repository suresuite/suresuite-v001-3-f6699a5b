import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { completeRun, failRun, getOrStart } from "../_shared/analysisStore.ts";
import {
  CRITICAL_NODES_METHOD,
  type LaneRow,
  resolveThreshold,
  scoreCriticalNodes,
} from "../_shared/criticalNodes.ts";

/**
 * WP 4.3 · part of the store's key. Bump when the prediction changes.
 * §4 D307 — `critical_nodes@d307.1`: one score per NODE by demand at risk,
 * mirrored onto `node_list`. It was `critical_nodes@wp101.1`, a connectivity
 * blend over lane rows.
 */
const CODE_VERSION = 'critical_nodes@d307.1';

/** §4 D200 — one request is complete only below the server's max_rows, so page. */
const PAGE = 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const body = await req.json().catch(() => ({}));
    const project_id: string | undefined = body.project_id;
    const uploaded_by = body.uploaded_by;
    // §4 D307 — the threshold is part of the request AND of the cache key: two
    // thresholds are two answers. Out of (0, 1] falls back to the default.
    const threshold = resolveThreshold(body.threshold);

    console.log('Starting critical node prediction process...', { project_id, uploaded_by, threshold });

    if (!uploaded_by) {
      return new Response(JSON.stringify({
        success: false,
        error: 'uploaded_by is required: a tier-3 write must name its actor (invariant audit-actor)',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // WP 10.1 · §4 D236 — ONE PROJECT, NAMED BY THE CALLER. This read used to be
    // `supply_chain_data` filtered by `plant_name` alone, which is not scoped to a
    // project. §4 D307 — and the plant filter is gone too: a node carries ONE
    // score per project (`node_list` is keyed by project and node), so a run
    // scored for one plant would clear every other plant's scores. A `plant_name`
    // in the body is accepted and ignored.
    if (!project_id) {
      return new Response(JSON.stringify({
        success: false,
        error: 'project_id is required: a prediction is computed for one project',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // WP 10.1 · §4 D236 — THE CACHE IS ASKED FIRST. The kind is keyed on the
    // PROCESS level (`analysis_kinds`): the lane graph is rebuilt from it, so a
    // price edit is a hit and a lane change is a miss. §4 D307 — the method and
    // the threshold are in `params`, so a run says how it was computed.
    const run = await getOrStart(supabase, {
      projectId: project_id,
      analysisKind: 'critical_nodes',
      params: { method: CRITICAL_NODES_METHOD, threshold },
      codeVersion: CODE_VERSION,
      actorUserId: uploaded_by,
    });

    const counts = (run.rowCounts ?? {}) as { nodes?: number; nexus?: number };
    if (run.cacheHit) {
      console.log(`critical_nodes: cache hit on run ${run.runId}`);
      return new Response(JSON.stringify({
        success: true, cache_hit: true, run_id: run.runId,
        input_hash: run.inputHash, input_scope: run.inputScope,
        dataset_version_id: run.datasetVersionId, code_version: run.codeVersion,
        method: CRITICAL_NODES_METHOD, threshold,
        nodes: counts.nodes ?? 0, nexus: counts.nexus ?? 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (run.claimedByOther && run.status === 'running') {
      return new Response(JSON.stringify({
        success: true, cache_hit: false, in_progress: true, run_id: run.runId,
        message: 'another request is already computing this exact analysis',
      }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // §4 D200 / D196 — PAGED. One unranged request is complete only below the
    // server's max_rows, and one project was scored on 1 000 of its 1 173 lanes.
    const lanes: LaneRow[] = [];
    try {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('supply_chain_data')
          .select('id, from_location, to_location, data_source, weighted, material_consumption_rate, sourcing_ratio')
          .eq('project_id', project_id)
          .neq('data_source', 'multi_tier')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message ?? String(error));
        lanes.push(...((data ?? []) as LaneRow[]));
        if (!data || data.length < PAGE) break;
      }
    } catch (fetchError) {
      console.error('Error fetching supply chain data:', fetchError);
      await failRun(supabase, run.runId, uploaded_by,
        [{ code: 'read_failed', message: String(fetchError) }]);
      throw new Error(`Failed to fetch data: ${String(fetchError)}`);
    }

    console.log(`Scoring ${lanes.length} lane rows`);

    let result: ReturnType<typeof scoreCriticalNodes>;
    try {
      result = scoreCriticalNodes(lanes, { threshold });
    } catch (computeError) {
      await failRun(supabase, run.runId, uploaded_by,
        [{ code: 'compute_failed', message: String(computeError) }]);
      throw computeError;
    }
    const nexus = result.nodes.filter((n) => n.is_critical).length;

    let rowsUpdated = 0;
    try {
      // The entity mirror: one score per NODE on `node_list`, which a lane rebuild
      // does not delete. Stamped with the run's own hash by the RPC.
      const { data: applied, error: applyError } = await supabase.rpc('analysis_apply_critical_nodes', {
        _run_id: run.runId,
        _scores: result.nodes.map((n) => ({ node_id: n.node_id, is_critical: n.is_critical, score: n.score })),
        _actor_user_id: uploaded_by,
      });
      if (applyError) {
        console.error('analysis_apply_critical_nodes failed', applyError);
        throw applyError;
      }
      rowsUpdated = Number((applied as { rows_updated?: number } | null)?.rows_updated ?? 0);

      // T3 · the run states its own limits: the substitutions the scorer applied,
      // and any scored node with no `node_list` row to carry it.
      const warnings: unknown[] = [...result.substitutions];
      if (rowsUpdated < result.nodes.length) {
        warnings.push({
          code: 'scored_but_not_in_node_list',
          scored: result.nodes.length,
          written: rowsUpdated,
          meaning: 'nodes were scored that have no node_list row; their scores are in the run only',
        });
      }

      await completeRun(
        supabase, run.runId, uploaded_by,
        result.nodes.map((n) => ({
          entity_type: 'node',
          entity_id: n.node_id,
          metrics: {
            score: n.score,
            is_critical: n.is_critical,
            rank: n.rank,
            products_affected: n.products_affected,
            sole_source_of: n.sole_source_of,
            betweenness: n.betweenness,
          },
        })),
        {
          lanes: lanes.length,
          nodes: result.nodes.length,
          nexus,
          products: result.products,
          node_list_rows: rowsUpdated,
          demand_basis: result.demand_basis,
        },
        warnings,
      );
    } catch (writeError) {
      await failRun(supabase, run.runId, uploaded_by,
        [{ code: 'write_failed', message: String(writeError) }]);
      throw writeError;
    }

    console.log(`Scored ${result.nodes.length} nodes, ${nexus} nexus, ${rowsUpdated} written to node_list`);

    return new Response(
      JSON.stringify({
        success: true,
        cache_hit: false,
        run_id: run.runId,
        input_hash: run.inputHash,
        input_scope: run.inputScope,
        dataset_version_id: run.datasetVersionId,
        code_version: run.codeVersion,
        method: CRITICAL_NODES_METHOD,
        threshold,
        message: `Scored ${result.nodes.length} nodes; ${nexus} nexus`,
        nodes: result.nodes.length,
        nexus,
        rows_updated: rowsUpdated,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Error in predict-critical-nodes function:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
