import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DEFAULT_KPI_CONFIGS, KPIData } from '@/types/simulation';

interface SimulationResultsChartProps {
  baselineData: KPIData;
  scenarioData: KPIData;
  simulationPeriod?: { start_week: number; end_week: number } | { start_day: number; end_day: number };
}

interface ExtendedSimulationResultsChartProps extends SimulationResultsChartProps {
  showBaseline?: boolean;
}

export function SimulationResultsChart({
  baselineData,
  scenarioData,
  simulationPeriod,
  showBaseline = true
}: ExtendedSimulationResultsChartProps) {
  const [selectedKPI, setSelectedKPI] = React.useState<string>('fill_rate'); // Default to one KPI

  // Debug: log incoming series status
  React.useEffect(() => {
    const b = baselineData?.[selectedKPI] || [];
    const s = scenarioData?.[selectedKPI] || [];
    // Keep logs lightweight
    console.debug('[Chart] KPI:', selectedKPI, 'baseline len:', b.length, 'scenario len:', s.length, 'sample baseline:', b[0], 'sample scenario:', s[0]);
  }, [baselineData, scenarioData, selectedKPI]);

  // Prepare chart data
  const chartData = React.useMemo(() => {
    const selectedBaselineData = baselineData[selectedKPI] || [];
    const selectedScenarioData = scenarioData[selectedKPI] || [];
    
    if (selectedBaselineData.length === 0 && selectedScenarioData.length === 0) {
      return [];
    }
    
    // Get all unique time points from both baseline and scenario data
    const allTimePoints = new Set<number>();
    
    selectedBaselineData.forEach((point: any) => {
      allTimePoints.add(point.week ?? point.day ?? 0);
    });
    
    selectedScenarioData.forEach((point: any) => {
      allTimePoints.add(point.week ?? point.day ?? 0);
    });
    
    // Convert to sorted array and filter to show only week 8 onward
    const sortedTimePoints = Array.from(allTimePoints)
      .sort((a, b) => a - b)
      .filter(timePoint => timePoint >= 8);
    
    return sortedTimePoints.map(timePoint => {
      const dataPoint: any = { week: timePoint };
      
      const baselinePoint = selectedBaselineData.find((p: any) => 
        (p.week ?? p.day ?? 0) === timePoint
      );
      const scenarioPoint = selectedScenarioData.find((p: any) => 
        (p.week ?? p.day ?? 0) === timePoint
      );
      
      dataPoint[`${selectedKPI}_baseline`] = baselinePoint?.value ?? null;
      dataPoint[`${selectedKPI}_scenario`] = scenarioPoint?.value ?? null;
      
      return dataPoint;
    });
  }, [baselineData, scenarioData, selectedKPI]);

  const handleKPIChange = (kpiId: string) => {
    setSelectedKPI(kpiId);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const config = DEFAULT_KPI_CONFIGS[selectedKPI];
      
      return (
        <div className="bg-background p-3 rounded-lg border shadow-lg">
          <p className="text-sm text-muted-foreground mb-2">Week {label}</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => {
              const isBaseline = entry.dataKey.includes('baseline');
              
              // Skip baseline entries if baseline is hidden
              if (isBaseline && !showBaseline) {
                return null;
              }
              
              const dotColor = isBaseline ? 'hsl(var(--primary))' : 'hsl(var(--destructive))';
              let formattedValue = '';
              
              if (config?.format === 'percentage') {
                formattedValue = `${(entry.value * 100).toFixed(1)}%`;
              } else if (config?.format === 'currency') {
                formattedValue = new Intl.NumberFormat('en-US', { 
                  style: 'currency', 
                  currency: 'USD',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                }).format(entry.value);
              } else {
                formattedValue = new Intl.NumberFormat('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                }).format(entry.value);
              }
              
              return (
                <div key={index} className="flex items-center gap-2">
                  <div 
                    className="w-2 h-2 rounded-full" 
                    style={{ backgroundColor: dotColor }}
                  />
                  <span className="text-sm text-muted-foreground">
                    {isBaseline ? 'Baseline' : 'Scenario'}:
                  </span>
                  <span className="text-sm font-bold">
                    {formattedValue}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Simulation Results Comparison</CardTitle>
          {/* KPI Selection Box */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">KPI:</span>
            <Select value={selectedKPI} onValueChange={handleKPIChange}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DEFAULT_KPI_CONFIGS).map(([kpiId, config]) => (
                  <SelectItem key={kpiId} value={kpiId}>
                    {config.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="1 1" stroke="#e5e7eb" strokeWidth={0.5} />
              <XAxis 
                dataKey="week" 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#6b7280' }}
                tickMargin={8}
                label={{ value: 'Week', position: 'insideBottom', offset: -10 }}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#6b7280' }}
                tickFormatter={(value) => {
                  const config = DEFAULT_KPI_CONFIGS[selectedKPI];
                  if (config?.format === 'percentage') {
                    return `${(value * 100).toFixed(0)}%`;
                  } else if (value >= 1000000) {
                    return `${(value / 1000000).toFixed(0)}M`;
                  } else if (value >= 1000) {
                    return `${(value / 1000).toFixed(0)}k`;
                  }
                  return value.toString();
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              
              {/* Conditionally render baseline and scenario lines */}
              {showBaseline && (
                <Line
                  type="monotone"
                  dataKey={`${selectedKPI}_baseline`}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                  dot={false}
                  name={`${DEFAULT_KPI_CONFIGS[selectedKPI].name} (Baseline)`}
                  connectNulls={true}
                />
              )}
              <Line
                type="monotone"
                dataKey={`${selectedKPI}_scenario`}
                stroke="hsl(var(--destructive))"
                strokeWidth={2.5}
                dot={false}
                name={`${DEFAULT_KPI_CONFIGS[selectedKPI].name} (Scenario)`}
                connectNulls={true}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}