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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const plant_name = body.plant_name || body.plant;
    const uploaded_by = body.uploaded_by;

    console.log('Starting critical node prediction process...', { plant_name, uploaded_by });

    let query = supabase.from('supply_chain_data').select('*');
    if (plant_name) query = query.eq('plant_name', plant_name);
    // if (uploaded_by) query = query.eq('uploaded_by', uploaded_by);
    query = query.neq('data_source', 'multi_tier');

    const { data: supplyChainData, error: fetchError } = await query;

    if (fetchError) {
      console.error('Error fetching supply chain data:', fetchError);
      throw new Error(`Failed to fetch data: ${fetchError.message}`);
    }

    console.log(`Processing ${supplyChainData.length} records for prediction`);

    // ── Process ALL data at once (no batching) so graph metrics are global ──
    const predictions = await predictCriticalNodes(supplyChainData);

    const updatePromises = predictions.map(async (prediction) => {
      const { error: updateError } = await supabase
        .from('supply_chain_data')
        .update({
          is_critical_node: prediction.is_critical,
          critical_node_score: prediction.score,
          prediction_timestamp: new Date().toISOString()
        })
        .eq('id', prediction.id);

      if (updateError) {
        console.error(`Error updating record ${prediction.id}:`, updateError);
        throw updateError;
      }
    });

    await Promise.all(updatePromises);

    console.log(`Successfully updated ${predictions.length} records with predictions`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully predicted and updated ${predictions.length} records`,
        predictions: predictions.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Error in predict-critical-nodes function:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function predictCriticalNodes(data: any[]): Promise<Array<{id: string, is_critical: boolean, score: number}>> {
  const mlApiUrl = Deno.env.get('ML_API_URL');
  const mlApiKey = Deno.env.get('ML_API_KEY');

  // Try real ML service first if configured
  if (mlApiUrl && mlApiKey) {
    try {
      const nodes = data.map(node => ({
        id: node.id,
        location_name: node.location_name,
        node_type: node.node_type,
        latitude: node.latitude,
        longitude: node.longitude,
        capacity: node.capacity,
        current_utilization: node.current_utilization,
        risk_factor: node.risk_factor,
        connectivity_score: node.connectivity_score
      }));

      const response = await fetch(`${mlApiUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': mlApiKey },
        body: JSON.stringify({ nodes })
      });

      if (!response.ok) throw new Error(`ML service error: ${response.status}`);

      const result = await response.json();
      return result.predictions.map((pred: any) => ({
        id: pred.id,
        is_critical: Boolean(pred.is_critical),
        score: Number(pred.score)
      }));

    } catch (error) {
      console.error('ML service failed, falling back to prominence scoring:', error);
    }
  }

  console.log('Using prominence-based scoring for critical node classification');

  const CONNECTION_WEIGHT_CAP = 20;
  const CENTRALITY_PARTNER_CAP = 15;

  // ── Step 1: Build adjacency and connection maps ───────────────────────────
  const inConnMap: Record<string, number> = {};
  const outConnMap: Record<string, number> = {};
  const adjacency = new Map<string, Set<string>>();
  const allNodeIds = new Set<string>();

  data.forEach(row => {
    const src = row.from_location as string;
    const dst = row.to_location as string;
    if (!src || !dst) return;

    allNodeIds.add(src);
    allNodeIds.add(dst);

    outConnMap[src] = (outConnMap[src] || 0) + 1;
    inConnMap[dst]  = (inConnMap[dst]  || 0) + 1;

    if (!adjacency.has(src)) adjacency.set(src, new Set());
    if (!adjacency.has(dst)) adjacency.set(dst, new Set());
    adjacency.get(src)!.add(dst);
    adjacency.get(dst)!.add(src);
  });

  const nodeIds = Array.from(allNodeIds);
  console.log(`Building graph metrics for ${nodeIds.length} unique nodes`);

  // ── Step 2: Eigenvector centrality (power iteration, 40 rounds) ───────────
  const ev: Record<string, number> = {};
  nodeIds.forEach(id => ev[id] = 1);

  for (let iter = 0; iter < 40; iter++) {
    const next: Record<string, number> = {};
    let norm = 0;
    nodeIds.forEach(id => {
      let s = 0;
      adjacency.get(id)?.forEach(nb => { s += ev[nb] ?? 0; });
      next[id] = s;
      norm += s * s;
    });
    norm = Math.sqrt(norm) || 1;
    nodeIds.forEach(id => { ev[id] = next[id] / norm; });
  }
  const maxEv = Math.max(...nodeIds.map(id => ev[id] ?? 0), 1);

  // ── Step 3: Closeness centrality (BFS per node) ───────────────────────────
  const clos: Record<string, number> = {};
  nodeIds.forEach(src => {
    const dist: Record<string, number> = {};
    nodeIds.forEach(id => dist[id] = Infinity);
    dist[src] = 0;
    const q = [src];
    while (q.length) {
      const cur = q.shift()!;
      adjacency.get(cur)?.forEach(nb => {
        if (dist[nb] === Infinity) { dist[nb] = dist[cur] + 1; q.push(nb); }
      });
    }
    const reachable = nodeIds.filter(id => dist[id] < Infinity && dist[id] > 0);
    clos[src] = reachable.length
      ? reachable.length / reachable.reduce((s, id) => s + dist[id], 0)
      : 0;
  });
  const maxClos = Math.max(...nodeIds.map(id => clos[id] ?? 0), 1);

  // ── Step 4: Score each row by its from_location prominence ────────────────
  const computeProminence = (nodeId: string): number => {
    const totalConn = adjacency.get(nodeId)?.size || 0;
    const inConn    = inConnMap[nodeId]  || 0;
    const outConn   = outConnMap[nodeId] || 0;
    const totalIO   = inConn + outConn;

    const connectionWeight  = Math.min(totalConn, CONNECTION_WEIGHT_CAP) / CONNECTION_WEIGHT_CAP;
    const revenueWeight     = 0; // not available in supply_chain_data
    const balanceWeight     = totalIO > 0
      ? 1 - Math.abs(inConn - outConn) / totalIO
      : 0;
    const betweennessApprox = Math.min(totalConn, CENTRALITY_PARTNER_CAP) / CENTRALITY_PARTNER_CAP;
    const eigenvectorWeight = (ev[nodeId] ?? 0) / maxEv;
    const closenessWeight   = (clos[nodeId] ?? 0) / maxClos;

    return Math.min(Math.max(
      connectionWeight  * 0.60 +
      revenueWeight     * 0.05 +
      balanceWeight     * 0.05 +
      betweennessApprox * 0.10 +
      eigenvectorWeight * 0.10 +
      closenessWeight   * 0.10,
    0), 1);
  };

  const scoredRows = data.map(row => ({
    id:         row.id as string,
    prominence: computeProminence(row.from_location as string),
  }));

  // ── Step 5: p90 threshold across all rows ────────────────────────────────
  const uniqueNodeScores = Array.from(
    new Map(
      scoredRows.map(r => [
        data.find((d: any) => d.id === r.id)?.from_location,
        r.prominence
      ])
    ).values()
  ).sort((a, b) => a - b);

  const p90Threshold = uniqueNodeScores[
    Math.floor(uniqueNodeScores.length * 0.90)
  ] ?? 0;

  console.log(`p90 threshold: ${p90Threshold.toFixed(4)} across ${uniqueNodeScores.length} unique nodes`);

  // console.log(`Prominence p90 threshold: ${p90Threshold.toFixed(4)} across ${nodeIds.length} unique nodes, ${sorted.length} rows`);

  // ── Step 6: Classify top 10% as critical ─────────────────────────────────
  return scoredRows.map(({ id, prominence }) => ({
    id,
    is_critical: prominence >= p90Threshold,
    score: parseFloat(prominence.toFixed(4)),
  }));
}