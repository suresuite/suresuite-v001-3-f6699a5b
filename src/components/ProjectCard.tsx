import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { StepwiseDatePicker } from '@/components/ui/stepwise-date-picker';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import {
  CheckCircle,
  AlertCircle,
  Factory,
  GitBranch,
  Layers,
  Download,
  Eye,
  Upload,
  Pencil,
  Trash2,
  Info,
  Network,
  Workflow,
  Coins,
  MoreHorizontal,
} from 'lucide-react';
import { getCombineStatusStyle, getCombineStatusIcon, getCombineStatusText } from '@/utils/combineStatus';
import { getFallbackSimulationDates } from '@/utils/dateHelpers';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { MobileSheet } from '@/components/shared/MobileSheet';
import {
  M,
  MobileChip,
  MobilePanel,
  MobileRow,
  MobileToggle,
} from '@/components/mobile';
import { cn } from '@/lib/utils';

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
  simulation_start?: string;
  simulation_end?: string;
  deep_tier_enabled?: boolean;
  combine_status?: 'pending' | 'running' | 'completed' | 'failed';
  combine_timestamp?: string | null;
  data_type?: string;
}

interface CompletionInfo {
  bom: boolean;
  inbound: boolean;
  outbound: boolean;
  nodeList: boolean;
  deepNodes?: boolean;
  deepEdges?: boolean;
  deepSummary?: boolean;
}

interface ProjectCardProps {
  project: Project;
  completion: CompletionInfo;
  isSelected: boolean;
  isEditing: boolean;
  globalSelectedProjectId: string | null;
  canModify: boolean;
  role: string;
  userId: string;
  editProjectName: string;
  editPlantName: string;
  editSupplyChainModel: string;
  editBomLevel: string;
  editDataType: string;
  editSimulationStart?: Date;
  editSimulationEnd?: Date;
  editDeepTierEnabled: boolean;
  onSelect: (project: Project) => void;
  onGlobalSelect: (projectId: string | null) => void;
  onDownloadNodeList: (project: Project) => void;
  onGenerateNodeList: (project: Project) => void;
  onViewData: (project: Project) => void;
  onUploadData: (project: Project) => void;
  onEditItemMaster: (project: Project) => void;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
  onCombine: (project: Project) => void;
  onCancelEdit: () => void;
  onUpdateProject: () => void;
  onEditProjectNameChange: (value: string) => void;
  onEditPlantNameChange: (value: string) => void;
  onEditSupplyChainModelChange: (value: string) => void;
  onEditBomLevelChange: (value: string) => void;
  onEditDataTypeChange: (value: string) => void;
  onEditSimulationStartChange: (date?: Date) => void;
  onEditSimulationEndChange: (date?: Date) => void;
  onEditDeepTierEnabledChange: (value: boolean) => void;
}

