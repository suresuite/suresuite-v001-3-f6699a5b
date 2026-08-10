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
} from 'lucide-react';
import { getCombineStatusStyle, getCombineStatusIcon, getCombineStatusText } from '@/utils/combineStatus';
import { getFallbackSimulationDates } from '@/utils/dateHelpers';

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
  onGlobalSelect: (projectId: string) => void;
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
          <div className="space-y-4">
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
          </div>
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
                  <Badge className={`text-xs ${getCombineStatusStyle(project.combine_status)}`}>
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

            <div className="flex items-center gap-1 ml-4">
              {/* Global Project Selector */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center">
                      <Switch
                        checked={globalSelectedProjectId === project.id}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            onGlobalSelect(project.id);
                            toast({
                              title: "Global project selected",
                              description: `"${project.name}" is now the active project across the app`
                            });
                          } else {
                            onGlobalSelect(null);
                            toast({
                              title: "Global project deselected",
                              description: "No project is currently active across the app"
                            });
                          }
                        }}
                        className="h-4 w-8 data-[state=checked]:bg-foreground scale-75"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Global Project Selection</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {canModify && (project.modeler_id === userId || role === 'admin') && (
                <>
                  <span className="text-muted-foreground text-sm mx-1">|</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewData(project);
                          }}
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>View data</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUploadData(project);
                          }}
                        >
                          <Upload className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Upload data</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditItemMaster(project);
                          }}
                        >
                          <Coins className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit item master (costs &amp; capacities)</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {completion && Object.values(completion).some(Boolean) && (!project.combine_status || project.combine_status === 'pending' || project.combine_status === 'failed') && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 hover:bg-muted"
                            disabled={project.combine_status === 'running'}
                            onClick={(e) => {
                              e.stopPropagation();
                              onCombine(project);
                            }}
                          >
                            <Workflow className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {project.combine_status === 'failed' ? 'Retry combine datasets' : 'Combine datasets'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(project);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit project</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            const isComplexProject = project.deep_tier_enabled && project.bom_level === 'multi_level';
                            const message = isComplexProject 
                              ? `Delete project "${project.name}"? This is a complex project that will be force-deleted (all data cleaned first).`
                              : `Are you sure you want to delete project "${project.name}"?`;
                              
                            if (confirm(message)) {
                              onDelete(project);
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete project</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}