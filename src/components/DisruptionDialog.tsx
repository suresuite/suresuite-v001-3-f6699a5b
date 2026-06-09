// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScenarios } from '@/hooks/useScenarios';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { getFallbackSimulationDates } from '@/utils/dateHelpers';
import type { Edge } from '@xyflow/react';
import { StepwiseDatePicker } from '@/components/ui/stepwise-date-picker';

const disruptionSchema = z.object({
  scenario_name: z.string().min(1, 'Scenario name is required'),
  target_type: z.enum(['node', 'edge']),
  target_id: z.string().min(1, 'Target selection is required'),
  disruption_type: z.enum(['capacity_reduction', 'time_delay']),
  capacity_reduction_percent: z.number().min(0).max(100).optional(),
  capacity_reduction_amount: z.number().min(0).optional(),
  capacity_unit: z.enum(['percent', 'numeric']).optional(),
  time_delay_amount: z.number().min(0).optional(),
  time_delay_unit: z.enum(['days', 'weeks']).optional(),
  disruption_start: z.date().optional(),
  disruption_end: z.date().optional(),
  description: z.string().optional(),
}).refine((data) => {
  if (data.disruption_type === 'capacity_reduction') {
    if (!data.capacity_unit) return false;
    if (data.capacity_unit === 'percent') {
      return data.capacity_reduction_percent !== undefined && data.capacity_reduction_percent > 0;
    }
    if (data.capacity_unit === 'numeric') {
      return data.capacity_reduction_amount !== undefined && data.capacity_reduction_amount > 0;
    }
  }
  if (data.disruption_type === 'time_delay') {
    return data.time_delay_unit && data.time_delay_amount !== undefined && data.time_delay_amount > 0;
  }
  return true;
}, {
  message: "Please provide valid disruption parameters greater than 0",
  path: ["disruption_type"]
});

type DisruptionFormData = z.infer<typeof disruptionSchema>;

interface DisruptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string | null;
  projectId: string;
  plantName: string;
  connectedEdges: Edge[];
  onSuccess?: () => void;
}

interface ProjectData {
  simulation_start?: string | null;
  simulation_end?: string | null;
}

