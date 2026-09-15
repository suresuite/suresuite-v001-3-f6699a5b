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
  Map,
  Building2,
} from 'lucide-react';
import { PageLayout, PageHeader, ProjectSelector, PAGE_GUTTER, PAGE_GUTTER_SKIN } from '@/components/shared';
import { useIsMobile } from '@/hooks/use-is-mobile';
import MLPrediction from '@/components/MLPrediction';
import { DisruptionDialog } from '@/components/DisruptionDialog';
// mapbox-gl and its CSS are ~200 kB gzipped and only reachable from here and
// /network/product-level — and then only once the user switches to map view.
// Lazy keeps it out of this page's chunk entirely for anyone who never does.
const MapView = lazy(() => import('@/components/MapView'));
import { FROZEN_CELL } from '@/components/shared';
import { MobileGroup, MobilePageHeader, ProjectChip } from '@/components/mobile';
import { RiskDataNotice } from '@/components/network/RiskDataNotice';
import {
  LensChip,
  LensHowToRead,
  LensDesktopOnlyNote,
  LensStructure,
  LensRisk,
  LensTable,
  LensAction,
  LensSection,
} from '@/components/network/MobileLens';


const TIER_ORDER = ['Tier 1', 'Tier 2', 'Tier 3', 'Plant'] as const;
type TierKey = typeof TIER_ORDER[number];

const TIER_COLORS: Record<TierKey, string> = {
  'Tier 1': '#22c55e',    // Green
  'Tier 2': '#facc15',    // Yellow
  'Tier 3': '#3b82f6',    // Blue
  'Plant': '#8b5cf6',     // Purple
};

const HIGHLIGHT_HEX = '#ff0000';

const TIER_LABELS: Record<TierKey, string> = {
  'Tier 1': 'Tier 1 Suppliers',
  'Tier 2': 'Tier 2 Suppliers', 
  'Tier 3': 'Tier 3 Suppliers',
  'Plant': 'Manufacturing Plant',
};

interface NetworkNode {
  id: string;
  project_id: string;
  plant_name: string;
  uid: string;
  depth: number | null;
  name: string | null;
  country: string | null;
  industry: string | null;
  website: string | null;
  traded_as: string | null;
  number_of_employees: number | null;
  revenue: number | null;
  lat: number | null;
  long: number | null;
  is_seed: boolean | null;
  prominence: number | null;
  prominence_updated_at: string | null;
}

interface NetworkEdge {
  id: string;
  project_id: string;
  plant_name: string;
  src_uid: string;
  dst_uid: string;
  relation_type: string | null;
  relative_revenue: number | null;
  relative_revenue_percentage: number | null;
  depth: number | null;
  direction: string | null;
}

// NetworkSummary interface removed - no longer needed

interface NodeData extends Record<string, unknown> {
  label: string;
  type: 'location';
  tier?: TierKey;
  group?: 'A' | 'B' | 'C' | 'D';
  incoming: number;
  outgoing: number;
  incomingFlow: number;
  outgoingFlow: number;
  revenue: number;
  country: string;
  industry: string;
}

interface FirmRevenueDatum {
  firm: string;
  revenue: number;
}

interface FirmConnectionDatum {
  firm: string;
  connections: number;
}