export function ProjectCard({
  project,
  completion,
  isSelected,
  isEditing,
  globalSelectedProjectId,
  canModify,
  role,
  userId,
  editProjectName,
  editPlantName,
  editSupplyChainModel,
  editBomLevel,
  editDataType,
  editSimulationStart,
  editSimulationEnd,
  editDeepTierEnabled,
  onSelect,
  onGlobalSelect,
  onDownloadNodeList,
  onGenerateNodeList,
  onViewData,
  onUploadData,
  onEditItemMaster,
  onEdit,
  onDelete,
  onCombine,
  onCancelEdit,
  onUpdateProject,
  onEditProjectNameChange,
  onEditPlantNameChange,
  onEditSupplyChainModelChange,
  onEditBomLevelChange,
  onEditDataTypeChange,
  onEditSimulationStartChange,
  onEditSimulationEndChange,
  onEditDeepTierEnabledChange,
}: ProjectCardProps) {
  // The edit form, hoisted so BOTH chromes mount the same controls. It is
  // the real editor either way — the mobile branch wraps it in the panel
  // and applies the touch floor; nothing about the fields changes (§8).
  const editForm = (
    <>
          <div>
            <Label htmlFor={`edit-name-${project.id}`}>Project Name</Label>
            <Input
              id={`edit-name-${project.id}`}
              value={editProjectName}
              onChange={(e) => onEditProjectNameChange(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`edit-plant-${project.id}`}>Plant</Label>
            <Input
              id={`edit-plant-${project.id}`}
              value={editPlantName}
              onChange={(e) => onEditPlantNameChange(e.target.value)}
            />
          </div>
          <div>
            <Label>Data</Label>
            <RadioGroup
              value={editDataType}
              onValueChange={onEditDataTypeChange}
              className="flex gap-4 mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="curated" id={`edit-data-curated-${project.id}`} />
                <Label htmlFor={`edit-data-curated-${project.id}`}>Curated data</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="uncurated" id={`edit-data-uncurated-${project.id}`} />
                <Label htmlFor={`edit-data-uncurated-${project.id}`}>Uncurated data</Label>
              </div>
            </RadioGroup>
          </div>
          <div>
            <Label>Supply Chain Model</Label>
            <RadioGroup
              value={editSupplyChainModel}
              onValueChange={onEditSupplyChainModelChange}
              className="flex gap-4 mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Make-To-Order" id={`edit-model-mto-${project.id}`} />
                <Label htmlFor={`edit-model-mto-${project.id}`}>Make-To-Order</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Make-To-Stock" id={`edit-model-mts-${project.id}`} />
                <Label htmlFor={`edit-model-mts-${project.id}`}>Make-To-Stock</Label>
              </div>
            </RadioGroup>
          </div>
          <div>
            <Label>BOM Level</Label>
            <RadioGroup
              value={editBomLevel}
              onValueChange={onEditBomLevelChange}
              className="flex gap-4 mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="single" id={`edit-bom-single-${project.id}`} />
                <Label htmlFor={`edit-bom-single-${project.id}`}>Single Level BOM</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="multi" id={`edit-bom-multi-${project.id}`} />
                <Label htmlFor={`edit-bom-multi-${project.id}`}>Multiple Level BOM</Label>
              </div>
            </RadioGroup>
          </div>
          
          <div className="space-y-2">
            <Label>Deep Tier Network</Label>
            <div className="flex items-center space-x-3">
              <Switch
                id={`deep-tier-edit-${project.id}`}
                checked={editDeepTierEnabled}
                onCheckedChange={onEditDeepTierEnabledChange}
              />
              <Label htmlFor={`deep-tier-edit-${project.id}`}>
                Enable Deep Tier Network Analysis
              </Label>
            </div>
            {editDeepTierEnabled && (
              <p className="text-xs text-muted-foreground">
                This will enable tier-2 and tier-3 supplier data collection for extended supply chain visibility.
              </p>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Simulation Start Date</Label>
              <StepwiseDatePicker
                date={editSimulationStart}
                onSelect={onEditSimulationStartChange}
                placeholder="Pick start date"
              />
            </div>
            <div>
              <Label className="text-xs">Simulation End Date</Label>
              <StepwiseDatePicker
                date={editSimulationEnd}
                onSelect={onEditSimulationEndChange}
                placeholder="Pick end date"
                disabled={(date) => editSimulationStart ? date < editSimulationStart : false}
              />
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onUpdateProject();
              }}
              disabled={!editProjectName.trim() || !editPlantName.trim()}
            >
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onCancelEdit();
              }}
            >
              Cancel
            </Button>
          </div>
    </>
  );
  const isMobile = useIsMobile();
  const [sheet, setSheet] = useState(false);

  const fallbackDates = getFallbackSimulationDates(project.simulation_start, project.simulation_end);
  const period =
    fallbackDates.start.toLocaleDateString() + ' → ' + fallbackDates.end.toLocaleDateString();
  const periodDefaulted = !project.simulation_start || !project.simulation_end;

  const owns = canModify && (project.modeler_id === userId || role === 'admin');
  const isGlobal = globalSelectedProjectId === project.id;
  const hasBasicData = completion.bom && completion.inbound && completion.outbound;

  // The dataset checklist, as one sentence and one dot rather than six
  // coloured badges — a meaning colour is a dot, a 2px rule or a chip (§3).
  const datasets: Array<[string, boolean]> = [
    ['BOM', completion.bom],
    ['Inbound', completion.inbound],
    ['Outbound', completion.outbound],
    ...(project.deep_tier_enabled
      ? ([
          ['Deep nodes', Boolean(completion.deepNodes)],
          ['Deep edges', Boolean(completion.deepEdges)],
        ] as Array<[string, boolean]>)
      : []),
  ];
  const datasetsDone = datasets.filter(([, ok]) => ok).length;
  const datasetsComplete = datasetsDone === datasets.length;

  if (isMobile) {
    // Project Manager, converted (v2 §4B). Every shadcn Card on this surface
    // is the panel; the badge wall becomes rows; and the six actions that
    // used to hide inside a `…` dropdown — which §8 forbids — become named
    // rows in a sheet. Nothing is added, removed or renamed: the same
    // handlers, the same copy, the same destinations.
    //
    // The editing state keeps the REAL form. It is the same inputs desktop
    // edits with, inside the panel rather than a bordered card, with the 44px
    // touch floor applied to every control it holds.
    if (isEditing) {
      return (
        <MobilePanel label="Edit project" counter={project.name}>
          <div
            className={cn(
              'space-y-4 p-3',
              '[&_input]:min-h-11 [&_button]:min-h-11 [&_[role=radio]]:min-h-6',
            )}
          >
            {editForm}
          </div>
        </MobilePanel>
      );
    }

    const action = (
      label: string,
      onClick: () => void,
      sub?: string,
      disabled?: boolean,
      note?: string,
    ) => (
      <MobileRow
        label={label}
        sub={sub}
        disabled={disabled}
        note={disabled ? note : undefined}
        onClick={disabled ? undefined : onClick}
        chevron={!disabled}
      />
    );

    return (
      <>
        <MobilePanel
          // The globally active project is the one thing on this screen that
          // is different from the others, so it is the screen's one ink head
          // (v2 §2) — and there is at most one active project by definition.
          tone={isGlobal ? 'primary' : 'secondary'}
          label={project.name}
          counter={`${datasetsDone} / ${datasets.length}`}
        >
          <MobileRow
            chevron={false}
            label={project.plant_name}
            sub={[
              project.supply_chain_model,
              project.bom_level === 'single' ? 'Single-level BOM' : 'Multi-level BOM',
              project.data_type === 'uncurated' ? 'Uncurated data' : 'Curated data',
              project.deep_tier_enabled ? 'Deep tier' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            trailing={
              project.combine_status ? (
                <MobileChip>{getCombineStatusText(project.combine_status)}</MobileChip>
              ) : undefined
            }
          />

          <MobileRow
            chevron={false}
            dot={datasetsComplete ? M.process : M.blocking}
            label="Datasets"
            sub={datasets.map(([name, ok]) => `${name} ${ok ? '✓' : '✗'}`).join(' · ')}
            value={`${datasetsDone}/${datasets.length}`}
          />

          <MobileRow
            chevron={false}
            dot={periodDefaulted ? M.firm : undefined}
            label="Simulation period"
            sub={periodDefaulted ? 'defaults — no dates saved on the project' : undefined}
            value={period}
          />

          <MobileRow
            chevron={false}
            label="Active project"
            sub="the project the rest of the app works on"
            trailing={
              <MobileToggle
                checked={isGlobal}
                label={`Set ${project.name} as the active project`}
                onChange={(next) => {
                  onGlobalSelect(next ? project.id : null);
                  toast({
                    title: next ? 'Global project selected' : 'Global project deselected',
                    description: next
                      ? `"${project.name}" is now the active project across the app`
                      : 'No project is currently active across the app',
                  });
                }}
              />
            }
          />

          <MobileRow
            label="Project actions"
            sub={owns ? 'data, item master, combine, edit, delete' : 'view data'}
            value={owns ? '6' : '1'}
            onClick={() => setSheet(true)}
          />

          <MobileRow
            chevron={false}
            label="Modeller"
            sub={`created ${new Date(project.created_at).toLocaleDateString()}`}
            value={project.modeler_name}
          />
        </MobilePanel>

        <MobileSheet
          open={sheet}
          title={project.name}
          sub="Every action this project has. One row each — nothing is hidden behind a menu."
          onClose={() => setSheet(false)}
        >
          <div className="flex flex-col">
            {action(
              'View data',
              () => {
                onViewData(project);
                setSheet(false);
              },
              'the datasets loaded into this project',
              !owns,
              'Only the project’s modeller or an admin can open its data.',
            )}
            {action(
              'Upload data',
              () => {
                onUploadData(project);
                setSheet(false);
              },
              'the upload wizard',
              !owns,
              'Only the project’s modeller or an admin can upload.',
            )}
            {action(
              'Edit item master',
              () => {
                onEditItemMaster(project);
                setSheet(false);
              },
              'materials, products and suppliers',
              !owns,
              'Only the project’s modeller or an admin can edit the item master.',
            )}
            {action(
              completion.nodeList && hasBasicData ? 'Download node list' : 'Generate node list',
              () => {
                if (completion.nodeList && hasBasicData) onDownloadNodeList(project);
                else onGenerateNodeList(project);
                setSheet(false);
              },
              'optional — enhance it with location data and re-upload',
              !hasBasicData,
              'Upload BOM, inbound and outbound first — the node list is combined from them.',
            )}
            {action(
              project.combine_status === 'failed' ? 'Retry combine datasets' : 'Combine datasets',
              () => {
                onCombine(project);
                setSheet(false);
              },
              project.combine_status ? getCombineStatusText(project.combine_status) : undefined,
              !owns || project.combine_status === 'running',
              project.combine_status === 'running'
                ? 'A combine is already running for this project.'
                : 'Only the project’s modeller or an admin can combine datasets.',
            )}
            {action(
              'Edit project',
              () => {
                onEdit(project);
                setSheet(false);
              },
              'name, plant, model, BOM level, dates',
              !owns,
              'Only the project’s modeller or an admin can edit this project.',
            )}
            {action(
              'Delete project',
              () => {
                const isComplexProject = project.deep_tier_enabled && project.bom_level === 'multi_level';
                const message = isComplexProject
                  ? `Delete project "${project.name}"? This is a complex project that will be force-deleted (all data cleaned first).`
                  : `Are you sure you want to delete project "${project.name}"?`;
                if (confirm(message)) {
                  onDelete(project);
                  setSheet(false);
                }
              },
              'permanent',
              !owns,
              'Only the project’s modeller or an admin can delete this project.',
            )}
          </div>
        </MobileSheet>
      </>
    );
  }

  return (
    <Card
      className={`cursor-pointer transition-all duration-200 hover:shadow-lg ${
        isSelected
          ? 'ring-2 ring-primary bg-primary/5'
          : 'hover:bg-muted/30'
      }`}
      onClick={() => {
        if (!isEditing) {
          onSelect(project);
        }
      }}
    >
      <CardContent className="p-4">
        {isEditing ? (
          <div className="space-y-4">{editForm}</div>
        ) : (
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="mb-2">
                <h4 className="font-semibold text-sm">{project.name}</h4>
              </div>

              <div className="flex flex-wrap gap-1 mb-2">
                <Badge variant="outline" className="flex items-center gap-1 text-xs">
                  <Factory className="h-3 w-3" /> {project.plant_name}
                </Badge>
                <Badge variant="outline" className="flex items-center gap-1 text-xs">
                  <Workflow className="h-3 w-3" /> {project.data_type === 'uncurated' ? 'Uncurated data' : 'Curated data'}
                </Badge>
                <Badge variant="outline" className="flex items-center gap-1 text-xs">
                  <GitBranch className="h-3 w-3" /> {project.supply_chain_model}
                </Badge>
                <Badge variant="outline" className="flex items-center gap-1 text-xs">
                  <Layers className="h-3 w-3" /> {project.bom_level === 'single' ? 'Single-level BOM' : 'Multi-level BOM'}
                </Badge>
                {project.deep_tier_enabled && (
                  <Badge variant="outline" className="flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                    <Network className="h-3 w-3" /> Deep Tier Enabled
                  </Badge>
                )}
                
                {project.combine_status && (
                  <Badge variant="outline" className={`text-xs ${getCombineStatusStyle(project.combine_status)}`}>
                    {(() => {
                      const StatusIcon = getCombineStatusIcon(project.combine_status);
                      return (
                        <>
                          <StatusIcon className={`w-3 h-3 mr-1 ${project.combine_status === 'running' ? 'animate-spin' : ''}`} />
                          {getCombineStatusText(project.combine_status)}
                        </>
                      );
                    })()}
                  </Badge>
                )}
              </div>


              {/* Simulation Period - Always show with fallback to current year */}
              <div className="mb-3 mt-3">
                <div className="text-xs font-medium text-muted-foreground mb-2">Simulation Period</div>
                <div className="flex items-center gap-2 text-xs text-foreground">
                  {(() => {
                    const fallbackDates = getFallbackSimulationDates(project.simulation_start, project.simulation_end);
                    const showingFallback = !project.simulation_start || !project.simulation_end;
                    
                    return (
                      <>
                        <span className={`px-2.5 py-1 rounded-sm font-medium ${
                          project.simulation_start 
                            ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300' 
                            : 'bg-gray-50 dark:bg-gray-950/30 text-gray-600 dark:text-gray-400'
                        }`}>
                          Start: {fallbackDates.start.toLocaleDateString()}
                          {!project.simulation_start && <span className="text-xs opacity-75"> (default)</span>}
                        </span>
                        <span className={`px-2.5 py-1 rounded-sm font-medium ${
                          project.simulation_end 
                            ? 'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300' 
                            : 'bg-gray-50 dark:bg-gray-950/30 text-gray-600 dark:text-gray-400'
                        }`}>
                          End: {fallbackDates.end.toLocaleDateString()}
                          {!project.simulation_end && <span className="text-xs opacity-75"> (default)</span>}
                        </span>
                      </>
                    );
                  })()}
                </div>
              </div>


              {/* Data Completion Checklist */}
              <div className="flex flex-wrap gap-1 mt-3">
                <Badge
                  variant={completion.bom ? "default" : "destructive"}
                  className={`text-xs ${completion.bom ? 'bg-green-500' : 'bg-red-500'}`}
                >
                  BOM {completion.bom ? '✓' : '✗'}
                </Badge>
                <Badge
                  variant={completion.inbound ? "default" : "destructive"}
                  className={`text-xs ${completion.inbound ? 'bg-green-500' : 'bg-red-500'}`}
                >
                  Inbound {completion.inbound ? '✓' : '✗'}
                </Badge>
                <Badge
                  variant={completion.outbound ? "default" : "destructive"}
                  className={`text-xs ${completion.outbound ? 'bg-green-500' : 'bg-red-500'}`}
                >
                  Outbound {completion.outbound ? '✓' : '✗'}
                </Badge>
                
                {/* Deep Tier Dataset Badges */}
                {project.deep_tier_enabled && (
                  <>
                    <Badge
                      variant={completion.deepNodes ? "default" : "destructive"}
                      className={`text-xs ${completion.deepNodes ? 'bg-green-500' : 'bg-red-500'}`}
                    >
                      Deep Nodes {completion.deepNodes ? '✓' : '✗'}
                    </Badge>
                    <Badge
                      variant={completion.deepEdges ? "default" : "destructive"}
                      className={`text-xs ${completion.deepEdges ? 'bg-green-500' : 'bg-red-500'}`}
                    >
                      Deep Edges {completion.deepEdges ? '✓' : '✗'}
                    </Badge>
                  </>
                )}
                
                {/* Optional Node List Dataset */}
                <div className="flex items-center gap-1">
                  <Badge
                    variant="outline"
                    className={`text-xs transition-colors ${
                      completion.nodeList && (completion.bom && completion.inbound && completion.outbound)
                        ? 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/40' 
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const hasBasicData = completion.bom && completion.inbound && completion.outbound;
                      if (completion.nodeList && hasBasicData) {
                        onDownloadNodeList(project);
                      } else if (hasBasicData) {
                        onGenerateNodeList(project);
                      }
                    }}
                  >
                    <span className="flex items-center gap-1">
                      Node List {completion.nodeList ? '✓' : '○'}
                      {completion.nodeList && (completion.bom && completion.inbound && completion.outbound) && (
                        <Download className="h-3 w-3" />
                      )}
                    </span>
                  </Badge>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="text-xs">
                          Optional: Download the pre-combined node list, enhance it with location data, 
                          and re-upload to improve network visualization and analysis.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  </div>
                </div>

                {/* Modeller and Creation Date */}
                <div className="pt-3 mt-3 border-t border-border/50">
                  <div className="text-xs text-muted-foreground">
                    Modeller: {project.modeler_name} • Created: {new Date(project.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>

            <div className="flex items-center gap-2 ml-4 shrink-0" onClick={(e) => e.stopPropagation()}>
              {/* Global Project Selector */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Switch
                        size="sm"
                        checked={globalSelectedProjectId === project.id}
                        onCheckedChange={(checked) => {
                          onGlobalSelect(checked ? project.id : null);
                          toast({
                            title: checked ? 'Global project selected' : 'Global project deselected',
                            description: checked
                              ? `"${project.name}" is now the active project across the app`
                              : 'No project is currently active across the app',
                          });
                        }}
                        // The default unchecked track (--input, 88%) is invisible against
                        // the card's selected/hover tint, leaving a bare white thumb.
                        className="data-[state=unchecked]:bg-gray-400"
                        aria-label="Set as the active project across the app"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Global project selection</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {canModify && (project.modeler_id === userId || role === 'admin') && (
                <>
                  <Separator orientation="vertical" className="h-4" />

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 min-h-11 gap-1.5 md:min-h-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewData(project);
                    }}
                  >
                    <Eye className="h-3.5 w-3.5" /> View data
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 min-h-11 gap-1.5 md:min-h-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUploadData(project);
                    }}
                  >
                    <Upload className="h-3.5 w-3.5" /> Upload
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 min-h-11 min-w-11 md:min-h-0 md:min-w-0" aria-label="More actions" title="More actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onClick={() => onEditItemMaster(project)}>
                        <Coins className="mr-2 h-4 w-4" /> Edit item master
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={project.combine_status === 'running'}
                        onClick={() => onCombine(project)}
                      >
                        <Workflow className="mr-2 h-4 w-4" />
                        {project.combine_status === 'failed' ? 'Retry combine datasets' : 'Combine datasets'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit(project)}>
                        <Pencil className="mr-2 h-4 w-4" /> Edit project
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-[#bf2330] focus:text-[#bf2330]"
                        onClick={() => {
                          const isComplexProject = project.deep_tier_enabled && project.bom_level === 'multi_level';
                          const message = isComplexProject
                            ? `Delete project "${project.name}"? This is a complex project that will be force-deleted (all data cleaned first).`
                            : `Are you sure you want to delete project "${project.name}"?`;
                          if (confirm(message)) onDelete(project);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete project
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}