import { CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type CombineStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * The canonical status recipe (audit C6): a 10% tint, 700-weight ink and a 30%
 * border, rather than a filled block. Pair it with `variant="outline"` — C8
 * has no filled `default` badge in the mature pages.
 */
export function getCombineStatusStyle(status: CombineStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-muted text-muted-foreground border-border';
    case 'running':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30';
    case 'completed':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
    case 'failed':
      return 'bg-destructive/10 text-destructive border-destructive/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function getCombineStatusIcon(status: CombineStatus): LucideIcon {
  switch (status) {
    case 'pending':
      return Clock;
    case 'running':
      return Loader2;
    case 'completed':
      return CheckCircle;
    case 'failed':
      return AlertCircle;
    default:
      return Clock;
  }
}

export function getCombineStatusText(status: CombineStatus): string {
  switch (status) {
    case 'pending':
      return 'Combine Pending';
    case 'running':
      return 'Combining...';
    case 'completed':
      return 'Combined';
    case 'failed':
      return 'Combine Failed';
    default:
      return 'Combine Pending';
  }
}