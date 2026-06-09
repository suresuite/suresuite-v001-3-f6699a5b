// @ts-nocheck
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    const { project_id, config = defaultConfig } = await req.json();

    if (!project_id) {
      return new Response(JSON.stringify({ error: 'Project ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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

    // Batch update all nodes with their prominence values
    console.log(`🔄 Updating ${prominenceUpdates.length} nodes with prominence values...`);
    
    const updatePromises = prominenceUpdates.map(async (update, index) => {
      const result = await supabaseClient
        .from('network_nodes')
        .update({
          prominence: update.prominence,
          prominence_updated_at: update.prominence_updated_at
        })
        .eq('id', update.id);
      
      if (result.error) {
        console.error(`❌ Error updating node ${update.uid} (${update.id}):`, result.error);
      } else if (index < 3) { // Log first few updates for debugging
        console.log(`✅ Updated node ${update.uid} with prominence ${update.prominence.toFixed(3)}`);
      }
      
      return result;
    });

    const updateResults = await Promise.all(updatePromises);
    const failedUpdates = updateResults.filter(r => r.error);
    
    if (failedUpdates.length > 0) {
      console.error(`❌ ${failedUpdates.length} updates failed out of ${updateResults.length}`);
    } else {
      console.log(`✅ All ${updateResults.length} prominence updates completed successfully`);
    }

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
      updated_count: prominenceUpdates.length,
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