export function DisruptionDialog({
  open,
  onOpenChange,
  nodeId,
  projectId,
  plantName,
  connectedEdges,
  onSuccess,
}: DisruptionDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { createFromNode } = useScenarios(projectId);
  const [loading, setLoading] = useState(false);
  const [projectData, setProjectData] = useState<ProjectData | null>(null);

  const form = useForm<DisruptionFormData>({
    resolver: zodResolver(disruptionSchema),
    defaultValues: {
      scenario_name: '',
      target_type: 'node',
      target_id: nodeId || '',
      disruption_type: 'capacity_reduction',
      capacity_unit: 'percent',
      capacity_reduction_percent: 1,
      capacity_reduction_amount: 1,
      time_delay_amount: 1,
      time_delay_unit: 'days',
      description: '',
    },
  });

  const watchTargetType = form.watch('target_type');
  const watchDisruptionType = form.watch('disruption_type');
  const watchCapacityUnit = form.watch('capacity_unit');
  const watchDisruptionStart = form.watch('disruption_start');
  const watchTimeDelayAmount = form.watch('time_delay_amount');
  const watchTimeDelayUnit = form.watch('time_delay_unit');

  const onSubmit = async (data: DisruptionFormData) => {
    if (!user || !data.target_id) return;

    if (!projectId || !plantName) {
      toast.error('Please ensure a project and plant are selected');
      return;
    }

    setLoading(true);
    try {
      // Transform targets for new schema
      const targets = [];
      if (data.target_type === 'node') {
        targets.push({
          target_type: 'node',
          node_ids: [data.target_id]
        });
      } else if (data.target_type === 'edge') {
        // Find the selected edge or parse manual input
        const selectedEdge = connectedEdges.find(edge => edge.id === data.target_id);
        let fromNode: string | undefined;
        let toNode: string | undefined;
        if (selectedEdge) {
          fromNode = selectedEdge.source;
          toNode = selectedEdge.target;
        } else if (data.target_id.includes('->')) {
          const parts = data.target_id.split('->').map(s => s.trim());
          if (parts.length === 2) {
            fromNode = parts[0];
            toNode = parts[1];
          }
        }
        if (fromNode && toNode) {
          targets.push({
            target_type: 'edge',
            edges: [{ from_node: fromNode, to_node: toNode }]
          });
        } else {
          toast.error('Please provide a valid edge in from->to format');
          setLoading(false);
          return;
        }
      }

      // Transform effects for new schema
      const effects = [];
      if (data.disruption_type === 'capacity_reduction') {
        const magnitude = data.capacity_unit === 'percent' 
          ? data.capacity_reduction_percent || 0
          : data.capacity_reduction_amount || 0;
        const unit = data.capacity_unit === 'percent' ? 'percent' : 'units';
        
        effects.push({
          effect_type: 'capacity_reduction',
          magnitude,
          unit
        });
      }

      if (data.disruption_type === 'time_delay') {
        const magnitude = data.time_delay_amount || 0;
        const unit = data.time_delay_unit || 'days';
        
        effects.push({
          effect_type: 'time_delay',
          magnitude,
          unit
        });
      }

      const { error } = await supabase.rpc('create_disruption_scenario_v2', {
        p_project_id: projectId,
        p_plant_name: plantName,
        p_scenario_name: data.scenario_name,
        p_user_id: user.id,
        p_user_email: user.email,
        p_status: 'draft',
        p_description: data.description || `${data.disruption_type} on ${data.target_type}: ${data.target_id}`,
        p_tags: [],
        p_targets: targets,
        p_effects: effects,
        p_settings: null,
        p_disruption_start: data.disruption_start ? data.disruption_start.toISOString().split('T')[0] : null,
        p_disruption_end: data.disruption_end ? data.disruption_end.toISOString().split('T')[0] : null,
      });

      if (error) throw error;

      const now = new Date();
      const dStart = data.disruption_start ?? new Date(Date.now() + 7 * 86400000);
      const dEnd   = data.disruption_end   ?? new Date(dStart.getTime() + 42 * 86400000);
      const startDay     = Math.max(1, Math.ceil((dStart.getTime() - now.getTime()) / 86400000));
      const durationDays = Math.max(7, Math.ceil((dEnd.getTime() - dStart.getTime()) / 86400000));
      const magnitude    = Number(
        data.disruption_type === 'capacity_reduction'
          ? (data.capacity_unit === 'percent' ? data.capacity_reduction_percent : data.capacity_reduction_amount)
          : data.time_delay_amount
      ) || 80;

      const scenario = await createFromNode(projectId, data.target_id, 'node', magnitude, durationDays, startDay);

      form.reset();
      onOpenChange(false);
      onSuccess?.();

      if (scenario?.id) {
        toast.success('Disruption scenario created', {
          action: {
            label: 'Open in Simulation Lab',
            onClick: () => navigate(`/simulation-lab?scenario_id=${scenario.id}&pane=recovery`),
          },
        });
      } else {
        toast.success('Disruption scenario created. Open the Simulation page to run scenarios.');
      }
    } catch (error) {
      console.error('Error creating disruption scenario:', error);
      toast.error('Failed to create disruption scenario');
    } finally {
      setLoading(false);
    }
  };

  // Fetch project data when component opens
  useEffect(() => {
    if (open && projectId) {
      const fetchProjectData = async () => {
        try {
          const { data, error } = await supabase
            .from('projects')
            .select('simulation_start, simulation_end')
            .eq('id', projectId)
            .single();
          
          if (error) throw error;
          setProjectData(data);
        } catch (error) {
          console.error('Error fetching project data:', error);
        }
      };
      fetchProjectData();
    }
  }, [open, projectId]);

  // Update target_id when nodeId changes or target_type changes
  useEffect(() => {
    if (nodeId && watchTargetType === 'node') {
      form.setValue('target_id', nodeId);
    }
  }, [nodeId, watchTargetType, form]);

  // Auto-calculate end date for time delay disruptions
  useEffect(() => {
    if (watchDisruptionType === 'time_delay' && watchDisruptionStart && watchTimeDelayAmount && watchTimeDelayUnit) {
      const startDate = new Date(watchDisruptionStart);
      const endDate = new Date(startDate);
      
      if (watchTimeDelayUnit === 'days') {
        endDate.setDate(startDate.getDate() + watchTimeDelayAmount);
      } else if (watchTimeDelayUnit === 'weeks') {
        endDate.setDate(startDate.getDate() + (watchTimeDelayAmount * 7));
      }
      
      form.setValue('disruption_end', endDate);
    }
  }, [watchDisruptionType, watchDisruptionStart, watchTimeDelayAmount, watchTimeDelayUnit, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Disruption Scenario</DialogTitle>
          <DialogDescription>
            Configure a disruption scenario for the selected network element. 
            Define the target, type, and parameters to simulate supply chain disruptions.
            Once saved, you can run simulations on the <strong>Simulation page</strong>.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="scenario_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Scenario Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Major Supplier Outage" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />


            <FormField
              control={form.control}
              name="target_type"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Disruption Target</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex flex-col space-y-1"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="node" id="target-node" />
                        <Label htmlFor="target-node">
                          {nodeId ? `Single Node (Selected: ${nodeId})` : 'Single Node'}
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="edge" id="target-edge" />
                        <Label htmlFor="target-edge">
                          {nodeId ? `Single Edge (Connected to ${nodeId})` : 'Single Edge'}
                        </Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchTargetType === 'node' && !nodeId && (
              <FormField
                control={form.control}
                name="target_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Node ID</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., S1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {watchTargetType === 'edge' && (
              connectedEdges.length > 0 ? (
                <FormField
                  control={form.control}
                  name="target_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Select Edge</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose an edge" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {connectedEdges.map((edge) => (
                            <SelectItem key={edge.id} value={edge.id}>
                              {edge.source} → {edge.target}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="target_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Edge (from→to)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., S1->M1" {...field} />
                      </FormControl>
                      <FormDescription>Use format from→to</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )
            )}

            <FormField
              control={form.control}
              name="disruption_type"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Disruption Type</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex flex-col space-y-1"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="capacity_reduction" id="capacity" />
                        <Label htmlFor="capacity">Capacity Reduction</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="time_delay" id="delay" />
                        <Label htmlFor="delay">Time Delay</Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchDisruptionType === 'capacity_reduction' && (
              <>
                <FormField
                  control={form.control}
                  name="capacity_unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Capacity Reduction Unit</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="percent">Percentage (%)</SelectItem>
                          <SelectItem value="numeric">Numeric Value</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {watchCapacityUnit === 'percent' ? (
                  <FormField
                    control={form.control}
                    name="capacity_reduction_percent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Capacity Reduction (%)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            min="0" 
                            max="100" 
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>
                          Percentage reduction in capacity (0-100%)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name="capacity_reduction_amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Capacity Reduction Amount</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            min="0" 
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                          />
                        </FormControl>
                        <FormDescription>
                          Numeric reduction in capacity units
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </>
            )}

            {watchDisruptionType === 'time_delay' && (
              <>
                <FormField
                  control={form.control}
                  name="time_delay_amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delay Duration</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          min="0" 
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="time_delay_unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Time Unit</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="days">Days</SelectItem>
                          <SelectItem value="weeks">Weeks</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {/* Disruption Event Dates */}
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="disruption_start"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Disruption Event Start</FormLabel>
                    <FormControl>
                      <StepwiseDatePicker
                        date={field.value}
                        onSelect={field.onChange}
                        placeholder="Start date"
                        disabled={(d) => {
                          if (!projectData) return false;
                          const fallbackDates = getFallbackSimulationDates(projectData.simulation_start, projectData.simulation_end);
                          if (d < fallbackDates.start) return true;
                          if (d > fallbackDates.end) return true;
                          return false;
                        }}
                      />
                    </FormControl>
                    {projectData && (
                      <FormDescription>
                        Must be within simulation period: {(() => {
                          const fallbackDates = getFallbackSimulationDates(projectData.simulation_start, projectData.simulation_end);
                          return `${fallbackDates.start.toLocaleDateString()} - ${fallbackDates.end.toLocaleDateString()}`;
                        })()}{!projectData.simulation_start || !projectData.simulation_end ? ' (using current year defaults)' : ''}
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchDisruptionType === 'capacity_reduction' && (
                <FormField
                  control={form.control}
                  name="disruption_end"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Disruption Event End</FormLabel>
                      <FormControl>
                        <StepwiseDatePicker
                          date={field.value}
                          onSelect={field.onChange}
                          placeholder="End date"
                          disabled={(d) => {
                            const start = form.getValues('disruption_start');
                            if (start && d < start) return true;
                            if (!projectData) return false;
                            const fallbackDates = getFallbackSimulationDates(projectData.simulation_start, projectData.simulation_end);
                            if (d < fallbackDates.start) return true;
                            if (d > fallbackDates.end) return true;
                            return false;
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {watchDisruptionType === 'time_delay' && watchDisruptionStart && (
                <div className="text-sm text-muted-foreground p-3 bg-muted rounded-md">
                  <strong>Auto-calculated End Date:</strong> {
                    (() => {
                      if (!watchTimeDelayAmount || !watchTimeDelayUnit) return 'Set delay duration first';
                      const startDate = new Date(watchDisruptionStart);
                      const endDate = new Date(startDate);
                      if (watchTimeDelayUnit === 'days') {
                        endDate.setDate(startDate.getDate() + watchTimeDelayAmount);
                      } else if (watchTimeDelayUnit === 'weeks') {
                        endDate.setDate(startDate.getDate() + (watchTimeDelayAmount * 7));
                      }
                      return endDate.toLocaleDateString();
                    })()
                  }
                </div>
              )}
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Additional details about this scenario..."
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create Scenario'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}