interface FirmLevelNetworkProps {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

function getTierFromDepth(depth: number | null, isPlant: boolean = false): TierKey {
  if (isPlant) return 'Plant';
  if (depth === null || depth === 0) return 'Plant';
  if (depth === 1) return 'Tier 1';
  if (depth === 2) return 'Tier 2';
  return 'Tier 3';
}

export default function FirmLevelNetwork({ isCollapsed, setIsCollapsed }: FirmLevelNetworkProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { globalSelectedProjectId, setGlobalSelectedProjectId } = useGlobalProject();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const [loading, setLoading] = useState(false);
  const [tierCounts, setTierCounts] = useState<Record<TierKey, number>>({ 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0, 'Plant': 0 });
  const [allNodes, setAllNodes] = useState<Node<NodeData>[]>([]);
  const [allEdges, setAllEdges] = useState<Edge[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [firmRevenues, setFirmRevenues] = useState<FirmRevenueDatum[]>([]);
  const [firmConnections, setFirmConnections] = useState<FirmConnectionDatum[]>([]);
  const [disruptionDialogOpen, setDisruptionDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'network' | 'map'>('network');
  const [countryRiskMap, setCountryRiskMap] = useState<Record<string, string>>({});
  // D4: `risk_data` has no migration, so this read normally fails. The page
  // used to warn to the console and render an unshaded graph as if nothing
  // were missing; now it says so on screen (RiskDataNotice).
  const [riskDataError, setRiskDataError] = useState<string | null>(null);
  // networkSummary state removed - no longer needed
  const [networkNodes, setNetworkNodes] = useState<NetworkNode[]>([]);
  const [networkEdges, setNetworkEdges] = useState<NetworkEdge[]>([]);
  const [prominenceStats, setProminenceStats] = useState<{
    count: number;
    min: number;
    max: number;
    average: number;
    distribution: { low: number; medium: number; high: number };
  } | null>(null);
  const [recalculatingProminence, setRecalculatingProminence] = useState(false);

  // Function to recalculate prominence using edge function
  const recalculateProminence = async () => {
    if (!user || !globalSelectedProjectId) {
      toast.error('No project selected');
      return;
    }

    setRecalculatingProminence(true);
    
    try {
      console.log('🔄 Recalculating prominence for project:', globalSelectedProjectId);
      
      const { data, error } = await supabase.functions.invoke('calculate-node-prominence', {
        body: { project_id: globalSelectedProjectId }
      });

      if (error) throw error;

      console.log('✅ Prominence recalculation complete:', data);
      
      // Update prominence stats
      setProminenceStats(data.statistics);
      
      toast.success(`Recalculated prominence for ${data.updated_count} nodes`);
      
      // Refresh the network data to get updated prominence values
      await fetchData();
      
    } catch (error: any) {
      console.error('❌ Error recalculating prominence:', error);
      toast.error(`Failed to recalculate prominence: ${error.message}`);
    } finally {
      setRecalculatingProminence(false);
    }
  };

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
  
  // // At the top of fetchData, store the fetched nodes in a local variable
  // const fetchedNodes = networkNodes as unknown as NetworkNode[];
  // setNetworkNodes(fetchedNodes); // still update state for other uses


  const fetchData = async () => {
    console.log('🔍 FirmLevel fetchData called with:', { 
      hasUser: !!user, 
      selectedProject: globalSelectedProjectId
    });

    if (!user || !globalSelectedProjectId) {
      console.log('❌ Clearing data - no user or project');
      setNodes([]);
      setEdges([]);
      setAllNodes([]);
      setAllEdges([]);
      setTierCounts({ 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0, 'Plant': 0 });
      setSelectedNode(null);
      setFocusedNode(null);
      setFirmRevenues([]);
      setFirmConnections([]);
      // networkSummary state reset removed - no longer needed
      return;
    }

    setLoading(true);
    
    try {
      const [
              { data: rawNodes, error: nodesError },
              { data: rawEdges, error: edgesError },
              { data: riskData, error: riskError }
            ] = await Promise.all([
              supabase.rpc('get_network_nodes', {
                p_project_id: globalSelectedProjectId,
                p_user_id: user.id,
                p_user_email: user.email,
                p_plant_name: null
              }),
              supabase.rpc('get_network_edges', {
                p_project_id: globalSelectedProjectId,
                p_user_id: user.id,
                p_user_email: user.email,
                p_plant_name: null
              }),
              supabase.from('risk_data').select('COUNTRY, "RISK CLASS"')
            ]);

            if (nodesError) throw nodesError;
            if (edgesError) throw edgesError;
            
            // We don't throw the riskError to avoid crashing the whole graph if
            // just the risk table fails — but D4: not crashing is not the same
            // as not telling the user. An empty risk map renders every node's
            // risk as "Unknown", which reads as an answer rather than as a
            // missing source, so the failure is surfaced (RiskDataNotice).
            if (riskError) {
              console.warn('⚠️ Could not load risk data:', riskError);
              setRiskDataError(riskError.message ?? String(riskError));
              setCountryRiskMap({});
            } else if (riskData) {
              const riskMap: Record<string, string> = {};
              riskData.forEach(row => {
                // Bracket notation: the table's columns are quoted and
                // upper-case ("RISK CLASS"), which is itself part of D4.
                const countryVal = row['COUNTRY'] || row['country']; 
                const riskVal = row['RISK CLASS'] || row['risk class'] || row['risk_class'];

                if (countryVal) {
                  riskMap[countryVal.trim().toUpperCase()] = riskVal;
                }
              });
              setRiskDataError(Object.keys(riskMap).length === 0 ? 'The risk_data table returned no rows.' : null);
              setCountryRiskMap(riskMap);
            } else {
              setRiskDataError('The risk_data table returned no rows.');
              setCountryRiskMap({});
            }

            // ✅ Local variables — no stale state, no re-render loop
            const fetchedNodes = (rawNodes || []) as unknown as NetworkNode[];
            const fetchedEdges = (rawEdges || []) as unknown as NetworkEdge[];

            // ✅ Update state for UI use elsewhere (sidebar, banner, etc.)
            setNetworkNodes(fetchedNodes);
            setNetworkEdges(fetchedEdges);

      // ✅ calculateNodeImportance uses fetchedNodes and fetchedEdges directly
      const calculateNodeImportance = (data: NodeData, nodeId: string) => {
        const nodeData = fetchedNodes.find((n) => n.uid === nodeId);
        let prominence: number;

        if (typeof nodeData?.prominence === 'number' && !Number.isNaN(nodeData.prominence)) {
          prominence = nodeData.prominence;
        } else {
          // In the else branch (no stored prominence):
          const totalConnections    = data.incoming + data.outgoing;
          const connectionWeight    = Math.min(totalConnections / 20, 1.0);
          const connections = fetchedEdges.filter((e): e is NetworkEdge =>
            e.src_uid === nodeId || e.dst_uid === nodeId
          );
          const revenueWeight       = data.revenue > 0
            ? Math.min(Math.log(data.revenue) / Math.log(1000000), 1.0) : 0;
          const balanceWeight       = totalConnections > 0
            ? 1 - Math.abs(data.incoming - data.outgoing) / totalConnections : 0;
          const uniquePartners = new Set(
            connections.map((conn: NetworkEdge) => 
              conn.src_uid === nodeId ? conn.dst_uid : conn.src_uid
            )
          );
          const betweennessApprox   = Math.min(uniquePartners.size / 15, 1.0);

          // Eigenvector + closeness not computable without full graph here
          // — these will be 0 in fallback; stored prominence from DB is preferred
          const eigenvectorWeight   = 0;
          const closenessWeight     = 0;

          prominence = Math.min(Math.max(
            connectionWeight  * 0.60 +  // was 0.30
            revenueWeight     * 0.05 +  // was 0.25
            balanceWeight     * 0.05 +  // was 0.20
            betweennessApprox * 0.10 +  // was 0.25
            eigenvectorWeight * 0.10 +
            closenessWeight   * 0.10,
          0), 1);
        }

        return {
          prominence,
          size: 12 + (prominence * 16),
          opacity: 0.75 + (prominence * 0.25),
          glowIntensity: prominence * 0.8,
        };
      };


      // Calculate prominence statistics from stored values
      const prominenceValues = fetchedNodes
        .filter(n => typeof n.prominence === 'number' && !Number.isNaN(n.prominence))
        .map(n => n.prominence!);
        
      // if (prominenceValues.length > 0) {
      //   const prominenceStats = {
      //     count: prominenceValues.length,
      //     min: Math.min(...prominenceValues),
      //     max: Math.max(...prominenceValues),
      //     average: prominenceValues.reduce((a, b) => a + b, 0) / prominenceValues.length,
      //     distribution: {
      //       low: prominenceValues.filter(p => p < 0.3).length,
      //       medium: prominenceValues.filter(p => p >= 0.3 && p < 0.7).length,
      //       high: prominenceValues.filter(p => p >= 0.7).length,
      //     }
      //   };
      //   setProminenceStats(prominenceStats);
        
      //   console.log('📈 Prominence stats:', {
      //     ...prominenceStats,
      //     hasStoredValues: prominenceValues.length,
      //     totalNodes: (networkNodes as unknown as NetworkNode[]).length
      //   });
      // } else {
      //   console.log('⚠️ No stored prominence values found — auto-calculating...');
      //   // Auto-calculate instead of showing the banner
      //   // await recalculateProminence();
      // }



      // Process firm revenues
      const revenueData: FirmRevenueDatum[] = fetchedNodes
        .filter(n => n.revenue != null && n.revenue > 0)
        .map(n => ({
          firm: n.name || n.uid,
          revenue: n.revenue || 0
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 20);

      setFirmRevenues(revenueData);

      // Process firm connections
      const connectionCounts: { [key: string]: number } = {};
      fetchedEdges.forEach(edge => {
        connectionCounts[edge.src_uid] = (connectionCounts[edge.src_uid] || 0) + 1;
        connectionCounts[edge.dst_uid] = (connectionCounts[edge.dst_uid] || 0) + 1;
      });

      const connectionData: FirmConnectionDatum[] = (networkNodes as unknown as NetworkNode[])
        .map(n => ({
          firm: n.name || n.uid,
          connections: connectionCounts[n.uid] || 0
        }))
        .sort((a, b) => b.connections - a.connections)
        .slice(0, 20);

      setFirmConnections(connectionData);

      // Build node map
      const nodeMap: { [key: string]: NodeData } = {};
      const edgeMap: { [key: string]: Edge } = {};

      fetchedNodes.forEach((n: NetworkNode) => {
        const isPlant = n.is_seed === true;
        const tier = getTierFromDepth(n.depth, isPlant);
        
        nodeMap[n.uid] = {
          label: n.name || n.uid,
          type: 'location',
          tier,
          group: tier === 'Plant' ? 'C' : 'A', // Map tiers to groups for MapView compatibility
          incoming: 0,
          outgoing: 0,
          incomingFlow: 0,
          outgoingFlow: 0,
          revenue: n.revenue || 0,
          country: n.country || 'Unknown',
          industry: n.industry || 'Unknown',
        };
      });

      // Process edges
      fetchedEdges.forEach((e: NetworkEdge) => {
        if (nodeMap[e.src_uid] && nodeMap[e.dst_uid]) {
          const flowValue = e.relative_revenue || 1;
          nodeMap[e.src_uid].outgoing++;
          nodeMap[e.src_uid].outgoingFlow += flowValue;
          nodeMap[e.dst_uid].incoming++;
          nodeMap[e.dst_uid].incomingFlow += flowValue;

          const edgeKey = `${e.src_uid}-${e.dst_uid}`;
          edgeMap[edgeKey] = {
            id: edgeKey,
            source: e.src_uid,
            target: e.dst_uid,
            style: {
              stroke: '#8C8C8C',
              strokeWidth: 1.5,
              strokeOpacity: 0.6,
            },
            type: 'straight',
            data: { 
              weight: e.relative_revenue || 1,
              relationType: e.relation_type 
            },
          };
        }
      });

      const activeProminenceValues = fetchedNodes.map(n => {
        const data = nodeMap[n.uid];
        if (!data) return 0;
        // This will use the DB number if valid, or calculate it locally if missing/NaN!
        return calculateNodeImportance(data, n.uid).prominence;
      });

      if (activeProminenceValues.length > 0) {
        setProminenceStats({
          count: activeProminenceValues.length,
          min: Math.min(...activeProminenceValues),
          max: Math.max(...activeProminenceValues),
          average: activeProminenceValues.reduce((a, b) => a + b, 0) / activeProminenceValues.length,
          distribution: {
            low: activeProminenceValues.filter(p => p < 0.3).length,
            medium: activeProminenceValues.filter(p => p >= 0.3 && p < 0.7).length,
            high: activeProminenceValues.filter(p => p >= 0.7).length,
          }
        });
      }

      // Group by tiers
      const grouped: Record<TierKey, string[]> = { 'Tier 1': [], 'Tier 2': [], 'Tier 3': [], 'Plant': [] };
      for (const [id, node] of Object.entries(nodeMap)) {
        grouped[node.tier || 'Tier 1'].push(id);
      }
      
      console.log('📊 Firm tier groups:', {
        tier1: grouped['Tier 1'].length,
        tier2: grouped['Tier 2'].length,
        tier3: grouped['Tier 3'].length,
        plant: grouped['Plant'].length
      });
      
      setTierCounts({ 
        'Tier 1': grouped['Tier 1'].length, 
        'Tier 2': grouped['Tier 2'].length, 
        'Tier 3': grouped['Tier 3'].length, 
        'Plant': grouped['Plant'].length 
      });

      // Create advanced shell layout with mathematical optimization
      const nodeList: Node<NodeData>[] = [];
      const centerX = 400;
      const centerY = 300;
      const baseNodeSize = 16; // Reduced from 24 for smaller nodes
      const subRingSpacing = 10; // Reduced sub-ring spacing for tighter clustering
      const mainRingDistance = subRingSpacing * 18; // Increased major ring distance (180px)
      
      // Mathematical constants for optimal distribution
      const OPTIMAL_NODE_SPACING = 45; // Keep at 45px for major rings
      const SUB_RING_NODE_SPACING = 35; // Reduced spacing for sub-rings
      const COLLISION_THRESHOLD = 30; // Reduced for tighter packing
      
      // Advanced mathematical helper functions
      const calculateOptimalSubRings = (nodeCount: number, baseRadius: number): number => {
        // Calculate optimal number of sub-rings based on circumference and node density
        const maxNodesPerRing = Math.floor((2 * Math.PI * baseRadius) / SUB_RING_NODE_SPACING);
        return Math.ceil(nodeCount / maxNodesPerRing);
      };
      
      const calculateOptimalNodesPerSubRing = (nodeCount: number, subRingCount: number): number => {
        return Math.ceil(nodeCount / subRingCount);
      };
      
      const calculateDynamicRadius = (baseRadius: number, subRingIndex: number, nodeCount: number): number => {
        // Dynamic radius with adaptive spacing based on node density
        const densityFactor = Math.max(0.8, Math.min(1.5, nodeCount / 20));
        return baseRadius + (subRingIndex * subRingSpacing * densityFactor);
      };
      
      // Advanced collision detection with force-directed adjustment
      const resolveCollisions = (positions: Array<{x: number, y: number, id: string}>, newPos: {x: number, y: number}, nodeId: string): {x: number, y: number} => {
        let adjustedPos = { ...newPos };
        let iterations = 0;
        const maxIterations = 25;
        
        while (iterations < maxIterations) {
          let totalForceX = 0;
          let totalForceY = 0;
          let hasCollision = false;
          
          for (const pos of positions) {
            if (pos.id === nodeId) continue;
            
            const dx = adjustedPos.x - pos.x;
            const dy = adjustedPos.y - pos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < COLLISION_THRESHOLD && distance > 0) {
              hasCollision = true;
              // Apply repulsive force inversely proportional to distance
              const force = (COLLISION_THRESHOLD - distance) / distance;
              totalForceX += (dx / distance) * force;
              totalForceY += (dy / distance) * force;
            }
          }
          
          if (!hasCollision) break;
          
          // Apply forces with damping
          const damping = 0.3;
          adjustedPos.x += totalForceX * damping;
          adjustedPos.y += totalForceY * damping;
          iterations++;
        }
        
        return adjustedPos;
      };
      
      // Track all positions for collision detection
      const allPositions: Array<{x: number, y: number, id: string}> = [];
      
      // Color utility functions for HSL manipulation
      const hexToHsl = (hex: string): [number, number, number] => {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;
        
        if (max !== min) {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
          }
          h /= 6;
        }
        
        return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
      };
      
      const hslToHex = (h: number, s: number, l: number): string => {
        h /= 360; s /= 100; l /= 100;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h * 6) % 2 - 1));
        const m = l - c / 2;
        let r = 0, g = 0, b = 0;
        
        if (0 <= h && h < 1/6) { r = c; g = x; b = 0; }
        else if (1/6 <= h && h < 2/6) { r = x; g = c; b = 0; }
        else if (2/6 <= h && h < 3/6) { r = 0; g = c; b = x; }
        else if (3/6 <= h && h < 4/6) { r = 0; g = x; b = c; }
        else if (4/6 <= h && h < 5/6) { r = x; g = 0; b = c; }
        else if (5/6 <= h && h < 1) { r = c; g = 0; b = x; }
        
        r = Math.round((r + m) * 255);
        g = Math.round((g + m) * 255);
        b = Math.round((b + m) * 255);
        
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
      };
      
      const withAlpha = (color: string, alpha: number): string => {
        const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
        return color + alphaHex;
      };
      
      const shadeForProminence = (baseColor: string, prominence: number): string => {
        const [h, s, l] = hexToHsl(baseColor);
        // Higher prominence = darker/richer color (lower lightness, higher saturation)
        const newL = Math.max(25, l - (prominence * 25)); // Darken by up to 25%
        const newS = Math.min(100, s + (prominence * 20)); // Increase saturation by up to 20%
        return hslToHex(h, newS, newL);
      };
      
      const gradientFromShade = (baseShade: string, prominence: number): string => {
        const [h, s, l] = hexToHsl(baseShade);
        const lighterShade = hslToHex(h, Math.max(30, s - 10), Math.min(85, l + 15));
        return `radial-gradient(circle, ${baseShade}, ${lighterShade})`;
      };
      
      // Size scaling with eased curve
      const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
      
      const computeTierSize = (prominence: number, tierSizeRange: [number, number]): number => {
        const [minSize, maxSize] = tierSizeRange;
        const easedProminence = easeOutCubic(prominence);
        return Math.round(minSize + (maxSize - minSize) * easedProminence);
      };


      
      // Fibonacci spiral distribution for organic positioning
      const calculateFibonacciPosition = (index: number, total: number, baseRadius: number): { angle: number, radius: number } => {
        const goldenRatio = (1 + Math.sqrt(5)) / 2;
        const angle = index * 2 * Math.PI / goldenRatio;
        const spiralRadius = Math.sqrt(index / total) * baseRadius;
        return { angle, radius: spiralRadius };
      };
      
      // Enhanced density-aware clustering
      const calculateClusterPosition = (
        nodeIndex: number, 
        clusterNodes: number, 
        baseRadius: number, 
        clusterId: number
      ): { x: number, y: number } => {
        // Golden ratio spacing for natural distribution
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));  // ~137.5 degrees
        const normalizedIndex = nodeIndex / Math.max(clusterNodes - 1, 1);
        
        // Spiral positioning with cluster offset
        const spiralAngle = nodeIndex * goldenAngle + (clusterId * Math.PI / 3);
        const spiralRadius = baseRadius + Math.sqrt(normalizedIndex) * 25;
        
        return {
          x: centerX + Math.cos(spiralAngle) * spiralRadius,
          y: centerY + Math.sin(spiralAngle) * spiralRadius
        };
      };
      
