// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import { Suspense, lazy, useEffect, useState, useCallback, useMemo } from 'react';
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
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { supabase } from '@/integrations/supabase/client';
import { buildProductLevelGraph, edgeWidthForFlow, maxFlow, GRAPH_INK, type FlatLaneRow } from '@/lib/graph';
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
import {
  PageLayout,
  PageHeader,
  HeaderRefreshButton,
  PAGE_GUTTER,
  PAGE_GUTTER_SKIN,
  HDR_GHOST_BUTTON,
  HDR_ICON_BUTTON,
  HDR_ICON_BUTTON_ON,
  HDR_PROJECT_SELECT,
  HDR_SEARCH_INPUT,
} from '@/components/shared';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';
import MLPrediction from '@/components/MLPrediction';
import SupplierVolumeChart, { SupplierVolumeDatum, aggregateSupplierVolumes } from '@/components/SupplierVolumeChart';
import SupplierMaterialChart from '@/components/SupplierMaterialChart';
import { DisruptionDialog } from '@/components/DisruptionDialog';
// See the note in FirmLevelNetwork.tsx — mapbox-gl loads only when the user
// actually switches this card to map view.
const MapView = lazy(() => import('@/components/MapView'));
import { NetworkMetricsTable } from '@/components/NetworkMetricsTable';
import { calculateSupplierMetrics, calculateMaterialMetrics } from '@/utils/networkMetrics';
import { MobileGroup, MobilePageHeader, ProjectChip } from '@/components/mobile';
import { RiskDataNotice } from '@/components/network/RiskDataNotice';
import {
  LensChip,
  LensSection,
  LensHowToRead,
  LensDesktopOnlyNote,
  LensStructure,
  LensRisk,
  LensTable,
  LensAction,
} from '@/components/network/MobileLens';

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

/**
 * The four columns this page draws, DERIVED — WP 8.4 · §4 D127.
 *
 * `buildGroupClassification` and `getLocationGroup` used to live here. They assigned a
 * node to a column by the LANE that produced each row, letting the last row win — so a
 * sub-assembly, which is a bom source AND a bom target, landed in the Material column
 * or the Product column depending on the order the rows came back from the database.
 * `getLocationGroup` then defaulted anything unrecognised to **A, Supplier**, which is
 * a value displayed for data that does not carry it (T1).
 *
 * Both are gone. `buildProductLevelGraph` resolves every node's echelon once, from the
 * lane ROLES it holds rather than from one row, collapses the bill of materials to
 * purchased-material → finished-product, and recomputes the edge flows so they describe
 * the path actually drawn.
 */

