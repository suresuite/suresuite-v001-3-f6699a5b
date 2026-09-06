// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import { useEffect, useState, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeMouseHandler,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useGlobalProject } from '@/hooks/useGlobalProject';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  RefreshCw,
  Network,
  Search,
  BarChart,
  RotateCcw,
  AlertTriangle,
  Map as MapIcon,
} from 'lucide-react';
import { PageLayout, PageHeader, ProjectSelector, PAGE_GUTTER } from '@/components/shared';
import MLPrediction from '@/components/MLPrediction';
import SupplierVolumeChart, { SupplierVolumeDatum, aggregateSupplierVolumes } from '@/components/SupplierVolumeChart';
import SupplierMaterialChart from '@/components/SupplierMaterialChart';
import { DisruptionDialog } from '@/components/DisruptionDialog';
import MapView from '@/components/MapView';
import { NetworkMetricsTable } from '@/components/NetworkMetricsTable';
import { calculateSupplierMetrics, calculateMaterialMetrics } from '@/utils/networkMetrics';

const GROUP_ORDER = ['A', 'B', 'C', 'D'] as const;
type GroupKey = typeof GROUP_ORDER[number];

const GROUP_COLORS: Record<GroupKey, string> = {
  A: '#22c55e',
  B: '#facc15',
  C: '#3b82f6',
  D: '#fb923c',
};

const HIGHLIGHT_HEX = '#ff0000';


const GROUP_LABELS: Record<GroupKey, string> = {
  A: 'Supplier',
  B: 'Material',
  C: 'Product',
  D: 'Customer',
};

interface SupplyChainData {
  id: string;
  plant_name: string;
  from_location: string;
  to_location: string;
  material_consumption_rate: number;
  sourcing_ratio: number;
  weighted: number;
  data_source?: string;
}

interface NodeData extends Record<string, unknown> {
  label: string;
  type: 'location';
  group?: GroupKey;
  incoming: number;
  outgoing: number;
  incomingFlow: number;
  outgoingFlow: number;
}

interface SupplierMaterialCount {
  supplier: string;
  count: number;
}

