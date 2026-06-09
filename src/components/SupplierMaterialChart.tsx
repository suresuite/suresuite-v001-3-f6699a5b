import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatNumber } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  TooltipProps,
} from "recharts";
import { useState } from "react";

interface SupplierMaterialCount {
  supplier: string;
  count: number;
}

interface SupplierMaterialChartProps {
  data: SupplierMaterialCount[];
  supplierDiversity: string;
  singleSourceRisk: string;
  sidebarCollapsed: boolean;
}

const SupplierMaterialChart = ({
  data,
  supplierDiversity,
  singleSourceRisk,
  sidebarCollapsed,
}: SupplierMaterialChartProps) => {
  const sortedData = [...data].sort((a, b) => b.count - a.count);
  const [labelDensity, setLabelDensity] = useState<"smart" | "all">("smart");
  const barCategoryGap = sidebarCollapsed ? 10 : 20;
  const barSize = sidebarCollapsed ? 32 : 24;

  const renderTick = ({ x, y, payload }: any) => {
    const name: string = payload.value;
    const truncated = name.length > 10 ? `${name.slice(0, 10)}…` : name;
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={16}
          textAnchor={labelDensity === "all" ? "end" : "middle"}
          transform={labelDensity === "all" ? "rotate(-45)" : undefined}
          fill="hsl(var(--gray-600))"
          fontSize={11}
          
          className="transition-all duration-200"
        >
          {truncated}
        </text>
      </g>
    );
  };

  const CustomTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const value = payload[0].value as number;
    return (
      <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-muted-foreground">{formatNumber(value)} materials</p>
      </div>
    );
  };

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-medium">Material Count per Supplier</h3>
        <p className="text-sm text-muted-foreground">
          Number of materials supplied by each supplier
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-6">
        <div className="sm:w-3/4 w-full h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={sortedData}
              barCategoryGap={barCategoryGap}
              margin={{ top: 10, right: 30, left: 0, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--gray-200))"
                vertical={false}
                opacity={0.5}
              />
              <XAxis
                dataKey="supplier"
                axisLine={false}
                tickLine={false}
                tick={renderTick}
                interval={labelDensity === "all" ? 0 : undefined}
                height={labelDensity === "all" ? 60 : 30}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(var(--gray-600))", fontSize: 11 }}
                tickFormatter={formatNumber}
                dx={-10}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--foreground) / 0.04)" }}
                content={<CustomTooltip />}
              />
              <Bar
                dataKey="count"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
                barSize={barSize}
                name="Materials"
                animationDuration={200}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-col justify-between sm:w-1/4 w-full mt-4 sm:mt-0">
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Supplier Diversity</p>
              <p className="text-xl font-semibold">{supplierDiversity}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Single Source Risk</p>
              <p className="text-xl font-semibold">{singleSourceRisk}</p>
            </div>
          </div>
          <div className="mt-4">
            <Label className="text-xs text-muted-foreground mb-2">Label Density</Label>
            <RadioGroup
              value={labelDensity}
              onValueChange={(value) => setLabelDensity(value as "smart" | "all")}
              className="flex items-center gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="smart" id="material-smart" />
                <label htmlFor="material-smart" className="text-sm">
                  Smart
                </label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="all" id="material-all" />
                <label htmlFor="material-all" className="text-sm">
                  All
                </label>
              </div>
            </RadioGroup>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default SupplierMaterialChart;
