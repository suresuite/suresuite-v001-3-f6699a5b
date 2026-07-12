import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  emphasis?: boolean;
  over?: boolean;
}

/**
 * Single-source KPI tile used by Platform Overview and per-user budget usage.
 * Keep tokens semantic — no hardcoded colors.
 */
export function StatCard({ label, value, hint, emphasis, over }: StatCardProps) {
  return (
    <Card
      className={cn(
        'shadow-xs',
        emphasis && 'ring-1 ring-primary/15 bg-surface-elevated',
      )}
    >
      <CardContent className="p-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            'mt-1.5 text-[26px] font-semibold leading-none tabular-nums',
            over ? 'text-destructive' : 'text-foreground',
          )}
        >
          {value}
        </div>
        {hint && (
          <div className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
            {hint}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