interface NetworkVisualizationProps {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

function buildGroupClassification(data: SupplyChainData[]): Record<string, GroupKey> {
  const locationGroups: Record<string, GroupKey> = {};

  // Group A: from_location where data_source = inbound
  // Group B: from_location where data_source = BOM
  // Group C: to_location where data_source = BOM
  // Group D: to_location where data_source = outbound

  data.forEach((d) => {
    if (d.data_source === 'inbound') {
      locationGroups[d.from_location] = 'A';
      locationGroups[d.to_location] = 'B';
    } else if (d.data_source === 'bom') {
      locationGroups[d.from_location] = 'B';
      locationGroups[d.to_location] = 'C';
    } else if (d.data_source === 'outbound') {
      locationGroups[d.from_location] = 'C';
      locationGroups[d.to_location] = 'D';
    }
  });

  return locationGroups;
}

function getLocationGroup(id: string, groupMap: Record<string, GroupKey>): GroupKey {
  return groupMap[id] || 'A'; // Default to group A if not found
}

export default function NetworkVisualization({ isCollapsed, setIsCollapsed }: NetworkVisualizationProps) {
  const { user } = useAuth();
  const { globalSelectedProjectId, setGlobalSelectedProjectId } = useGlobalProject();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const [loading, setLoading] = useState(false);
  const [groupCounts, setGroupCounts] = useState<Record<GroupKey, number>>({ A: 0, B: 0, C: 0, D: 0 });
  const [allNodes, setAllNodes] = useState<Node<NodeData>[]>([]);
  const [allEdges, setAllEdges] = useState<Edge[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [supplierVolumes, setSupplierVolumes] = useState<SupplierVolumeDatum[]>([]);
  const [supplierMaterialCounts, setSupplierMaterialCounts] = useState<SupplierMaterialCount[]>([]);
  const [networkMetrics, setNetworkMetrics] = useState<Array<{
    id: string;
    uid: string;
    name: string;
    revenue: number | null;
    degree_centrality: number | null;
    weighted_degree_centrality: number | null;
    eigenvector_centrality: number | null;
    betweenness_centrality: number | null;
    closeness_centrality: number | null;
    prominence: number | null;
    connection_count: number;
  }>>([]);
  const [networkMetricsLoading, setNetworkMetricsLoading] = useState(false);
  const [disruptionDialogOpen, setDisruptionDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'network' | 'map'>('network');
  const [countryRiskMap, setCountryRiskMap] = useState<Record<string, string>>({});
  // Add state for metrics metadata
  const [metricsMetadata, setMetricsMetadata] = useState<{
    lastCalculated: string | null;
    dataLastModified: string | null;
    reason: string;
  } | null>(null);
  // Add state for calculated risk metrics
  const [supplierMetrics, setSupplierMetrics] = useState({ supplierDiversity: 0, singleSourceRisk: '0%' });
  const [materialMetrics, setMaterialMetrics] = useState({ materialDiversity: 0, materialConcentrationRisk: '0%' });

  const fetchProjects = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase.rpc('list_projects', {
        p_user_id: user.id,
        p_user_email: user.email
      });
      
      if (error) throw error;
      setProjects(data || []);
    } catch (e) {
      console.error('Failed to fetch projects:', e);
      toast.error('Failed to load projects');
    }
  };

  const fetchNetworkMetrics = async (projectId: string, forceRecalculate = false) => {
    if (!user?.id || !user?.email) return;
    
    setNetworkMetricsLoading(true);
    try {
      // Check if recalculation is needed using smart cache validation
      if (!forceRecalculate) {
        const { data: cacheStatus, error: cacheError } = await supabase.rpc('should_recalculate_network_metrics', {
          p_project_id: projectId
        });

        if (cacheError) {
          console.error('Error checking cache status:', cacheError);
        } else if (cacheStatus && cacheStatus.length > 0) {
          const status = cacheStatus[0];
          console.log('Cache status:', status);
          
          if (!status.needs_recalculation) {
            // Fetch existing cached metrics
            const { data, error } = await supabase.rpc('get_network_metrics_for_materials', {
              p_project_id: projectId,
              p_user_id: user.id,
              p_user_email: user.email
            });

            if (error) {
              console.error('Error fetching cached metrics:', error);
              toast.error('Failed to load cached metrics');
              return;
            }

            if (data && data.length > 0) {
              setNetworkMetrics(data);
              setMetricsMetadata({
                lastCalculated: status.last_calculated,
                dataLastModified: status.data_last_modified,
                reason: status.reason
              });
              toast.success(`Loaded cached metrics (${status.reason})`);
              return;
            }
          }
        }
      }

      // Need to calculate metrics
      console.log('Network metrics calculation needed');
      toast.info('Calculating network metrics...');
      
      const computeLocalMetrics = async () => {
        try {
          const { data: scd, error: scdErr } = await supabase.rpc('get_supply_chain_data', {
            p_project_id: projectId,
            p_plant_name: null,
            p_user_id: user.id,
            p_user_email: user.email
          });
          if (scdErr) {
            console.error('Error fetching supply chain data for local metrics:', scdErr);
            return false;
          }
          const rows = (scd || []).filter((d: any) => d.data_source !== 'multi_tier');
          if (rows.length === 0) return false;  

          // Build adjacency (undirected) with weights
          const adjacency = new globalThis.Map<string, globalThis.Map<string, number>>();
          const allNodesSet = new globalThis.Set<string>();
          rows.forEach((r: any) => {
            const a = r.from_location as string;
            const b = r.to_location as string;
            const w = Number(r.weighted ?? 1) || 1;
            allNodesSet.add(a); allNodesSet.add(b);
            if (!adjacency.has(a)) adjacency.set(a, new globalThis.Map());
            if (!adjacency.has(b)) adjacency.set(b, new globalThis.Map());
            adjacency.get(a)!.set(b, (adjacency.get(a)!.get(b) || 0) + w);
            adjacency.get(b)!.set(a, (adjacency.get(b)!.get(a) || 0) + w);
          });
          const nodesArr = Array.from(allNodesSet);
          const n = nodesArr.length || 1;

          // Degree and weighted degree
          const degree: Record<string, number> = {};
          const wdegree: Record<string, number> = {};
          let maxW = 1;
          nodesArr.forEach(id => {
            const neigh = adjacency.get(id) || new globalThis.Map<string, number>();
            degree[id] = neigh.size / Math.max(1, n - 1);
            const sumW = Array.from(neigh.values()).reduce((s: number, v: number) => s + v, 0);
            wdegree[id] = sumW;
            if (sumW > maxW) maxW = sumW;
          });

          // Eigenvector (power iteration)
          const ev: Record<string, number> = {};
          nodesArr.forEach(id => ev[id] = 1);
          for (let iter = 0; iter < 40; iter++) {
            const next: Record<string, number> = {};
            let norm = 0;
            nodesArr.forEach(id => {
              let s = 0; (adjacency.get(id) || new globalThis.Map<string, number>()).forEach((w: number, nb: string) => { s += w * ev[nb]; });
              next[id] = s; norm += s * s;
            });
            norm = Math.sqrt(norm) || 1;
            nodesArr.forEach(id => { ev[id] = next[id] / norm; });
          }

          // Closeness (unweighted BFS)
          const clos: Record<string, number> = {};
          nodesArr.forEach(src => {
            const dist: Record<string, number> = {} as any;
            nodesArr.forEach(id => dist[id] = Infinity);
            dist[src] = 0;
            const q: string[] = [src];
            while (q.length) {
              const cur = q.shift()!;
              (adjacency.get(cur) || new globalThis.Map<string, number>()).forEach((_w: number, nb: string) => {
                if (dist[nb] === Infinity) { dist[nb] = dist[cur] + 1; q.push(nb); }
              });
            }
            const reachable = nodesArr.filter(id => dist[id] < Infinity && dist[id] > 0);
            clos[src] = reachable.length ? (reachable.length / reachable.reduce((s, d) => s + dist[d], 0)) : 0;
          });

          // Betweenness (sampled)
          const btw: Record<string, number> = {}; nodesArr.forEach(id => btw[id] = 0);
          const sample = nodesArr.slice(0, Math.min(30, nodesArr.length));
          sample.forEach(source => {
            const dist: Record<string, number> = {} as any;
            const pred: Record<string, string[]> = {} as any;
            const sigma: Record<string, number> = {} as any;
            nodesArr.forEach(id => { dist[id] = Infinity; pred[id] = []; sigma[id] = 0; });
            dist[source] = 0; sigma[source] = 1;
            const q: string[] = [source];
            while (q.length) {
              const v = q.shift()!;
              (adjacency.get(v) || new globalThis.Map<string, number>()).forEach((_w: number, nb: string) => {
                if (dist[nb] === Infinity) { dist[nb] = dist[v] + 1; q.push(nb); }
                if (dist[nb] === dist[v] + 1) { sigma[nb] += sigma[v]; pred[nb].push(v); }
              });
            }
            const dep: Record<string, number> = {} as any; nodesArr.forEach(id => dep[id] = 0);
            const order = nodesArr.filter(id => dist[id] < Infinity).sort((a,b) => dist[b]-dist[a]);
            order.forEach(w => {
              pred[w].forEach(v => { dep[v] += (sigma[v] / Math.max(1, sigma[w])) * (1 + dep[w]); });
              if (w !== source) btw[w] += dep[w];
            });
          });
          const norm = nodesArr.length > 2 ? 2 / ((nodesArr.length - 1) * (nodesArr.length - 2)) : 1;
          nodesArr.forEach(id => { btw[id] *= norm; });

          // Filter to materials only (group B)
          const groupMap = buildGroupClassification(rows as any);
          const materials = nodesArr.filter(id => groupMap[id] === 'B');
          const allIds = nodesArr;
          const maxBtw = Math.max(...allIds.map(id => btw[id] ?? 0), 1);
          const maxClos = Math.max(...allIds.map(id => clos[id] ?? 0), 1);

          const CONNECTION_WEIGHT_CAP = 20;
          const CENTRALITY_PARTNER_CAP = 15;

          const result = materials.map(id => ({
            id,
            uid: id,
            name: id,
            revenue: null,
            degree_centrality: degree[id] ?? 0,
            weighted_degree_centrality: maxW ? (wdegree[id] / maxW) : 0,
            eigenvector_centrality: ev[id] ?? 0,
            betweenness_centrality: btw[id] ?? 0,
            closeness_centrality: clos[id] ?? 0,
            prominence: (() => {
              const totalConn = (adjacency.get(id)?.size || 0);
              const inConn    = rows.filter((r: any) => r.to_location   === id).length;
              const outConn   = rows.filter((r: any) => r.from_location === id).length;
              const totalIO   = inConn + outConn;

              const connectionWeight  = Math.min(totalConn, CONNECTION_WEIGHT_CAP) / CONNECTION_WEIGHT_CAP;
              const revenueWeight     = 0;
              const balanceWeight     = totalIO > 0
                ? 1 - Math.abs(inConn - outConn) / totalIO : 0;
              const betweennessApprox = Math.min(totalConn, CENTRALITY_PARTNER_CAP) / CENTRALITY_PARTNER_CAP;
              const eigenvectorWeight = (ev[id] ?? 0);        // already normalized via power iteration
              const closenessWeight   = maxClos ? ((clos[id] ?? 0) / maxClos) : 0;

              return Math.min(Math.max(
                connectionWeight  * 0.60 +  // was 0.80
                revenueWeight     * 0.05 +
                balanceWeight     * 0.05 +
                betweennessApprox * 0.10 +
                eigenvectorWeight * 0.10 +  // NEW
                closenessWeight   * 0.10,   // NEW
              0), 1);
            })(),
            connection_count: (adjacency.get(id)?.size || 0),
          }));

          setNetworkMetrics(result);
          toast.success('Computed network metrics locally');
          return true;
        } catch (e) {
          console.error('Local metrics computation failed:', e);
          return false;
        }
      };

      const { error: calcError } = await supabase.functions.invoke('calculate-network-science-metrics', {
        body: { project_id: projectId }
      });

      if (calcError) {
        console.error('Error calculating network metrics:', calcError);
        const ok = await computeLocalMetrics();
        if (!ok) toast.error('Failed to calculate network metrics');
        return;
      }

      // Fetch the calculated metrics
      const { data: calculatedData, error: fetchError } = await supabase.rpc('get_network_metrics_for_materials', {
        p_project_id: projectId,
        p_user_id: user.id,
        p_user_email: user.email
      });

      if (fetchError) {
        console.error('Error fetching calculated metrics:', fetchError);
        const ok = await computeLocalMetrics();
        if (!ok) toast.error('Failed to load calculated metrics');
        return;
      }

      if (!calculatedData || calculatedData.length === 0) {
        const ok = await computeLocalMetrics();
        if (!ok) toast.info('No network metrics available');
        return;
      }

      setNetworkMetrics(calculatedData || []);
      setMetricsMetadata(null); // Clear metadata for fresh calculation
      toast.success('Network metrics calculated successfully');
    } catch (error) {
      console.error('Error in fetchNetworkMetrics:', error);
      toast.error('Failed to process network metrics');
    } finally {
      setNetworkMetricsLoading(false);
    }
  };
    
  const fetchData = async () => {
    console.log('🔍 fetchData called with:', { 
      hasUser: !!user, 
      selectedProject: globalSelectedProjectId
    });

    if (!user || !globalSelectedProjectId) {
      console.log('❌ Clearing data - no user or project');
      setNodes([]);
      setEdges([]);
      setAllNodes([]);
      setAllEdges([]);
      setGroupCounts({ A: 0, B: 0, C: 0, D: 0 });
      setSelectedNode(null);
      setFocusedNode(null);
      setSupplierVolumes([]);
      setSupplierMaterialCounts([]);
      return;
    }

    setLoading(true);
    
    try {
      console.log('📡 Fetching data for project:', globalSelectedProjectId);
      const [
        { data: scData, error: scError },
        { data: riskData, error: riskError }
      ] = await Promise.all([
        supabase.rpc('get_supply_chain_data', {
          p_project_id: globalSelectedProjectId,
          p_plant_name: null, 
          p_user_id: user.id,
          p_user_email: user.email
        }),
        supabase.from('risk_data').select('COUNTRY, "RISK CLASS"')
      ]);
      
      if (scError) {
        console.error('❌ Database error:', scError);
        throw scError;
      }

      if (riskError) {
        console.warn('⚠️ Could not load risk data:', riskError);
      }

      // 🚨 ADD THIS: Build the map exactly like we did in FirmLevel
      if (riskData) {
        const riskMap: Record<string, string> = {};
        riskData.forEach(row => {
          const countryVal = row['COUNTRY'] || row['country']; 
          const riskVal = row['RISK CLASS'] || row['risk class'] || row['risk_class'];
          if (countryVal) {
            riskMap[countryVal.trim().toUpperCase()] = riskVal;
          }
        });
        setCountryRiskMap(riskMap);
      }

      // Reassign scData to 'data' so the rest of your existing code works without changes
      const data = scData;

      console.log('✅ Supply chain data fetched:', data?.length, 'records');
      
      if (!data || data.length === 0) {
        console.log('⚠️ No data for selected project');
        toast.error(`No data found for project`);
        return;
      }

      // Filter out multi-tier data sources from the product-level network
      const filteredData = data.filter((d: SupplyChainData) => d.data_source !== 'multi_tier');

      setSupplierVolumes(aggregateSupplierVolumes(filteredData));

      // Build group classification map based on data source logic
      const groupMap = buildGroupClassification(filteredData);

      const supplierMaterialMap: { [key: string]: Set<string> } = {};
      filteredData.forEach((d: SupplyChainData) => {
        const fromGroup = getLocationGroup(d.from_location, groupMap);
        const toGroup = getLocationGroup(d.to_location, groupMap);
        
        // Group A (inbound suppliers) -> Group B (BOM materials)
        if (fromGroup === 'A' && toGroup === 'B') {
          if (!supplierMaterialMap[d.from_location]) {
            supplierMaterialMap[d.from_location] = new Set();
          }
          supplierMaterialMap[d.from_location].add(d.to_location);
        }
      });
      setSupplierMaterialCounts(
        Object.entries(supplierMaterialMap)
          .map(([supplier, materials]) => ({
            supplier,
            count: materials.size,
          }))
          .sort((a, b) => b.count - a.count)
      );

      // Calculate risk metrics
      const calculatedSupplierMetrics = calculateSupplierMetrics(filteredData);
      const calculatedMaterialMetrics = calculateMaterialMetrics(filteredData);
      setSupplierMetrics(calculatedSupplierMetrics);
      setMaterialMetrics(calculatedMaterialMetrics);

      const nodeMap: { [key: string]: NodeData } = {};
      const edgeMap: { [key: string]: Edge } = {};

      filteredData.forEach((d: SupplyChainData) => {
        const fromGroup = getLocationGroup(d.from_location, groupMap);
        const toGroup = getLocationGroup(d.to_location, groupMap);

        if (!nodeMap[d.from_location]) {
          nodeMap[d.from_location] = {
            label: d.from_location,
            type: 'location',
            group: fromGroup,
            incoming: 0,
            outgoing: 0,
            incomingFlow: 0,
            outgoingFlow: 0,
          };
        }
        if (!nodeMap[d.to_location]) {
          nodeMap[d.to_location] = {
            label: d.to_location,
            type: 'location',
            group: toGroup,
            incoming: 0,
            outgoing: 0,
            incomingFlow: 0,
            outgoingFlow: 0,
          };
        }

        nodeMap[d.from_location].outgoing++;
        nodeMap[d.from_location].outgoingFlow += d.weighted;
        nodeMap[d.to_location].incoming++;
        nodeMap[d.to_location].incomingFlow += d.weighted;

        const edgeKey = `${d.from_location}-${d.to_location}`;
        if (!edgeMap[edgeKey]) {
          edgeMap[edgeKey] = {
            id: edgeKey,
            source: d.from_location,
            target: d.to_location,
            style: {
              stroke: '#8C8C8C',
              strokeWidth: 1.5,
              strokeOpacity: 0.6,
            },
            type: 'straight',
            data: { weight: d.weighted },
          };
        }
      });

      // Filter out nodes with zero incoming and outgoing flow
      const originalNodeCount = Object.keys(nodeMap).length;
      const filteredNodeMap = Object.fromEntries(
        Object.entries(nodeMap).filter(([id, node]) => 
          !(node.incomingFlow === 0 && node.outgoingFlow === 0)
        )
      );
      const filteredCount = originalNodeCount - Object.keys(filteredNodeMap).length;

      // Also filter edges to only include those connecting filtered nodes
      const filteredNodeIds = new Set(Object.keys(filteredNodeMap));
      const filteredEdgeMap = Object.fromEntries(
        Object.entries(edgeMap).filter(([key, edge]) => 
          filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
        )
      );

      const grouped: Record<GroupKey, string[]> = { A: [], B: [], C: [], D: [] };
      for (const [id, node] of Object.entries(filteredNodeMap)) {
        grouped[node.group || 'A'].push(id);
      }
      
      console.log('📊 Node groups (after filtering):', {
        suppliers: grouped.A.length,
        materials: grouped.B.length,
        products: grouped.C.length,
        customers: grouped.D.length,
        filtered: filteredCount
      });
      
      setGroupCounts({ A: grouped.A.length, B: grouped.B.length, C: grouped.C.length, D: grouped.D.length });

      const nodeList: Node<NodeData>[] = [];
      const columnX = isCollapsed ? 250 : 220;
      const columnGap = 350;
      const rowGap = 60;

      GROUP_ORDER.forEach((group, colIdx) => {
        const ids = grouped[group];
        const x = columnX + colIdx * columnGap;
        const nodeSize = Math.max(50 - Math.log(Object.keys(filteredNodeMap).length) * 3, 30) * 1.05;

        const subgroupCount = ids.length >= 20 ? Math.ceil(ids.length / 20) : 1;
        const spacing = nodeSize * 1.2;
        const subgroupOffsets = Array.from({ length: subgroupCount }, (_, i) =>
          (i - (subgroupCount - 1) / 2) * spacing
        );

        const subgroups = Array.from({ length: subgroupCount }, () => [] as string[]);
        ids.forEach((id, idx) => subgroups[idx % subgroupCount].push(id));

        subgroups.forEach((subIds, si) => {
          const isOffsetGroup = (group === 'A' || group === 'B') && si % 2 === 1;
          const additionalY = isOffsetGroup ? rowGap * 0.5 : 0;
          const yOffset = -((subIds.length - 1) * rowGap) / 2 + additionalY;

          subIds.forEach((id, i) => {
            const data = filteredNodeMap[id];
            nodeList.push({
              id,
              position: { x: x + subgroupOffsets[si], y: yOffset + i * rowGap },
              data,
              style: {
                background: GROUP_COLORS[data.group || 'A'],
                color: 'white',
                width: nodeSize,
                height: nodeSize * 0.62,
                fontSize: 10,
                fontWeight: 'bold',
                borderRadius: 8,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                textAlign: 'center',
              },
              type: 'default',
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
            });
          });
        });
      });

      setNodes(nodeList);
      setEdges(Object.values(filteredEdgeMap));
      setAllNodes(nodeList);
      setAllEdges(Object.values(filteredEdgeMap));
      console.log('✅ Visualization updated with', nodeList.length, 'nodes and', Object.keys(filteredEdgeMap).length, 'edges');
      const message = filteredCount > 0 
        ? `Loaded ${filteredData.length} records for project (${filteredCount} zero-flow nodes filtered out)`
        : `Loaded ${filteredData.length} records for project`;
      toast.success(message);
    } catch (e) {
      console.error('❌ fetchData error:', e);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchProjects();
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [globalSelectedProjectId, user]);

  // Auto-fetch network metrics when analytics are shown
  useEffect(() => {
    if (showAnalytics && globalSelectedProjectId && user) {
      fetchNetworkMetrics(globalSelectedProjectId);
    }
  }, [showAnalytics, globalSelectedProjectId, user]);

  // Manual refresh function
  const handleRefreshMetrics = async () => {
    if (!globalSelectedProjectId) return;
    await fetchNetworkMetrics(globalSelectedProjectId, true);
  };

  useEffect(() => {
    if (!focusedNode) {
      setNodes(allNodes);
      setEdges(allEdges);
      return;
    }
  
    const node = allNodes.find(n => n.id === focusedNode);
    if (!node) return;
  
    const group = node.data.group;
    const included = new Set<string>([node.id]);
  
    const getTargets = (sources: Set<string>, targetGroup: GroupKey) =>
      new Set(
        allEdges
          .filter(e => {
            const sourceNode = allNodes.find(n => n.id === e.source);
            const targetNode = allNodes.find(n => n.id === e.target);
            return sources.has(e.source as string) && targetNode?.data.group === targetGroup;
          })
          .map(e => e.target as string)
      );
  
    const getSources = (targets: Set<string>, sourceGroup: GroupKey) =>
      new Set(
        allEdges
          .filter(e => {
            const sourceNode = allNodes.find(n => n.id === e.source);
            const targetNode = allNodes.find(n => n.id === e.target);
            return targets.has(e.target as string) && sourceNode?.data.group === sourceGroup;
          })
          .map(e => e.source as string)
      );
  
    let A = new Set<string>(), B = new Set<string>(), C = new Set<string>(), D = new Set<string>();
  
    if (group === 'A') {
      B = getTargets(new Set([node.id]), 'B');
      C = getTargets(B, 'C');
      D = getTargets(C, 'D');
      [B, C, D].forEach(set => set.forEach(id => included.add(id)));
    } else if (group === 'B') {
      A = getSources(new Set([node.id]), 'A');
      C = getTargets(new Set([node.id]), 'C');
      D = getTargets(C, 'D');
      [A, C, D].forEach(set => set.forEach(id => included.add(id)));
    } else if (group === 'C') {
      B = getSources(new Set([node.id]), 'B');
      A = getSources(B, 'A');
      D = getTargets(new Set([node.id]), 'D');
      [A, B, D].forEach(set => set.forEach(id => included.add(id)));
    } else if (group === 'D') {
      C = getSources(new Set([node.id]), 'C');
      B = getSources(C, 'B');
      A = getSources(B, 'A');
      [A, B, C].forEach(set => set.forEach(id => included.add(id)));
    }
  
    const subNodes = allNodes.filter(n => included.has(n.id));
    const subEdges = allEdges.filter(
      e => included.has(e.source as string) && included.has(e.target as string)
    );
  
    setNodes(subNodes);
    setEdges(subEdges);
  }, [focusedNode, allNodes, allEdges]);


  useEffect(() => {
    const updatedEdges = allEdges.map(edge => {
      if (selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id)) {
        return { ...edge, style: { stroke: '#3b82f6', strokeWidth: 1.8, strokeOpacity: 0.8 } };
      } else {
        return { ...edge, style: { stroke: '#8C8C8C', strokeWidth: 1.2, strokeOpacity: 0.5 } };
      }
    });
    setEdges(updatedEdges);
  }, [selectedNode]);


  useEffect(() => {
    const term = searchTerm.trim();
  
    // Apply highlight on top of the current visible set of nodes (works with or without focus mode)
    setNodes((current) => {
      return current.map((n) => {
        // Find the baseline node (for original size/color) from allNodes
        const base = allNodes.find((b) => b.id === n.id) || n;
        const baseStyle: any = base.style || {};
  
        const isHit = term !== '' && n.id === term;
  
        // Safely read numeric width/height; if undefined, leave as-is
        const baseWidth =
          typeof baseStyle.width === 'number'
            ? baseStyle.width
            : parseFloat(baseStyle.width) || baseStyle.width;
        const baseHeight =
          typeof baseStyle.height === 'number'
            ? baseStyle.height
            : parseFloat(baseStyle.height) || baseStyle.height;
  
        const factor = isHit ? 1.1 : 1;
  
        return {
          ...n,
          style: {
            ...baseStyle,
            // change color only when it matches exactly
            background: isHit ? HIGHLIGHT_HEX : baseStyle.background,
            // increase size by 10% for the found node (if numeric sizes exist)
            width: typeof baseWidth === 'number' ? baseWidth * factor : baseWidth,
            height: typeof baseHeight === 'number' ? baseHeight * factor : baseHeight,
          },
        };
      });
    });
  }, [searchTerm, allNodes]);


  const onNodeClick: NodeMouseHandler = useCallback((_, node) => setSelectedNode(node as Node<NodeData>), []);
  const onNodeDoubleClick: NodeMouseHandler = useCallback((_, node) => {
    const id = node.id;
    setFocusedNode(prev => (prev === id ? null : id));
  }, []);
  const onConnect = useCallback((params: Connection) => setEdges(eds => addEdge(params, eds)), []);

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className={PAGE_GUTTER}>
        <PageHeader
          title="Product-level Network Intelligence"
          subtitle={`Multipartile networks of ${groupCounts.A} supplier${groupCounts.A !== 1 ? 's' : ''}, ${groupCounts.B} material${groupCounts.B !== 1 ? 's' : ''}, ${groupCounts.C} product${groupCounts.C !== 1 ? 's' : ''}, ${groupCounts.D} customer${groupCounts.D !== 1 ? 's' : ''}`}
          onRefresh={fetchData}
          refreshLoading={loading}
          rightContent={
            <div className="flex items-center space-x-2">
              {selectedNode && (
                <>
                  <Button
                    onClick={() => setDisruptionDialogOpen(true)}
                    variant="outline"
                    size="sm"
                    className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </Button>
                </>
              )}
              
              {searchOpen ? (
                <div className="relative w-48 transition-all">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <input
                    autoFocus
                    type="text"
                    className="h-9 min-h-11 md:min-h-0 pl-9 pr-3 border border-border rounded-md text-sm bg-background focus:outline-none w-full"
                    placeholder="find a node"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onBlur={() => !searchTerm && setSearchOpen(false)}
                  />
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchOpen(true)}
                >
                  <Search className="h-4 w-4" />
                </Button>
              )}

              <Button
                variant={showAnalytics ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowAnalytics(!showAnalytics)}
              >
                <BarChart className="h-4 w-4" />
              </Button>

              <Button
                variant={viewMode === 'map' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode(viewMode === 'network' ? 'map' : 'network')}
              >
                {viewMode === 'network' ? <MapIcon className="h-4 w-4" /> : <Network className="h-4 w-4" />}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefreshMetrics}
                disabled={networkMetricsLoading}
              >
                <RotateCcw className="w-4 h-4 mr-1" />
                Refresh
              </Button>

