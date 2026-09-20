// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
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
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';


import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { typedNodesFromLanes, labelForEchelon, type Echelon } from '@/lib/graph';
import { useAuth } from '@/hooks/useAuth';
import { useGlobalProject } from '@/hooks/useGlobalProject';
import { fetchMultiTierNetworkData, MultiTierNetworkData } from '@/services/network';
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
  AlertTriangle,
  Tag,
} from 'lucide-react';
import {
  PageLayout,
  PageHeader,
  HeaderRefreshButton,
  PAGE_GUTTER,
  PAGE_GUTTER_SKIN,
  HDR_FILTER_SELECT,
  HDR_ICON_BUTTON,
  HDR_ICON_BUTTON_ON,
  HDR_OUTLINE_BUTTON,
  HDR_PROJECT_SELECT,
  HDR_SEARCH_INPUT,
} from '@/components/shared';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';
import { MobileGroup, MobilePageHeader, ProjectChip } from '@/components/mobile';
import {
  LensChip,
  LensHowToRead,
  LensDesktopOnlyNote,
  LensStructure,
  LensRisk,
  LensTable,
  LensSection,
} from '@/components/network/MobileLens';
import { DisruptionDialog } from '@/components/DisruptionDialog';
import MLPrediction from '@/components/MLPrediction';
import { BarChart } from 'lucide-react';

// Colors for integrated process network - left to right flow (Level 6 Suppliers → Customer)
const NODE_TYPE_COLORS: Record<string, string> = {
  supplier: '#2563eb',   // Blue - suppliers (leftmost)
  material: '#059669',   // Green - base materials
  product: '#dc2626',    // Red - products  
  customer: '#7c2d12',   // Brown - customers (rightmost)
};

// Process level colors for corrected mapping (Level 6 Suppliers → Products → Customers)
// const LEVEL_COLORS: Record<number, string> = {
//   '-1': '#fb923c', // Level -1 (Customers) 
//   0: '#3b82f6',    // Level 0 (Products)   
//   1: '#059669',    // Level 1 (Materials) - Green
//   2: '#ca8a04',    // Level 2 (Materials) - Gold
//   3: '#ea580c',    // Level 3 (Materials) - Orange
//   4: '#dc2626',    // Level 4 (Materials) - Red
//   5: '#2563eb',    // Level 5 (Materials/Suppliers) - Blue
//   6: '#22c55e',    // Level 6 (Suppliers) 
// };

const HIGHLIGHT_HEX = '#ff0000';

interface MultiTierData {
  id: string;
  project_id: string;
  plant_name: string;
  from_location: string;
  to_location: string;
  level: number;
  material_consumption_rate: number | null;
  sourcing_ratio: number | null;
  weighted: number | null;
  data_source: string;
  data_source_group: string | null;
  path_root: string | null;
  uploaded_by: string | null;
  organization: string;
  created_at: string;
  updated_at: string;
}

interface NodeData extends Record<string, unknown> {
  label: string;
  /**
   * WP 8.3 · §4 D127. The node's ROLE, derived once by the one rule
   * (`classify_node_echelon`, mirrored client-side by `typedNodesFromLanes`) instead
   * of inferred from an integer. This is what the labels and the details panel read.
   */
  echelon: Echelon;
  /**
   * The legacy four-value field, kept because `getNodeColor` and the level filters
   * still read it. DERIVED from `echelon` at the one place nodes are built, exactly
   * as `classify_node_type` is now a mapping over `classify_node_echelon` in SQL —
   * so the two vocabularies cannot disagree about the same node.
   */
  nodeType: 'supplier' | 'material' | 'product' | 'customer';
  /**
   * The node's position ordinate. Since WP 8.3 this is the REAL BOM depth from
   * `bom_multi_level` where the node is in a BOM, and the lane ordinate otherwise —
   * NOT `supply_chain_data_multi_tier.level`, which two live writers disagree about
   * and one of which flattens every BOM row to a literal 2 (§4 D140).
   */
  level: number;
  bomLevel: number | null;
  incoming: number;
  outgoing: number;
  flowVolume: number;
  consumptionRate: number | null;
  dataSource: string;
  isConnected: boolean;
  mappingConfidence: number | null;
}

