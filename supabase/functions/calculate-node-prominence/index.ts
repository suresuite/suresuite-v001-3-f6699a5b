// @ts-nocheck
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  applyNodeMetrics, completeRun, failRun, getOrStart, topologyDigest,
} from "../_shared/analysisStore.ts";

/**
 * WP 4.3 · THE CODE VERSION IS PART OF THE KEY, SO IT IS A CONSTANT AND NOT A
 * TIMESTAMP. Bump it whenever `calculateNodeProminence` changes what it
 * computes — two `code_version`s coexist under one input hash by design
 * (WP 4.2 §11), so a bump makes the next request a MISS rather than serving an
 * answer the current code would not produce.
 */
const CODE_VERSION = 'prominence@wp43.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Node {
  id: string;
  uid: string;
  revenue?: number;
  name?: string;
}

interface Edge {
  src_uid: string;
  dst_uid: string;
  relative_revenue?: number;
}

interface ProminenceConfig {
  connectionWeightCap: number;
  revenueNormalizationScale: number;
  centralityPartnerCap: number;
  connectionWeight: number;
  revenueWeight: number;
  balanceWeight: number;
  centralityWeight: number;
}

const defaultConfig: ProminenceConfig = {
  connectionWeightCap: 20,
  revenueNormalizationScale: 1000000, // 1M
  centralityPartnerCap: 15,
  connectionWeight: 0.8,  // 80% - Edge-focused
  revenueWeight: 0.05,    // 5% - Minimal revenue impact
  balanceWeight: 0.05,    // 5% - Minimal balance impact
  centralityWeight: 0.1,  // 10% - Moderate centrality impact
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

    const { project_id, uploaded_by, config = defaultConfig } = await req.json();

    if (!project_id) {
      return new Response(JSON.stringify({ error: 'Project ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // WP 4.3 · G4. The write below is a tier-3 write and it goes through an RPC
    // that takes the actor, so a call that cannot name one is refused here
    // rather than producing a row saying `actor_known: false`. Same stance
    // `predict-critical-nodes` took in WP 4.1.
    if (!uploaded_by) {
      return new Response(JSON.stringify({
        success: false,
        error: 'uploaded_by is required: a tier-3 write must name its actor (invariant audit-actor)',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // WP 4.3 · claim the key BEFORE reading the graph, so the digest and the
    // read describe the same moment as closely as one process can manage.
    const digest = await topologyDigest(supabaseClient, project_id);
    const run = await getOrStart(supabaseClient, {
      projectId: project_id,
      analysisKind: 'prominence',
      params: { config, topology_digest: digest },
      codeVersion: CODE_VERSION,
      actorUserId: uploaded_by,
    });

    // A HIT IS AN ANSWER, NOT A SHORTCUT. The entity rows already carry this
    // run's numbers and its `computed_from_hash`, because the run that wrote
    // `analysis_results` wrote them in the same transaction — so returning here
    // is returning the stored answer, not skipping the work.
    if (run.cacheHit) {
      console.log(`prominence: cache hit on run ${run.runId} (input ${run.inputHash.slice(0, 12)})`);
      return new Response(JSON.stringify({
        success: true,
        cache_hit: true,
        run_id: run.runId,
        input_hash: run.inputHash,
        code_version: run.codeVersion,
        updated_count: (run.rowCounts as { nodes?: number } | undefined)?.nodes ?? 0,
        config_used: config,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Another request won the key and is still computing. Saying so beats
    // racing it: two processes writing the same entity rows is how a partial
    // result becomes a permanent one.
    if (run.claimedByOther && run.status === 'running') {
      return new Response(JSON.stringify({
        success: true, cache_hit: false, in_progress: true, run_id: run.runId,
        message: 'another request is already computing this exact analysis',
      }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`🔄 Calculating prominence for project: ${project_id}`);
    console.log(`🔍 Using service role key: ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ? 'Available' : 'Missing'}`);

    // Fetch all nodes and edges for the project
    console.log('📊 Fetching nodes and edges...');
    const [nodesResult, edgesResult] = await Promise.all([
      supabaseClient.rpc('get_network_nodes_for_prominence', {
        p_project_id: project_id
      }),
      supabaseClient.rpc('get_network_edges_for_prominence', {
        p_project_id: project_id
      })
    ]);

    console.log(`📦 Nodes result:`, { data: nodesResult.data?.length, error: nodesResult.error });
    console.log(`🔗 Edges result:`, { data: edgesResult.data?.length, error: edgesResult.error });

    if (nodesResult.error) {
      console.error('❌ Error fetching nodes:', nodesResult.error);
      throw nodesResult.error;
    }
    if (edgesResult.error) {
      console.error('❌ Error fetching edges:', edgesResult.error);
      throw edgesResult.error;
    }

    const nodes: Node[] = nodesResult.data || [];
    const edges: Edge[] = edgesResult.data || [];

    console.log(`📊 Found ${nodes.length} nodes and ${edges.length} edges`);

    // Calculate prominence for each node
    const prominenceUpdates = nodes.map(node => {
      const prominence = calculateNodeProminence(node, nodes, edges, config);
      return {
        id: node.id,
        uid: node.uid,
        prominence,
        prominence_updated_at: new Date().toISOString(),
      };
    });

    // ── WP 4.3 · THE DUAL-WRITE ──────────────────────────────────────────
    //
    // WHAT STOOD HERE was one `.update()` PER NODE, all fired in parallel. Since
    // WP 2.3 each of those statements writes its own audit row saying
    // `actor_known: false`, because a service-role PostgREST call cannot set the
    // GUC the trigger reads (D36) — §15 measured 1 385 nodes in one project, so
    // one prominence run wrote 1 385 rows into the log that statement grain
    // exists to keep readable. It also swallowed every failure into a console
    // line and returned `success: true` over a partial write.
    //
    // Now: ONE statement, naming the actor, stamping `computed_from_hash` from
    // the run (I5) — and the same numbers into `analysis_results`, so WP 5.3 can
    // drop the columns without changing what the product reports.
    let updatedCount = 0;
    try {
      updatedCount = await applyNodeMetrics(
        supabaseClient, run.runId, uploaded_by,
        prominenceUpdates.map(u => ({ uid: u.uid, prominence: u.prominence })),
      );

      await completeRun(
        supabaseClient, run.runId, uploaded_by,
        prominenceUpdates.map(u => ({
          entity_type: 'node',
          entity_id: u.uid,
          metrics: { prominence: u.prominence },
        })),
        { nodes: updatedCount, nodes_scored: prominenceUpdates.length },
        // T3 · the computation publishes its own blind spot. A scored node with
        // no row in `network_nodes` is a real state (the graph came from the
        // fallback derivation) and it is reported rather than logged.
        updatedCount === prominenceUpdates.length ? [] : [{
          code: 'nodes_scored_but_not_stored',
          scored: prominenceUpdates.length,
          stored: updatedCount,
          meaning: 'prominence was computed for nodes that have no network_nodes row',
        }],
      );
    } catch (writeError) {
      // The run must record that it died, or its `running` row owns the key
      // forever and the next request waits on an analysis nobody is running.
      await failRun(supabaseClient, run.runId, uploaded_by,
        [{ code: 'write_failed', message: String(writeError) }]);
      throw writeError;
    }
    console.log(`✅ prominence run ${run.runId}: ${updatedCount} node(s) written to both destinations`);

    // Calculate statistics
    const prominenceValues = prominenceUpdates.map(u => u.prominence);
    const stats = {
      count: prominenceValues.length,
      min: Math.min(...prominenceValues),
      max: Math.max(...prominenceValues),
      average: prominenceValues.reduce((a, b) => a + b, 0) / prominenceValues.length,
      distribution: {
        low: prominenceValues.filter(p => p < 0.3).length,
        medium: prominenceValues.filter(p => p >= 0.3 && p < 0.7).length,
        high: prominenceValues.filter(p => p >= 0.7).length,
      }
    };

    console.log(`✅ Updated prominence for ${prominenceUpdates.length} nodes`);
    console.log(`📈 Stats: min=${stats.min.toFixed(3)}, max=${stats.max.toFixed(3)}, avg=${stats.average.toFixed(3)}`);

    return new Response(JSON.stringify({
      success: true,
      cache_hit: false,
      run_id: run.runId,
      input_hash: run.inputHash,
      code_version: run.codeVersion,
      updated_count: updatedCount,
      statistics: stats,
      config_used: config
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error calculating prominence:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      details: error.stack 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function calculateNodeProminence(
  node, 
  allNodes, 
  allEdges, 
  config
) {
  const nodeId = node.uid;
  
  // Safety Net 1: Ensure config has all properties, even if partially passed
  const safeConfig = { ...defaultConfig, ...(config || {}) };
  
  // 1. Connection-based weight
  const connections = allEdges.filter(edge => 
    edge.src_uid === nodeId || edge.dst_uid === nodeId
  );
  const connCap = safeConfig.connectionWeightCap || 20;
  const connectionWeight = Math.min(connections.length, connCap) / connCap;

  // Safety Net 2: Aggressive revenue parsing (handles "$1M", "N/A", null, etc.)
  let parsedRevenue = 0;
  if (typeof node.revenue === 'number') {
    parsedRevenue = node.revenue;
  } else if (typeof node.revenue === 'string') {
    // Strip out everything except digits, minus signs, and decimals
    const cleanString = node.revenue.replace(/[^0-9.-]+/g, "");
    parsedRevenue = parseFloat(cleanString);
  }
  
  // If parsing failed (e.g., it was "N/A"), fallback to 0
  if (Number.isNaN(parsedRevenue)) {
    parsedRevenue = 0;
  }

  const revCap = safeConfig.revenueNormalizationScale || 1000000;
  const revenueWeight = Math.min(parsedRevenue, revCap) / revCap;

  // 3. Balance weight
  const incomingEdges = allEdges.filter(edge => edge.dst_uid === nodeId);
  const outgoingEdges = allEdges.filter(edge => edge.src_uid === nodeId);
  const totalConnections = incomingEdges.length + outgoingEdges.length;
  const balanceWeight = totalConnections > 0 
    ? 1 - Math.abs(incomingEdges.length - outgoingEdges.length) / totalConnections 
    : 0;

  // 4. Betweenness centrality approximation
  const partners = new Set([
    ...connections.map(e => e.src_uid === nodeId ? e.dst_uid : e.src_uid)
  ]);
  const partnerCap = safeConfig.centralityPartnerCap || 15;
  const betweennessCentrality = Math.min(partners.size, partnerCap) / partnerCap;

  // Calculate final prominence using safe configs
  let prominence = 
    (connectionWeight * (safeConfig.connectionWeight || 0.8)) +
    (revenueWeight * (safeConfig.revenueWeight || 0.05)) +
    (balanceWeight * (safeConfig.balanceWeight || 0.05)) +
    (betweennessCentrality * (safeConfig.centralityWeight || 0.1));

  // Safety Net 3: The ultimate NaN blocker
  if (Number.isNaN(prominence) || !Number.isFinite(prominence)) {
    console.error(`Warning: NaN calculated for node ${nodeId}. Defaulting to 0.`);
    prominence = 0; 
  }

  return Math.min(Math.max(prominence, 0), 1); // Clamp between 0 and 1
}