import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, Edit, AlertTriangle, Clock, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DisruptionScenario {
  id: string;
  scenario_name: string;
  description?: string;
  status: string;
  created_at: string;
  disruption_start?: string;
  disruption_end?: string;
  effects: {
    effect_type: string;
    magnitude: number;
    unit: string;
  }[];
}

const getEffectTypeDisplay = (effectType: string): string => {
  switch (effectType) {
    case 'time_delay': return 'Time Delay';
    case 'capacity_reduction': return 'Capacity Reduction';
    default: return 'Unknown Effect';
  }
};

interface ScenarioImpactSliderProps {
  scenario: DisruptionScenario;
  isSelected: boolean;
  onToggleSelect: (scenarioId: string) => void;
  onMagnitudeChange: (scenarioId: string, magnitude: number) => void;
  onDelete?: (scenarioId: string) => void;
  onEdit?: (scenarioId: string) => void;
  showActions?: boolean;
  className?: string;
}

export function ScenarioImpactSlider({
  scenario,
  isSelected,
  onToggleSelect,
  onMagnitudeChange,
  onDelete,
  onEdit,
  showActions = false,
  className
}: ScenarioImpactSliderProps) {
  const primaryEffect = scenario.effects?.[0];
  const currentMagnitude = primaryEffect?.magnitude || 0;

  return (
    <Card 
      className={cn(
        "cursor-pointer transition-all duration-200",
        isSelected 
          ? "ring-2 ring-primary border-primary shadow-md" 
          : "hover:shadow-sm border-border",
        className
      )}
      onClick={() => onToggleSelect(scenario.id)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-semibold truncate">
              {scenario.scenario_name}
            </CardTitle>
            
            {/* Disruption Type Badge */}
            {primaryEffect && (
              <div className="flex justify-start mt-2">
                <Badge 
                  variant="outline" 
                  className="flex items-center gap-1 text-xs bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800"
                >
                  {primaryEffect.effect_type === 'time_delay' ? (
                    <>
                      <Clock className="h-3 w-3" /> Time delay
                    </>
                  ) : (
                    <>
                      <TrendingDown className="h-3 w-3" /> Capacity Reduction
                    </>
                  )}
                </Badge>
              </div>
            )}
          </div>
          
          {showActions && (
            <div className="flex items-center space-x-1 ml-2 flex-shrink-0">
              {onEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(scenario.id);
                  }}
                  className="h-6 w-6 p-0"
                >
                  <Edit className="h-3 w-3" />
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(scenario.id);
                  }}
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {primaryEffect && (
          <div className="space-y-4">
            {/* Impact Level Display and Slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {primaryEffect.effect_type === 'time_delay' ? 'Delay Duration' : 'Impact Level'}
                </span>
                <span className="font-medium">
                  {primaryEffect.effect_type === 'time_delay' 
                    ? `${currentMagnitude} ${primaryEffect.unit || 'days'}`
                    : `${currentMagnitude.toFixed(1)}${primaryEffect.unit === 'percent' ? '%' : ' units'}`
                  }
                </span>
              </div>
              
              <div 
                className="px-1"
                onClick={(e) => e.stopPropagation()}
              >
                <Slider
                  value={[currentMagnitude]}
                  onValueChange={(value) => onMagnitudeChange(scenario.id, value[0])}
                  max={(() => {
                    if (primaryEffect.effect_type === 'time_delay') {
                      return primaryEffect.unit === 'weeks' ? 26 : 100; // 26 weeks or 100 days
                    }
                    return primaryEffect.unit === 'percent' ? 100 : 1000;
                  })()}
                  min={0}
                  step={(() => {
                    if (primaryEffect.effect_type === 'capacity_reduction' && primaryEffect.unit === 'percent') {
                      return 5; // 5% increments for capacity reduction
                    }
                    return primaryEffect.effect_type === 'time_delay' ? 1 : 1;
                  })()}
                  className="w-full"
                />
              </div>
            </div>
            
            {/* Additional Effect Information */}
            <div className="pt-3 border-t border-border/50">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Type:</span>
                  <div className="font-medium">{getEffectTypeDisplay(primaryEffect.effect_type)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Unit:</span>
                  <div className="font-medium">{primaryEffect.unit || 'N/A'}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Timing Information */}
        {scenario.disruption_start && scenario.disruption_end && (
          <div className="mt-4 pt-3 border-t border-border/50">
            <div className="text-xs font-medium text-muted-foreground mb-2">Disruption Period</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="px-2 py-1 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 rounded font-medium">
                Start: {new Date(scenario.disruption_start).toLocaleDateString()}
              </div>
              <div className="px-2 py-1 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 rounded font-medium">
                End: {new Date(scenario.disruption_end).toLocaleDateString()}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}