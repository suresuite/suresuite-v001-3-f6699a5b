// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { AlertCircle, RefreshCw, Download, X } from 'lucide-react';

// Define the type that includes all possible tab keys  
type TabKey = 'bom' | 'inbound' | 'outbound' | 'nodeList' | 'deepNodes' | 'deepEdges' | 'deepSummary';

interface ProjectDatasets {
  bom_level: string;
  bom: any[];
  inbound: any[];
  outbound: any[];
  multiTier: any[];
}

interface NodeListItem {
  id: string;
  node_id: string;
  node_type?: string;
  node_group?: string;
  description_text?: string;
  location_text?: string;
  longitude?: number;
  latitude?: number;
  plant_name: string;
}

interface Project {
  id: string;
  name: string;
  plant_name: string;
  supply_chain_model: string;
  bom_level: string;
  completed: boolean;
  created_at: string;
  modeler_id: string;
  modeler_name: string;
  deep_tier_enabled?: boolean;
}

interface ProjectDataViewerProps {
  project: Project;
  onClose: () => void;
  onDataDeleted: () => void;
}

const SMALL_TXT = 'text-xs';
const HEAD_CELL_PAD = 'h-7 px-2 py-1 font-medium text-white text-left';
const CELL_PAD = 'h-6 px-2 py-1';

