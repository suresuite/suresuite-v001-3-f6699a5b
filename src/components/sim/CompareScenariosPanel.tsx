import { Card, CardContent } from "@/components/ui/card";

export function CompareScenariosPanel() {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">
          <strong>Compare</strong> — select multiple scenarios to see paired-t comparisons, tornado charts,
          and Pareto frontiers. Coming in the next iteration.
        </p>
      </CardContent>
    </Card>
  );
}