      // Position Plant nodes (Tier 0) at center with enhanced prominence
      const plantIds = grouped['Plant'];
      if (plantIds.length > 0) {
        plantIds.forEach((id, i) => {
          const data = nodeMap[id];
          const { prominence, size, opacity, glowIntensity } = calculateNodeImportance(data, id);
          
          // Central positioning with sophisticated spacing for multiple plants
          const angle = plantIds.length === 1 ? 0 : (i * 2 * Math.PI) / plantIds.length;
          const radius = plantIds.length === 1 ? 0 : Math.min(30, 15 + plantIds.length * 2);
          
          let position = {
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius
          };
          
          position = resolveCollisions(allPositions, position, id);
          allPositions.push({...position, id});
          
          // Enhanced visual styling with prominence-based effects
          const tierColor = TIER_COLORS[data.tier || 'Plant'];
          const glowColor = `${tierColor}40`; // 25% opacity for glow
          
          nodeList.push({
            id,
            position,
            data,
            style: {
              background: `linear-gradient(135deg, ${tierColor}, ${tierColor}E6)`,
              color: 'white',
              width: Math.max(24, Math.round(size * 1.2)), // Plant nodes are larger
              height: Math.max(24, Math.round(size * 1.2)),
              fontSize: 0,
              borderRadius: '50%',
              border: '3px solid white',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              boxShadow: `0 6px 20px rgba(0,0,0,0.15), 0 0 ${Math.round(glowIntensity * 20)}px ${glowColor}`,
              opacity,
              transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              zIndex: 30,
              filter: `brightness(${1 + prominence * 0.2})`,
            },
            type: 'default',
          });
        });
      }
      