const ProjectDataViewer = ({ project, onClose, onDataDeleted }: ProjectDataViewerProps) => {
  const [bomData, setBomData] = useState<any[]>([]);
  const [inboundData, setInboundData] = useState<any[]>([]);
  const [outboundData, setOutboundData] = useState<any[]>([]);
  const [nodeListData, setNodeListData] = useState<NodeListItem[]>([]);
  const [deepNodesData, setDeepNodesData] = useState<any[]>([]);
  const [deepEdgesData, setDeepEdgesData] = useState<any[]>([]);
  const [deepSummaryData, setDeepSummaryData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('bom');
  const [rowLimit, setRowLimit] = useState<number | 'all'>(10);

  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    loadProjectData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const loadProjectData = async () => {
    if (!user?.id || !user?.email) return;
    setLoading(true);
    try {
      // Load regular datasets
      const { data, error } = await supabase.rpc('get_project_datasets', {
        p_project_id: project.id,
        p_user_id: user.id,
        p_user_email: user.email
      });
      if (error) throw error;

      const ds = (data as unknown as ProjectDatasets) || { bom_level: 'single', bom: [], inbound: [], outbound: [] };
      setBomData(ds.bom || []);
      setInboundData(ds.inbound || []);
      setOutboundData(ds.outbound || []);

      // Load node list data
      const { data: nodeListData, error: nodeListError } = await supabase.rpc('get_node_list', {
        p_project_id: project.id,
        p_plant_name: project.plant_name,
        p_user_id: user.id,
        p_user_email: user.email
      });
      if (nodeListError) throw nodeListError;
      setNodeListData(nodeListData || []);

      // Load deep tier data if enabled using the secure RPC function
      if (project.deep_tier_enabled) {
        const { data: deepData, error: deepError } = await supabase.rpc('get_deep_tier_datasets', {
          p_project_id: project.id,
          p_user_id: user.id,
          p_user_email: user.email
        });
        
        if (deepError) {
          console.error('Error loading deep tier data:', deepError);
          setDeepNodesData([]);
          setDeepEdgesData([]);
          setDeepSummaryData([]);
        } else {
          const deepDataObj = deepData as any;
          setDeepNodesData(deepDataObj?.nodes || []);
          setDeepEdgesData(deepDataObj?.edges || []);
          setDeepSummaryData(deepDataObj?.summary || []);
        }
      } else {
        setDeepNodesData([]);
        setDeepEdgesData([]);
        setDeepSummaryData([]);
      }

    } catch (error) {
      console.error(error);
      toast({
        title: 'Error loading data',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const tabsAll = useMemo(
    () => {
      const baseTabs = [
        { key: 'bom' as const, label: 'BOM', data: bomData },
        { key: 'inbound' as const, label: 'Inbound', data: inboundData },
        { key: 'outbound' as const, label: 'Outbound', data: outboundData },
        { key: 'nodeList' as const, label: 'Node List', data: nodeListData },
      ];

      const deepTierTabs = project.deep_tier_enabled ? [
        { key: 'deepNodes' as const, label: 'Deep Nodes', data: deepNodesData },
        { key: 'deepEdges' as const, label: 'Deep Edges', data: deepEdgesData },
        { key: 'deepSummary' as const, label: 'Deep Summary', data: deepSummaryData },
      ] : [];

      return [...baseTabs, ...deepTierTabs];
    },
    [bomData, inboundData, outboundData, nodeListData, deepNodesData, deepEdgesData, deepSummaryData, project.deep_tier_enabled]
  );

  // Only render tabs that actually have rows
  const visibleTabs = useMemo(() => tabsAll.filter(t => (t.data?.length || 0) > 0), [tabsAll]);

  // Keep a valid tab selected
  useEffect(() => {
    if (!visibleTabs.length) return;
    if (!visibleTabs.some(t => t.key === activeTab)) {
      setActiveTab(visibleTabs[0].key);
    }
  }, [visibleTabs, activeTab]);

  const current = useMemo(
    () => visibleTabs.find(t => t.key === activeTab) ?? visibleTabs[0],
    [visibleTabs, activeTab]
  );
  const currentData = current?.data ?? [];
  const totalCount = currentData.length;

  const headerTitle = useMemo(() => current?.label ?? '', [current]);

  const visibleRows = useMemo(
    () => (rowLimit === 'all' ? currentData : currentData.slice(0, rowLimit)),
    [currentData, rowLimit]
  );

  const downloadCSV = () => {
    let columns: string[] = [];
    if (activeTab === 'bom') {
      columns = project.bom_level === 'single'
        ? ['product_id', 'material_id', 'consumption_rate', 'plant_name']
        : ['higher_level_component_id', 'material_id', 'level', 'consumption_rate', 'plant_name'];
    } else if (activeTab === 'inbound') {
      columns = ['supplier_id', 'material_id', 'volume', 'unit_price', 'lead_time', 'time_unit', 'plant_name'];
    } else if (activeTab === 'outbound') {
      columns = ['customer_id', 'product_id', 'volume', 'unit_price', 'expected_lead_time', 'time_unit', 'plant_name'];
    } else if (activeTab === 'nodeList') {
      columns = ['node_id', 'node_type', 'node_group', 'description_text', 'location_text', 'longitude', 'latitude', 'plant_name'];
    } else if (activeTab === 'deepNodes') {
      columns = ['uid', 'name', 'country', 'industry', 'revenue', 'number_of_employees', 'lat', 'long', 'prominence', 'plant_name'];
    } else if (activeTab === 'deepEdges') {
      columns = ['src_uid', 'dst_uid', 'relation_type', 'relative_revenue', 'relative_revenue_percentage', 'depth', 'direction', 'plant_name'];
    } else if (activeTab === 'deepSummary') {
      columns = ['nodes_count', 'edges_count', 'tiers_data', 'plant_name'];
    }

    const rows = currentData.map((row: any) =>
      columns.map(c => {
        const s = String(row?.[c] ?? '').replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      }).join(',')
    );

    const csv = [columns.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${headerTitle.toLowerCase()}_data.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderEmpty = (msg: string) => (
    <div className={`flex items-center justify-center py-6 text-muted-foreground ${SMALL_TXT}`}>
      <AlertCircle className="h-4 w-4 mr-2" />
      {msg}
    </div>
  );

  const TableShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="border rounded-md overflow-hidden">
      <div className="max-h-64 overflow-auto">
        {children}
      </div>
    </div>
  );

  const renderTable = () => {
    if (!currentData?.length) return renderEmpty(`No ${headerTitle.toLowerCase()} data available`);

    const cols =
      activeTab === 'bom'
        ? (project.bom_level === 'single'
            ? ['Product ID', 'Material ID', 'Consumption Rate', 'Plant Name']
            : ['Higher Level Component ID', 'Material ID', 'Level', 'Consumption Rate', 'Plant Name'])
        : activeTab === 'inbound'
        ? ['Supplier ID', 'Material ID', 'Volume', 'Unit Price', 'Lead Time', 'Time Unit', 'Plant Name']
        : activeTab === 'outbound'
        ? ['Customer ID', 'Product ID', 'Volume', 'Unit Price', 'Expected Lead Time', 'Time Unit', 'Plant Name']
        : activeTab === 'nodeList'
        ? ['Node ID', 'Type', 'Group', 'Description', 'Location', 'Longitude', 'Latitude', 'Plant Name']
        : activeTab === 'deepNodes'
        ? ['UID', 'Name', 'Country', 'Industry', 'Revenue', 'Employees', 'Lat', 'Long', 'Prominence', 'Plant Name']
        : activeTab === 'deepEdges'
        ? ['Source UID', 'Dest UID', 'Relation Type', 'Relative Revenue', 'Revenue %', 'Depth', 'Direction', 'Plant Name']
        : ['Nodes Count', 'Edges Count', 'Tiers Data', 'Plant Name'];

    return (
      <TableShell>
        <Table className={SMALL_TXT}>
          {/* ultra-compact table header */}
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow className="h-7">
              {cols.map((c) => (
                <TableHead key={c} className={`${HEAD_CELL_PAD} ${SMALL_TXT}`}>{c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row: any, idx: number) => (
              <TableRow key={idx} className="hover:bg-muted/40">
                {activeTab === 'bom' ? (
                  project.bom_level === 'single' ? (
                    <>
                      <TableCell className={CELL_PAD}>{row.product_id}</TableCell>
                      <TableCell className={CELL_PAD}>{row.material_id}</TableCell>
                      <TableCell className={CELL_PAD}>{row.consumption_rate}</TableCell>
                      <TableCell className={CELL_PAD}>{row.plant_name}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className={CELL_PAD}>{row.higher_level_component_id || 'N/A'}</TableCell>
                      <TableCell className={CELL_PAD}>{row.material_id}</TableCell>
                      <TableCell className={CELL_PAD}>{row.level}</TableCell>
                      <TableCell className={CELL_PAD}>{row.consumption_rate}</TableCell>
                      <TableCell className={CELL_PAD}>{row.plant_name}</TableCell>
                    </>
                  )
                ) : activeTab === 'inbound' ? (
                  <>
                    <TableCell className={CELL_PAD}>{row.supplier_id}</TableCell>
                    <TableCell className={CELL_PAD}>{row.material_id}</TableCell>
                    <TableCell className={CELL_PAD}>{row.volume}</TableCell>
                    <TableCell className={CELL_PAD}>{row.unit_price}</TableCell>
                    <TableCell className={CELL_PAD}>{row.lead_time}</TableCell>
                    <TableCell className={CELL_PAD}>{row.time_unit}</TableCell>
                    <TableCell className={CELL_PAD}>{row.plant_name}</TableCell>
                  </>
                ) : activeTab === 'outbound' ? (
                  <>
                    <TableCell className={CELL_PAD}>{row.customer_id}</TableCell>
                    <TableCell className={CELL_PAD}>{row.product_id}</TableCell>
                    <TableCell className={CELL_PAD}>{row.volume}</TableCell>
                    <TableCell className={CELL_PAD}>{row.unit_price}</TableCell>
                    <TableCell className={CELL_PAD}>{row.expected_lead_time}</TableCell>
                    <TableCell className={CELL_PAD}>{row.time_unit}</TableCell>
                    <TableCell className={CELL_PAD}>{row.plant_name}</TableCell>
                  </>
                ) : activeTab === 'nodeList' ? (
                  <>
                    <TableCell className={CELL_PAD}>{row.node_id}</TableCell>
                    <TableCell className={CELL_PAD}>{row.node_type || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.node_group || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.description_text || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.location_text || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.longitude || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.latitude || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.plant_name}</TableCell>
                  </>
                ) : activeTab === 'deepNodes' ? (
                  <>
                    <TableCell className={CELL_PAD}>{row.uid}</TableCell>
                    <TableCell className={CELL_PAD}>{row.name || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.country || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.industry || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.revenue || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.number_of_employees || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.lat || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.long || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.prominence || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.plant_name}</TableCell>
                  </>
                ) : activeTab === 'deepEdges' ? (
                  <>
                    <TableCell className={CELL_PAD}>{row.src_uid}</TableCell>
                    <TableCell className={CELL_PAD}>{row.dst_uid}</TableCell>
                    <TableCell className={CELL_PAD}>{row.relation_type || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.relative_revenue || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.relative_revenue_percentage || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.depth || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.direction || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.plant_name}</TableCell>
                  </>
                ) : activeTab === 'deepSummary' ? (
                  <>
                    <TableCell className={CELL_PAD}>{row.nodes_count}</TableCell>
                    <TableCell className={CELL_PAD}>{row.edges_count}</TableCell>
                    <TableCell className={CELL_PAD}>{JSON.stringify(row.tiers_data) || 'N/A'}</TableCell>
                    <TableCell className={CELL_PAD}>{row.plant_name}</TableCell>
                  </>
                ) : (
                  <TableCell className={CELL_PAD}>Unknown tab</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableShell>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-3">
          <div className={`flex items-center justify-center py-4 ${SMALL_TXT}`}>
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
            <span className="ml-2">Loading…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative">
      {/* Compact header bar */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        {/* Tabs: width auto (just fits the buttons) */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)} className="flex-1">
          <TabsList
            className="inline-flex justify-start gap-1 px-1 py-1 h-8 rounded-md"
            style={{ width: 'fit-content' }}
          >
            {visibleTabs.map(t => (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className={`${SMALL_TXT} py-1 px-2`}
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Right side: count + actions */}
        <div className={`ml-auto flex items-center gap-1 ${SMALL_TXT} text-muted-foreground`}>
          <span className="mr-2">• {totalCount} records</span>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={loadProjectData}
            title="Refresh data"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">Refresh</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={downloadCSV}
            title="Download CSV"
          >
            <Download className="h-4 w-4" />
            <span className="sr-only">Download CSV</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-7 w-7"
            title="Close"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Button>
        </div>
      </div>

      {/* Row limit selector */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2">
          <span className={`${SMALL_TXT} text-muted-foreground`}>Show:</span>
          <Select value={String(rowLimit)} onValueChange={(v) => setRowLimit(v === 'all' ? 'all' : Number(v))}>
            <SelectTrigger className={`w-20 h-6 ${SMALL_TXT}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <span className={`${SMALL_TXT} text-muted-foreground`}>rows</span>
        </div>
      </div>

      {/* Table content */}
      <CardContent className="p-3 pt-0">
        {renderTable()}
      </CardContent>
    </Card>
  );
};

export default ProjectDataViewer;
