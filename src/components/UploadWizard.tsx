// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Download, FileText, AlertTriangle, X, FileUp, Database } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const SMALL_TXT = 'text-[11px] leading-tight';
const CELL_PAD = 'py-1 px-2';       // compact body cells
const HEAD_CELL_PAD = 'py-1 px-2';   // ultra-compact header cells

interface BaseRow {
  plant_name?: string;
  project_id?: string;
}

interface BomSingleLevelRow extends BaseRow {
  product_id: string;
  material_id: string;
  consumption_rate: number;
}

interface BomMultiLevelRow extends BaseRow {
  material_id: string;
  level: number;
  higher_level_component_id: string | null;
  consumption_rate: number;
}

interface InboundLogisticsRow extends BaseRow {
  supplier_id: string;
  material_id: string;
  volume: number;
  time_unit: string;
  lead_time: number;
  unit_price: number;
}

interface OutboundLogisticsRow extends BaseRow {
  customer_id: string;
  product_id: string;
  volume: number;
  time_unit: string;
  expected_lead_time: number;
  unit_price: number;
}


interface NodeListRow extends BaseRow {
  node_id: string;
  description_text?: string;
  location_text?: string;
  longitude?: number;
  latitude?: number;
}


interface DeepNodeRow extends BaseRow {
  uid: string;
  depth?: number;
  name?: string;
  country?: string;
  industry?: string;
  website?: string;
  traded_as?: string;
  number_of_employees?: number;
  revenue?: number;
  lat?: number;
  long?: number;
  is_seed?: boolean;
}

interface DeepEdgeRow extends BaseRow {
  src_uid: string;
  dst_uid: string;
  relation_type?: string;
  relative_revenue?: number;
  relative_revenue_percentage?: number;
  depth?: number;
  direction?: string;
}


type DataRow =
  | BomSingleLevelRow
  | BomMultiLevelRow
  | InboundLogisticsRow
  | OutboundLogisticsRow
  | NodeListRow
  | DeepNodeRow
  | DeepEdgeRow;

interface TemplateType {
  id: string;
  name: string;
  description: string;
  templateFile: string;
  guideFile: string;
  expectedHeaders: string[];
  category: string;
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
  simulation_start?: string | null;
  simulation_end?: string | null;
  deep_tier_enabled?: boolean;
}

interface UploadWizardProps {
  onUploadComplete: () => void;
  userId: string;
  selectedProject: Project | null;
  onClose: () => void;
}