      // Position Tier 1 nodes with cluster-based prominence distribution (matching Tier 2 approach)
      const tier1Ids = grouped['Tier 1'];
      if (tier1Ids.length > 0) {
        const baseRadius = mainRingDistance;
        
        // Create prominence-based clusters for Tier 1
        const tier1NodesWithProminence = tier1Ids.map(id => ({
          id,
          data: nodeMap[id],
          ...calculateNodeImportance(nodeMap[id], id)
        })).sort((a, b) => b.prominence - a.prominence);
        
        type NodeWithProminence = typeof tier1NodesWithProminence[0];
        
        // Divide into clusters based on prominence levels
        const clusterSize = Math.ceil(tier1Ids.length / 6); // 6 clusters max
        const clusters: NodeWithProminence[][] = [];
        for (let i = 0; i < tier1NodesWithProminence.length; i += clusterSize) {
          clusters.push(tier1NodesWithProminence.slice(i, i + clusterSize));
        }
        
        clusters.forEach((cluster, clusterIndex) => {
          cluster.forEach((nodeInfo, nodeIndex) => {
            const { id, data, prominence, size, opacity, glowIntensity } = nodeInfo;
            
            // Calculate cluster-based position with golden ratio distribution  
            const position = calculateClusterPosition(
              nodeIndex, 
              cluster.length, 
              baseRadius + (clusterIndex * subRingSpacing), 
              clusterIndex
            );
            
            // Apply prominence-based radial adjustment
            const distanceFromCenter = Math.sqrt(
              Math.pow(position.x - centerX, 2) + Math.pow(position.y - centerY, 2)
            );
            const adjustedDistance = distanceFromCenter + ((1 - prominence) * 20); // Stronger prominence effect
            const angle = Math.atan2(position.y - centerY, position.x - centerX);
            
            let finalPosition = {
              x: centerX + Math.cos(angle) * adjustedDistance,
              y: centerY + Math.sin(angle) * adjustedDistance
            };
            
            finalPosition = resolveCollisions(allPositions, finalPosition, id);
            allPositions.push({...finalPosition, id});
            
            // Enhanced Tier 1 styling using prominence-based color shading
            const tierColor = TIER_COLORS[data.tier || 'Tier 1'];
            const shadedColor = shadeForProminence(tierColor, prominence);
            const gradientBg = gradientFromShade(shadedColor, prominence);
            const glowColor = withAlpha(shadedColor, 0.3);
            const dynamicSize = computeTierSize(prominence, [16, 32]);
            
            nodeList.push({
              id,
              position: finalPosition,
              data,
              style: {
                background: gradientBg,
                color: 'white',
                width: dynamicSize,
                height: dynamicSize,
                fontSize: 0,
                borderRadius: '50%',
                border: `${Math.round(1 + prominence * 2)}px solid rgba(255,255,255,${0.7 + prominence * 0.3})`,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                boxShadow: `0 ${Math.round(2 + prominence * 6)}px ${Math.round(8 + prominence * 12)}px rgba(0,0,0,${0.1 + prominence * 0.15}), 0 0 ${Math.round(glowIntensity * 15)}px ${glowColor}`,
                opacity,
                transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                zIndex: Math.round(20 + prominence * 5),
              },
              type: 'default',
            });
          });
        });
      }
      
      // Position Tier 2 nodes with cluster-based prominence distribution
      const tier2Ids = grouped['Tier 2'];
      if (tier2Ids.length > 0) {
        const baseRadius = mainRingDistance * 2; // 360px (180px × 2)
        
        // Create prominence-based clusters for Tier 2
        const tier2NodesWithProminence = tier2Ids.map(id => ({
          id,
          data: nodeMap[id],
          ...calculateNodeImportance(nodeMap[id], id)
        })).sort((a, b) => b.prominence - a.prominence);
        
        type NodeWithProminence = typeof tier2NodesWithProminence[0];
        
        // Divide into clusters based on prominence levels
        const clusterSize = Math.ceil(tier2Ids.length / 6); // 6 clusters max
        const clusters: NodeWithProminence[][] = [];
        for (let i = 0; i < tier2NodesWithProminence.length; i += clusterSize) {
          clusters.push(tier2NodesWithProminence.slice(i, i + clusterSize));
        }
        
        clusters.forEach((cluster, clusterIndex) => {
          cluster.forEach((nodeInfo, nodeIndex) => {
            const { id, data, prominence, size, opacity, glowIntensity } = nodeInfo;
            
            // Calculate cluster-based position with golden ratio distribution  
            const position = calculateClusterPosition(
              nodeIndex, 
              cluster.length, 
              baseRadius + (clusterIndex * subRingSpacing), 
              clusterIndex
            );
            
            // Apply prominence-based radial adjustment
            const distanceFromCenter = Math.sqrt(
              Math.pow(position.x - centerX, 2) + Math.pow(position.y - centerY, 2)
            );
            const prominenceAdjustment = (1 - prominence) * 25; // Enhanced prominence adjustment for better visibility
            const adjustedDistance = distanceFromCenter + prominenceAdjustment;
            const angle = Math.atan2(position.y - centerY, position.x - centerX);
            
            let finalPosition = {
              x: centerX + Math.cos(angle) * adjustedDistance,
              y: centerY + Math.sin(angle) * adjustedDistance
            };
            
            finalPosition = resolveCollisions(allPositions, finalPosition, id);
            allPositions.push({...finalPosition, id});
            
            // Enhanced Tier 2 styling using prominence-based color shading with improved visibility
            const tierColor = TIER_COLORS[data.tier || 'Tier 2'];
            const shadedColor = shadeForProminence(tierColor, prominence);
            const gradientBg = gradientFromShade(shadedColor, prominence);
            const glowColor = withAlpha(shadedColor, 0.3); // Increased glow for better visibility
            const dynamicSize = computeTierSize(prominence, [10, 30]); // Expanded size range for better contrast
            
            // Enhanced border thickness based on prominence for Tier 2
            const borderThickness = Math.round(2 + prominence * 4); // 2-6px border based on prominence
            
            // Debug log for Tier 2 prominence visibility
            if (Math.random() < 0.05) { // Log only 5% of nodes to avoid spam
              console.log(`🔍 Tier 2 Debug - ${data.label}: prominence=${prominence.toFixed(3)}, size=${dynamicSize}px, border=${borderThickness}px`);
            }
            
            nodeList.push({
              id,
              position: finalPosition,
              data,
              style: {
                background: gradientBg,
                color: 'white',
                width: dynamicSize,
                height: dynamicSize,
                fontSize: 0,
                borderRadius: '50%',
                border: `${borderThickness}px solid rgba(255,255,255,${0.7 + prominence * 0.3})`, // Enhanced border using calculated thickness
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                boxShadow: `0 ${Math.round(2 + prominence * 5)}px ${Math.round(8 + prominence * 10)}px rgba(0,0,0,${0.1 + prominence * 0.15}), 0 0 ${Math.round(glowIntensity * 12)}px ${glowColor}`,
                opacity: opacity * 0.98, // Increased opacity for better visibility  
                transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                zIndex: Math.round(15 + prominence * 5), // Enhanced z-index range
              },
              type: 'default',
            });
          });
        });
      }
      