export default function NetworkVisualization({ isCollapsed, setIsCollapsed }: NetworkVisualizationProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
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
  // D4: `risk_data` gained its migration in WP 1.4, so the read now succeeds
  // against a real table — but an EMPTY one until an operator loads a vintage.
  // The page used to warn to the console and render an unshaded graph as if
  // nothing were missing; it says so on screen instead (RiskDataNotice).
  const [riskDataError, setRiskDataError] = useState<string | null>(null);
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
      // WP 4.4 · THE ONE STALENESS RULE, asked directly.
      //
      // This called `should_recalculate_network_metrics`, which compared
      // `last_data_time > last_calc_time` — whether a CLOCK moved, which an
      // UPDATE writing the same value answers yes to and a restored backup
      // answers no to (§4 D12). `project_freshness` asks the one question worth
      // asking: does every computed row name the dataset now loaded?
      //
      // `unknown` is treated as "recompute", which is `is_stale`'s collapse and
      // the only safe direction for a branch that can go two ways — but the
      // BADGE beside this view shows the third state, because telling a user a
      // number is out of date when nothing can say is T1 answered with a guess.
      if (!forceRecalculate) {
        const { data: freshness, error: cacheError } = await supabase.rpc('project_freshness', {
          p_project_id: projectId
        });

        if (cacheError) {
          console.error('Error checking freshness:', cacheError);
        } else if (freshness) {
          const nodes = (freshness as { tables?: Record<string, { rows?: number; fresh?: number }> })
            .tables?.network_nodes;
          const allFresh = (nodes?.rows ?? 0) > 0 && (nodes?.fresh ?? 0) === (nodes?.rows ?? 0);
          console.log('Freshness:', nodes);

          if (allFresh) {
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
                lastCalculated: nodes?.computed_at ?? null,
                // WP 4.4 · deliberately null. "When did the data last change" is
                // the question §4 D12 says is the wrong one, and there is no
                // honest value for it — inventing one would be a fabricated
                // source (T1). The hash below is the answer that replaces it.
                dataLastModified: null,
                reason: `every computed row names the dataset now loaded (${
                  (freshness as { graph_hash_short?: string }).graph_hash_short ?? 'hash unknown'
                })`
              });
              toast.success('Loaded stored metrics — they name the dataset now loaded');
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

          // Materials only, from the ONE rule (WP 8.4 · §4 D127). This used to call
          // `buildGroupClassification`, which assigns by lane with the LAST ROW
          // WINNING — so which nodes counted as materials depended on the order the
          // rows came back in, and a sub-assembly counted or did not at random.
          const materialSet = new Set(
            [...buildProductLevelGraph(rows as unknown as FlatLaneRow[]).nodes]
              .filter(([, v]) => v.echelon === 'material')
              .map(([id]) => id),
          );
          const materials = nodesArr.filter(id => materialSet.has(id));
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

      // WP 4.3 · the analyzer writes tier 3 through an RPC that takes the
      // actor, so the actor travels with the request (invariant audit-actor).
      const { error: calcError } = await supabase.functions.invoke('calculate-network-science-metrics', {
        body: { project_id: projectId, uploaded_by: user?.id }
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
        supabase.from('risk_data').select('country, risk_class')
      ]);
      
      if (scError) {
        console.error('❌ Database error:', scError);
        throw scError;
      }

      // D4: the risk table is optional to the graph but NOT invisible when it
      // fails — an empty risk map renders every node as "Unknown", which reads
      // as an answer rather than as a missing source.
      if (riskError) {
        console.warn('⚠️ Could not load risk data:', riskError);
        setRiskDataError(riskError.message ?? String(riskError));
        setCountryRiskMap({});
      } else if (riskData) {
        const riskMap: Record<string, string> = {};
        riskData.forEach(row => {
          // WP 1.4: snake_case columns, and a CHECK that the stored country is
          // already `upper(btrim(...))` — see 20260915000003_risk_data.sql.
          if (row.country) {
            riskMap[row.country.trim().toUpperCase()] = row.risk_class;
          }
        });
        setRiskDataError(Object.keys(riskMap).length === 0 ? 'The risk_data table returned no rows.' : null);
        setCountryRiskMap(riskMap);
      } else {
        setRiskDataError('The risk_data table returned no rows.');
        setCountryRiskMap({});
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

      console.log('Unique data_source values:', [...new Set(filteredData.map(d => d.data_source))]);
      console.log('Sample row:', filteredData[0]);

      setSupplierVolumes(aggregateSupplierVolumes(filteredData));

      // How many distinct materials each supplier delivers. Read off the INBOUND lane
      // directly: that lane IS "a supplier delivers this material", so it needs no
      // classification at all — which is why the group lookup it used to do was both
      // indirect and order-dependent (§4 D127).
      const supplierMaterialMap: { [key: string]: Set<string> } = {};
      filteredData.forEach((d: SupplyChainData) => {
        if ((d.data_source ?? '').toLowerCase() !== 'inbound') return;
        const supplier = (d.from_location ?? '').trim();
        const material = (d.to_location ?? '').trim();
        if (!supplier || !material) return;
        if (!supplierMaterialMap[supplier]) supplierMaterialMap[supplier] = new Set();
        supplierMaterialMap[supplier].add(material);
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

      // ── FOUR ECHELONS, AND THE BOM COLLAPSED (WP 8.4 · §4 D127, D136) ─────
      //
      // This page is Supplier → purchased Material → finished Product → Customer, and
      // nothing else. The material is the one a supplier actually DELIVERS — the
      // purchased leaf of the bill of materials — and the product is the one a customer
      // actually BUYS. Everything the plant builds in between belongs to the
      // Process-level view, and is collapsed away here.
      //
      // IT USED TO DRAW THE WHOLE BOM TREE. The deployed ETL writes the bom lane as
      // `material → IMMEDIATE PARENT`, one row per BOM row, so `supply_chain_data`
      // holds the tree and this page drew it. Worse, a sub-assembly is a bom
      // `from_location` (a material) AND a bom `to_location` (a product), and
      // `buildGroupClassification` assigned groups by lane with the LAST ROW WINNING —
      // so every sub-assembly landed in the Material column or the Product column
      // depending on the order the rows came back in.
      //
      // AND THE EDGES ARE RECOMPUTED, NOT JUST THE NODES. Collapsing nodes while
      // keeping the old weights would leave every material→product edge describing one
      // BOM hop of a path it no longer draws. `buildProductLevelGraph` propagates the
      // product's demand down the tree — the product of the consumption rates along
      // every path — and SUMS the paths when a material reaches the same product more
      // than one way, because it is needed for all of them.
      const productGraph = buildProductLevelGraph(filteredData);

      const nodeMap: { [key: string]: NodeData } = {};
      const edgeMap: { [key: string]: Edge } = {};

      const GROUP_OF_ECHELON: Record<string, GroupKey> = {
        supplier: 'A',
        material: 'B',
        product: 'C',
        customer: 'D',
      };

      for (const [nodeId, { echelon }] of productGraph.nodes) {
        nodeMap[nodeId] = {
          label: nodeId,
          type: 'location',
          // The page's A/B/C/D columns, now DERIVED from the echelon rather than from
          // whichever lane row was read last. `subassembly`, `plant` and `unknown`
          // cannot appear here: this view has no column for them, which is what
          // collapsing the BOM means.
          group: GROUP_OF_ECHELON[echelon] ?? 'B',
          incoming: 0,
          outgoing: 0,
          incomingFlow: 0,
          outgoingFlow: 0,
        };
      }

      for (const e of productGraph.edges) {
        const from = nodeMap[e.source];
        const to = nodeMap[e.target];
        if (!from || !to) continue;

        from.outgoing++;
        from.outgoingFlow += e.flow;
        to.incoming++;
        to.incomingFlow += e.flow;

        const edgeKey = `${e.source}-${e.target}`;
        if (!edgeMap[edgeKey]) {
          edgeMap[edgeKey] = {
            id: edgeKey,
            source: e.source,
            target: e.target,
            style: {
              stroke: GRAPH_INK.edge,
              // WIDTH ENCODES FLOW. It was a flat 1.5 on every edge while `weighted`
              // was loaded, stored and never rendered — an encoding carrying no data.
              strokeWidth: edgeWidthForFlow(e.flow, maxFlow(productGraph.edges)),
              strokeOpacity: 0.65,
            },
            type: 'straight',
            // DIRECTION IS VISIBLE. These lanes are directed and the graph read as
            // undirected because nothing drew an arrowhead.
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: GRAPH_INK.edge },
            data: { weight: e.flow, lane: e.lane },
          };
        }
      }

      // T3 — a view states the limit of its own computation, at the point of display.
      if (productGraph.unreachedMaterials.length > 0) {
        const sample = productGraph.unreachedMaterials.slice(0, 5).join(', ');
        toast.warning(
          `${productGraph.unreachedMaterials.length} purchased material(s) reach no finished ` +
            `product through the bill of materials, so they connect to nothing on this view: ` +
            `${sample}${productGraph.unreachedMaterials.length > 5 ? ' …' : ''}. ` +
            `Either the BOM does not link them, or their product is not in outbound logistics.`,
          { duration: 10000 },
        );
      }
      console.log(
        `[ProductLevelNetwork] four echelons · ${Object.keys(nodeMap).length} nodes · ` +
          `${Object.keys(edgeMap).length} edges · ${productGraph.collapsedIntermediates} ` +
          `intermediate assemblies collapsed · ${productGraph.unreachedMaterials.length} materials reach no product`,
      );

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
      const rowGap = 60;
      const baseColumnPadding = 150;

      // nodeSize is the same for every node, so compute it once up front
      const nodeSize = Math.max(50 - Math.log(Object.keys(filteredNodeMap).length) * 3, 30) * 1.05;
      const spacing = nodeSize * 1.2;

      // How wide each column's node cluster actually spreads, based on its own count
      const columnWidths = GROUP_ORDER.map((group) => {
        const count = grouped[group].length;
        const subgroupCount = count >= 20 ? Math.ceil(count / 20) : 1;
        return (subgroupCount - 1) * spacing + nodeSize;
      });

      // Turn those widths into center x-positions, packing columns with baseColumnPadding between them
      const columnCenters: number[] = [];
      let rightEdge = columnX;
      GROUP_ORDER.forEach((_, i) => {
        const width = columnWidths[i];
        const center = rightEdge + width / 2;
        columnCenters.push(center);
        rightEdge = center + width / 2 + baseColumnPadding;
      });

      GROUP_ORDER.forEach((group, colIdx) => {
        const ids = grouped[group];
        const x = columnCenters[colIdx];

        const subgroupCount = ids.length >= 20 ? Math.ceil(ids.length / 20) : 1;
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

  const mobileProductMetrics = useMemo(() => {
    const totalNodes = (groupCounts.A || 0) + (groupCounts.B || 0) + (groupCounts.C || 0) + (groupCounts.D || 0);
    const networkDepth = ['A', 'B', 'C', 'D'].filter(k => (groupCounts[k as GroupKey] || 0) > 0).length;
    const totalVolume = supplierVolumes.reduce((s, v) => s + v.volume, 0);
    let hhi = 0;
    if (totalVolume > 0) supplierVolumes.forEach(v => { const s = v.volume / totalVolume; hhi += s * s; });
    const peakBetweenness = networkMetrics.reduce((m, n) => Math.max(m, n.prominence ?? 0), 0);
    const nexusMaterials = networkMetrics.filter(n => (n.prominence ?? 0) >= 0.8).length;
    const hasSPOF = nexusMaterials > 0;
    const resilience = (hasSPOF ? 0 : 0.4) + 0.3 * (1 - hhi) + 0.3 * (1 - peakBetweenness);
    const topNexus = [...networkMetrics].sort((a, b) => (b.prominence ?? 0) - (a.prominence ?? 0))[0];
    return {
      totalNodes,
      networkDepth,
      hhi: hhi.toFixed(3),
      resilience: resilience.toFixed(3),
      resilienceRed: resilience < 0.4,
      nexusMaterials,
      hasSPOF,
      topNexusName: topNexus?.name ?? null,
    };
  }, [groupCounts, supplierVolumes, networkMetrics]);

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      {/* v3 §1.1/§1.4, D3-a — see FirmLevelNetwork's identical comment: root
          variant (a root with no tab of its own keeps the bar, no item
          active — not a back arrow), chip on the second row, refresh as the
          one meta action, the rest stays desktop-only exactly as before. */}
      {isMobile && (
        <MobilePageHeader
          variant="root"
          title="Product-level Network Intelligence"
          meta={
            <button
              type="button"
              onClick={fetchData}
              disabled={loading}
              aria-label="Refresh"
              title="Refresh"
              className="relative -mr-1 grid h-[32px] w-[32px] shrink-0 place-items-center text-[#18181b] after:absolute after:-inset-1.5 after:content-['']"
            >
              <RefreshCw className={loading ? 'h-[16px] w-[16px] animate-spin' : 'h-[16px] w-[16px]'} />
            </button>
          }
        >
          <ProjectChip
            projects={projects}
            selectedId={globalSelectedProjectId}
            onSelect={setGlobalSelectedProjectId}
          />
        </MobilePageHeader>
      )}
      <div className={isMobile ? PAGE_GUTTER_SKIN : PAGE_GUTTER}>
        {!isMobile && (
        /* Refresh is composed inside `rightContent` rather than passed as
           `onRefresh`, because the handoff's slot order puts it after this
           page's own graph controls — including the metrics `Refresh` ghost,
           which is a different control with a different handler — and before
           the project select. Same button, same handler as before. */
        <PageHeader
          title="Product-level Network Intelligence"
          rightContent={
            /* `gap-2` rather than `space-x-2`: `space-x-*` puts its margin on
               the DOM children, so it would land on the `md:contents` wrapper
               below instead of on the controls inside it and collapse the
               desktop spacing. `gap` is inherited correctly through
               `display:contents`, and for this single-line row the two
               produce the same 8px. */
            <div className="flex items-center gap-2">
              {/* Spec 4.1 caps the mobile right slot at three controls, and
                  everything in this group drives the network graph / analytics
                  panels, which are `hidden md:` on this page. Below `md` the
                  header therefore holds refresh + the project select only, and
                  `md:contents` hands every control straight back to the same
                  flex row on desktop - so the desktop header is unchanged. */}
              <span className="hidden md:contents">
              {selectedNode && (
                <>
                  <Button
                    onClick={() => setDisruptionDialogOpen(true)}
                    variant="outline"
                    size="icon"
                    className={cn(
                      'text-orange-600 hover:bg-orange-50 hover:text-orange-700',
                      HDR_ICON_BUTTON,
                      'md:text-[#ea580c] md:hover:text-[#ea580c]',
                    )}
                    aria-label="Add Disruption"
                    title="Add Disruption"
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
                    className={cn(
                      'h-9 min-h-11 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus:outline-none',
                      HDR_SEARCH_INPUT,
                      'md:pl-9',
                    )}
                    placeholder="find a node"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onBlur={() => !searchTerm && setSearchOpen(false)}
                  />
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="icon"
                  className={HDR_ICON_BUTTON}
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search"
                  title="Search"
                >
                  <Search className="h-4 w-4" />
                </Button>
              )}

              <Button
                variant={showAnalytics ? 'default' : 'outline'}
                size="icon"
                className={cn(HDR_ICON_BUTTON, showAnalytics && HDR_ICON_BUTTON_ON)}
                onClick={() => setShowAnalytics(!showAnalytics)}
                aria-label="Analytics"
                title="Analytics"
              >
                <BarChart className="h-4 w-4" />
              </Button>

              <Button
                variant={viewMode === 'map' ? 'default' : 'outline'}
                size="icon"
                className={cn(HDR_ICON_BUTTON, viewMode === 'map' && HDR_ICON_BUTTON_ON)}
                onClick={() => setViewMode(viewMode === 'network' ? 'map' : 'network')}
                aria-label={viewMode === 'network' ? 'Map view' : 'Network view'}
                title={viewMode === 'network' ? 'Map view' : 'Network view'}
              >
                {viewMode === 'network' ? <MapIcon className="h-4 w-4" /> : <Network className="h-4 w-4" />}
              </Button>

              {/* The metrics refresh — a different control with a different
                  handler from the page refresh beside it, which is why the
                  handoff keeps both and only changes their heights. */}
              <Button
                variant="ghost"
                size="sm"
                className={cn('gap-1', HDR_GHOST_BUTTON)}
                onClick={handleRefreshMetrics}
                disabled={networkMetricsLoading}
              >
                <RotateCcw className="h-4 w-4" />
                Refresh
              </Button>
              </span>

              <HeaderRefreshButton onClick={fetchData} loading={loading} />

              <Select value={globalSelectedProjectId || ''} onValueChange={setGlobalSelectedProjectId}>
                {/* Case A select (spec 2.1 / parity plan G3): the vw term
                    exceeds 180px at every width from 768 up, so the clamp
                    resolves to the desktop literal without an `md:`. The
                    handoff raises that desktop literal to the product-wide
                    200px project select. */}
                <SelectTrigger className={cn('h-9 w-[clamp(120px,38vw,180px)]', HDR_PROJECT_SELECT)}>
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
        )}

        {/* ── Mobile composition (md:hidden) ──────────────────────────
             Spec 5 row 7 / demo entry 08. Nothing below md: renders the
             graph, so this column is the lens itself: how to read it, the
             structure, the risk, the ranking, the prediction. Every piece
             is a presentational component from components/network/MobileLens
             so the three lenses cannot drift apart again. */}
        <div className="md:hidden mt-4 flex min-w-0 flex-col gap-[var(--m-gap)]">

          <div>
            <LensChip tone="violet">Product level</LensChip>
          </div>

          <LensHowToRead
            scope="Suppliers, materials, products and customers built from this project's inbound, BOM and outbound records. Multi-tier rows are excluded here — the deep-tier graph is the firm lens."
            findings="A material is reported as a nexus material once its prominence reaches 0.800: at that level the graph has no path around it. Prominence is coloured from 0.400 up, so a row is worth reading before it becomes a finding."
            columns={[
              { term: 'Node', def: 'The material this row measures.' },
              { term: 'Prominence', def: 'Overall network importance.' },
              { term: 'Betweenness', def: 'Bridge between network clusters.' },
              { term: 'Degree', def: 'Connection ratio to max possible.' },
              { term: 'Connections', def: 'Distinct nodes this one is joined to.' },
            ]}
          />

          <LensDesktopOnlyNote>
            The network graph, the map view and the supplier charts are desktop
            surfaces. Open this lens on a larger screen to explore them; the
            findings below are the same on both.
          </LensDesktopOnlyNote>

          {/* §13.4 — the numbers band. A stat grid is its own container and
              carries no head; the figures name themselves. */}
          <LensStructure
            items={[
              { label: 'Nodes', value: mobileProductMetrics.totalNodes > 0 ? String(mobileProductMetrics.totalNodes) : '—' },
              { label: 'Network depth', value: mobileProductMetrics.networkDepth > 0 ? String(mobileProductMetrics.networkDepth) : '—' },
              { label: 'Critical path', value: '—' },
              {
                label: 'Resilience',
                value: mobileProductMetrics.totalNodes > 0 ? mobileProductMetrics.resilience : '—',
                red: mobileProductMetrics.resilienceRed && mobileProductMetrics.totalNodes > 0,
              },
            ]}
          />

          <LensSection label="Structural risk" counter="4" tone="primary" lens="violet">
            <LensRisk
              rows={[
                { label: 'Single-source risk', value: supplierMetrics.supplierDiversity > 0 ? supplierMetrics.singleSourceRisk : '—' },
                { label: 'Concentration risk', value: materialMetrics.materialDiversity > 0 ? materialMetrics.materialConcentrationRisk : '—' },
                { label: 'Mean HHI', value: mobileProductMetrics.totalNodes > 0 ? mobileProductMetrics.hhi : '—' },
                { label: 'Nexus materials', value: networkMetrics.length > 0 ? String(mobileProductMetrics.nexusMaterials) : '—' },
              ]}
              alert={
                mobileProductMetrics.hasSPOF && mobileProductMetrics.topNexusName
                  ? `${mobileProductMetrics.topNexusName} is a nexus material — a single source of failure in the supply network.`
                  : undefined
              }
            />
          </LensSection>

          <LensSection label="Centrality" lens="violet" counter={networkMetrics.length ? String(Math.min(20, networkMetrics.length)) : undefined}>
            <LensTable
              loading={networkMetricsLoading}
              columns={[
                { key: 'node', label: 'Node' },
                { key: 'prominence', label: 'Prominence', align: 'right' },
                { key: 'betweenness', label: 'Betweenness', align: 'right' },
                { key: 'degree', label: 'Degree', align: 'right' },
                { key: 'connections', label: 'Connections', align: 'right' },
              ]}
              rows={[...networkMetrics]
                .sort((a, b) => (b.prominence ?? 0) - (a.prominence ?? 0))
                .slice(0, 20)
                .map(n => {
                  // The same four thresholds the desktop table colours its
                  // prominence cell with, spent as the row's 6px dot instead
                  // of as coloured type (skin §3).
                  const p = n.prominence ?? 0;
                  const tone = p >= 0.8 ? 'blocking' as const
                    : p >= 0.6 ? 'warn' as const
                      : p >= 0.4 ? 'notable' as const
                        : undefined;
                  return {
                    key: n.id,
                    id: n.name,
                    cells: [
                      { text: n.prominence != null ? n.prominence.toFixed(3) : '—', tone, primary: true },
                      { text: n.betweenness_centrality != null ? n.betweenness_centrality.toFixed(3) : '—' },
                      { text: n.degree_centrality != null ? n.degree_centrality.toFixed(3) : '—' },
                      { text: String(n.connection_count) },
                    ],
                  };
                })}
              empty="No centrality metrics yet. Calculate them to rank the materials in this lens."
              action={
                <LensAction
                  onClick={handleRefreshMetrics}
                  disabled={networkMetricsLoading || !globalSelectedProjectId}
                  disabledReason={!globalSelectedProjectId ? 'Select a project first' : 'Already calculating'}
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${networkMetricsLoading ? 'animate-spin' : ''}`} />
                  Calculate
                </LensAction>
              }
            />
          </LensSection>

          <MobileGroup label="Prediction">
            <MLPrediction skin selectedPlant={
              globalSelectedProjectId
                ? projects.find(p => p.id === globalSelectedProjectId)?.plant_name || null
                : null
            } />
          </MobileGroup>

        </div>
        {/* ── End mobile composition ── */}

          <div className="hidden md:grid grid-cols-1 lg:grid-cols-4 gap-6">

            {/* Graph Canvas or Map View */}
            <div className="lg:col-span-3">
              {globalSelectedProjectId && riskDataError && (
                <RiskDataNotice reason={riskDataError} />
              )}
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
                     <Suspense
                       fallback={
                         <div className="h-full grid place-content-center">
                           <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                         </div>
                       }
                     >
                     <MapView
                      nodes={nodes}
                      selectedNode={selectedNode}
                      onNodeClick={(node) => setSelectedNode(node)}
                      projectId={globalSelectedProjectId}
                      plantData={projects.find(p => p.id === globalSelectedProjectId) ?? null}
                      countryRiskMap={countryRiskMap}
                    />
                    </Suspense>
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
                          <span className="font-normal">{selectedNode.data.incomingFlow.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Outgoing Connections:</span>
                          <span className="font-normal">{selectedNode.data.outgoing}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Outgoing Flow:</span>
                          <span className="font-normal">{selectedNode.data.outgoingFlow.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
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

          <div className="hidden md:block">
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