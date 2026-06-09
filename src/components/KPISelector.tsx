import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { DEFAULT_KPI_CONFIGS, KPI_PRESETS } from '@/types/simulation';
import { cn } from '@/lib/utils';

interface KPISelectorProps {
  availableKPIs: string[];
  selectedKPIs: string[];
  onSelectionChange: (kpis: string[]) => void;
}

export function KPISelector({ availableKPIs, selectedKPIs, onSelectionChange }: KPISelectorProps) {
  const [open, setOpen] = React.useState(false);

  const handleKPIToggle = (kpiId: string) => {
    if (selectedKPIs.includes(kpiId)) {
      onSelectionChange(selectedKPIs.filter(id => id !== kpiId));
    } else {
      onSelectionChange([...selectedKPIs, kpiId]);
    }
  };

  const handlePresetSelect = (presetName: string) => {
    const presetKPIs = KPI_PRESETS[presetName as keyof typeof KPI_PRESETS].filter(
      kpi => availableKPIs.includes(kpi)
    );
    onSelectionChange(presetKPIs);
    setOpen(false);
  };

  const clearAll = () => {
    onSelectionChange([]);
  };

  const selectAll = () => {
    onSelectionChange(availableKPIs);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Select KPIs to Display</h3>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Clear All
          </Button>
          <Button variant="ghost" size="sm" onClick={selectAll}>
            Select All
          </Button>
        </div>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            {selectedKPIs.length === 0
              ? "Select KPIs..."
              : `${selectedKPIs.length} KPI${selectedKPIs.length === 1 ? '' : 's'} selected`}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <div className="p-3 space-y-3">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Quick Presets</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(KPI_PRESETS).map(([presetName, presetKPIs]) => (
                  <Button
                    key={presetName}
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs capitalize"
                    onClick={() => handlePresetSelect(presetName)}
                  >
                    {presetName}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Available KPIs</div>
              <div className="space-y-1">
                {availableKPIs.map((kpiId) => {
                  const config = DEFAULT_KPI_CONFIGS[kpiId];
                  const isSelected = selectedKPIs.includes(kpiId);
                  
                  return (
                    <div
                      key={kpiId}
                      className={cn(
                        "flex items-center space-x-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent",
                        isSelected && "bg-accent"
                      )}
                      onClick={() => handleKPIToggle(kpiId)}
                    >
                      <div className="flex items-center justify-center h-4 w-4 border rounded-sm">
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{config?.name || kpiId}</div>
                        <div className="text-xs text-muted-foreground">
                          {config?.description || `${kpiId} metric`}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {config?.category || 'other'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {selectedKPIs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedKPIs.map((kpiId) => {
            const config = DEFAULT_KPI_CONFIGS[kpiId];
            return (
              <Badge
                key={kpiId}
                variant="secondary"
                className="text-xs cursor-pointer hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleKPIToggle(kpiId)}
              >
                {config?.name || kpiId}
                <span className="ml-1">×</span>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}