              <Select value={globalSelectedProjectId || ''} onValueChange={setGlobalSelectedProjectId}>
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue placeholder="Select Project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

            {/* Graph Canvas or Map View */}
            <div className="lg:col-span-3">
              <Card className="h-[560px]">
                <CardContent className="p-0 h-full relative">
                  {viewMode === 'network' ? (
                    <>
                      <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeClick={onNodeClick}
                        onNodeDoubleClick={onNodeDoubleClick}
                        fitView
                        attributionPosition="bottom-left"
                      >
                        <Background />
                        <Controls />
                        <MiniMap
                          nodeColor={(node) => GROUP_COLORS[(node.data as NodeData).group || 'A']}
                          zoomable
                          pannable
                        />
                      </ReactFlow>
                      <p className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-[10px] text-muted-foreground text-center">
                        Click/double-click node to select and add disruptions • Double-click to focus supply chain path
                      </p>
                      {focusedNode && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setFocusedNode(null)}
                          className="absolute top-2 right-2"
                        >
                          <RotateCcw className="h-4 w-4" />
                          <span className="sr-only">Show All Nodes</span>
                        </Button>
                      )}
                    </>
                  ) : (
                     <MapView
                      nodes={nodes}
                      selectedNode={selectedNode}
                      onNodeClick={(node) => setSelectedNode(node)}
                      projectId={globalSelectedProjectId}
                      plantData={projects.find(p => p.id === globalSelectedProjectId) ?? null}
                      countryRiskMap={countryRiskMap}
                    />
                  )}
                  {!globalSelectedProjectId && (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground pointer-events-none">
                      Please select a project
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-1 flex flex-col space-y-6 w-full">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Node Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedNode ? (
                    <>
                      <div>
                        <h3 className="font-semibold text-lg">{selectedNode.data.label}</h3>
                        <Badge
                          variant="secondary"
                          style={{
                            backgroundColor: GROUP_COLORS[selectedNode.data.group || 'A'],
                            color: 'white',
                          }}
                        >
                          {GROUP_LABELS[selectedNode.data.group || 'A']}
                        </Badge>
                      </div>
                      <Separator />
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Incoming Connections:</span>
                          <span className="font-normal">{selectedNode.data.incoming}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Incoming Flow:</span>
                          <span className="font-normal">{selectedNode.data.incomingFlow.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Outgoing Connections:</span>
                          <span className="font-normal">{selectedNode.data.outgoing}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Outgoing Flow:</span>
                          <span className="font-normal">{selectedNode.data.outgoingFlow.toFixed(2)}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-muted-foreground">
                      <Network className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>Click a node to view details</p>
                    </div>
                  )}
                </CardContent>
              </Card>
              <MLPrediction selectedPlant={
                globalSelectedProjectId 
                  ? projects.find(p => p.id === globalSelectedProjectId)?.plant_name || null
                  : null
              } />
            </div>
          </div>

          {showAnalytics && (
            <div className="grid grid-cols-1 gap-6 mt-6">
              <SupplierVolumeChart
                data={supplierVolumes}
                materialDiversity={String(materialMetrics.materialDiversity)}
                materialConcentrationRisk={materialMetrics.materialConcentrationRisk}
                sidebarCollapsed={isCollapsed}
              />
              <SupplierMaterialChart
                data={supplierMaterialCounts}
                supplierDiversity={String(supplierMetrics.supplierDiversity)}
                singleSourceRisk={supplierMetrics.singleSourceRisk}
                sidebarCollapsed={isCollapsed}
              />
              <NetworkMetricsTable
                metrics={networkMetrics}
                loading={networkMetricsLoading}
              />
              {metricsMetadata && (
                <div className="mt-2 p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      Last calculated: {metricsMetadata.lastCalculated 
                        ? new Date(metricsMetadata.lastCalculated).toLocaleString()
                        : 'Never'
                      }
                    </span>
                    <span className="text-xs">
                      {metricsMetadata.reason}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

      <DisruptionDialog
        open={disruptionDialogOpen}
        onOpenChange={setDisruptionDialogOpen}
        nodeId={selectedNode?.id || null}
        projectId={globalSelectedProjectId}
        plantName={projects.find(p => p.id === globalSelectedProjectId)?.plant_name || 'Unknown Plant'}
        connectedEdges={selectedNode ? allEdges.filter(edge => 
          edge.source === selectedNode.id || edge.target === selectedNode.id
        ) : []}
        onSuccess={fetchData}
      />
    </PageLayout>
  );
}