const UploadWizard = ({
  onUploadComplete,
  userId,
  selectedProject,
  onClose,
}: UploadWizardProps) => {
  const [selectedDataset, setSelectedDataset] = useState<string>('bom');
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<DataRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [deepTierFormat, setDeepTierFormat] = useState<'csv' | 'json'>('csv');
  
  // Deep tier CSV specific states
  const [nodesFile, setNodesFile] = useState<File | null>(null);
  const [edgesFile, setEdgesFile] = useState<File | null>(null);
  const [nodesData, setNodesData] = useState<DeepNodeRow[]>([]);
  const [edgesData, setEdgesData] = useState<DeepEdgeRow[]>([]);
  const [nodesErrors, setNodesErrors] = useState<string[]>([]);
  const [edgesErrors, setEdgesErrors] = useState<string[]>([]);

  const { toast } = useToast();
  const { user } = useAuth();

  const templateTypes: TemplateType[] = [
    {
      id: 'bom_single_level',
      name: 'BOM Single Level',
      description: 'Single-level Bill of Materials data',
      templateFile: '/template/bom_single_level.csv',
      guideFile: '/docs/csv-upload-guide.md',
      expectedHeaders: ['product_id', 'material_id', 'consumption_rate'],
      category: 'bom',
    },
    {
      id: 'bom_multi_level',
      name: 'BOM Multi Level',
      description: 'Multi-level Bill of Materials data with hierarchy',
      templateFile: '/template/bom_multi_level.csv',
      guideFile: '/docs/csv-upload-guide.md',
      expectedHeaders: [
        'material_id',
        'level',
        'consumption_rate',
      ],
      category: 'bom',
    },
    {
      id: 'inbound_logistics',
      name: 'Inbound Logistics',
      description: 'Inbound supply network data from suppliers',
      templateFile: '/template/inbound_logistic.csv',
      guideFile: '/docs/csv-upload-guide.md',
      expectedHeaders: [
        'supplier_id',
        'material_id',
        'volume',
        'time_unit',
        'lead_time',
        'unit_price',
      ],
      category: 'inbound',
    },
    {
      id: 'outbound_logistics',
      name: 'Outbound Logistics',
      description: 'Outbound distribution data to customers',
      templateFile: '/template/outbound_logistic.csv',
      guideFile: '/docs/csv-upload-guide.md',
      expectedHeaders: [
        'customer_id',
        'product_id',
        'volume',
        'time_unit',
        'expected_lead_time',
        'unit_price',
      ],
      category: 'outbound',
    },
    {
      id: 'node_list',
      name: 'Node List',
      description: 'Node list data with locations and descriptions',
      templateFile: '', // No template file, users work with downloaded data
      guideFile: '/docs/csv-upload-guide.md',
      expectedHeaders: ['node_id'],
      category: 'node-list',
    },
    {
      id: 'tier2_suppliers',
      name: 'Tier-2 Suppliers',
      description: 'Tier-2 supplier relationship data',
      templateFile: '/template/tier2_suppliers.csv',
      guideFile: '/docs/csv-upload-guide.md',
      expectedHeaders: ['supplier_id', 'upstream_supplier_id', 'material_id', 'relationship_type'],
      category: 'tier2',
    },
    {
      id: 'tier3_suppliers',
      name: 'Tier-3 Suppliers',
      description: 'Tier-3 supplier relationship data',
      templateFile: '/template/tier3_suppliers.csv',
      guideFile: '/docs/csv-upload-guide.md',
      expectedHeaders: ['supplier_id', 'upstream_supplier_id', 'material_id', 'relationship_type'],
      category: 'tier3',
    },
    {
      id: 'network_nodes',
      name: 'Deep Tier Nodes',
      description: 'Firm-level network nodes (deep tiers)',
      templateFile: '/template/nodes.csv',
      guideFile: '/docs/location-dataset-guide.md',
      expectedHeaders: ['uid'],
      category: 'deep',
    },
    {
      id: 'network_edges',
      name: 'Deep Tier Edges',
      description: 'Firm-level network edges (deep tiers)',
      templateFile: '/template/edges.csv',
      guideFile: '/docs/location-dataset-guide.md',
      expectedHeaders: ['src_uid','dst_uid'],
      category: 'deep',
    },
    {
      id: 'deep_tier_json',
      name: 'Deep Tier Network (JSON)',
      description: 'Complete network data in single JSON file',
      templateFile: '/template/summary.json',
      guideFile: '/docs/nexus-node.md',
      expectedHeaders: [],
      category: 'deep',
    },
  ];

  const datasetTabs = [
    { id: 'bom', name: 'BOM' },
    { id: 'inbound', name: 'Inbound' },
    { id: 'outbound', name: 'Outbound' },
    { id: 'node-list', name: 'Node List' },
    ...(selectedProject?.deep_tier_enabled ? [
      { id: 'deep_tier', name: 'Deep Tier Network' }
    ] : [])
  ];

  const getSelectedTemplate = () => {
    if (selectedDataset === 'bom') {
      return selectedProject?.bom_level === 'single' ? 'bom_single_level' : 'bom_multi_level';
    } else if (selectedDataset === 'inbound') {
      return 'inbound_logistics';
    } else if (selectedDataset === 'outbound') {
      return 'outbound_logistics';
    } else if (selectedDataset === 'node-list') {
      return 'node_list';
    } else if (selectedDataset === 'tier2') {
      return 'tier2_suppliers';
    } else if (selectedDataset === 'tier3') {
      return 'tier3_suppliers';
    } else if (selectedDataset === 'deep_tier') {
      return deepTierFormat === 'csv' ? 'network_nodes' : 'deep_tier_json';
    }
    return '';
  };

  const selectedTemplate = getSelectedTemplate();

  const validateData = async (
    data: DataRow[],
    template: TemplateType
  ): Promise<string[]> => {
    const errors: string[] = [];

    data.forEach((row, index) => {
      template.expectedHeaders.forEach((header) => {
        if (row[header as keyof DataRow] === undefined || row[header as keyof DataRow] === '') {
          errors.push(`Row ${index + 2}: Missing required field "${header}"`);
        }
      });

      // Special validation for multi-level BOM
      if (template.id === 'bom_multi_level') {
        const bomRow = row as BomMultiLevelRow;
        // higher_level_component_id is optional for root components (level 0)
        if (bomRow.level !== 0 && (!bomRow.higher_level_component_id || bomRow.higher_level_component_id === '')) {
          errors.push(`Row ${index + 2}: Non-root components (level > 0) must have a higher_level_component_id`);
        }
      }

      if (template.id === 'bom_single_level' || template.id === 'bom_multi_level') {
        const bomRow = row as BomSingleLevelRow | BomMultiLevelRow;
        if (bomRow.consumption_rate && bomRow.consumption_rate <= 0) {
          errors.push(`Row ${index + 2}: Consumption rate must be positive`);
        }
      }

      if (template.id === 'bom_multi_level') {
        const bomRow = row as BomMultiLevelRow;
        if (bomRow.level && bomRow.level < 0) {
          errors.push(`Row ${index + 2}: Level must be non-negative`);
        }
      }

      if (template.id === 'inbound_logistics' || template.id === 'outbound_logistics') {
        const logRow = row as InboundLogisticsRow | OutboundLogisticsRow;
        if (logRow.volume && logRow.volume < 0) {
          errors.push(`Row ${index + 2}: Volume must be non-negative`);
        }
        if (logRow.unit_price && logRow.unit_price < 0) {
          errors.push(`Row ${index + 2}: Unit price must be non-negative`);
        }
      }
    });

    return errors;
  };

  const parseJSON = (content: string): { nodes: DeepNodeRow[], edges: DeepEdgeRow[] } => {
    try {
      const data = JSON.parse(content);
      
      if (!data.nodes || !data.edges) {
        throw new Error('JSON must contain "nodes" and "edges" arrays');
      }

      const nodes: DeepNodeRow[] = data.nodes.map((node: any) => ({
        ...node,
        plant_name: selectedProject?.plant_name,
        project_id: selectedProject?.id,
      }));

      const edges: DeepEdgeRow[] = data.edges.map((edge: any) => ({
        ...edge,
        plant_name: selectedProject?.plant_name,
        project_id: selectedProject?.id,
      }));

      return { nodes, edges };
    } catch (error) {
      throw new Error(`Invalid JSON format: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;

    try {
      if (selectedDataset === 'deep_tier' && deepTierFormat === 'json') {
        // Handle JSON format for deep tier
        if (!uploadedFile.name.endsWith('.json')) {
          setErrors(['Please upload a JSON file']);
          return;
        }
        
        const content = await uploadedFile.text();
        const { nodes, edges } = parseJSON(content);
        
        setFile(uploadedFile);
        setCsvData([...nodes, ...edges] as DataRow[]);
        setErrors([]);
        return;
      }

      // CSV parsing for all other cases
      if (!uploadedFile.name.endsWith('.csv')) {
        setErrors(['Please upload a CSV file']);
        return;
      }

      const content = await uploadedFile.text();
      const lines = content.trim().split('\n');
      const headers = lines[0].split(',').map((h) => h.trim());

      const targetTemplate = templateTypes.find((t) => t.id === selectedTemplate);
      if (!targetTemplate) return;

      const missingHeaders = targetTemplate.expectedHeaders.filter((h) => !headers.includes(h));
      if (missingHeaders.length > 0) {
        setErrors([`Missing required columns: ${missingHeaders.join(', ')}`]);
        return;
      }

      const data: DataRow[] = [];
      const numericHeaders = [
        'consumption_rate','level','volume','lead_time','unit_price','expected_lead_time','longitude','latitude',
        'depth','relative_revenue','relative_revenue_percentage','lat','long','number_of_employees'
      ];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim());
        const row: any = {};

        headers.forEach((header, index) => {
          const value = values[index];
          if (numericHeaders.includes(header)) {
            if (value === '') {
              row[header] = null;
            } else {
              const num = Number(value);
              row[header] = Number.isFinite(num) ? num : null;
            }
          } else if (header === 'is_seed') {
            row[header] = ['true', '1', 'yes'].includes(String(value).toLowerCase());
          } else if (header === 'higher_level_component_id' && value === '') {
            // Convert empty higher_level_component_id to null for root components
            row[header] = null;
          } else {
            row[header] = value;
          }
        });

        row.plant_name = selectedProject?.plant_name;
        row.project_id = selectedProject?.id;
        data.push(row);
      }

      const validationErrors = await validateData(data, targetTemplate);

      setFile(uploadedFile);
      setCsvData(data);
      setErrors(validationErrors);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to parse file';
      setErrors([errorMsg]);
    }
  };

  const handleNodesFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;

    try {
      if (!uploadedFile.name.endsWith('.csv')) {
        setNodesErrors(['Please upload a CSV file']);
        return;
      }

      const content = await uploadedFile.text();
      const lines = content.trim().split('\n');
      const headers = lines[0].split(',').map((h) => h.trim());

      const nodesTemplate = templateTypes.find((t) => t.id === 'network_nodes');
      if (!nodesTemplate) return;

      const missingHeaders = nodesTemplate.expectedHeaders.filter((h) => !headers.includes(h));
      if (missingHeaders.length > 0) {
        setNodesErrors([`Missing required columns: ${missingHeaders.join(', ')}`]);
        return;
      }

      const data: DeepNodeRow[] = [];
      const numericHeaders = ['depth', 'number_of_employees', 'revenue', 'lat', 'long'];
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim());
        const row: any = {};

        headers.forEach((header, index) => {
          const value = values[index];
          if (numericHeaders.includes(header)) {
            if (value === '') {
              row[header] = null;
            } else {
              const num = Number(value);
              row[header] = Number.isFinite(num) ? num : null;
            }
          } else if (header === 'is_seed') {
            row[header] = ['true', '1', 'yes'].includes(String(value).toLowerCase());
          } else {
            row[header] = value;
          }
        });

        row.plant_name = selectedProject?.plant_name;
        row.project_id = selectedProject?.id;
        data.push(row);
      }

      setNodesFile(uploadedFile);
      setNodesData(data);
      setNodesErrors([]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to parse nodes file';
      setNodesErrors([errorMsg]);
    }
  };

  const handleEdgesFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;

    try {
      if (!uploadedFile.name.endsWith('.csv')) {
        setEdgesErrors(['Please upload a CSV file']);
        return;
      }

      const content = await uploadedFile.text();
      const lines = content.trim().split('\n');
      const headers = lines[0].split(',').map((h) => h.trim());

      const edgesTemplate = templateTypes.find((t) => t.id === 'network_edges');
      if (!edgesTemplate) return;

      const missingHeaders = edgesTemplate.expectedHeaders.filter((h) => !headers.includes(h));
      if (missingHeaders.length > 0) {
        setEdgesErrors([`Missing required columns: ${missingHeaders.join(', ')}`]);
        return;
      }

      const data: DeepEdgeRow[] = [];
      const numericHeaders = ['relative_revenue', 'relative_revenue_percentage', 'depth'];
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim());
        const row: any = {};

        headers.forEach((header, index) => {
          const value = values[index];
          if (numericHeaders.includes(header)) {
            if (value === '') {
              row[header] = null;
            } else {
              const num = Number(value);
              row[header] = Number.isFinite(num) ? num : null;
            }
          } else {
            row[header] = value;
          }
        });

        row.plant_name = selectedProject?.plant_name;
        row.project_id = selectedProject?.id;
        data.push(row);
      }

      setEdgesFile(uploadedFile);
      setEdgesData(data);
      setEdgesErrors([]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to parse edges file';
      setEdgesErrors([errorMsg]);
    }
  };

  const getPreviewHeaders = () => {
    const template = templateTypes.find((t) => t.id === selectedTemplate);
    if (!template) return [];

    if (template.id === 'bom_single_level') {
      return ['Product ID', 'Material ID', 'Consumption Rate', 'Plant Name'];
    } else if (template.id === 'bom_multi_level') {
      return ['Material ID', 'Level', 'Higher Level Component ID', 'Consumption Rate', 'Plant Name'];
    } else if (template.id === 'inbound_logistics') {
      return ['Supplier ID', 'Material ID', 'Volume', 'Unit Price', 'Lead Time', 'Time Unit', 'Plant Name'];
    } else if (template.id === 'outbound_logistics') {
      return ['Customer ID', 'Product ID', 'Volume', 'Unit Price', 'Expected Lead Time', 'Time Unit', 'Plant Name'];
    } else if (template.id === 'node_list') {
      return ['Node ID', 'Description', 'Location', 'Longitude', 'Latitude', 'Plant Name'];
    } else if (template.id === 'tier2_suppliers') {
      return ['Supplier ID', 'Upstream Supplier ID', 'Material ID', 'Relationship Type', 'Volume', 'Unit Price', 'Lead Time', 'Time Unit', 'Plant Name'];
    } else if (template.id === 'tier3_suppliers') {
      return ['Supplier ID', 'Upstream Supplier ID', 'Material ID', 'Relationship Type', 'Volume', 'Unit Price', 'Lead Time', 'Time Unit', 'Plant Name'];
    } else if (template.id === 'network_nodes') {
      return ['UID', 'Depth', 'Name', 'Country', 'Industry', 'Website', 'Traded As', 'Employees', 'Revenue', 'Lat', 'Long', 'Is Seed', 'Plant Name'];
    } else if (template.id === 'network_edges') {
      return ['Src UID', 'Dst UID', 'Relation Type', 'Relative Revenue', 'Relative Revenue %', 'Depth', 'Direction', 'Plant Name'];
    }
    return [];
  };

  const getPreviewCells = (row: DataRow) => {
    const template = templateTypes.find((t) => t.id === selectedTemplate);
    if (!template) return [];

    if (template.id === 'bom_single_level') {
      const bomRow = row as BomSingleLevelRow;
      return [bomRow.product_id, bomRow.material_id, bomRow.consumption_rate, bomRow.plant_name];
    } else if (template.id === 'bom_multi_level') {
      const bomRow = row as BomMultiLevelRow;
      return [bomRow.material_id, bomRow.level, bomRow.higher_level_component_id || 'N/A', bomRow.consumption_rate, bomRow.plant_name];
    } else if (template.id === 'inbound_logistics') {
      const inboundRow = row as InboundLogisticsRow;
      return [inboundRow.supplier_id, inboundRow.material_id, inboundRow.volume, inboundRow.unit_price, inboundRow.lead_time, inboundRow.time_unit, inboundRow.plant_name];
    } else if (template.id === 'outbound_logistics') {
      const outboundRow = row as OutboundLogisticsRow;
      return [outboundRow.customer_id, outboundRow.product_id, outboundRow.volume, outboundRow.unit_price, outboundRow.expected_lead_time, outboundRow.time_unit, outboundRow.plant_name];
    } else if (template.id === 'node_list') {
      const nodeRow = row as NodeListRow;
      return [nodeRow.node_id, nodeRow.description_text || 'N/A', nodeRow.location_text || 'N/A', nodeRow.longitude || 'N/A', nodeRow.latitude || 'N/A', nodeRow.plant_name];
    } else if (template.id === 'tier2_suppliers' || template.id === 'tier3_suppliers') {
      const tierRow = row as any;
      return [tierRow.supplier_id, tierRow.upstream_supplier_id, tierRow.material_id, tierRow.relationship_type, tierRow.volume || 'N/A', tierRow.unit_price || 'N/A', tierRow.lead_time || 'N/A', tierRow.time_unit || 'N/A', tierRow.plant_name];
    } else if (template.id === 'network_nodes') {
      const n = row as any;
      return [n.uid, n.depth ?? 'N/A', n.name ?? 'N/A', n.country ?? 'N/A', n.industry ?? 'N/A', n.website ?? 'N/A', n.traded_as ?? 'N/A', n.number_of_employees ?? 'N/A', n.revenue ?? 'N/A', n.lat ?? 'N/A', n.long ?? 'N/A', String(n.is_seed ?? false), n.plant_name];
    } else if (template.id === 'network_edges') {
      const e = row as any;
      return [e.src_uid, e.dst_uid, e.relation_type ?? 'N/A', e.relative_revenue ?? 'N/A', e.relative_revenue_percentage ?? 'N/A', e.depth ?? 'N/A', e.direction ?? 'N/A', e.plant_name];
    }
    return [];
  };

  const handleUpload = async () => {
    console.log('🔄 Upload initiated:', {
      template: selectedTemplate,
      dataset: selectedDataset,
      project: selectedProject?.name,
      dataRows: csvData.length,
      timestamp: new Date().toISOString()
    });
    
    setIsUploading(true);

    try {
      const template = templateTypes.find((t) => t.id === selectedTemplate);
      
      if (!template) {
        console.error('❌ No template found for:', selectedTemplate);
        throw new Error(`Template not found: ${selectedTemplate}`);
      }
      if (!user?.id) {
        console.error('❌ Missing user ID');
        throw new Error('User authentication required');
      }
      if (!user?.email) {
        console.error('❌ Missing user email');
        throw new Error('User email required');
      }
      if (!selectedProject?.id) {
        console.error('❌ Missing selected project');
        throw new Error('Project selection required');
      }

      const dataToInsert = csvData.map((row, index) => {
        const mappedRow = {
          ...row,
          project_id: selectedProject?.id,
          plant_name: selectedProject?.plant_name,
        };

        // Enhanced logging for outbound logistics data transformation
        if (selectedTemplate === 'outbound_logistics') {
          const outboundRow = mappedRow as any; // Type assertion for logging
          console.log(`📋 Outbound logistics row ${index + 1} transformation:`, {
            original: row,
            mapped: mappedRow,
            requiredFields: {
              customer_id: outboundRow.customer_id,
              product_id: outboundRow.product_id,
              volume: outboundRow.volume,
              time_unit: outboundRow.time_unit,
              expected_lead_time: outboundRow.expected_lead_time,
              unit_price: outboundRow.unit_price,
              plant_name: outboundRow.plant_name,
              project_id: outboundRow.project_id
            },
            fieldTypes: {
              volume: typeof outboundRow.volume,
              expected_lead_time: typeof outboundRow.expected_lead_time, 
              unit_price: typeof outboundRow.unit_price,
              customer_id: typeof outboundRow.customer_id,
              product_id: typeof outboundRow.product_id
            }
          });
        }
        
        return mappedRow;
      });

      // Enhanced data validation function
      const validateDataStructure = (data: any[], templateId: string) => {
        console.log(`🔍 Validating data structure for ${templateId}:`, {
          recordCount: data.length,
          firstRecord: data[0],
          sampleFields: Object.keys(data[0] || {})
        });

        // Specific validation for outbound logistics
        if (templateId === 'outbound_logistics') {
          data.forEach((row, index) => {
            const requiredFields = ['customer_id', 'product_id', 'volume', 'time_unit', 'expected_lead_time', 'unit_price'];
            const missing = requiredFields.filter(field => row[field] === undefined || row[field] === null || row[field] === '');
            if (missing.length > 0) {
              console.warn(`⚠️ Row ${index + 1} missing fields:`, missing);
            }
            
            // Log numeric field validation
            const numericFields = ['volume', 'expected_lead_time', 'unit_price'];
            numericFields.forEach(field => {
              if (row[field] !== null && row[field] !== undefined && row[field] !== '') {
                const num = Number(row[field]);
                if (!Number.isFinite(num)) {
                  console.warn(`⚠️ Row ${index + 1} invalid numeric value for ${field}:`, row[field]);
                }
              }
            });
          });
        }

        return data;
      };

      // Enhanced batch processing with better error handling and transaction safety
      const processBatches = async (rpcFunction: string, data: any[], params: any = {}) => {
        // Much smaller batch size for Multi Level BOM to prevent timeouts
        const BATCH_SIZE = rpcFunction === 'bulk_insert_bom_multi_level' ? 25 : 50;
        let totalInserted = 0;
        const failedBatches: { batchNumber: number, error: string, records: any[] }[] = [];
        
        console.log(`🚀 Starting batch processing for ${rpcFunction} with ${data.length} records`);
        console.log(`📊 Batch configuration: size=${BATCH_SIZE}, totalBatches=${Math.ceil(data.length / BATCH_SIZE)}`);
        
        // Validate data structure before processing
        const validatedData = validateDataStructure(data, selectedTemplate);
        
        for (let i = 0; i < validatedData.length; i += BATCH_SIZE) {
          const batch = validatedData.slice(i, i + BATCH_SIZE);
          const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
          const totalBatches = Math.ceil(validatedData.length / BATCH_SIZE);
          
          console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)`);
          console.log(`📋 Batch ${batchNumber} sample data:`, {
            firstRecord: batch[0],
            lastRecord: batch[batch.length - 1],
            recordCount: batch.length
          });
          
          try {
            const batchParams = { ...params };
            if (batchParams.p_rows) batchParams.p_rows = batch;
            if (batchParams.p_data) batchParams.p_data = batch;
            
            console.log(`🔄 Calling ${rpcFunction} with params:`, {
              ...batchParams,
              p_rows: `[${batch.length} records]` // Don't log full data, just count
            });
            
            const result = await (supabase as any).rpc(rpcFunction, batchParams);
            
            if (result.error) {
              console.error(`❌ Batch ${batchNumber} failed:`, {
                code: result.error.code,
                message: result.error.message,
                details: result.error.details,
                hint: result.error.hint
              });
              
              failedBatches.push({
                batchNumber,
                error: result.error.message || result.error.code || 'Unknown error',
                records: batch
              });
              continue; // Continue with next batch instead of throwing
            }
            
            const batchInsertCount = result.data || batch.length;
            totalInserted += batchInsertCount;
            
            console.log(`✅ Batch ${batchNumber} completed successfully:`, {
              recordsProcessed: batch.length,
              recordsInserted: batchInsertCount,
              totalInserted: totalInserted
            });
            
            // Longer delay between batches for Multi Level BOM to ensure database stability
            if (i + BATCH_SIZE < validatedData.length) {
              const delayMs = rpcFunction === 'bulk_insert_bom_multi_level' ? 1000 : 500;
              console.log(`⏳ Waiting ${delayMs}ms before next batch...`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown batch error';
            console.error(`❌ Batch ${batchNumber} exception:`, errorMsg);
            failedBatches.push({
              batchNumber,
              error: errorMsg,
              records: batch
            });
          }
        }
        
        // Report results
        if (failedBatches.length > 0) {
          console.error(`⚠️ Upload completed with errors:`, {
            totalRecords: data.length,
            successfulInserts: totalInserted,
            failedBatches: failedBatches.length,
            failureDetails: failedBatches.map(fb => ({
              batch: fb.batchNumber,
              error: fb.error,
              recordCount: fb.records.length
            }))
          });
          
          // Show detailed error message
          const errorSummary = failedBatches.map(fb => 
            `Batch ${fb.batchNumber}: ${fb.error} (${fb.records.length} records)`
          ).join('\n');
          
          throw new Error(`Upload partially failed:\nSuccessful: ${totalInserted}/${data.length} records\nErrors:\n${errorSummary}`);
        }
        
        console.log(`🎉 All batches completed successfully: ${totalInserted}/${data.length} records inserted`);
        return { insertedCount: totalInserted };
      };

      // Edge-based outbound ingestion to avoid DB timeouts
      const uploadOutboundViaEdge = async (rows: any[]) => {
        const BATCH_SIZE = 50;
        let totalInserted = 0;
        const failedBatches: { batchNumber: number; error: string }[] = [];
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          try {
            const { data, error } = await supabase.functions.invoke('ingest-outbound-logistics', {
              body: { rows: batch, userId: user.id, userEmail: user.email },
            });
            if (error || !data?.success) {
              failedBatches.push({ batchNumber: Math.floor(i / BATCH_SIZE) + 1, error: String(error?.message || data?.error || 'Unknown') });
              continue;
            }
            totalInserted += data.inserted ?? batch.length;
            if (i + BATCH_SIZE < rows.length) {
              await new Promise((r) => setTimeout(r, 300));
            }
          } catch (e: any) {
            failedBatches.push({ batchNumber: Math.floor(i / BATCH_SIZE) + 1, error: String(e?.message || e) });
          }
        }
        if (failedBatches.length) {
          const summary = failedBatches.map((f) => `Batch ${f.batchNumber}: ${f.error}`).join('\n');
          throw new Error(`Outbound upload partially failed: ${summary}`);
        }
        return { insertedCount: totalInserted };
      };

      // Edge-based inbound ingestion to avoid DB timeouts
      const uploadInboundViaEdge = async (rows: any[]) => {
        const BATCH_SIZE = 50;
        let totalInserted = 0;
        const failedBatches: { batchNumber: number; error: string }[] = [];
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          try {
            const { data, error } = await supabase.functions.invoke('ingest-inbound-logistics', {
              body: { rows: batch, userId: user.id, userEmail: user.email },
            });
            if (error || !data?.success) {
              failedBatches.push({ batchNumber: Math.floor(i / BATCH_SIZE) + 1, error: String(error?.message || data?.error || 'Unknown') });
              continue;
            }
            totalInserted += data.inserted ?? batch.length;
            if (i + BATCH_SIZE < rows.length) {
              await new Promise((r) => setTimeout(r, 300));
            }
          } catch (e: any) {
            failedBatches.push({ batchNumber: Math.floor(i / BATCH_SIZE) + 1, error: String(e?.message || e) });
          }
        }
        if (failedBatches.length) {
          const summary = failedBatches.map((f) => `Batch ${f.batchNumber}: ${f.error}`).join('\n');
          throw new Error(`Inbound upload partially failed: ${summary}`);
        }
        return { insertedCount: totalInserted };
      };

      // Edge-based BOM Multi Level ingestion to avoid DB timeouts
      const uploadBomMultiViaEdge = async (rows: any[]) => {
        const BATCH_SIZE = 200;
        let totalInserted = 0;
        const failedBatches: { batchNumber: number; error: string }[] = [];
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          try {
            const { data, error } = await supabase.functions.invoke('ingest-bom-multi-level', {
              body: { rows: batch, userId: user.id, userEmail: user.email },
            });
            if (error || !data?.success) {
              failedBatches.push({ batchNumber: Math.floor(i / BATCH_SIZE) + 1, error: String(error?.message || data?.error || 'Unknown') });
              continue;
            }
            totalInserted += data.inserted ?? batch.length;
            if (i + BATCH_SIZE < rows.length) {
              await new Promise((r) => setTimeout(r, 300));
            }
          } catch (e: any) {
            failedBatches.push({ batchNumber: Math.floor(i / BATCH_SIZE) + 1, error: String(e?.message || e) });
          }
        }
        if (failedBatches.length) {
          const summary = failedBatches.map((f) => `Batch ${f.batchNumber}: ${f.error}`).join('\n');
          throw new Error(`BOM Multi Level upload partially failed: ${summary}`);
        }
        return { insertedCount: totalInserted };
      };

      // Batch processing for deep tier network nodes
      const uploadNetworkNodesBatch = async (rows: any[]) => {
        const BATCH_SIZE = 200; // Optimal batch size for network nodes
        let totalInserted = 0;
        const failedBatches: { batchNumber: number; error: string }[] = [];
        const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
        
        console.log(`🚀 Starting network nodes batch upload: ${rows.length} records, ${totalBatches} batches`);
        
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
          
          try {
            console.log(`📦 Processing nodes batch ${batchNumber}/${totalBatches} (${batch.length} records)`);
            
            const { data, error } = await supabase.rpc('bulk_insert_network_nodes', {
              p_project_id: selectedProject?.id,
              p_plant_name: selectedProject?.plant_name,
              p_user_id: user.id,
              p_user_email: user.email,
              p_rows: JSON.parse(JSON.stringify(batch)),
            });
            
            if (error) {
              const errorMsg = `Database error: ${error.message || error}`;
              console.error(`❌ Nodes batch ${batchNumber} failed:`, errorMsg);
              failedBatches.push({ batchNumber, error: errorMsg });
              continue;
            }
            
            const insertedInBatch = data || 0;
            totalInserted += insertedInBatch;
            console.log(`✅ Nodes batch ${batchNumber} completed: ${insertedInBatch} records inserted`);
            
            // Add delay between batches to prevent overwhelming the database
            if (i + BATCH_SIZE < rows.length) {
              await new Promise((r) => setTimeout(r, 250));
            }
          } catch (e: any) {
            const errorMsg = `Upload error: ${e?.message || e}`;
            console.error(`❌ Nodes batch ${batchNumber} failed:`, errorMsg);
            failedBatches.push({ batchNumber, error: errorMsg });
          }
        }
        
        if (failedBatches.length > 0) {
          const summary = failedBatches.map((f) => `Batch ${f.batchNumber}: ${f.error}`).join('\n');
          throw new Error(`Network nodes upload partially failed:\n${summary}`);
        }
        
        console.log(`✅ Network nodes batch upload completed: ${totalInserted} total records`);
        return { insertedCount: totalInserted };
      };

      // Batch processing for deep tier network edges
      const uploadNetworkEdgesBatch = async (rows: any[]) => {
        const BATCH_SIZE = 200; // Optimal batch size for network edges
        let totalInserted = 0;
        const failedBatches: { batchNumber: number; error: string }[] = [];
        const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
        
        console.log(`🚀 Starting network edges batch upload: ${rows.length} records, ${totalBatches} batches`);
        
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
          
          try {
            console.log(`📦 Processing edges batch ${batchNumber}/${totalBatches} (${batch.length} records)`);
            
            const { data, error } = await supabase.rpc('bulk_insert_network_edges', {
              p_project_id: selectedProject?.id,
              p_plant_name: selectedProject?.plant_name,
              p_user_id: user.id,
              p_user_email: user.email,
              p_rows: JSON.parse(JSON.stringify(batch)),
            });
            
            if (error) {
              const errorMsg = `Database error: ${error.message || error}`;
              console.error(`❌ Edges batch ${batchNumber} failed:`, errorMsg);
              failedBatches.push({ batchNumber, error: errorMsg });
              continue;
            }
            
            const insertedInBatch = data || 0;
            totalInserted += insertedInBatch;
            console.log(`✅ Edges batch ${batchNumber} completed: ${insertedInBatch} records inserted`);
            
            // Add delay between batches to prevent overwhelming the database
            if (i + BATCH_SIZE < rows.length) {
              await new Promise((r) => setTimeout(r, 250));
            }
          } catch (e: any) {
            const errorMsg = `Upload error: ${e?.message || e}`;
            console.error(`❌ Edges batch ${batchNumber} failed:`, errorMsg);
            failedBatches.push({ batchNumber, error: errorMsg });
          }
        }
        
        if (failedBatches.length > 0) {
          const summary = failedBatches.map((f) => `Batch ${f.batchNumber}: ${f.error}`).join('\n');
          throw new Error(`Network edges upload partially failed:\n${summary}`);
        }
        
        console.log(`✅ Network edges batch upload completed: ${totalInserted} total records`);
        return { insertedCount: totalInserted };
      };


      let result;
      const uploadStartTime = Date.now();
      
      console.log('🚀 Starting bulk insert for:', template.id, 'with', dataToInsert.length, 'records');
      
      // Use the appropriate bulk insert function based on template
      if (template.id === 'bom_single_level') {
        console.log('📦 Uploading BOM Single Level data...');
        const batchResult = await processBatches('bulk_insert_bom_single_level', dataToInsert, {
          p_rows: dataToInsert, // Will be replaced per batch
          p_user_id: user.id,
          p_user_email: user.email
        });
        result = { insertedCount: batchResult.insertedCount };
      } else if (template.id === 'bom_multi_level') {
        console.log('📦 Uploading BOM Multi Level data via Edge Function...');
        const batchResult = await uploadBomMultiViaEdge(dataToInsert);
        result = { insertedCount: batchResult.insertedCount };
      } else if (template.id === 'inbound_logistics') {
        console.log('📥 Uploading Inbound Logistics data via Edge Function...');
        const batchResult = await uploadInboundViaEdge(dataToInsert);
        result = { insertedCount: batchResult.insertedCount };
      } else if (template.id === 'outbound_logistics') {
        console.log('📤 Uploading Outbound Logistics data via Edge Function...');
        const batchResult = await uploadOutboundViaEdge(dataToInsert);
        result = { insertedCount: batchResult.insertedCount };
      } else if (template.id === 'node_list') {
        const batchResult = await processBatches('upload_node_list_data', dataToInsert, {
          p_project_id: selectedProject?.id,
          p_user_id: user.id,
          p_user_email: user.email,
          p_rows: dataToInsert // Will be replaced per batch
        });
        result = { insertedCount: batchResult.insertedCount };
      } else if (template.id === 'tier2_suppliers') {
        const batchResult = await processBatches('bulk_insert_tier2_suppliers', dataToInsert, {
          p_project_id: selectedProject?.id,
          p_data: dataToInsert, // Will be replaced per batch
          p_user_id: user.id,
          p_user_email: user.email
        });
        result = { insertedCount: batchResult.insertedCount };
      } else if (template.id === 'tier3_suppliers') {
        const batchResult = await processBatches('bulk_insert_tier3_suppliers', dataToInsert, {
          p_project_id: selectedProject?.id,
          p_data: dataToInsert, // Will be replaced per batch
          p_user_id: user.id,
          p_user_email: user.email
        });
        result = { insertedCount: batchResult.insertedCount };
      } else if (template.id === 'deep_tier_json') {
        // Handle JSON format for deep tier data with batch processing
        const content = await file.text();
        const { nodes, edges } = parseJSON(content);
        
        console.log(`📊 Deep tier JSON parsed: ${nodes.length} nodes, ${edges.length} edges`);
        
        let totalInserted = 0;
        
        // Upload nodes first with batch processing
        if (nodes.length > 0) {
          console.log('📦 Starting batch upload of nodes...');
          const nodesResult = await uploadNetworkNodesBatch(nodes);
          totalInserted += nodesResult.insertedCount;
          console.log(`✅ Nodes upload completed: ${nodesResult.insertedCount} records`);
        }

        // Upload edges second with batch processing
        if (edges.length > 0) {
          console.log('🔗 Starting batch upload of edges...');
          const edgesResult = await uploadNetworkEdgesBatch(edges);
          totalInserted += edgesResult.insertedCount;
          console.log(`✅ Edges upload completed: ${edgesResult.insertedCount} records`);
        }

        result = { data: totalInserted };
        
      } else if (selectedDataset === 'deep_tier' && deepTierFormat === 'csv') {
        // Handle deep tier CSV format with batch processing - upload both nodes and edges
        if (!nodesFile || !edgesFile || nodesData.length === 0 || edgesData.length === 0) {
          throw new Error('Please upload both nodes and edges CSV files');
        }

        console.log(`📊 Deep tier CSV loaded: ${nodesData.length} nodes, ${edgesData.length} edges`);
        
        let totalInserted = 0;

        // Upload nodes first with batch processing
        console.log('📦 Starting batch upload of CSV nodes...');
        const nodesResult = await uploadNetworkNodesBatch(nodesData);
        totalInserted += nodesResult.insertedCount;
        console.log(`✅ CSV nodes upload completed: ${nodesResult.insertedCount} records`);

        // Upload edges second with batch processing
        console.log('🔗 Starting batch upload of CSV edges...');
        const edgesResult = await uploadNetworkEdgesBatch(edgesData);
        totalInserted += edgesResult.insertedCount;
        console.log(`✅ CSV edges upload completed: ${edgesResult.insertedCount} records`);

        result = { data: totalInserted };

      } else if (template.id === 'network_nodes') {
        // Use batch processing for individual network nodes upload
        console.log('📦 Starting batch upload of network nodes...');
        const batchResult = await uploadNetworkNodesBatch(dataToInsert);
        result = { data: batchResult.insertedCount };
      } else if (template.id === 'network_edges') {
        // Use batch processing for individual network edges upload  
        console.log('🔗 Starting batch upload of network edges...');
        const batchResult = await uploadNetworkEdgesBatch(dataToInsert);
        result = { data: batchResult.insertedCount };
      }

      const uploadDuration = Date.now() - uploadStartTime;
      console.log('⏱️ Upload completed in:', uploadDuration, 'ms');
      
      if (result?.error) {
        console.error('❌ Upload RPC error:', result.error);
        throw new Error(`Database upload failed: ${result.error.message || result.error}`);
      }

      const insertedCount = result?.data || result?.insertedCount || 0;
      
      // Enhanced validation of insertion results
      if (insertedCount === 0 && dataToInsert.length > 0) {
        console.error('⚠️ CRITICAL: Upload appeared successful but 0 records were inserted!', {
          template: selectedTemplate,
          dataset: selectedDataset, 
          originalRecords: csvData.length,
          processedRecords: dataToInsert.length,
          resultData: result?.data,
          resultError: result?.error,
          sampleRecord: dataToInsert[0]
        });
        throw new Error(`Upload failed: Expected to insert ${dataToInsert.length} records but got ${insertedCount}. This usually indicates a data validation or mapping issue.`);
      }
      
      if (insertedCount < dataToInsert.length) {
        console.warn('⚠️ Partial insertion detected:', {
          expected: dataToInsert.length,
          actual: insertedCount,
          template: selectedTemplate
        });
      }
      
      console.log('✅ Successfully inserted:', insertedCount, 'records for', template.id);

      // Auto-calculate prominence after successful deep tier uploads
      if (template.id === 'network_nodes' || template.id === 'network_edges' || template.id === 'deep_tier_json' || (selectedDataset === 'deep_tier' && deepTierFormat === 'csv')) {
        try {
          console.log('🔄 Auto-calculating prominence after', template.id, 'upload');
          const prominenceResult = await supabase.functions.invoke('calculate-node-prominence', {
            body: { project_id: selectedProject?.id }
          });
          
          if (prominenceResult.error) {
            console.warn('⚠️ Auto-prominence calculation failed:', prominenceResult.error);
            toast({
              title: 'Upload successful, but prominence calculation failed',
              description: `${insertedCount} records uploaded. You can manually recalculate prominence from the network view.`,
              variant: 'default',
            });
          } else {
            console.log('✅ Auto-prominence calculation completed:', prominenceResult.data);
            toast({
              title: 'Upload successful',
              description: `${insertedCount} records uploaded and prominence calculated for ${prominenceResult.data.updated_count} nodes`,
            });
          }
        } catch (prominenceError) {
          console.warn('⚠️ Auto-prominence calculation error:', prominenceError);
          toast({
            title: 'Upload successful',
            description: `${insertedCount} records uploaded. Prominence calculation will be available shortly.`,
          });
        }
      } else {
        toast({
          title: 'Upload successful',
          description: `${insertedCount} records uploaded`,
        });
      }
      
      // Clear form data after successful upload
      setFile(null);
      setCsvData([]);
      setErrors([]);
      // Clear deep tier data as well
      setNodesFile(null);
      setEdgesFile(null);
      setNodesData([]);
      setEdgesData([]);
      setNodesErrors([]);
      setEdgesErrors([]);
      
      console.log('🎉 Upload process completed successfully, triggering onUploadComplete callback');
      
      // Use setTimeout to ensure upload completion callback runs after current execution
      setTimeout(() => {
        onUploadComplete();
      }, 100);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('❌ Upload failed:', {
        error: errorMessage,
        template: selectedTemplate,
        dataset: selectedDataset,
        timestamp: new Date().toISOString(),
        projectId: selectedProject?.id,
        userId: user?.id,
        recordCount: csvData.length,
        errorStack: error instanceof Error ? error.stack : undefined
      });
      
      // Enhanced error messages for common issues
      let userFriendlyMessage = errorMessage;
      
      if (errorMessage.includes('statement timeout') || errorMessage.includes('timeout')) {
        userFriendlyMessage = `Upload timeout: Your dataset (${csvData.length || (nodesData?.length || 0) + (edgesData?.length || 0)} records) is too large for single processing. The system now uses batch processing to handle large files - please try again.`;
      } else if (errorMessage.includes('batch') && errorMessage.includes('failed')) {
        userFriendlyMessage = `Batch upload partially failed: Some batches couldn't be processed. This may be due to data validation issues or temporary database unavailability. Please check your data format and try again.`;
      } else if (errorMessage.includes('Network nodes upload') || errorMessage.includes('Network edges upload')) {
        userFriendlyMessage = `Deep tier data upload failed: ${errorMessage.includes('partially') ? 'Some batches failed during processing.' : 'Upload encountered errors.'} Please verify your JSON/CSV format matches the template exactly.`;
      } else if (errorMessage.includes('violates')) {
        userFriendlyMessage = `Data validation error: Some records don't meet the required format. Please check your CSV file against the template.`;
      } else if (errorMessage.includes('duplicate')) {
        userFriendlyMessage = `Duplicate data detected: Some records already exist. Please check for duplicate entries in your file.`;
      } else if (errorMessage.includes('0 records')) {
        userFriendlyMessage = `No records were imported. This usually means:\n• Column names don't match the template exactly\n• Required fields are missing\n• Data format issues\n\nPlease verify your CSV matches the downloaded template.`;
      } else if (errorMessage.includes('Unknown error occurred')) {
        userFriendlyMessage = `Upload failed with unknown error. This may be due to:\n• File too large (try smaller batches)\n• Network connectivity issues\n• Server timeout\n\nPlease try again or contact support if the issue persists.`;
      }
      
      toast({
        title: 'Upload failed',
        description: userFriendlyMessage,
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card className="relative">
      {/* Header with tabs */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b">
        <Tabs value={selectedDataset} onValueChange={setSelectedDataset} className="flex-1">
          <TabsList
            className="inline-flex justify-start gap-1 h-9 rounded-xl bg-muted p-1"
            style={{ width: 'fit-content' }}
          >
            {datasetTabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={`${SMALL_TXT} px-3 h-7 rounded-md transition-colors
                  data-[state=inactive]:text-muted-foreground
                  data-[state=active]:bg-background data-[state=active]:text-foreground
                  data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border`}
                onClick={() => {
                  setFile(null);
                  setErrors([]);
                  // Clear deep tier states as well
                  setNodesFile(null);
                  setEdgesFile(null);
                  setNodesData([]);
                  setEdgesData([]);
                  setNodesErrors([]);
                  setEdgesErrors([]);
                }}
              >
                {tab.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Dynamic Template and Guide buttons - now using selectedTemplate */}
        <div className="flex gap-2 ml-4">
          {selectedDataset !== 'deep_tier' || deepTierFormat === 'csv' ? (
            <Button 
              variant="outline" 
              size="sm" 
              asChild 
              className={`${SMALL_TXT} h-7`}
              disabled={!selectedTemplate || templateTypes.find((t) => t.id === selectedTemplate)?.templateFile === ''}
            >
              <a
                href={templateTypes.find((t) => t.id === selectedTemplate)?.templateFile}
                download
              >
                <Download className="h-3 w-3 mr-1" />
                Template
              </a>
            </Button>
          ) : (
            <Button 
              variant="outline" 
              size="sm" 
              asChild 
              className={`${SMALL_TXT} h-7`}
            >
              <a
                href={templateTypes.find((t) => t.id === selectedTemplate)?.templateFile}
                download
              >
                <Download className="h-3 w-3 mr-1" />
                JSON Example
              </a>
            </Button>
          )}
          <Button 
            variant="outline" 
            size="sm" 
            asChild 
            className={`${SMALL_TXT} h-7`}
            disabled={!selectedTemplate}
          >
            <a
              href={templateTypes.find((t) => t.id === selectedTemplate)?.guideFile}
              target="_blank"
              rel="noreferrer"
            >
              <FileText className="h-3 w-3 mr-1" />
              Guide
            </a>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-7 w-7 ml-2"
          title="Close"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Button>
      </div>

      <CardContent className="p-3 pt-2">
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className={SMALL_TXT}>
                {templateTypes.find((t) => t.id === selectedTemplate)?.name}
              </Label>
            </div>

            {/* Deep Tier Format Selection */}
            {selectedDataset === 'deep_tier' && (
              <Card className="border-dashed">
                <CardContent className="p-4 space-y-3">
                  <Label className="text-xs font-medium">Upload Format</Label>
                  <RadioGroup 
                    value={deepTierFormat} 
                    onValueChange={(value: 'csv' | 'json') => {
                      setDeepTierFormat(value);
                      // Clear all file states when changing format
                      setFile(null);
                      setCsvData([]);
                      setErrors([]);
                      setNodesFile(null);
                      setEdgesFile(null);
                      setNodesData([]);
                      setEdgesData([]);
                      setNodesErrors([]);
                      setEdgesErrors([]);
                    }}
                    className="flex gap-6"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="csv" id="format-csv" />
                      <Label htmlFor="format-csv" className="text-xs cursor-pointer">
                        CSV Files (2 files: nodes + edges)
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="json" id="format-json" />
                      <Label htmlFor="format-json" className="text-xs cursor-pointer">
                        JSON File (single combined file)
                      </Label>
                    </div>
                  </RadioGroup>
                  {deepTierFormat === 'csv' && (
                    <div className="text-xs text-muted-foreground">
                      Upload nodes and edges separately using the CSV templates
                    </div>
                  )}
                  {deepTierFormat === 'json' && (
                    <div className="text-xs text-muted-foreground">
                      Upload a single JSON file containing both nodes and edges arrays
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="space-y-3">
                {selectedDataset === 'deep_tier' && deepTierFormat === 'csv' ? (
                  // Deep tier CSV: separate file inputs for nodes and edges
                  <div className="space-y-4">
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-muted-foreground" />
                          <Label className="text-xs font-medium">
                            Network Nodes CSV File
                          </Label>
                        </div>
                        <Input
                          type="file"
                          accept=".csv"
                          onChange={handleNodesFileSelect}
                          className="
                            border-0 bg-transparent shadow-none
                            h-8 text-xs
                            file:mr-2 file:rounded-md file:border file:border-input
                            file:bg-muted file:px-2 file:py-0.5
                            file:text-xs file:font-medium file:text-foreground
                            file:hover:bg-muted/70
                          "
                        />
                        {nodesFile && nodesData.length > 0 && (
                          <div className="flex items-center gap-2 text-xs text-green-600">
                            <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                            <span>{nodesData.length} nodes loaded from {nodesFile.name}</span>
                          </div>
                        )}
                        {nodesErrors.length > 0 && (
                          <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription className="text-xs">
                              {nodesErrors.map((error, index) => (
                                <div key={index}>{error}</div>
                              ))}
                            </AlertDescription>
                          </Alert>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-muted-foreground" />
                          <Label className="text-xs font-medium">
                            Network Edges CSV File
                          </Label>
                        </div>
                        <Input
                          type="file"
                          accept=".csv"
                          onChange={handleEdgesFileSelect}
                          className="
                            border-0 bg-transparent shadow-none
                            h-8 text-xs
                            file:mr-2 file:rounded-md file:border file:border-input
                            file:bg-muted file:px-2 file:py-0.5
                            file:text-xs file:font-medium file:text-foreground
                            file:hover:bg-muted/70
                          "
                        />
                        {edgesFile && edgesData.length > 0 && (
                          <div className="flex items-center gap-2 text-xs text-green-600">
                            <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                            <span>{edgesData.length} edges loaded from {edgesFile.name}</span>
                          </div>
                        )}
                        {edgesErrors.length > 0 && (
                          <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription className="text-xs">
                              {edgesErrors.map((error, index) => (
                                <div key={index}>{error}</div>
                              ))}
                            </AlertDescription>
                          </Alert>
                        )}
                      </CardContent>
                    </Card>
                  </div>
              ) : (
                // Standard single file input for all other cases
                <Input
                  type="file"
                  accept={selectedDataset === 'deep_tier' && deepTierFormat === 'json' ? '.json' : '.csv'}
                  onChange={handleFileSelect}
                  className="
                    border-0 bg-transparent shadow-none
                    h-8 text-xs
                    file:mr-2 file:rounded-md file:border file:border-input
                    file:bg-muted file:px-2 file:py-0.5
                    file:text-xs file:font-medium file:text-foreground
                    file:hover:bg-muted/70
                  "
                />
              )}

              {/* Preview Tables */}
              {selectedDataset === 'deep_tier' && deepTierFormat === 'csv' ? (
                // Deep tier CSV: show preview for both nodes and edges
                <div className="space-y-4">
                  {nodesFile && nodesData.length > 0 && (
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className={`${SMALL_TXT} font-medium text-foreground`}>
                            Nodes Preview
                          </div>
                          <div className={`${SMALL_TXT} text-muted-foreground`}>
                            {nodesData.length} total rows
                          </div>
                        </div>
                        <div className="border rounded-md overflow-hidden">
                          <div className="max-h-48 overflow-auto">
                            <Table className={SMALL_TXT}>
                              <TableHeader className="sticky top-0 bg-background z-10">
                                <TableRow className="h-7">
                                  <TableHead className={`${HEAD_CELL_PAD} ${SMALL_TXT}`}>UID</TableHead>
                                  <TableHead className={`${HEAD_CELL_PAD} ${SMALL_TXT}`}>Name</TableHead>
                                  <TableHead className={`${HEAD_CELL_PAD} ${SMALL_TXT}`}>Country</TableHead>
                                  <TableHead className={`${HEAD_CELL_PAD} ${SMALL_TXT}`}>Revenue</TableHead>
                                  <TableHead className={`${HEAD_CELL_PAD} ${SMALL_TXT}`}>Is Seed</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {nodesData.slice(0, 3).map((row, idx) => (
                                  <TableRow key={idx} className="hover:bg-muted/40">
                                    <TableCell className={CELL_PAD}>{row.uid}</TableCell>
                                    <TableCell className={CELL_PAD}>{row.name || 'N/A'}</TableCell>
                                    <TableCell className={CELL_PAD}>{row.country || 'N/A'}</TableCell>
                                    <TableCell className={CELL_PAD}>{row.revenue || 'N/A'}</TableCell>
                                    <TableCell className={CELL_PAD}>{String(row.is_seed || false)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  
                  {edgesFile && edgesData.length > 0 && (
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className={`${SMALL_TXT} font-medium text-foreground`}>
                            Edges Preview
                          </div>
                          <div className={`${SMALL_TXT} text-muted-foreground`}>
                            {edgesData.length} total rows
                          </div>
                        </div>
                        <div className="border rounded-md overflow-hidden">
                          <div className="max-h-48 overflow-auto">
                            <Table className={SMALL_TXT}>
                              <TableHeader className="sticky top-0 bg-background z-10">
                                <TableRow className="h-7">
                                  <TableHead className={`${HEAD_CELL_PAD} ${SMALL_TXT}`}>Src UID</TableHead>
                                  <TableHead className={`${HEAD_CELL_PAD} ${SMALL_TXT}`}>Dst UID</TableHead>
                                  <TableHead className={`${HEAD_CELL_PAD} ${SMALL_TXT}`}>Relation Type</TableHead>
                                  <TableHead className={`${HEAD_CELL_PAD} ${SMALL_TXT}`}>Revenue</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {edgesData.slice(0, 3).map((row, idx) => (
                                  <TableRow key={idx} className="hover:bg-muted/40">
                                    <TableCell className={CELL_PAD}>{row.src_uid}</TableCell>
                                    <TableCell className={CELL_PAD}>{row.dst_uid}</TableCell>
                                    <TableCell className={CELL_PAD}>{row.relation_type || 'N/A'}</TableCell>
                                    <TableCell className={CELL_PAD}>{row.relative_revenue || 'N/A'}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : (
                // Standard preview for all other cases
                file && csvData.length > 0 && (
                  <div className="space-y-2">
                    <div className={`${SMALL_TXT} text-muted-foreground`}>
                      Preview (showing 5 of {csvData.length} rows)
                    </div>
                    <div className="border rounded-md overflow-hidden">
                      <div className="max-h-64 overflow-auto">
                        <Table className={SMALL_TXT}>
                          <TableHeader className="sticky top-0 bg-background z-10">
                            <TableRow className="h-7">
                              {getPreviewHeaders().map((header) => (
                                <TableHead key={header} className={`${HEAD_CELL_PAD} ${SMALL_TXT}`}>
                                  {header}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {csvData.slice(0, 5).map((row, idx) => (
                              <TableRow key={idx} className="hover:bg-muted/40">
                                {getPreviewCells(row).map((cell, cellIdx) => (
                                  <TableCell key={cellIdx} className={CELL_PAD}>
                                    {cell}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>

            {errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className={SMALL_TXT}>
                  {errors.map((error, index) => (
                    <div key={index}>{error}</div>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {/* Upload button logic */}
            {selectedDataset === 'deep_tier' && deepTierFormat === 'csv' ? (
              // Deep tier CSV: upload button for both files
              nodesFile && edgesFile && nodesErrors.length === 0 && edgesErrors.length === 0 && (
                <Card className="border-green-200 bg-green-50/50">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span className={`${SMALL_TXT} text-green-700 font-medium`}>
                          {nodesData.length} nodes + {edgesData.length} edges ready for upload
                        </span>
                      </div>
                      <Button
                        onClick={handleUpload}
                        disabled={isUploading}
                        size="sm"
                        className={`${SMALL_TXT} bg-green-600 hover:bg-green-700`}
                      >
                        <FileUp className="h-3 w-3 mr-1" />
                        {isUploading ? 'Uploading...' : 'Upload Network Data'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            ) : (
              // Standard upload button for all other cases
              file && errors.length === 0 && (
                <Card className="border-green-200 bg-green-50/50">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span className={`${SMALL_TXT} text-green-700 font-medium`}>
                          {csvData.length} rows ready for upload
                        </span>
                      </div>
                      <Button
                        onClick={handleUpload}
                        disabled={isUploading}
                        size="sm"
                        className={`${SMALL_TXT} bg-green-600 hover:bg-green-700`}
                      >
                        <FileUp className="h-3 w-3 mr-1" />
                        {isUploading ? 'Uploading...' : 'Upload'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default UploadWizard;