      // Position Tier 3+ nodes with organic spiral distribution
      const tier3Ids = grouped['Tier 3'];
      if (tier3Ids.length > 0) {
        const baseRadius = mainRingDistance * 3; // 540px (180px × 3)
        
        // Sort Tier 3 nodes by prominence for outer ring positioning
        const tier3NodesWithProminence = tier3Ids.map(id => ({
          id,
          data: nodeMap[id],
          ...calculateNodeImportance(nodeMap[id], id)
        })).sort((a, b) => b.prominence - a.prominence);
        
        tier3NodesWithProminence.forEach((nodeInfo, i) => {
          const { id, data, prominence, size, opacity, glowIntensity } = nodeInfo;
          
          // Advanced organic spiral for outermost tier
          const goldenAngle = Math.PI * (3 - Math.sqrt(5));
          const angle = i * goldenAngle * 1.2; // Extended spiral
          const spiralRadius = baseRadius + Math.sqrt(i / tier3Ids.length) * 80;
          
          // Prominence affects distance from center (less prominent = further out)
          const prominenceRadius = spiralRadius + ((1 - prominence) * 20);
          
          let position = {
            x: centerX + Math.cos(angle) * prominenceRadius,
            y: centerY + Math.sin(angle) * prominenceRadius
          };
          
          position = resolveCollisions(allPositions, position, id);
          allPositions.push({...position, id});
          
          // Enhanced Tier 3 styling using prominence-based color shading
          const tierColor = TIER_COLORS[data.tier || 'Tier 3'];
          const shadedColor = shadeForProminence(tierColor, prominence);
          const gradientBg = gradientFromShade(shadedColor, prominence);
          const glowColor = withAlpha(shadedColor, 0.2);
          const dynamicSize = computeTierSize(prominence, [10, 18]);
          
          nodeList.push({
            id,
            position,
            data,
            style: {
              background: gradientBg,
              color: 'white',
              width: dynamicSize,
              height: dynamicSize,
              fontSize: 0,
              borderRadius: '50%',
              border: `1px solid rgba(255,255,255,${0.4 + prominence * 0.3})`,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              boxShadow: `0 ${Math.round(0.5 + prominence * 2)}px ${Math.round(4 + prominence * 4)}px rgba(0,0,0,${0.06 + prominence * 0.08}), 0 0 ${Math.round(glowIntensity * 6)}px ${glowColor}`,
              opacity: opacity * 0.85, // Most subtle opacity
              transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              zIndex: Math.round(10 + prominence * 2),
            },
            type: 'default',
          });
        });
      }

