import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { completeRun, failRun, getOrStart } from "../_shared/analysisStore.ts";

/** WP 4.3 · part of the store's key. Bump when the prediction changes. */
const CODE_VERSION = 'critical_nodes@wp43.1';

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

    // ── WP 4.3 · WHICH PROJECT IS THIS? ──────────────────────────────────
    //
    // This function filters by `plant_name`, which is NOT scoped to a project —
    // `20260917000003` says so in its own header, which is why
    // `analysis_mark_critical_nodes` derives the project from the SCORED ROWS
    // and refuses a set spanning two. A run has to name a project before the
    // scoring happens, so the same question is answered here, from the rows
    // actually loaded, and answered the same way: one project or nothing.
    const projectIds = [...new Set(
      (supplyChainData ?? []).map((r: { project_id?: string }) => r.project_id).filter(Boolean),
    )];
    if (projectIds.length > 1) {
      return new Response(JSON.stringify({
        success: false,
        error: `plant_name '${plant_name}' spans ${projectIds.length} projects. One call `
             + `scores under one project's authority or it scores nothing.`,
        projects: projectIds.length,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const project_id = projectIds[0] as string | undefined;

    // ── Process ALL data at once (no batching) so graph metrics are global ──
    const predictions = await predictCriticalNodes(supplyChainData);

    // WP 4.1 — D36 CLOSED, AND THE AUDIT LOG STOPS BEING UNREADABLE.
    //
    // What stood here was ONE UPDATE PER PREDICTION, fired in parallel. Since
    // WP 2.3 every one of those statements writes its own audit row, so a single
    // analysis of the largest project in this database produced ~1 800 rows in
    // the log the statement grain exists to keep readable — each saying
    // `actor_known: false`, because a service-role PostgREST call cannot set the
    // GUC the trigger reads.
    //
    // `analysis_mark_critical_nodes` takes the actor as a parameter, sets
    // `app.current_user_id` LOCAL, and writes every score in ONE statement. It
    // also derives the project from the SCORED ROWS and refuses a set spanning
    // two — this function filters by `plant_name`, which is not scoped to a
    // project, so "which project am I writing" had no answer here at all.
    // `supabase/rehearsal/110` §7d reads the audit row back.
    if (!uploaded_by) {
      return new Response(JSON.stringify({
        success: false,
        error: 'uploaded_by is required: a tier-3 write must name its actor (invariant audit-actor)',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── WP 4.3 · the run, so the scores can say which world produced them ─
    //
    // NO TOPOLOGY DIGEST HERE, and the absence is a statement rather than an
    // omission: this analyzer reads `supply_chain_data`, which is
    // `combine-project`'s ETL output over the eleven tier-2 tables
    // `current_graph_hash` already covers. Its inputs ARE in the anchor. The two
    // centrality analyzers read `network_nodes`/`network_edges`, which are not —
    // see `20260917000007`'s header.
    const run = project_id
      ? await getOrStart(supabase, {
          projectId: project_id,
          analysisKind: 'critical_nodes',
          params: { plant_name: plant_name ?? null },
          codeVersion: CODE_VERSION,
          actorUserId: uploaded_by,
        })
      : null;

    if (run?.cacheHit) {
      console.log(`critical_nodes: cache hit on run ${run.runId}`);
      return new Response(JSON.stringify({
        success: true, cache_hit: true, run_id: run.runId,
        input_hash: run.inputHash, code_version: run.codeVersion,
        rows_updated: (run.rowCounts as { rows?: number } | undefined)?.rows ?? 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let rowsUpdated = 0;
    try {
      const { data: marked, error: markError } = await supabase.rpc('analysis_mark_critical_nodes', {
        _actor_user_id: uploaded_by,
        _scores: predictions.map((p) => ({ id: p.id, is_critical: p.is_critical, score: p.score })),
        _run_id: run?.runId ?? null,
      });
      if (markError) {
        console.error('analysis_mark_critical_nodes failed', markError);
        throw markError;
      }
      rowsUpdated = Number((marked as { rows_updated?: number } | null)?.rows_updated ?? 0);

      if (run) {
        await completeRun(
          supabase, run.runId, uploaded_by,
          predictions.map((p) => ({
            entity_type: 'supply_chain_row',
            entity_id: String(p.id),
            metrics: { is_critical: p.is_critical, criticality_score: p.score },
          })),
          { rows: rowsUpdated, scored: predictions.length },
          // T3 · the run states its own limit. A row scored but not written was
          // deleted between the read and the write; a count with no source is
          // the defect §5 T1 names.
          rowsUpdated === predictions.length ? [] : [{
            code: 'scored_but_not_written',
            scored: predictions.length,
            written: rowsUpdated,
            meaning: 'rows were scored that no longer existed when the write ran',
          }],
        );
      }
    } catch (writeError) {
      if (run) {
        await failRun(supabase, run.runId, uploaded_by,
          [{ code: 'write_failed', message: String(writeError) }]);
      }
      throw writeError;
    }

    // The number reported is the one the STATEMENT wrote, not the number of
    // predictions computed. They differ when a scored row was deleted between
    // the read and the write, and a count with no source is the defect §5 T1
    // names.
    console.log(`Updated ${rowsUpdated} of ${predictions.length} scored records`);

    return new Response(
      JSON.stringify({
        success: true,
        cache_hit: false,
        run_id: run?.runId ?? null,
        input_hash: run?.inputHash ?? null,
        code_version: run?.codeVersion ?? CODE_VERSION,
        message: `Predicted ${predictions.length} records and updated ${rowsUpdated}`,
        predictions: predictions.length,
        rows_updated: rowsUpdated
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