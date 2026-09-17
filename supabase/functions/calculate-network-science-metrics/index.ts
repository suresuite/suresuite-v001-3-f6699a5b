import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import {
  applyNodeMetrics, completeRun, failRun, getOrStart, topologyDigest,
} from "../_shared/analysisStore.ts";

/** WP 4.3 · part of the store's key. Bump when the metrics change. */
const CODE_VERSION = 'network_metrics@wp43.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Node {
  id: string;
  uid: string;
  name: string;
  revenue?: number;
}

interface Edge {
  src_uid: string;
  dst_uid: string;
  relative_revenue?: number;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { project_id, uploaded_by } = await req.json();

    if (!project_id) {
      return new Response(
        JSON.stringify({ error: 'Project ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // WP 4.3 · G4 — a tier-3 write names its actor or does not happen.
    if (!uploaded_by) {
      return new Response(JSON.stringify({
        success: false,
        error: 'uploaded_by is required: a tier-3 write must name its actor (invariant audit-actor)',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const digest = await topologyDigest(supabase, project_id);
    const run = await getOrStart(supabase, {
      projectId: project_id,
      analysisKind: 'network_metrics',
      params: { weighted: true, topology_digest: digest },
      codeVersion: CODE_VERSION,
      actorUserId: uploaded_by,
    });

    if (run.cacheHit) {
      console.log(`network_metrics: cache hit on run ${run.runId}`);
      return new Response(JSON.stringify({
        success: true, cache_hit: true, run_id: run.runId,
        input_hash: run.inputHash, code_version: run.codeVersion,
        nodes_updated: (run.rowCounts as { nodes?: number } | undefined)?.nodes ?? 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (run.claimedByOther && run.status === 'running') {
      return new Response(JSON.stringify({
        success: true, cache_hit: false, in_progress: true, run_id: run.runId,
        message: 'another request is already computing this exact analysis',
      }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Calculating network science metrics for project: ${project_id}`);

    // Fetch nodes
    const { data: nodes, error: nodesError } = await supabase
      .rpc('get_network_nodes_for_prominence', { p_project_id: project_id });

    if (nodesError) {
      console.error('Error fetching nodes:', nodesError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch nodes' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch edges
    const { data: edges, error: edgesError } = await supabase
      .rpc('get_network_edges_for_prominence', { p_project_id: project_id });

    if (edgesError) {
      console.error('Error fetching edges:', edgesError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch edges' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing ${nodes.length} nodes and ${edges.length} edges`);

    let effectiveNodes = nodes as Node[];
    let effectiveEdges = edges as Edge[];
    const fallbackWarnings: Array<Record<string, unknown>> = [];

    // Fallback: if no deep-tier nodes/edges exist, derive graph from supply_chain_data
    if ((effectiveNodes?.length ?? 0) === 0 || (effectiveEdges?.length ?? 0) === 0) {
      console.log('No deep-tier network data found. Deriving graph from supply_chain_data as fallback...');
      const { data: scdRows, error: scdError } = await supabase
        .from('supply_chain_data')
        .select('from_location,to_location,weighted,plant_name')
        .eq('project_id', project_id);

      if (scdError) {
        console.error('Failed to fetch supply_chain_data for fallback graph:', scdError);
      } else if ((scdRows?.length ?? 0) > 0) {
        const nodeSet = new Map<string, { uid: string; name: string; plant_name: string }>();
        const edgeList: Edge[] = [];

        for (const row of scdRows as any[]) {
          const from = row.from_location as string | null;
          const to = row.to_location as string | null;
          if (!from || !to) continue;
          const plant = (row.plant_name as string) ?? '';
          const weight = typeof row.weighted === 'number' ? row.weighted : Number(row.weighted ?? 1);

          if (!nodeSet.has(from)) nodeSet.set(from, { uid: from, name: from, plant_name: plant });
          if (!nodeSet.has(to)) nodeSet.set(to, { uid: to, name: to, plant_name: plant });
          edgeList.push({ src_uid: from, dst_uid: to, relative_revenue: isFinite(weight) ? weight : 1 });
        }

        effectiveNodes = Array.from(nodeSet.values()).map(n => ({ id: n.uid, uid: n.uid, name: n.name }));
        effectiveEdges = edgeList;

        console.log(`Derived fallback graph with ${effectiveNodes.length} nodes and ${effectiveEdges.length} edges from supply_chain_data.`);

        // Ensure nodes exist in network_nodes so metrics can be stored and later queried by RPCs
        if (effectiveNodes.length > 0) {
          const upsertRows = Array.from(nodeSet.values()).map(n => ({
            project_id,
            uid: n.uid,
            name: n.name,
            plant_name: n.plant_name,
          }));
          // §4 D72 · THIS UPSERT NAMES A CONSTRAINT THAT DOES NOT EXIST.
          // `network_nodes` has no unique index on `(project_id, uid)`, so
          // PostgREST's `on_conflict` is rejected and this call has failed on
          // EVERY run since it was written — logged, then carried on, and the
          // metrics below were then written against nodes that were never
          // stored. The index is not created in WP 4.3 because nothing has
          // COUNTED the duplicates that would block it (see
          // `20260917000007`'s header); what changes here is that the failure
          // is no longer swallowed. It becomes a declared warning on the run,
          // which is T3 — a computation publishes the limits of its own result.
          const { error: upsertErr } = await supabase
            .from('network_nodes')
            .upsert(upsertRows, { onConflict: 'project_id,uid' });
          if (upsertErr) {
            console.error('Failed to upsert network_nodes for fallback (D72):', upsertErr);
            fallbackWarnings.push({
              code: 'fallback_nodes_not_stored',
              defect: 'D72',
              attempted: upsertRows.length,
              message: upsertErr.message ?? String(upsertErr),
              meaning: 'network_nodes has no unique index on (project_id, uid), so the '
                + 'derived fallback graph could not be stored; metrics below describe '
                + 'nodes that may have no row to be written onto',
            });
          } else {
            console.log(`Upserted ${upsertRows.length} nodes into network_nodes (fallback).`);
          }
        }
      }
    }

    // Calculate network science metrics for each node using effective graph
    const metrics = calculateNetworkMetrics(effectiveNodes || [], effectiveEdges || []);

    // ── WP 4.3 · THE DUAL-WRITE ──────────────────────────────────────────
    //
    // One `.update()` per node stood here, in a serial loop — one statement and
    // one `actor_known: false` audit row each (D36). One statement now, naming
    // the actor, stamping the run's `input_hash` onto every row it writes (I5),
    // and the same numbers into `analysis_results` so WP 5.3 can drop the
    // columns without changing what the product reports.
    const entries = Object.entries(metrics);
    let updatedCount = 0;
    try {
      updatedCount = await applyNodeMetrics(
        supabase, run.runId, uploaded_by,
        entries.map(([uid, m]) => ({
          uid,
          prominence: m.prominence,
          degree_centrality: m.degree_centrality,
          weighted_degree_centrality: m.weighted_degree_centrality,
          eigenvector_centrality: m.eigenvector_centrality,
          betweenness_centrality: m.betweenness_centrality,
          closeness_centrality: m.closeness_centrality,
        })),
      );

      const warnings = [...fallbackWarnings];
      if (updatedCount !== entries.length) {
        warnings.push({
          code: 'nodes_scored_but_not_stored',
          scored: entries.length,
          stored: updatedCount,
          meaning: 'metrics were computed for nodes that have no network_nodes row',
        });
      }

      await completeRun(
        supabase, run.runId, uploaded_by,
        entries.map(([uid, m]) => ({
          entity_type: 'node',
          entity_id: uid,
          metrics: {
            prominence: m.prominence,
            degree_centrality: m.degree_centrality,
            weighted_degree_centrality: m.weighted_degree_centrality,
            eigenvector_centrality: m.eigenvector_centrality,
            betweenness_centrality: m.betweenness_centrality,
            closeness_centrality: m.closeness_centrality,
          },
        })),
        { nodes: updatedCount, nodes_scored: entries.length, edges: effectiveEdges.length },
        warnings,
      );
    } catch (writeError) {
      await failRun(supabase, run.runId, uploaded_by,
        [{ code: 'write_failed', message: String(writeError) }]);
      throw writeError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        cache_hit: false,
        run_id: run.runId,
        input_hash: run.inputHash,
        code_version: run.codeVersion,
        warnings: fallbackWarnings,
        nodes_processed: nodes.length,
        edges_processed: edges.length,
        nodes_updated: updatedCount,
        metrics_summary: {
          avg_degree: Object.values(metrics).reduce((sum, m: any) => sum + m.degree_centrality, 0) / Object.keys(metrics).length,
          avg_eigenvector: Object.values(metrics).reduce((sum, m: any) => sum + m.eigenvector_centrality, 0) / Object.keys(metrics).length,
          avg_betweenness: Object.values(metrics).reduce((sum, m: any) => sum + m.betweenness_centrality, 0) / Object.keys(metrics).length,
          avg_closeness: Object.values(metrics).reduce((sum, m: any) => sum + m.closeness_centrality, 0) / Object.keys(metrics).length
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in calculate-network-science-metrics function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function calculateNetworkMetrics(nodes: Node[], edges: Edge[]) {
  const nodeMap = new Map(nodes.map(n => [n.uid, n]));
  const adjacencyList = new Map<string, Map<string, number>>();
  const nodeMetrics: Record<string, any> = {};

  // Build adjacency list with weights
  nodes.forEach(node => {
    adjacencyList.set(node.uid, new Map());
  });

  edges.forEach(edge => {
    const weight = edge.relative_revenue || 1;
    adjacencyList.get(edge.src_uid)?.set(edge.dst_uid, weight);
    adjacencyList.get(edge.dst_uid)?.set(edge.src_uid, weight); // Undirected graph
  });

  // Calculate metrics for each node
  nodes.forEach(node => {
    const neighbors = adjacencyList.get(node.uid) || new Map();
    
    // Degree Centrality
    const degree = neighbors.size;
    const maxPossibleDegree = nodes.length - 1;
    const degree_centrality = maxPossibleDegree > 0 ? degree / maxPossibleDegree : 0;

    // Weighted Degree Centrality
    const weightedDegree = Array.from(neighbors.values()).reduce((sum, weight) => sum + weight, 0);
    const maxWeightedDegree = Math.max(...nodes.map(n => {
      const nNeighbors = adjacencyList.get(n.uid) || new Map();
      return Array.from(nNeighbors.values()).reduce((sum, weight) => sum + weight, 0);
    }), 1);
    const weighted_degree_centrality = weightedDegree / maxWeightedDegree;

    nodeMetrics[node.uid] = {
      degree_centrality,
      weighted_degree_centrality,
      eigenvector_centrality: 0, // Will be calculated separately
      betweenness_centrality: 0, // Will be calculated separately
      closeness_centrality: 0 // Will be calculated separately
    };
  });

  // Calculate Eigenvector Centrality using power iteration
  const eigenvectorCentrality = calculateEigenvectorCentrality(nodes, adjacencyList);
  Object.keys(eigenvectorCentrality).forEach(uid => {
    if (nodeMetrics[uid]) {
      nodeMetrics[uid].eigenvector_centrality = eigenvectorCentrality[uid];
    }
  });

  // Calculate Betweenness Centrality (simplified approximation for performance)
  const betweennessCentrality = calculateBetweennessCentrality(nodes, adjacencyList);
  Object.keys(betweennessCentrality).forEach(uid => {
    if (nodeMetrics[uid]) {
      nodeMetrics[uid].betweenness_centrality = betweennessCentrality[uid];
    }
  });

  // Calculate Closeness Centrality
  const closenessCentrality = calculateClosenessCentrality(nodes, adjacencyList);
  Object.keys(closenessCentrality).forEach(uid => {
    if (nodeMetrics[uid]) {
      nodeMetrics[uid].closeness_centrality = closenessCentrality[uid];
    }
  });

  // Find max values for normalisation
  const allMetrics = Object.values(nodeMetrics);
  const maxBetweenness = Math.max(...allMetrics.map((m: any) => m.betweenness_centrality), 1);
  const maxCloseness = Math.max(...allMetrics.map((m: any) => m.closeness_centrality), 1);

  // Calculate prominence as weighted composite
  nodes.forEach(node => {
    const m = nodeMetrics[node.uid];
    if (!m) return;

    // Normalise betweenness and closeness to [0,1] range
    const normBetweenness = m.betweenness_centrality / maxBetweenness;
    const normCloseness = m.closeness_centrality / maxCloseness;

    // Weighted composite — adjust weights to suit your business logic
    m.prominence = (
      0.25 * m.degree_centrality +
      0.35 * m.eigenvector_centrality +   // highest weight: neighbour influence
      0.25 * normBetweenness +             // bottleneck risk
      0.15 * normCloseness                 // reachability
    );
  });

  return nodeMetrics;
}

function calculateEigenvectorCentrality(nodes: Node[], adjacencyList: Map<string, Map<string, number>>) {
  const centrality: Record<string, number> = {};
  const nodeIds = nodes.map(n => n.uid);
  
  // Initialize centrality scores
  nodeIds.forEach(uid => centrality[uid] = 1);

  // Power iteration
  const maxIterations = 100;
  const tolerance = 1e-6;

  for (let iter = 0; iter < maxIterations; iter++) {
    const newCentrality: Record<string, number> = {};
    let norm = 0;

    // Calculate new centrality scores
    nodeIds.forEach(uid => {
      newCentrality[uid] = 0;
      const neighbors = adjacencyList.get(uid) || new Map();
      neighbors.forEach((weight, neighborUid) => {
        newCentrality[uid] += weight * centrality[neighborUid];
      });
      norm += newCentrality[uid] * newCentrality[uid];
    });

    // Normalize
    norm = Math.sqrt(norm);
    if (norm > 0) {
      nodeIds.forEach(uid => {
        newCentrality[uid] /= norm;
      });
    }

    // Check convergence
    let converged = true;
    nodeIds.forEach(uid => {
      if (Math.abs(newCentrality[uid] - centrality[uid]) > tolerance) {
        converged = false;
      }
    });

    Object.assign(centrality, newCentrality);

    if (converged) break;
  }

  return centrality;
}

function calculateBetweennessCentrality(nodes: Node[], adjacencyList: Map<string, Map<string, number>>) {
  const centrality: Record<string, number> = {};
  nodes.forEach(node => centrality[node.uid] = 0);

  // Simplified betweenness calculation (sample-based for performance)
  const sampleSize = Math.min(50, nodes.length); // Sample nodes for efficiency
  const sampledNodes = nodes.slice(0, sampleSize);

  sampledNodes.forEach(source => {
    const distances: Record<string, number> = {};
    const predecessors: Record<string, string[]> = {};
    const sigma: Record<string, number> = {};
    
    // Initialize
    nodes.forEach(node => {
      distances[node.uid] = Infinity;
      predecessors[node.uid] = [];
      sigma[node.uid] = 0;
    });
    
    distances[source.uid] = 0;
    sigma[source.uid] = 1;

    // BFS
    const queue = [source.uid];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjacencyList.get(current) || new Map();
      
      neighbors.forEach((weight, neighbor) => {
        if (distances[neighbor] === Infinity) {
          distances[neighbor] = distances[current] + 1;
          queue.push(neighbor);
        }
        
        if (distances[neighbor] === distances[current] + 1) {
          sigma[neighbor] += sigma[current];
          predecessors[neighbor].push(current);
        }
      });
    }

    // Accumulate betweenness
    const dependency: Record<string, number> = {};
    nodes.forEach(node => dependency[node.uid] = 0);

    const sortedNodes = nodes
      .filter(n => distances[n.uid] < Infinity)
      .sort((a, b) => distances[b.uid] - distances[a.uid]);

    sortedNodes.forEach(node => {
      predecessors[node.uid].forEach(pred => {
        dependency[pred] += (sigma[pred] / sigma[node.uid]) * (1 + dependency[node.uid]);
      });
      
      if (node.uid !== source.uid) {
        centrality[node.uid] += dependency[node.uid];
      }
    });
  });

  // Normalize
  const n = nodes.length;
  const normFactor = n > 2 ? 2 / ((n - 1) * (n - 2)) : 1;
  Object.keys(centrality).forEach(uid => {
    centrality[uid] *= normFactor;
  });

  return centrality;
}

function calculateClosenessCentrality(nodes: Node[], adjacencyList: Map<string, Map<string, number>>) {
  const centrality: Record<string, number> = {};

  nodes.forEach(source => {
    const distances: Record<string, number> = {};
    nodes.forEach(node => distances[node.uid] = Infinity);
    distances[source.uid] = 0;

    // BFS for shortest paths
    const queue = [source.uid];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjacencyList.get(current) || new Map();
      
      neighbors.forEach((weight, neighbor) => {
        if (distances[neighbor] === Infinity) {
          distances[neighbor] = distances[current] + 1;
          queue.push(neighbor);
        }
      });
    }

    // Calculate closeness
    const reachableNodes = Object.values(distances).filter(d => d < Infinity && d > 0);
    if (reachableNodes.length > 0) {
      const totalDistance = reachableNodes.reduce((sum, d) => sum + d, 0);
      centrality[source.uid] = reachableNodes.length / totalDistance;
    } else {
      centrality[source.uid] = 0;
    }
  });

  return centrality;
}