      setNodes(nodeList);
      setEdges(Object.values(edgeMap));
      setAllNodes(nodeList);
      setAllEdges(Object.values(edgeMap));
      console.log('✅ Firm visualization updated with', nodeList.length, 'nodes and', Object.keys(edgeMap).length, 'edges');
      toast.success(`Loaded firm network: ${nodeList.length} firms, ${Object.keys(edgeMap).length} connections`);
    } catch (error) {
      console.error('❌ fetchData error:', error);
      toast.error('Failed to load firm network data');
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

  useEffect(() => {
    if (!focusedNode) {
      setNodes(allNodes);
      setEdges(allEdges);
      return;
    }
  
    const node = allNodes.find(n => n.id === focusedNode);
    if (!node) return;

    const tier = node.data.tier;
    const included = new Set<string>([node.id]);
  
    // Include connected nodes from edges
    allEdges.forEach(edge => {
      if (edge.source === focusedNode || edge.target === focusedNode) {
        included.add(edge.source as string);
        included.add(edge.target as string);
      }
    });
  
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
        return { ...edge, style: { stroke: '#3b82f6', strokeWidth: 2.5, strokeOpacity: 0.9, zIndex: 1 } };
      } else {
        return { ...edge, style: { stroke: '#8C8C8C', strokeWidth: 1, strokeOpacity: 0.25, zIndex: 1 } };
      }
    });
    setEdges(updatedEdges);
  }, [selectedNode]);

  useEffect(() => {
    const term = searchTerm.trim().toLowerCase();
   
    setNodes((current) => {
      return current.map((n) => {
        const base = allNodes.find((b) => b.id === n.id) || n;
        const baseStyle: any = base.style || {};
  
        const isHit = term !== '' && (
          n.id.toLowerCase().includes(term) || 
          n.data.label.toLowerCase().includes(term)
        );
  
        const baseWidth = typeof baseStyle.width === 'number' ? baseStyle.width : parseFloat(baseStyle.width) || baseStyle.width;
        const baseHeight = typeof baseStyle.height === 'number' ? baseStyle.height : parseFloat(baseStyle.height) || baseStyle.height;
  
        const factor = isHit ? 1.15 : 1;
  
        return {
          ...n,
          style: {
            ...baseStyle,
            background: isHit ? HIGHLIGHT_HEX : baseStyle.background,
            width: typeof baseWidth === 'number' ? baseWidth * factor : baseWidth,
            height: typeof baseHeight === 'number' ? baseHeight * factor : baseHeight,
            boxShadow: isHit ? '0 0 0 3px rgba(255,0,0,0.3)' : baseStyle.boxShadow,
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

  const mobileFirmMetrics = useMemo(() => {
    const totalNodes = networkNodes.length;
    const maxDepth = networkNodes.reduce((m, n) => Math.max(m, n.depth ?? 0), 0);
    const supplierDiversity = (tierCounts['Tier 1'] ?? 0) + (tierCounts['Tier 2'] ?? 0) + (tierCounts['Tier 3'] ?? 0);
    const tier1Exposure = totalNodes > 0
      ? ((tierCounts['Tier 1'] / totalNodes) * 100).toFixed(1) + '%'
      : '—';
    // `Map` is shadowed in this module by the lucide icon of the same name
    // (line 35), so the global constructor is reached through globalThis -
    // the pattern ProductLevelNetwork.tsx already uses for the same reason.
    const dstSources = new globalThis.Map<string, Set<string>>();
    networkEdges.forEach(e => {
      if (!dstSources.has(e.dst_uid)) dstSources.set(e.dst_uid, new Set());
      dstSources.get(e.dst_uid)!.add(e.src_uid);
    });
    const soleSourceSet = new Set<string>();
    dstSources.forEach(sources => { if (sources.size === 1) sources.forEach(s => soleSourceSet.add(s)); });
    const hubBetweenness = prominenceStats?.max ?? null;
    const hubNode = hubBetweenness !== null
      ? networkNodes.find(n => Math.abs((n.prominence ?? 0) - hubBetweenness) < 0.001)
      : null;
    const revMap = new globalThis.Map<string, number>();
    let revTotal = 0;
    networkEdges.forEach(e => {
      if (e.relative_revenue_percentage != null) {
        revMap.set(e.src_uid, (revMap.get(e.src_uid) || 0) + e.relative_revenue_percentage);
        revTotal += e.relative_revenue_percentage;
      }
    });
    let hhi = 0;
    if (revTotal > 0) revMap.forEach(v => { const s = v / revTotal; hhi += s * s; });
    const peak = hubBetweenness ?? 0;
    const hasSPOF = peak >= 0.999;
    const resilience = (hasSPOF ? 0 : 0.4) + 0.3 * (1 - hhi) + 0.3 * (1 - peak);
    return {
      totalNodes,
      networkDepth: maxDepth,
      supplierDiversity,
      tier1Exposure,
      soleSources: soleSourceSet.size,
      hubDependence: hubBetweenness !== null ? hubBetweenness.toFixed(3) : '—',
      hubNodeName: hubNode?.name ?? null,
      resilience: resilience.toFixed(3),
      resilienceRed: resilience < 0.4,
      hasSPOF,
    };
  }, [networkNodes, networkEdges, tierCounts, prominenceStats]);

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      {/* v3 §1.1/§1.4, D3-a: sibling before the gutter, root variant — Network
          isn't one of the tab bar's four labelled tabs, but it IS a root
          (reached from More) and D3-a's design review is explicit that it
          keeps the tab bar (no item active), not a back arrow. The chip
          rides the second row exactly as GAP-CLOSE T4 names it for Network.
          Refresh is the one meta-slot action; the search/analytics/map/
          recalculate controls stay desktop-only exactly as before
          (`hidden md:contents`), so nothing that already worked on mobile
          is lost. */}
      {isMobile && (
        <MobilePageHeader
          variant="root"
          title="Firm-Level Network Intelligence"
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
        <PageHeader
          title="Firm-Level Network Intelligence"
          subtitle={`Deep-tier network of ${tierCounts['Tier 1']} Tier 1, ${tierCounts['Tier 2']} Tier 2, ${tierCounts['Tier 3']} Tier 3 suppliers, and ${tierCounts['Plant']} plant${tierCounts['Plant'] !== 1 ? 's' : ''}`}
          onRefresh={fetchData}
          refreshLoading={loading}
          rightContent={
            /* `gap-2` rather than `space-x-2`: `space-x-*` puts its margin on
               the DOM children, so it would land on the `md:contents` wrapper
               below instead of on the controls inside it and collapse the
               desktop spacing. `gap` is inherited correctly through
               `display:contents`, and for this single-line row the two
               produce the same 8px. */
            <div className="flex items-center gap-2">
              {/* Spec 4.1 caps the mobile right slot at three controls. Search,
                  the map toggle and the analytics panel all drive surfaces that
                  are `hidden md:` on this page, and "recalculate prominence"
                  moves next to the centrality table it changes. Below `md` the
                  header therefore holds refresh + the project select only;
                  `md:contents` hands every control straight back to the same
                  flex row on desktop, unchanged. */}
              <span className="hidden md:contents">
              {selectedNode && (
                <Button
                  onClick={() => setDisruptionDialogOpen(true)}
                  variant="outline"
                  size="sm"
                  className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                >
                  <AlertTriangle className="h-4 w-4" />
                  <span className="hidden sm:inline ml-1">Add Disruption</span>
                </Button>
              )}
              
              {searchOpen ? (
                <div className="relative w-48 transition-all">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <input
                    autoFocus
                    type="text"
                    className="h-9 min-h-11 md:min-h-0 pl-9 pr-3 border border-border rounded-md text-sm bg-background focus:outline-none w-full"
                    placeholder="find a firm"
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
                variant="outline"
                size="sm"
                onClick={recalculateProminence}
                disabled={loading || recalculatingProminence || !globalSelectedProjectId}
              >
                <RotateCcw className={`h-4 w-4 ${recalculatingProminence ? 'animate-spin' : ''}`} />
              </Button>

              <Button
                variant={viewMode === 'map' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode(viewMode === 'network' ? 'map' : 'network')}
              >
                {viewMode === 'network' ? <Map className="h-4 w-4" /> : <Network className="h-4 w-4" />}
              </Button>

              </span>

              <Select value={globalSelectedProjectId || ''} onValueChange={setGlobalSelectedProjectId}>
                {/* Case A select (spec 2.1 / parity plan G3): the vw term
                    exceeds 180px at every width from 768 up, so the clamp
                    resolves to the desktop literal without an `md:`. */}
                <SelectTrigger className="w-[clamp(120px,38vw,180px)] h-9">
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
             Spec 5 row 7 / demo entry 08. See ProductLevelNetwork for the
             shape; the pieces come from components/network/MobileLens so the
             three lenses stay identical in composition and differ only in
             what each lens measures. */}
        <div className="md:hidden mt-4 flex min-w-0 flex-col gap-[var(--m-gap)]">

          <div>
            <LensChip tone="amber">Firm level</LensChip>
          </div>

          <LensHowToRead
            scope="Every firm in this project's deep-tier graph, with your plant as the seed and tiers counted outward from it."
            findings="A firm is reported as a single hub once it carries the graph's peak prominence: every shortest path runs through it and nothing routes around it. Prominence is coloured from 0.400 up, so a row is worth reading before it becomes a finding."
            columns={[
              { term: 'Firm', def: 'The firm this row measures.' },
              { term: 'Tier', def: 'Distance from your plant, counted outward.' },
              { term: 'Prominence', def: 'Overall network importance.' },
              { term: 'In', def: 'Firms supplying this one.' },
              { term: 'Out', def: 'Firms this one supplies.' },
            ]}
          />

          <LensDesktopOnlyNote>
            The firm graph, the map view and the tier analytics are desktop
            surfaces. Open this lens on a larger screen to explore them; the
            findings below are the same on both.
          </LensDesktopOnlyNote>

          {/* §13.4 — the numbers band. A stat grid is its own container and
              carries no head; the figures name themselves. */}
          <LensStructure
            items={[
              { label: 'Nodes', value: mobileFirmMetrics.totalNodes > 0 ? String(mobileFirmMetrics.totalNodes) : '—' },
              { label: 'Network depth', value: mobileFirmMetrics.networkDepth > 0 ? String(mobileFirmMetrics.networkDepth) : '—' },
              { label: 'Critical path', value: '—' },
              {
                label: 'Resilience',
                value: mobileFirmMetrics.totalNodes > 0 ? mobileFirmMetrics.resilience : '—',
                red: mobileFirmMetrics.resilienceRed && mobileFirmMetrics.totalNodes > 0,
              },
            ]}
          />

          <LensSection label="Structural risk" counter="4" tone="primary" lens="amber">
            <LensRisk
              rows={[
                { label: 'Supplier diversity', value: mobileFirmMetrics.totalNodes > 0 ? String(mobileFirmMetrics.supplierDiversity) : '—' },
                { label: 'Tier-1 exposure', value: mobileFirmMetrics.totalNodes > 0 ? mobileFirmMetrics.tier1Exposure : '—' },
                { label: 'Sole-source firms', value: mobileFirmMetrics.totalNodes > 0 ? String(mobileFirmMetrics.soleSources) : '—' },
                { label: 'Hub dependence', value: mobileFirmMetrics.hubDependence },
              ]}
              alert={
                mobileFirmMetrics.hasSPOF && mobileFirmMetrics.hubNodeName
                  ? `${mobileFirmMetrics.hubNodeName} is a single hub — every path runs through it.`
                  : undefined
              }
            />
          </LensSection>

          <LensSection label="Centrality" lens="amber" counter={networkNodes.length ? String(Math.min(20, networkNodes.length)) : undefined}>
            <LensTable
              loading={loading}
              columns={[
                { key: 'firm', label: 'Firm' },
                { key: 'tier', label: 'Tier' },
                { key: 'prominence', label: 'Prominence', align: 'right' },
                { key: 'in', label: 'In', align: 'right' },
                { key: 'out', label: 'Out', align: 'right' },
              ]}
              rows={[...networkNodes]
                .sort((a, b) => (b.prominence ?? 0) - (a.prominence ?? 0))
                .slice(0, 20)
                .map(node => {
                  // The same four thresholds the desktop table colours its
                  // prominence cell with, spent as the row's 6px dot instead
                  // of as coloured type (skin §3).
                  const p = node.prominence ?? 0;
                  const tone = p >= 0.8 ? 'blocking' as const
                    : p >= 0.6 ? 'warn' as const
                      : p >= 0.4 ? 'notable' as const
                        : undefined;
                  return {
                    key: node.id,
                    id: node.name ?? node.uid,
                    cells: [
                      { text: getTierFromDepth(node.depth, node.is_seed ?? false) },
                      { text: node.prominence != null ? node.prominence.toFixed(3) : '—', tone, primary: true },
                      { text: String(networkEdges.filter(e => e.dst_uid === node.uid).length) },
                      { text: String(networkEdges.filter(e => e.src_uid === node.uid).length) },
                    ],
                  };
                })}
              empty="No deep-tier network data. Select a project with deep-tier sourcing enabled."
              action={
                <LensAction
                  onClick={recalculateProminence}
                  disabled={loading || recalculatingProminence || !globalSelectedProjectId}
                  disabledReason={!globalSelectedProjectId ? 'Select a project first' : 'Already recalculating'}
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${recalculatingProminence ? 'animate-spin' : ''}`} />
                  Recalculate
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
                          nodeColor={(node) => TIER_COLORS[(node.data as NodeData).tier || 'Tier 1']}
                          zoomable
                          pannable
                        />
                      </ReactFlow>
                      <p className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-[10px] text-muted-foreground text-center">
                        Click/double-click firm to select and add disruptions • Double-click to focus network connections
                      </p>
                      {focusedNode && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setFocusedNode(null)}
                          className="absolute top-2 right-2"
                        >
                          <RotateCcw className="h-4 w-4" />
                          <span className="sr-only">Show All Firms</span>
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
                      onNodeClick={(node) => {
                        const matchingNode = allNodes.find(n => n.id === node.id);
                        if (matchingNode) setSelectedNode(matchingNode);
                      }}
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
                  <CardTitle className="text-base">Firm Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedNode ? (
                    <>
                      <div>
                        <h3 className="font-semibold text-base">{selectedNode.data.label}</h3>
                        <Badge
                          variant="secondary"
                          className="text-xs"
                          style={{
                            backgroundColor: TIER_COLORS[selectedNode.data.tier || 'Tier 1'],
                            color: 'white',
                          }}
                        >
                          {TIER_LABELS[selectedNode.data.tier || 'Tier 1']}
                        </Badge>
                      </div>
                      <Separator />
                      <div className="space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Incoming:</span>
                          <span className="text-sm font-medium">{selectedNode.data.incoming}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Outgoing:</span>
                          <span className="text-sm font-medium">{selectedNode.data.outgoing}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Revenue:</span>
                          <span className="text-sm font-medium">
                            {selectedNode.data.revenue > 0 
                              ? `$${(selectedNode.data.revenue / 1000000).toFixed(1)}M` 
                              : 'N/A'
                            }
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Country:</span>
                          <span className="text-sm font-medium">{selectedNode.data.country}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Industry:</span>
                          <span className="text-xs font-medium">{selectedNode.data.industry}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-muted-foreground">
                      <Building2 className="h-10 w-10 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Click a firm to view details</p>
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
              {prominenceStats && (
                <Card className="p-6">
                  <div className="mb-4">
                    <h3 className="text-base font-medium">Prominence Statistics</h3>
                    <p className="text-xs text-muted-foreground">
                      Node prominence distribution and calculation metrics
                    </p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary">{prominenceStats.count}</div>
                      <div className="text-xs text-muted-foreground">Total Nodes</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">{prominenceStats.average.toFixed(3)}</div>
                      <div className="text-xs text-muted-foreground">Average</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">{prominenceStats.max.toFixed(3)}</div>
                      <div className="text-xs text-muted-foreground">Maximum</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-600">{prominenceStats.min.toFixed(3)}</div>
                      <div className="text-xs text-muted-foreground">Minimum</div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <div className="text-lg font-semibold text-red-600">{prominenceStats.distribution.low}</div>
                      <div className="text-xs text-muted-foreground">Low (&lt; 0.3)</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-yellow-600">{prominenceStats.distribution.medium}</div>
                      <div className="text-xs text-muted-foreground">Medium (0.3-0.7)</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-green-600">{prominenceStats.distribution.high}</div>
                      <div className="text-xs text-muted-foreground">High (&gt; 0.7)</div>
                    </div>
                  </div>
                </Card>
              )}


              {/* Industry breakdown + Geographic concentration */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                  {/* Industry breakdown */}
                  <Card className="p-6">
                    <h3 className="text-base font-medium mb-1">Industry breakdown</h3>
                    <p className="text-xs text-muted-foreground mb-4">Firm count by sector</p>
                    {(() => {
                      const industryCounts: Record<string, number> = {};
                      networkNodes.forEach(n => {
                        const ind = n.industry || 'Unknown';
                        industryCounts[ind] = (industryCounts[ind] || 0) + 1;
                      });
                      const sorted = Object.entries(industryCounts)
                        .sort(([, a], [, b]) => b - a)
                        // .slice(0, 6);
                      const max = sorted[0]?.[1] || 1;
                      return (
                        <div className="overflow-y-auto max-h-[168px] space-y-2 pr-1">
                          {sorted.map(([industry, count]) => (
                            <div key={industry} className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground w-20 shrink-0 truncate" title={industry}>{industry}</span>
                              <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                                <div
                                  className="h-full rounded"
                                  style={{ width: `${(count / max) * 100}%`, background: '#8b5cf6' }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-6 text-right">{count}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </Card>

                  {/* Geographic concentration */}
                  <Card className="p-6">
                    <h3 className="text-base font-medium mb-1">Geographic concentration</h3>
                    <p className="text-xs text-muted-foreground mb-4">Top countries by firm count</p>
                    {(() => {
                      const countryCounts: Record<string, number> = {};
                      networkNodes.forEach(n => {
                        const c = n.country || 'Unknown';
                        countryCounts[c] = (countryCounts[c] || 0) + 1;
                      });
                      const sorted = Object.entries(countryCounts)
                        .sort(([, a], [, b]) => b - a)
                        // .slice(0, 6);
                      const max = sorted[0]?.[1] || 1;
                      return (
                        <div className="overflow-y-auto max-h-[168px] space-y-2 pr-1">
                          {sorted.map(([country, count]) => (
                            <div key={country} className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground w-20 shrink-0 truncate">{country}</span>
                              <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                                <div
                                  className="h-full rounded"
                                  style={{ width: `${(count / max) * 100}%`, background: '#3b82f6' }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-6 text-right">{count}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </Card>
                </div>

                {/* Tier composition + Revenue coverage */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                  {/* Tier composition donut */}
                  <Card className="p-6">
                    <h3 className="text-base font-medium mb-1">Tier composition</h3>
                    <p className="text-xs text-muted-foreground mb-4">Share of firms per supply chain tier</p>
                    {(() => {
                      const total = Object.values(tierCounts).reduce((a, b) => a + b, 0) || 1;
                      const tiers = TIER_ORDER.map(t => ({
                        label: t,
                        count: tierCounts[t],
                        pct: Math.round((tierCounts[t] / total) * 100),
                        color: TIER_COLORS[t],
                      }));
                      const circumference = 2 * Math.PI * 32;
                      let offset = 0;
                      return (
                        <div className="flex items-center gap-6">
                          <svg width="90" height="90" viewBox="0 0 90 90" className="shrink-0">
                            {tiers.map(t => {
                              const dash = (t.pct / 100) * circumference;
                              const seg = (
                                <circle
                                  key={t.label}
                                  cx="45" cy="45" r="32"
                                  fill="none"
                                  stroke={t.color}
                                  strokeWidth="14"
                                  strokeDasharray={`${dash} ${circumference - dash}`}
                                  strokeDashoffset={-offset}
                                />
                              );
                              offset += dash;
                              return seg;
                            })}
                          </svg>
                          <div className="space-y-1.5">
                            {tiers.map(t => (
                              <div key={t.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                                {t.label} — {t.pct}% ({t.count})
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </Card>

                  {/* Revenue coverage */}
                  <Card className="p-6">
                    <h3 className="text-base font-medium mb-1">Revenue coverage</h3>
                    <p className="text-xs text-muted-foreground mb-4">Firms with known revenue per tier</p>
                    {(() => {
                      const tiers = TIER_ORDER.map(t => {
                        const tierNodes = networkNodes.filter(n => {
                          const isPlant = n.is_seed === true;
                          return getTierFromDepth(n.depth, isPlant) === t;
                        });
                        const withRevenue = tierNodes.filter(n => n.revenue != null && n.revenue > 0).length;
                        const pct = tierNodes.length > 0 ? Math.round((withRevenue / tierNodes.length) * 100) : 0;
                        return { label: t, pct, color: TIER_COLORS[t] };
                      });
                      return (
                        <div className="space-y-2">
                          {tiers.map(t => (
                            <div key={t.label} className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground w-20 shrink-0">{t.label}</span>
                              <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                                <div
                                  className="h-full rounded"
                                  style={{ width: `${t.pct}%`, background: t.color }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground w-8 text-right">{t.pct}%</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </Card>
                </div>

                {/* Single-source exposure */}
                <Card className="p-6">
                  <h3 className="text-base font-medium mb-1">Single-source exposure</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Nodes with only one upstream supplier but multiple downstream connections — highest disruption risk
                  </p>
                  {(() => {
                    const inCount: Record<string, number> = {};
                    const outCount: Record<string, number> = {};
                    networkEdges.forEach(e => {
                      inCount[e.dst_uid]  = (inCount[e.dst_uid]  || 0) + 1;
                      outCount[e.src_uid] = (outCount[e.src_uid] || 0) + 1;
                    });
                    
                  const exposed = networkNodes
                    .filter(n => (inCount[n.uid] || 0) === 1 && (outCount[n.uid] || 0) > 0)
                    .map(n => {
                      const nodeCountry = n.country || 'Unknown';
                      
                      // 1. Force the lookup key to be exactly what we stored in the map (Uppercase & Trimmed)
                      const lookupKey = nodeCountry.trim().toUpperCase();
                      
                      // 2. Fetch the risk, and trim any accidental spaces from the database string
                      const rawRisk = countryRiskMap[lookupKey];
                      const safeRisk = rawRisk ? rawRisk.trim() : 'Unknown';

                      return {
                        name: n.name || n.uid,
                        tier: getTierFromDepth(n.depth, n.is_seed === true),
                        country: nodeCountry, // Keep original casing for the UI display
                        incoming: inCount[n.uid] || 0,
                        outgoing: outCount[n.uid] || 0,
                        risk: safeRisk, 
                      };
                    })
                    .sort((a, b) => b.outgoing - a.outgoing)
                    .slice(0, 10);

                    if (exposed.length === 0) return (
                      <p className="text-sm text-muted-foreground text-center py-4">No single-source nodes detected</p>
                    );

                    // IMPORTANT: You may need to update these keys if the text in "INFORM RISK" 
                    // is different from "High", "Medium", "Low" (e.g., if it uses numbers or "Very High")
                    // 1. Define the dynamic color mapping for the new Risk Classes
                    // Note: Ensure the keys exactly match the capitalization in your database
                    const riskStyle: Record<string, string> = {
                      'Very High': 'bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-200 font-bold',
                      'High':      'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
                      'Medium':    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
                      'Low':       'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
                      'Very Low':  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
                      'Unknown':   'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                    };

                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className={`text-left font-medium text-muted-foreground pb-2 pr-3 ${FROZEN_CELL}`}>Firm</th>
                              <th className="text-left font-medium text-muted-foreground pb-2 pr-3">Tier</th>
                              <th className="text-left font-medium text-muted-foreground pb-2 pr-3">Country</th>
                              <th className="text-right font-medium text-muted-foreground pb-2 pr-3">In</th>
                              <th className="text-right font-medium text-muted-foreground pb-2 pr-3">Out</th>
                              <th className="text-left font-medium text-muted-foreground pb-2">Risk Class</th>
                            </tr>
                          </thead>
                          <tbody>
                            {exposed.map(row => {
                              // Safely grab the style, fallback to Unknown if the database has a weird string
                              const badgeStyle = riskStyle[row.risk] || riskStyle['Unknown'];
                              
                              return (
                                <tr key={row.name} className="border-b last:border-0">
                                  <td className={`py-2 pr-3 max-w-[140px] truncate ${FROZEN_CELL}`} title={row.name}>{row.name}</td>
                                  <td className="py-2 pr-3">
                                    <span
                                      className="inline-block px-2 py-0.5 rounded-sm text-xs font-medium"
                                      style={{ background: TIER_COLORS[row.tier] + '22', color: TIER_COLORS[row.tier] }}
                                    >
                                      {row.tier}
                                    </span>
                                  </td>
                                  <td className="py-2 pr-3 text-muted-foreground">{row.country}</td>
                                  <td className="py-2 pr-3 text-right">{row.incoming}</td>
                                  <td className="py-2 pr-3 text-right">{row.outgoing}</td>
                                  <td className="py-2">
                                    <span className={`inline-block px-2 py-0.5 rounded-sm text-xs font-medium ${badgeStyle}`}>
                                      {row.risk}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </Card>

              {firmRevenues.length > 0 && (
                <Card className="p-6">
                  <div className="mb-4">
                    <h3 className="text-base font-medium">Top Firms by Revenue</h3>
                    <p className="text-xs text-muted-foreground">
                      Revenue distribution across network firms
                    </p>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {firmRevenues.map((firm, index) => (
                      <div key={firm.firm} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-medium w-6 text-center">{index + 1}</span>
                          <span className="text-sm font-medium">{firm.firm}</span>
                        </div>
                        <Badge variant="outline">
                          ${(firm.revenue / 1000000).toFixed(1)}M
                        </Badge>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              
              {firmConnections.length > 0 && (
                <Card className="p-6">
                  <div className="mb-4">
                    <h3 className="text-base font-medium">Most Connected Firms</h3>
                    <p className="text-xs text-muted-foreground">
                      Firms ranked by number of network connections
                    </p>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {firmConnections.map((firm, index) => (
                      <div key={firm.firm} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-medium w-6 text-center">{index + 1}</span>
                          <span className="text-sm font-medium">{firm.firm}</span>
                        </div>
                        <Badge variant="outline">
                          {firm.connections} connections
                        </Badge>
                      </div>
                    ))}
                  </div>
                </Card>
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