function TooltipNode({ data }: { data: NodeData }) {
  return (
    <div className="relative group w-full h-full flex items-center justify-center">
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded shadow-md border border-border whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-50">
        {data.label}
      </div>
      <span className="truncate px-1 text-center leading-tight">
        {data.label}
      </span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

interface NetworkVisualizationProps {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

function getNodeColor(nodeType: string, level: number, maxLevel: number): string {
  // Color from nodeType directly wherever it's authoritative — nodeType is
  // now dataSource-aware (a row explicitly tagged "inbound" is always a
  // supplier), while `level` alone is not: some projects' multi-tier
  // pipeline never tiers inbound rows past level 1, so a supplier and a
  // material can share the exact same level and be indistinguishable by
  // level comparison alone.
  if (nodeType === 'supplier') return '#22c55e';
  if (nodeType === 'customer') return '#fb923c';
  if (nodeType === 'product') return '#3b82f6';

  // Remaining nodes are materials — keep the existing dynamic shading by depth
  if (level > 0 && level < maxLevel) {
    const materialLevelsCount = Math.max(1, maxLevel - 1);
    const lightnessStep = (80 - 20) / materialLevelsCount;
    const calculatedLightness = 80 - (level * lightnessStep);
    return `hsl(48, 96%, ${calculatedLightness}%)`;
  }

  // A material sitting at the deepest available level (no shallower tier to
  // shade against) still gets a material color, not the fallback gray.
  if (level > 0) return 'hsl(48, 96%, 50%)';

  return '#6b7280';
}

/**
 * The legacy four-value vocabulary, DERIVED from the echelon — WP 8.3 · §4 D127.
 *
 * `getNodeTypeFromLevel` and `getDisplayNodeType` used to live here. Both are gone:
 * they inferred a node's type from `supply_chain_data_multi_tier.level`, a column two
 * live writers disagree about (§4 D140) and which the deployed one flattens to a
 * literal 2 on every BOM row. They also disagreed with EACH OTHER — one had an
 * `inbound` override and the other read the level alone — which is two of the eight
 * classifiers D127 counts, in one file.
 *
 * What replaces them is `typedNodesFromLanes`, the declared mirror of
 * `classify_node_echelon`, and this mapping. It is a mapping and not a second rule,
 * exactly as `classify_node_type` is now a mapping over `classify_node_echelon` in
 * SQL — so the page and the database cannot type the same node differently.
 *
 * `subassembly` maps to `material`: a thing the plant both builds and consumes is
 * input to something else, and calling it a product told the map to draw it on the
 * customer side. `plant` and `unknown` map to `material` ONLY for the legacy colour
 * and filter paths that cannot express them; every label a user reads goes through
 * `labelForEchelon`, which says "Unknown" rather than guessing (T1).
 */
function echelonToLegacyType(echelon: Echelon): 'supplier' | 'material' | 'product' | 'customer' {
  switch (echelon) {
    case 'customer': return 'customer';
    case 'product': return 'product';
    case 'supplier': return 'supplier';
    default: return 'material';
  }
}

/**
 * The label for a DEPTH BUCKET, as the level tiles and the flow list describe one.
 *
 * Distinct from `labelForEchelon`, which labels a NODE. A bucket is a set of nodes at
 * one ordinate, and since WP 8.3 that ordinate is the real BOM depth — so the honest
 * label names the depth rather than asserting a kind. `-1` and `0` are the two the
 * page's own convention reserves.
 */
function depthBucketLabel(level: number): string {
  if (level === -1) return 'Customers';
  if (level === 0) return 'Finished products';
  if (level > 0) return `BOM depth ${level}`;
  return 'Unknown depth';
}

export default function ProcessLevelNetwork({ isCollapsed, setIsCollapsed }: NetworkVisualizationProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { globalSelectedProjectId, setGlobalSelectedProjectId } = useGlobalProject();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const [loading, setLoading] = useState(false);
  const [levelCounts, setLevelCounts] = useState<Record<number, number>>({});
  const [legendGroups, setLegendGroups] = useState<Array<{ key: string; label: string; count: number; color: string }>>([]);
  const [allNodes, setAllNodes] = useState<Node<NodeData>[]>([]);
  const [allEdges, setAllEdges] = useState<Edge[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [topFlowFilter, setTopFlowFilter] = useState<string>('');
  interface LevelStats {
    level: number;
    displayType: string;
    count: number;
    avgIn: number;
    avgOut: number;
    avgFlow: number;
    color: string;
  }
  const [levelStats, setLevelStats] = useState<LevelStats[]>([]);
  const [topFlowNodes, setTopFlowNodes] = useState<{ id: string; flow: number; level: number }[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [maxLevel, setMaxLevel] = useState(0);
  const [showLabels, setShowLabels] = useState(false);
  
  // Level 1 node filter states
  const [selectedLevel1Node, setSelectedLevel1Node] = useState<string | null>(null);
  const [reachableNodes, setReachableNodes] = useState<Set<string>>(new Set());
  const [isLevel1FilterActive, setIsLevel1FilterActive] = useState(false);
  const [level1Nodes, setLevel1Nodes] = useState<string[]>([]);
  const [disruptionDialogOpen, setDisruptionDialogOpen] = useState(false);

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
      setLevelCounts({});
      setLegendGroups([]);
        setSelectedNode(null);
        setFocusedNode(null);
        setMaxLevel(0);
        return;
    }

    setLoading(true);
    
    try {
      console.log('📡 Fetching multi-tier network data via service for project:', globalSelectedProjectId);
      
      // Use the new service function that handles RLS context properly
      const multiTierData = await fetchMultiTierNetworkData(
        globalSelectedProjectId,
        user.id,
        user.email
      );

      if (!multiTierData || multiTierData.length === 0) {
        console.log('⚠️ No multi-tier network data for selected project');
        
        // Clear visualization
        setNodes([]);
        setEdges([]);
        setAllNodes([]);
        setAllEdges([]);
        setLevelCounts({});
        setLegendGroups([]);
        setSelectedNode(null);
        setFocusedNode(null);
        setMaxLevel(0);
        
        toast.info('No process network data available. Please upload and combine your project datasets.');
        
        return;
      }

      console.log('✅ Multi-tier data response:', { 
        recordCount: multiTierData.length,
        sample: multiTierData.slice(0, 3),
        levels: [...new Set(multiTierData.map(d => d.level))].sort((a, b) => a - b),
        dataSources: [...new Set(multiTierData.map(d => d.data_source))]
      });

      // Cache multiTierData for reachability algorithm
      setMultiTierDataCache(multiTierData);

      // ── WP 8.3 · §4 D127, D140 — TYPE AND DEPTH COME FROM THE DATA NOW ────
      //
      // Everything below this point reads `record.level` and `nodeType`. Both were
      // wrong, for two different reasons, and this is where they are fixed once
      // rather than at each of the places that consume them.
      //
      // DEPTH. `supply_chain_data_multi_tier.level` has TWO live writers that
      // disagree (§4 D140), and the deployed one — the SQL RPC
      // `combine_project_into_supply_chain` — stamps a LITERAL 2 on every
      // `bom_multi_level` row and never reads the real depth. §15 run 35433474185
      // measured a project whose BOM is four levels deep and whose entire bom lane
      // sits at level 2: its 260 materials and 66 products rendered as ONE flat
      // column, every one of them labelled a level-2 material. `bom_multi_level.level`
      // is the real depth, neither writer touches it, and it is one read away.
      //
      // TYPE. Derived from the LANE ROLES a node actually holds, by the one rule
      // (`classify_node_echelon`, WP 8.1) rather than from a fixed ladder over an
      // integer. That is what lets a `subassembly` exist at all — §15 found 65 nodes
      // that are both a BOM target and a BOM source on the reported project, every
      // one of which the ladder called a material and the SQL called a product.
      //
      // WHY NOT `node_list.echelon`, WHICH IS THE AUTHORITY. Because the migration
      // that adds it deploys on MERGE (`supabase-migrations.yml` is
      // `branches: [main]`), so reading it today renders nothing. `typedNodesFromLanes`
      // is the declared mirror of the same rule and `echelonMirror.test.ts` parses the
      // SQL's own branch order and fails if the two diverge. When the column reaches
      // production this block becomes a `useGraphNodes` call and the mirror's only
      // caller disappears.
      const projectPlant =
        projects.find((pr) => pr.id === globalSelectedProjectId)?.plant_name ?? null;

      const { data: bomDepthRows, error: bomDepthError } = await supabase
        .from('bom_multi_level')
        .select('material_id,higher_level_component_id,level')
        .eq('project_id', globalSelectedProjectId);

      if (bomDepthError) {
        // SAID, not swallowed. A depth we could not read is rendered as unknown
        // below, and the user is told why rather than shown a flat graph (T2).
        console.error('[ProcessLevelNetwork] bom_multi_level read failed:', bomDepthError.message);
        toast.warning(
          'Could not read the bill of materials, so BOM depth is shown as unknown. ' +
            'The graph is still correct about what connects to what.',
        );
      }

      const typedNodes = typedNodesFromLanes(multiTierData, bomDepthRows ?? [], projectPlant);

      // The echelon a node resolves to, and the depth to render it at. `bomDepth` is
      // null for anything outside the BOM — a supplier, a customer — so those keep the
      // lane ordinate, which is meaningful for them (0 outbound, and the inbound lane's
      // own position). A NULL depth is never substituted with 0: that is §4 D134.
      const echelonOf = (id: string): Echelon =>
        typedNodes.get(id)?.echelon ?? 'unknown';
      const depthOf = (id: string): number | null =>
        typedNodes.get(id)?.bomDepth ?? null;

      // ── WHERE A SUPPLIER SITS, derived rather than inherited ───────────────
      //
      // A supplier is in no BOM, so it has no BOM depth — and taking the lane's own
      // ordinate for it is the last place §4 D140 still shows: on the reported
      // project the inbound lane occupies levels 1 AND 5, from one upload, because
      // `GREATEST(1, max_level + 1)` was computed against a BOM depth the writer had
      // already flattened. The page then drew the same kind of firm in two columns
      // four apart, and called the ones at level 1 materials.
      //
      // The position IS in the data: a supplier feeds material M, M has a real BOM
      // depth d, so the supplier sits one step beyond the deepest material it
      // supplies. That is what both ETLs were reaching for with `max_level + 1`; the
      // only thing they got wrong was computing it from the flattened copy.
      //
      // A supplier whose materials are all outside the BOM has no derivable position,
      // and is placed one step beyond the deepest material in the project rather than
      // at a level that means something else. That is a LAYOUT fallback, not a claim
      // about the data: `bomDepth` stays null for it and every label it carries comes
      // from its echelon.
      const deepestMaterialDepth = Math.max(
        0,
        ...[...typedNodes.values()].map((v) => v.bomDepth ?? 0),
      );
      const supplierOrdinate = new Map<string, number>();
      for (const record of multiTierData) {
        if ((record.data_source ?? '').toLowerCase() !== 'inbound') continue;
        const supplier = (record.from_location ?? '').trim();
        if (!supplier) continue;
        const fedDepth = depthOf((record.to_location ?? '').trim());
        const candidate = (fedDepth ?? deepestMaterialDepth) + 1;
        const prev = supplierOrdinate.get(supplier);
        if (prev === undefined || candidate > prev) supplierOrdinate.set(supplier, candidate);
      }

      console.log('🔄 Processing nodes and edges from multi-tier data...');

      const nodeMap: { [key: string]: NodeData } = {};
      const edgeMap: { [key: string]: Edge } = {};
      const levelNodeCounts: Record<number, number> = {};

      // ── ONE node pass, over BOTH endpoints (WP 8.3 · §4 D128) ─────────────
      //
      // There were two passes and between them they lost nodes. The first read only
      // `record.from_location`. The second read `to_location` but ONLY for outbound
      // rows at level 0, i.e. customers. So **a BOM target that is never also a BOM
      // source and never an outbound source got no node at all** — and every edge
      // pointing at it was then skipped, silently, because the edge builder requires
      // both endpoints to exist. On the reported project that is invisible only
      // because its sub-assemblies happen to be both, which is luck rather than
      // design.
      //
      // The dedup guard is also fixed here: it used to test `nodeMap[dedupKey]` while
      // writing `nodeMap[nodeId]`, so it never fired and the last row won every
      // node's level, type, lane and colour. §15 measured 466 nodes for which "last
      // row wins" was a real choice. `levelNodeCounts` was incremented inside that
      // same unreachable branch, which is why the legend counts and the level tiles
      // counted ROWS rather than nodes.
      const addNode = (rawId: string | null | undefined, record: MultiTierData) => {
        const nodeId = (rawId ?? '').trim();
        if (!nodeId) return;                 // never a node for a blank endpoint
        if (nodeMap[nodeId]) return;         // first record wins, deterministically

        const echelon = echelonOf(nodeId);
        // A customer sits at -1 by this page's own convention, which keeps it apart
        // from a finished product at BOM depth 0. Everything else takes the real BOM
        // depth where it has one, and the lane ordinate where it does not — a
        // supplier and a customer are in no BOM, and giving them a depth of 0 would
        // be §4 D134's substitution in a new place.
        const level =
          echelon === 'customer' ? -1
          : echelon === 'supplier' ? supplierOrdinate.get(nodeId) ?? deepestMaterialDepth + 1
          : depthOf(nodeId) ?? record.level;

        levelNodeCounts[level] = (levelNodeCounts[level] || 0) + 1;

        nodeMap[nodeId] = {
          label: nodeId,
          echelon,
          nodeType: echelonToLegacyType(echelon),
          level,
          bomLevel: depthOf(nodeId),
          incoming: 0,
          outgoing: 0,
          flowVolume: 0,
          consumptionRate: 0,
          dataSource: record.data_source,
          isConnected: true,
          // §4 D135 — this was a literal 1.0 at five creation sites, which made the
          // amber low-confidence border unreachable: a confidence signal that could
          // only ever say "confident". It is now computed from the one thing that
          // genuinely makes a node's role uncertain — the data not placing it.
          mappingConfidence: echelon === 'unknown' ? 0 : 1,
        };
      };

      for (const record of multiTierData) {
        addNode(record.from_location, record);
        addNode(record.to_location, record);
      }

      const echelonTally = Object.values(nodeMap).reduce<Record<string, number>>((acc, n) => {
        acc[n.echelon] = (acc[n.echelon] || 0) + 1;
        return acc;
      }, {});
      console.log('📍 Nodes by echelon:', echelonTally, '· depths:', levelNodeCounts);

      console.log('📍 Created', Object.keys(nodeMap).length, 'unique nodes using corrected logic');
      console.log('📊 Level distribution:', levelNodeCounts);
      
      // Log detailed breakdown by level AND node type for verification
      const levelTypeBreakdown: Record<string, Record<string, number>> = {};
      Object.values(nodeMap).forEach(node => {
        const levelKey = `Level ${node.level}`;
        if (!levelTypeBreakdown[levelKey]) levelTypeBreakdown[levelKey] = {};
        levelTypeBreakdown[levelKey][node.nodeType] = (levelTypeBreakdown[levelKey][node.nodeType] || 0) + 1;
      });
      
      Object.entries(levelTypeBreakdown).forEach(([level, types]) => {
        const typesSummary = Object.entries(types).map(([type, count]) => `${count} ${type}`).join(', ');
        console.log(`   ${level}: ${typesSummary}`);
      });

      // CORRECTED LOGIC: Step 3 - Create edges from from_location to to_location with weighted values
      const edgeSet = new Set<string>();
      
      multiTierData.forEach((record) => {
        const fromNode = record.from_location;
        const toNode = record.to_location;
        
        // Create edge if both nodes exist and are different
        if (fromNode && toNode && fromNode !== toNode && nodeMap[fromNode] && nodeMap[toNode]) {
          const edgeKey = `${fromNode}-${toNode}`;
          
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            
            // Update connection counts
            nodeMap[fromNode].outgoing++;
            nodeMap[toNode].incoming++;
            
            // Update flow volumes using weighted values
            const weightedValue = record.weighted || 0;
            const consumptionRate = record.material_consumption_rate || 0;
            
            nodeMap[fromNode].flowVolume += weightedValue;
            nodeMap[toNode].flowVolume += weightedValue;
            nodeMap[fromNode].consumptionRate += consumptionRate;
            nodeMap[toNode].consumptionRate += consumptionRate;

            // Use silver/gray styling for all edges to reduce visual noise
            const strokeColor = '#8C8C8C';
            const strokeWidth = 1.5;

            // Create edge - labels controlled by showLabels state
            edgeMap[edgeKey] = {
              id: edgeKey,
              source: fromNode,
              target: toNode,
              label: '', // Labels will be set dynamically based on showLabels state
              style: {
                stroke: strokeColor,
                strokeWidth,
                strokeOpacity: 0.6,
              },
              animated: false,
              type: 'straight',
              data: { 
                consumptionRate: consumptionRate,
                flowVolume: weightedValue,
                dataSource: record.data_source,
                connectionType: record.data_source,
                isConnected: true,
                mappingConfidence: 1.0,
                originalLabel: weightedValue > 0 ? `${Math.round(weightedValue)}` : 
                               consumptionRate > 0 ? `${consumptionRate.toFixed(1)}` : ''
              },
            };
          }
        }
      });

      console.log('📊 Created', Object.keys(edgeMap).length, 'edges using corrected logic');

      const currentMaxLevel = Math.max(...Object.keys(levelNodeCounts).map(Number));
      setLevelCounts(levelNodeCounts);
      setMaxLevel(currentMaxLevel);

      // Build the sidebar legend from nodeType, not raw level — a level can
      // hold a mix of nodeTypes (e.g. inbound suppliers this project's
      // multi-tier pipeline never tiered past level 1), which grouping by
      // level alone would silently merge into one mislabeled bucket.
      const legendGroupMap: Record<string, { label: string; count: number; color: string; sortKey: number }> = {};
      Object.values(nodeMap).forEach((n) => {
        const key = n.nodeType === 'material' ? `material-${n.level}` : n.nodeType;
        if (!legendGroupMap[key]) {
          legendGroupMap[key] = {
            label: labelForEchelon(n.echelon),
            count: 0,
            color: getNodeColor(n.nodeType, n.level, currentMaxLevel),
            // Suppliers first, then materials deepest→shallowest, then product, then customer —
            // mirrors the graph's own left-to-right flow.
            sortKey: n.nodeType === 'supplier' ? 10000
              : n.nodeType === 'material' ? 1000 + n.level
              : n.nodeType === 'product' ? -1000
              : -2000,
          };
        }
        legendGroupMap[key].count++;
      });
      setLegendGroups(Object.values(legendGroupMap).sort((a, b) => b.sortKey - a.sortKey));
      
      // Extract Level 1 nodes for filtering
      const level1NodeIds = Object.entries(nodeMap)
        .filter(([_, nodeData]) => nodeData.level === 1)
        .map(([nodeId, _]) => nodeId)
        .sort();
      setLevel1Nodes(level1NodeIds);

      console.log('📊 Level distribution:', levelNodeCounts);
      
      // Group nodes by level for left-to-right layout
      const nodesByLevel: Record<number, string[]> = {};
      Object.entries(nodeMap).forEach(([nodeId, nodeData]) => {
        const level = nodeData.level;
        if (!nodesByLevel[level]) nodesByLevel[level] = [];
        nodesByLevel[level].push(nodeId);
      });

      // Create visual layout using clean group-based approach
      const nodeList: Node<NodeData>[] = [];
      const rowGap = 60; // Fixed consistent row gap
      const startY = 100;

      // Sort levels for left-to-right positioning (Level 6 → Level -1)
      const sortedLevels = Object.keys(nodesByLevel).map(Number).sort((a, b) => b - a);

      // Adaptive spacing: measure each present level's real horizontal
      // footprint (based on how many nodes/sub-columns it actually needs)
      // instead of assuming a fixed slot per absolute level number.
      const baseColumnPadding = 150;
      const totalNodesForSizing = Object.keys(nodeMap).length;
      const baseNodeSizeForSizing = Math.max(50 - Math.log(totalNodesForSizing) * 3, 30);
      const genericSpacing = baseNodeSizeForSizing * 1.2;

      const levelFootprints: Record<number, number> = {};
      sortedLevels.forEach((level) => {
        const levelNodes = nodesByLevel[level];

        if (level === 1) {
          const level1Set = new Set(levelNodes);
          const receivesFromLevel1 = new Set<string>();
          Object.values(edgeMap).forEach(edge => {
            if (level1Set.has(edge.source as string) && level1Set.has(edge.target as string)) {
              receivesFromLevel1.add(edge.target as string);
            }
          });
          const colACount = levelNodes.filter(id => !receivesFromLevel1.has(id)).length;
          const colBCount = levelNodes.filter(id => receivesFromLevel1.has(id)).length;
          const colASubCount = colACount >= 20 ? Math.ceil(colACount / 20) : (colACount > 0 ? 1 : 0);
          const colBSubCount = colBCount >= 20 ? Math.ceil(colBCount / 20) : (colBCount > 0 ? 1 : 0);
          const totalSubCols = Math.max(colASubCount + colBSubCount, 1);
          levelFootprints[level] = (totalSubCols - 1) * genericSpacing + baseNodeSizeForSizing;
        } else {
          const count = levelNodes.length;
          const subgroupCount = count >= 20 ? Math.ceil(count / 20) : 1;
          levelFootprints[level] = (subgroupCount - 1) * genericSpacing + baseNodeSizeForSizing;
        }
      });

      const levelXPositions: Record<number, number> = {};
      let rightEdge = 100;
      sortedLevels.forEach((level) => {
        const width = levelFootprints[level];
        const center = rightEdge + width / 2;
        levelXPositions[level] = center;
        rightEdge = center + width / 2 + baseColumnPadding;
      });

      const calculateLevelXPosition = (level: number): number => levelXPositions[level] ?? 100;
      
      sortedLevels.forEach((level) => {
        const levelNodes = nodesByLevel[level];
        const x = calculateLevelXPosition(level);

        const totalNodes = Object.keys(nodeMap).length;
        let baseNodeSize = Math.max(50 - Math.log(totalNodes) * 3, 30);

        if (level === 0) baseNodeSize *= 1.1;
        if (level === -1) baseNodeSize *= 0.9;

        // ── Special split logic for Level 1 ──────────────────────────────
        if (level === 1) {
          const level1Set = new Set(levelNodes);
          const receivesFromLevel1 = new Set<string>();

          Object.values(edgeMap).forEach(edge => {
            if (
              level1Set.has(edge.source as string) &&
              level1Set.has(edge.target as string)
            ) {
              receivesFromLevel1.add(edge.target as string);
            }
          });

          const colA = levelNodes.filter(id => !receivesFromLevel1.has(id));
          const colB = levelNodes.filter(id => receivesFromLevel1.has(id));
          const spacing = baseNodeSize * 1.2;

          // Same 20-per-column rule the generic levels use, applied to each
          // side — so a single-level BOM with hundreds of level-1 nodes
          // spreads into many columns instead of 2 absurdly tall ones.
          const subdivide = (colNodes: string[]) => {
            const subCount = colNodes.length >= 20 ? Math.ceil(colNodes.length / 20) : (colNodes.length > 0 ? 1 : 0);
            const subs: string[][] = Array.from({ length: subCount }, () => []);
            colNodes.forEach((id, idx) => subs[idx % subCount].push(id));
            return subs;
          };

          const colASubs = subdivide(colA);
          const colBSubs = subdivide(colB);

          // Combine colA (left) and colB (right) into ONE centered sequence,
          // the same way the generic subgroup logic centers its subcolumns —
          // instead of centering colA and colB independently around x. colB
          // is usually much larger than colA (most materials receive an edge
          // from a supplier or another material, both level 1), so centering
          // them separately made the real rightward extent exceed what the
          // footprint calculation reserved, letting materials bleed into the
          // next level's column.
          const allSubs = [...colASubs, ...colBSubs];
          const totalSubCols = allSubs.length;
          const allOffsets = allSubs.map((_, i) => (i - (totalSubCols - 1) / 2) * spacing);

          ([[allSubs, allOffsets]] as [string[][], number[]][]).forEach(([subs, offsets]) => {
            subs.forEach((subIds, si) => {
              const yOffset = -((subIds.length - 1) * rowGap) / 2;
              subIds.forEach((nodeId, i) => {
                const nodeData = nodeMap[nodeId];
                const isDisconnected = !nodeData.isConnected && nodeData.dataSource !== 'bridge';
                const hasLowConfidence = nodeData.mappingConfidence && nodeData.mappingConfidence < 0.8;

                nodeList.push({
                  id: nodeId,
                  position: {
                    x: x + offsets[si],
                    y: startY + yOffset + i * rowGap,
                  },
                  data: nodeData,
                  style: {
                    background: isDisconnected ? '#6b7280' : getNodeColor(nodeData.nodeType, nodeData.level, currentMaxLevel),
                    color: 'white',
                    width: baseNodeSize,
                    height: baseNodeSize * 0.7,
                    fontSize: 10,
                    fontWeight: 'normal',
                    borderRadius: 8,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    textAlign: 'center',
                    border: isDisconnected ? '2px solid #ef4444' :
                            hasLowConfidence ? '2px solid #f59e0b' :
                            '1px solid rgba(255,255,255,0.3)',
                    boxShadow: isDisconnected ? '0 2px 8px rgba(239, 68, 68, 0.4)' : 'none',
                    opacity: isDisconnected ? 0.7 : 1,
                  },
                  type: 'default',
                  sourcePosition: Position.Right,
                  targetPosition: Position.Left,
                });
              });
            });
          });

          return; // Skip the generic subgroup logic below
        }
        // ── End Level 1 special logic ─────────────────────────────────────

        // Generic subgroup logic (all other levels)
        const subgroupCount = levelNodes.length >= 20 ? Math.ceil(levelNodes.length / 20) : 1;
        const spacing = baseNodeSize * 1.2;
        const subgroupOffsets = Array.from({ length: subgroupCount }, (_, i) =>
          (i - (subgroupCount - 1) / 2) * spacing
        );

        const subgroups = Array.from({ length: subgroupCount }, () => [] as string[]);
        levelNodes.forEach((nodeId, idx) => subgroups[idx % subgroupCount].push(nodeId));

        subgroups.forEach((subIds, si) => {
          const yOffset = -((subIds.length - 1) * rowGap) / 2;

          subIds.forEach((nodeId, i) => {
            const nodeData = nodeMap[nodeId];
            const isProductNode = nodeData.nodeType === 'product';
            const isCustomerNode = nodeData.nodeType === 'customer';
            const isDisconnected = !nodeData.isConnected && nodeData.dataSource !== 'bridge';
            const hasLowConfidence = nodeData.mappingConfidence && nodeData.mappingConfidence < 0.8;

            nodeList.push({
              id: nodeId,
              position: {
                x: x + subgroupOffsets[si],
                y: startY + yOffset + i * rowGap,
              },
              data: nodeData,
              style: {
                background: isDisconnected ? '#6b7280' : getNodeColor(nodeData.nodeType, nodeData.level, currentMaxLevel),
                color: 'white',
                width: isProductNode ? 65 : isCustomerNode ? 50 : baseNodeSize,
                height: isProductNode ? 45 : isCustomerNode ? 30 : baseNodeSize * 0.7,
                fontSize: isProductNode ? 12 : 10,
                fontWeight: isProductNode ? 'bold' : 'normal',
                borderRadius: 8,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                textAlign: 'center',
                border: isProductNode ? '3px solid #fff' :
                        isCustomerNode ? '2px solid rgba(255,255,255,0.5)' :
                        isDisconnected ? '2px solid #ef4444' :
                        hasLowConfidence ? '2px solid #f59e0b' :
                        '1px solid rgba(255,255,255,0.3)',
                boxShadow: isProductNode ? '0 4px 12px rgba(220, 38, 38, 0.3)' :
                          isDisconnected ? '0 2px 8px rgba(239, 68, 68, 0.4)' : 'none',
                opacity: isDisconnected ? 0.7 : 1,
              },
              type: 'default',
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
            });
          });
        });
      });

      // Apply label visibility based on showLabels state
      const edgeList = Object.values(edgeMap).map(edge => ({
        ...edge,
        label: showLabels ? (edge.data?.originalLabel as string || '') : ''
      }));
      
      const nodeListWithLabels = nodeList.map(node => ({
        ...node,
        data: {
          ...node.data,
          label: showLabels ? (node.data.label as string) : ''
        }
      }));

    // ── Analytics: level stats ──────────────────────────────────────────
    const levelStatMap: Record<number, {
      count: number; totalIn: number; totalOut: number; totalFlow: number;
    }> = {};

    Object.values(nodeMap).forEach((n) => {
      const l = n.level;
      if (!levelStatMap[l]) levelStatMap[l] = { count: 0, totalIn: 0, totalOut: 0, totalFlow: 0 };
      levelStatMap[l].count++;
      levelStatMap[l].totalIn    += n.incoming;
      levelStatMap[l].totalOut   += n.outgoing;
      levelStatMap[l].totalFlow  += n.flowVolume;
    });

    const computedLevelStats: LevelStats[] = Object.entries(levelStatMap)
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([lvl, s]) => {
        const l = Number(lvl);
        return {
          level: l,
          displayType: depthBucketLabel(l),
          count: s.count,
          avgIn:   Math.round((s.totalIn   / s.count) * 10) / 10,
          avgOut:  Math.round((s.totalOut  / s.count) * 10) / 10,
          avgFlow: Math.round( s.totalFlow / s.count),
          color: getNodeColor('material', l, currentMaxLevel),
        };
      });
    setLevelStats(computedLevelStats);

    // ── Analytics: top flow nodes ───────────────────────────────────────
    const topNodes = Object.entries(nodeMap)
      .map(([id, n]) => ({ id, flow: n.flowVolume, level: n.level }))
      .sort((a, b) => b.flow - a.flow)
      .slice(0, 10);
    setTopFlowNodes(topNodes);
    const firstType = topNodes.length > 0 ? depthBucketLabel(topNodes[0].level) : '';
    setTopFlowFilter(firstType);

      setNodes(nodeListWithLabels);
      setEdges(edgeList);
      setAllNodes(nodeListWithLabels);
      setAllEdges(edgeList);
      
      console.log('✅ Integrated process visualization updated with', nodeList.length, 'nodes and', Object.keys(edgeMap).length, 'edges');
      
      // Count by node type for summary
      const typeCounts = Object.values(nodeMap).reduce((acc, node) => {
        acc[node.nodeType] = (acc[node.nodeType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Enhanced success message with connection statistics  
      const connectedNodes = Object.values(nodeMap).filter(node => node.isConnected).length;
      const totalNodes = Object.values(nodeMap).length;
      const customerConnectionCount = multiTierData.filter(d => d.level === 0 && d.data_source === 'outbound').length;
      
      toast.success(`Loaded process network: ${typeCounts.supplier || 0} suppliers → ${typeCounts.material || 0} materials → ${typeCounts.product || 0} products → ${typeCounts.customer || 0} customers (${connectedNodes}/${totalNodes} connected, ${customerConnectionCount} customer connections)`);
    } catch (e) {
      console.error('❌ fetchData error:', e);
      
      // Clear visualization on error
      setNodes([]);
      setEdges([]);
      setAllNodes([]);
      setAllEdges([]);
      setLevelCounts({});
      setLegendGroups([]);
      setSelectedNode(null);
      setFocusedNode(null);
      setMaxLevel(0);
      
      toast.error('Failed to load network data. Please check your connection and try again.');
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
  }, [globalSelectedProjectId, user, showLabels]);

  // Reset Level 1 filter when project changes
  useEffect(() => {
    setSelectedLevel1Node(null);
    setIsLevel1FilterActive(false);
    setReachableNodes(new Set());
  }, [globalSelectedProjectId]);

  // Update labels visibility when showLabels changes
  useEffect(() => {
    if (allNodes.length > 0 && allEdges.length > 0) {
      const updatedNodes = allNodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          label: showLabels ? (node.data.label as string) : ''
        }
      }));
      
      const updatedEdges = allEdges.map(edge => ({
        ...edge,
        label: showLabels ? (edge.data?.originalLabel as string || '') : ''
      }));
      
      setNodes(updatedNodes);
      setEdges(updatedEdges);
    }
  }, [showLabels, allNodes, allEdges]);

  // Store multiTierData in state for reachability algorithm
  const [multiTierDataCache, setMultiTierDataCache] = useState<MultiTierNetworkData[]>([]);

  // Reachability algorithm for Level 1 node filtering
  const findReachableNodes = useCallback((startNodeId: string, allNodes: Node<NodeData>[], allEdges: Edge[], multiTierData: MultiTierNetworkData[]): Set<string> => {
    console.log(`🎯 Starting Level 1 reachability analysis for node: ${startNodeId}`);
    console.log(`📊 MultiTierData records available: ${multiTierData.length}`);
    
    // Debug: Check actual data structure and find our node
    if (multiTierData.length > 0) {
      console.log(`🔍 Sample multiTierData record:`, multiTierData[0]);
      console.log(`🔍 Available fields:`, Object.keys(multiTierData[0]));
      
      // Find records containing our start node
      const startNodeRecords = multiTierData.filter(r => 
        r.from_location === startNodeId || r.to_location === startNodeId
      );
      console.log(`🔍 Records containing ${startNodeId}:`, startNodeRecords.length);
      if (startNodeRecords.length > 0) {
        console.log(`🔍 Sample record with ${startNodeId}:`, startNodeRecords[0]);
      }
    }
    
    // Create node-level mapping from multiTierData for quick lookup
    const nodeLevelMap = new Map<string, number>();
    multiTierData.forEach(record => {
      // Map both from_location and to_location nodes to their levels
      if (record.from_location) {
        const fromLevel = record.level;
        nodeLevelMap.set(record.from_location, fromLevel);
      }
      if (record.to_location) {
        // Level -1 for customers (to_location in outbound records)
        if (record.level === 0 && record.data_source === 'outbound') {
          nodeLevelMap.set(record.to_location, -1);
        } else {
          nodeLevelMap.set(record.to_location, record.level);
        }
      }
    });
    
    console.log(`📊 Created node-level map with ${nodeLevelMap.size} entries`);
    console.log(`📊 Selected node ${startNodeId} is at level:`, nodeLevelMap.get(startNodeId));
    
    const reachable = new Set<string>([startNodeId]);
    
    // Node-first reachability algorithm using multiTierData
    const findNodesInGroup = (sourceNodes: string[], targetLevel: number, relationship: 'from_to' | 'to_from') => {
      const foundNodes: string[] = [];
      console.log(`🎯 Finding Level ${targetLevel} nodes via ${relationship} from:`, sourceNodes);
      
      sourceNodes.forEach(sourceId => {
        console.log(`  🔍 Checking relationships for: ${sourceId}`);
        let connectionsFound = 0;
        
        multiTierData.forEach(record => {
          if (relationship === 'from_to') {
            // Find records where sourceId is from_location
            if (record.from_location === sourceId && record.to_location) {
              const candidateLevel = nodeLevelMap.get(record.to_location);
              if (candidateLevel === targetLevel) {
                foundNodes.push(record.to_location);
                connectionsFound++;
                console.log(`    ✅ Found Level ${targetLevel} node: ${record.to_location} (from→to)`);
              }
            }
          } else {
            // Find records where sourceId is to_location  
            if (record.to_location === sourceId && record.from_location) {
              const candidateLevel = nodeLevelMap.get(record.from_location);
              if (candidateLevel === targetLevel) {
                foundNodes.push(record.from_location);
                connectionsFound++;
                console.log(`    ✅ Found Level ${targetLevel} node: ${record.from_location} (to←from)`);
              }
            }
          }
        });
        
        console.log(`  📊 Found ${connectionsFound} connections from ${sourceId}`);
      }); 
      
      const uniqueNodes = [...new Set(foundNodes)];
      console.log(`📊 Group result - Level ${targetLevel}:`, uniqueNodes);
      return uniqueNodes;
    };
    
    // Apply the node-first reachability algorithm
    const group0A = findNodesInGroup([startNodeId], 0, 'from_to');
    console.log(`📊 Group 0A (Level 0 via from→to from Level 1):`, group0A);
    
    const group2A = findNodesInGroup([startNodeId], 2, 'to_from');
    console.log(`📊 Group 2A (Level 2 via to←from from Level 1):`, group2A);
    
    const groupNeg1A = findNodesInGroup(group0A, -1, 'from_to');
    console.log(`📊 Group -1A (Level -1 via from→to from Group 0A):`, groupNeg1A);
    
    const group3A = findNodesInGroup(group2A, 3, 'to_from');
    console.log(`📊 Group 3A (Level 3 via to←from from Group 2A):`, group3A);
    
    const group4A = findNodesInGroup(group3A, 4, 'to_from');
    console.log(`📊 Group 4A (Level 4 via to←from from Group 3A):`, group4A);
    
    const group5A = findNodesInGroup(group4A, 5, 'to_from');
    console.log(`📊 Group 5A (Level 5 via to←from from Group 4A):`, group5A);
    
    // Add all found nodes to reachable set
    [...group0A, ...group2A, ...groupNeg1A, ...group3A, ...group4A, ...group5A].forEach(nodeId => {
      reachable.add(nodeId);
    });
    
    console.log('🎯 Reachability groups summary:', {
      level1: [startNodeId],
      group0A,
      group2A,
      groupNeg1A,
      group3A,
      group4A,
      group5A,
      totalReachable: Array.from(reachable)
    });
    
    return reachable;
  }, []);

  // Handle Level 1 node selection
  const handleLevel1NodeSelect = useCallback((nodeId: string | null) => {
    // Treat 'all' as null (clear filter)
    const actualNodeId = nodeId === 'all' ? null : nodeId;
    setSelectedLevel1Node(actualNodeId);
    
    if (actualNodeId) {
      const reachableNodeSet = findReachableNodes(actualNodeId, allNodes, allEdges, multiTierDataCache);
      setReachableNodes(reachableNodeSet);
      setIsLevel1FilterActive(true);
      toast.success(`Filtered to show nodes reachable from Level 1 node: ${actualNodeId}`);
    } else {
      setReachableNodes(new Set());
      setIsLevel1FilterActive(false);
    }
  }, [allNodes, allEdges, multiTierDataCache, findReachableNodes]);

  useEffect(() => {
    if (!focusedNode && !isLevel1FilterActive) {
      setNodes(allNodes);
      setEdges(allEdges);
      return;
    }

    let filteredNodes = allNodes;
    let filteredEdges = allEdges;

    // Apply Level 1 filtering first
    if (isLevel1FilterActive && reachableNodes.size > 0) {
      filteredNodes = allNodes.filter(n => reachableNodes.has(n.id));
      filteredEdges = allEdges.filter(
        e => reachableNodes.has(e.source as string) && reachableNodes.has(e.target as string)
      );
    }

    // Then apply focus filtering if active
    if (focusedNode) {
      const node = filteredNodes.find(n => n.id === focusedNode);
      if (!node) return;
    
      const included = new Set<string>([node.id]);
      
      // Include all nodes that are connected to the focused node (upstream and downstream)
      const addConnectedNodes = (nodeId: string, visited: Set<string>) => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        
        // Add downstream nodes (children)
        filteredEdges.forEach(edge => {
          if (edge.source === nodeId && !included.has(edge.target as string)) {
            included.add(edge.target as string);
            addConnectedNodes(edge.target as string, visited);
          }
        });
        
        // Add upstream nodes (parents)
        filteredEdges.forEach(edge => {
          if (edge.target === nodeId && !included.has(edge.source as string)) {
            included.add(edge.source as string);
            addConnectedNodes(edge.source as string, visited);
          }
        });
      };
      
      addConnectedNodes(focusedNode, new Set());
    
      filteredNodes = filteredNodes.filter(n => included.has(n.id));
      filteredEdges = filteredEdges.filter(
        e => included.has(e.source as string) && included.has(e.target as string)
      );
    }
  
    setNodes(filteredNodes);
    setEdges(filteredEdges);
  }, [focusedNode, allNodes, allEdges, isLevel1FilterActive, reachableNodes]);

  useEffect(() => {
    const updatedEdges = allEdges.map(edge => {
      if (selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id)) {
        return { ...edge, style: { stroke: '#3b82f6', strokeWidth: 3, strokeOpacity: 0.9 } };
      } else {
        return { ...edge, style: { stroke: '#8C8C8C', strokeWidth: 2, strokeOpacity: 0.6 } };
      }
    });
    setEdges(updatedEdges);
  }, [selectedNode]);

  useEffect(() => {
    const term = searchTerm.trim();
   
    setNodes((current) => {
      return current.map((n) => {
        const base = allNodes.find((b) => b.id === n.id) || n;
        const baseStyle: any = base.style || {};
  
        const isHit = term !== '' && n.id === term;
  
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
            background: isHit ? HIGHLIGHT_HEX : baseStyle.background,
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

  const mobileProcessMetrics = useMemo(() => {
    const totalNodes = allNodes.length;
    const networkDepth = Object.keys(levelCounts).length;
    // Bottlenecks: level-1 nodes in the top flow list (manufacturing / assembly steps)
    const bottlenecks = topFlowNodes.filter(n => n.level === 1).length;
    // Path concentration: HHI of flow volumes across top-flow nodes
    const flows = topFlowNodes.map(n => n.flow);
    const totalFlow = flows.reduce((s, f) => s + f, 0);
    let pathConc = 0;
    if (totalFlow > 0) flows.forEach(f => { const s = f / totalFlow; pathConc += s * s; });
    // Top bottleneck node
    const topL1 = [...topFlowNodes].filter(n => n.level === 1).sort((a, b) => b.flow - a.flow)[0];
    const topL1Node = topL1 ? allNodes.find(n => n.id === topL1.id) : null;
    // Resilience: use path concentration as HHI proxy, no SPOF heuristic from flow
    const resilience = 0.4 + 0.3 * (1 - pathConc) + 0.3 * (1 - Math.min(pathConc, 1));
    return {
      totalNodes,
      networkDepth,
      bottlenecks,
      pathConcentration: totalFlow > 0 ? pathConc.toFixed(3) : '—',
      resilience: totalFlow > 0 ? resilience.toFixed(3) : '—',
      resilienceRed: totalFlow > 0 && resilience < 0.4,
      topBottleneckName: topL1Node?.data?.label ?? null,
    };
  }, [allNodes, levelCounts, topFlowNodes]);

  // Diagnostics: check BOM level distribution and multi-tier presence (including level 0)
  const runDiagnostics = useCallback(async () => {
    if (!user || !globalSelectedProjectId) {
      toast.info('Select a project first');
      return;
    }
    try {
      const [{ data: bomRows, error: bomErr }, { data: mtRows, error: mtErr }] = await Promise.all([
        supabase.from('bom_multi_level').select('level').eq('project_id', globalSelectedProjectId),
        supabase.from('supply_chain_data_multi_tier').select('level,data_source').eq('project_id', globalSelectedProjectId),
      ]);

      if (bomErr) throw bomErr;
      if (mtErr) throw mtErr;

      const bomCounts = (bomRows || []).reduce((acc: Record<number, number>, r: any) => {
        const lvl = Number(r.level);
        acc[lvl] = (acc[lvl] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);

      const mtCounts = (mtRows || []).reduce((acc: Record<number, number>, r: any) => {
        const lvl = Number(r.level);
        acc[lvl] = (acc[lvl] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);

      const mtOutboundL0 = (mtRows || []).filter((r: any) => Number(r.level) === 0 && (r.data_source || '').toLowerCase() === 'outbound').length;
      const bomL0 = bomCounts[0] || 0;
      const mtL0 = mtCounts[0] || 0;

      const bomSummary = Object.keys(bomCounts).sort((a, b) => Number(a) - Number(b)).map(k => `${k}:${bomCounts[Number(k)]}`).join(', ') || 'none';
      const mtSummary = Object.keys(mtCounts).sort((a, b) => Number(a) - Number(b)).map(k => `${k}:${mtCounts[Number(k)]}`).join(', ') || 'none';

      toast.success(`Diagnostics — BOM levels: ${bomSummary} | Multi-tier levels: ${mtSummary} | L0 BOM: ${bomL0}, L0 MT: ${mtL0}, L0 MT outbound: ${mtOutboundL0}`);

      if (bomL0 > 0 && mtOutboundL0 === 0) {
        toast.warning('Level 0 exists in BOM but no level 0 outbound edges were found in multi-tier data. Re-run combine.');
      }
    } catch (e: any) {
      console.error('Diagnostics failed:', e);
      toast.error(`Diagnostics failed: ${e.message || e}`);
    }
  }, [user, globalSelectedProjectId]);

  const nodeTypes = useMemo(() => ({ default: TooltipNode }), []);

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      {/* v3 §1.1/§1.4, D3-a — see FirmLevelNetwork's identical comment: root
          variant (a root with no tab of its own keeps the bar, no item
          active — not a back arrow), chip on the second row, refresh as the
          one meta action, the rest stays desktop-only exactly as before. */}
      {isMobile && (
        <MobilePageHeader
          variant="root"
          title="Product Structure — Multi-level BOM Network"
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
           page's own graph controls and before the project select. Same
           button, same handler — see HeaderRefreshButton. */
        <PageHeader
          title="Product Structure — Multi-level BOM Network"
          rightContent={
            /* `gap-2` rather than `space-x-2`: `space-x-*` puts its margin on
               the DOM children, so it would land on the `md:contents` wrapper
               below instead of on the controls inside it and collapse the
               desktop spacing. `gap` is inherited correctly through
               `display:contents`, and for this single-line row the two
               produce the same 8px. */
            <div className="flex items-center gap-2">
              {/* Spec 4.1 caps the mobile right slot at three controls, and
                  every control in this group drives the network graph or the
                  analytics panel, both of which are `hidden md:` on this page.
                  Below `md` the header therefore holds refresh + the project
                  select only; `md:contents` hands each control straight back
                  to the same flex row on desktop, unchanged. */}
              <span className="hidden md:contents">
              {/* Level 1 Node Filter */}
              {level1Nodes.length > 0 && (
                <>
              <Select value={selectedLevel1Node || 'all'} onValueChange={handleLevel1NodeSelect}>
                <SelectTrigger className={cn('h-9 w-[160px]', HDR_FILTER_SELECT)}>
                  <SelectValue placeholder="Level 1 Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Nodes</SelectItem>
                      {level1Nodes.map((nodeId) => (
                        <SelectItem key={nodeId} value={nodeId}>
                          {nodeId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  {isLevel1FilterActive && (
                    <Button
                      onClick={() => handleLevel1NodeSelect(null)}
                      variant="outline"
                      size="sm"
                      className={cn('text-muted-foreground hover:text-foreground', HDR_OUTLINE_BUTTON)}
                    >
                      Clear Filter
                    </Button>
                  )}
                </>
              )}

              <Button
                onClick={() => setShowLabels(!showLabels)}
                variant={showLabels ? "default" : "outline"}
                size="icon"
                className={cn(HDR_ICON_BUTTON, showLabels && HDR_ICON_BUTTON_ON)}
                aria-label={showLabels ? 'Hide labels' : 'Show labels'}
                title={showLabels ? 'Hide labels' : 'Show labels'}
              >
                <Tag className="h-4 w-4" />
              </Button>
            

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
                    placeholder="find a component"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onBlur={() => !searchTerm && setSearchOpen(false)}
                  />
                </div>
              ) : (
                <Button
                  onClick={() => setSearchOpen(true)}
                  variant="outline"
                  size="icon"
                  className={cn('text-muted-foreground hover:text-foreground', HDR_ICON_BUTTON)}
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
              
              {selectedNode && (
                <Button
                  onClick={() => setDisruptionDialogOpen(true)}
                  variant="outline"
                  size="sm"
                  className={cn(
                    'gap-1 border-orange-600 text-orange-600 hover:bg-orange-50 hover:text-orange-700',
                    HDR_OUTLINE_BUTTON,
                    'md:border-border md:text-[#ea580c] md:hover:text-[#ea580c]',
                  )}
                >
                  <AlertTriangle className="h-4 w-4" />
                  <span className="hidden sm:inline">Add Disruption</span>
                </Button>
              )}
              
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
             Spec 5 row 7 / demo entry 08. See ProductLevelNetwork for the
             shape; the pieces come from components/network/MobileLens so the
             three lenses stay identical in composition and differ only in
             what each lens measures. */}
        <div className="md:hidden mt-4 flex min-w-0 flex-col gap-[var(--m-gap)]">

          <div>
            <LensChip tone="teal">Process level</LensChip>
          </div>

          <LensHowToRead
            scope="Shop-floor dependencies from this project's multi-tier records — suppliers, materials, process steps and products — ordered by level from raw material through to customer."
            findings="The ten highest-flow nodes are ranked below. A level-1 node among them is a manufacturing or assembly step, and the highest-flow one is reported as the constraint on the critical path."
            columns={[
              { term: 'Node', def: 'The process step, material or product this row measures.' },
              { term: 'Type', def: 'Which of those it is, read from its level in the multi-tier data.' },
              { term: 'Flow', def: 'Total weighted volume across the edges touching the node.' },
              { term: 'In', def: 'Edges arriving at the node.' },
              { term: 'Out', def: 'Edges leaving the node.' },
            ]}
          />

          <LensDesktopOnlyNote>
            The process graph, its labels and the level analytics are desktop
            surfaces. Open this lens on a larger screen to explore them; the
            findings below are the same on both.
          </LensDesktopOnlyNote>

          {/* §13.4 — the numbers band. A stat grid is its own container and
              carries no head; the figures name themselves. */}
          <LensStructure
            items={[
              { label: 'Nodes', value: mobileProcessMetrics.totalNodes > 0 ? String(mobileProcessMetrics.totalNodes) : '—' },
              { label: 'Network depth', value: mobileProcessMetrics.networkDepth > 0 ? String(mobileProcessMetrics.networkDepth) : '—' },
              { label: 'Critical path', value: '—' },
              {
                label: 'Resilience',
                value: mobileProcessMetrics.resilience,
                red: mobileProcessMetrics.resilienceRed,
              },
            ]}
          />

          <LensSection label="Structural risk" counter="4" tone="primary" lens="teal">
            <LensRisk
              rows={[
                { label: 'Critical path', value: '—' },
                { label: 'Bottlenecks', value: mobileProcessMetrics.totalNodes > 0 ? String(mobileProcessMetrics.bottlenecks) : '—' },
                { label: 'Utilisation headroom', value: '—' },
                { label: 'Path concentration', value: mobileProcessMetrics.pathConcentration },
              ]}
              alert={
                mobileProcessMetrics.bottlenecks > 0 && mobileProcessMetrics.topBottleneckName
                  ? `${mobileProcessMetrics.topBottleneckName} is the highest-flow assembly step and may constrain the critical path.`
                  : undefined
              }
            />
          </LensSection>

          <LensSection label="Centrality" lens="teal" counter={topFlowNodes.length ? String(Math.min(20, topFlowNodes.length)) : undefined}>
            <LensTable
              loading={loading}
              columns={[
                { key: 'node', label: 'Node' },
                { key: 'type', label: 'Type' },
                { key: 'flow', label: 'Flow', align: 'right' },
                { key: 'in', label: 'In', align: 'right' },
                { key: 'out', label: 'Out', align: 'right' },
              ]}
              rows={topFlowNodes.slice(0, 20).map(n => {
                const node = allNodes.find(an => an.id === n.id);
                // `||`, not `??`: the graph blanks every node label while the
                // Labels toggle is off (line 683), and that toggle is a
                // desktop-graph control. `??` kept the empty string, so the
                // identifying column rendered blank on every row.
                const label = node?.data?.label || n.id;
                return {
                  key: n.id,
                  id: String(label),
                  cells: [
                    { text: labelForEchelon(n.echelon as Echelon) },
                    { text: n.flow.toLocaleString(), primary: true },
                    { text: String((node?.data?.incoming as number) ?? 0) },
                    { text: String((node?.data?.outgoing as number) ?? 0) },
                  ],
                };
              })}
              empty="No process network data. Select a project, then upload and combine its datasets."
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
          {/* Main network view */}
          <div className="lg:col-span-3">
            <Card className="h-[800px]">
              <CardContent className="p-0 h-full relative">
                {loading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                    <div className="flex flex-col items-center space-y-4">
                      <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Loading process network data...</p>
                    </div>
                  </div>
                ) : nodes.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center space-y-4">
                      <AlertTriangle className="h-16 w-16 text-muted-foreground mx-auto" />
                      <div>
                        <h3 className="text-lg font-medium">No Process Network Data</h3>
                        <p className="text-sm text-muted-foreground mt-2">
                          {globalSelectedProjectId 
                            ? "This project doesn't have multi-tier supply chain data uploaded yet."
                            : "Select a project to view its multi-level bill of materials."
                          }
                        </p>
                        {globalSelectedProjectId && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Upload multi-tier supply chain data to see the visualization.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeClick={onNodeClick}
                  nodeTypes={nodeTypes}
                  onNodeDoubleClick={onNodeDoubleClick}
                  fitView
                  attributionPosition="bottom-right"
                >
                  <Background />
                  <Controls />
                  <MiniMap 
                  nodeStrokeColor={(n: Node) => getNodeColor((n.data as NodeData)?.nodeType || 'material', (n.data as NodeData)?.level || 0, maxLevel)}
                  nodeColor={(n: Node) => getNodeColor((n.data as NodeData)?.nodeType || 'material', (n.data as NodeData)?.level || 0, maxLevel)}
                  className="!bg-background"
                  />
                </ReactFlow>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-4">

            {/* Selected Node Details */}
            {selectedNode && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Component Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="text-sm font-medium">{selectedNode.data.label}</div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {labelForEchelon(selectedNode.data.echelon)}
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Node ID:</span>
                      <span className="font-medium text-right break-all">{selectedNode.id}</span>
                    </div>
                    {/* <div className="flex justify-between">
                      <span className="text-muted-foreground">Node Name:</span>
                      <span className="font-medium text-right break-all">{selectedNode.data.label as string}</span>
                    </div> */}
                    <div className="flex justify-between">
                      {/* WP 8.5 · §4 D140. This is the lane's own `level`
                          ordinate, and TWO live writers disagree about what it
                          means — so it is labelled as the raw column it is rather
                          than as a process level or a BOM depth, neither of which
                          it reliably carries. `node_list.bom_depth` is the depth,
                          and WP 8.4 is what puts it here. */}
                      <span>Lane level (raw):</span>
                      <Badge variant="outline" className="text-xs">
                        {selectedNode.data.level}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Data Source:</span>
                      <Badge variant="secondary" className="text-xs capitalize">
                        {selectedNode.data.dataSource}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Incoming Connections:</span>
                      <span className="font-medium">{selectedNode.data.incoming}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Outgoing Connections:</span>
                      <span className="font-medium">{selectedNode.data.outgoing}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Connections:</span>
                      <span className="font-medium">{selectedNode.data.incoming + selectedNode.data.outgoing}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Flow Volume:</span>
                      <span className="font-medium">{selectedNode.data.flowVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Consumption Rate:</span>
                      <span className="font-medium">{selectedNode.data.consumptionRate?.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Chain Position:</span>
                      <span className="text-xs text-muted-foreground">
                        {selectedNode.data.level === -1 ? 'End Customer' :
                         selectedNode.data.level === 0 ? 'Final Product' :
                         selectedNode.data.level === 1 ? 'Manufacturing' :
                         selectedNode.data.level >= 2 && selectedNode.data.level <= 4 ? 'Intermediate' :
                         selectedNode.data.level === 5 ? 'Direct Supplier' :
                         'Upstream Supplier'}
                      </span>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  {focusedNode === selectedNode.id ? (
                    <Button
                      onClick={() => setFocusedNode(null)}
                      variant="outline"  
                      size="sm"
                      className="w-full"
                    >
                      <Network className="h-4 w-4 mr-1" />
                      Show All Components
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setFocusedNode(selectedNode.id)}
                      variant="outline"
                      size="sm"
                      className="w-full"
                    >
                      <Network className="h-4 w-4 mr-1" />
                      Focus Process Chain
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* WP 8.5 · §4 D139 — these buckets are echelons in a bill of
                materials, not process levels. Nothing in this database describes a
                process. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Echelons</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {legendGroups.map((g) => (
                  <div key={g.key} className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div 
                        className="w-4 h-4 rounded"
                        style={{ backgroundColor: g.color }}
                      />
                      <span className="text-sm capitalize">
                        {g.label}
                      </span>
                    </div>
                    <Badge variant="secondary" className="text-xs">{g.count}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Instructions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Instructions</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>• Click a component to see details</p>
                <p>• Double-click to focus on process chain</p>
                <p>• Use search to find specific components</p>
                <p>• Horizontal layout shows supply chain flow</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="hidden md:block">
        {showAnalytics && (
          <div className="mt-6 space-y-6">

            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Total nodes',  value: allNodes.length },
                { label: 'BOM levels',   value: Object.keys(levelCounts).length },
                { label: 'Total edges',  value: allEdges.length },
                { label: 'Products',     value: levelStats.find(l => l.level === 0)?.count ?? 0 },
              ].map(s => (
                <Card key={s.label}>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-medium">{s.value}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Top nodes by flow volume */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top nodes by flow volume</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Nodes handling the most weighted flow — potential bottlenecks
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Filter buttons */}
                <div className="flex flex-wrap gap-1 pb-2">
                  {Array.from(new Set(topFlowNodes.map(n => depthBucketLabel(n.level)))).map(type => (
                    <button
                      key={type}
                      onClick={() => setTopFlowFilter(type)}
                      className={`text-xs px-2 py-1 rounded-sm border transition-colors capitalize ${
                        topFlowFilter === type
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                {/* Chart */}
                {(() => {
                  const filtered = topFlowNodes.filter(n =>
                    topFlowFilter === '' || depthBucketLabel(n.level) === topFlowFilter
                  );
                  const max = filtered[0]?.flow || 1;

                  return filtered.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No nodes for this type</p>
                  ) : (
                    filtered.map(n => (
                      <div key={n.id} className="flex items-center gap-3">
                        <span
                          className="text-xs text-muted-foreground w-36 shrink-0 truncate text-left"
                          title={n.id}
                        >
                          {n.id}
                        </span>
                        <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
                          <div
                            className="h-full rounded transition-all"
                            style={{
                              width: `${(n.flow / max) * 100}%`,
                              background: getNodeColor('material', n.level, maxLevel),
                            }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-16 shrink-0 text-right">
                          {n.flow.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    ))
                  );
                })()}
              </CardContent>
            </Card>

            {/* Level connectivity table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Level connectivity summary</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Average connections and flow per level — reveals structural thinness or concentration
                </p>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left font-medium text-muted-foreground pb-2 pr-4">Level</th>
                      <th className="text-left font-medium text-muted-foreground pb-2 pr-4">Type</th>
                      <th className="text-right font-medium text-muted-foreground pb-2 pr-4">Nodes</th>
                      <th className="text-right font-medium text-muted-foreground pb-2 pr-4">Avg in</th>
                      <th className="text-right font-medium text-muted-foreground pb-2 pr-4">Avg out</th>
                      <th className="text-right font-medium text-muted-foreground pb-2">Avg flow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levelStats.map(l => (
                      <tr key={l.level} className="border-b last:border-0">
                        <td className="py-2 pr-4">{l.level}</td>
                        <td className="py-2 pr-4">
                          <span
                            className="inline-block px-2 py-0.5 rounded-sm text-xs font-medium capitalize"
                            style={{ background: l.color + '22', color: l.color }}
                          >
                            {l.displayType}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right">{l.count}</td>
                        <td className="py-2 pr-4 text-right">{l.avgIn}</td>
                        <td className="py-2 pr-4 text-right">{l.avgOut}</td>
                        <td className="py-2 text-right">{l.avgFlow.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

          </div>
        )}
        </div>

        <DisruptionDialog
          open={disruptionDialogOpen}
          onOpenChange={setDisruptionDialogOpen}
          nodeId={selectedNode?.id || ''}
          projectId={globalSelectedProjectId || ''}
          plantName={projects.find(p => p.id === globalSelectedProjectId)?.name || ''}
          connectedEdges={allEdges.filter(edge => 
            selectedNode && (edge.source === selectedNode.id || edge.target === selectedNode.id)
          )}
          onSuccess={() => {
            fetchData();
            setDisruptionDialogOpen(false);
          }}
        />
      </div>
    </PageLayout>
  );
}