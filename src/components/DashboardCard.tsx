import { Card } from "@/components/ui/card";

interface DashboardCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

const DashboardCard = ({ title, value, icon, trend }: DashboardCardProps) => {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div className="text-secondary">{icon}</div>
        {trend && (
          <div
            className={`text-sm ${
              trend.isPositive ? "text-green-500" : "text-red-500"
            }`}
          >
            {trend.isPositive ? "+" : "-"}{trend.value}%
          </div>
        )}
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-medium text-muted-foreground">{title}</h3>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </div>
    </Card>
  );
};

export default DashboardCard;