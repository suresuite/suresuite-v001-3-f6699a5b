import { CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type CombineStatus = 'pending' | 'running' | 'completed' | 'failed';

export function getCombineStatusStyle(status: CombineStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-muted text-muted-foreground';
    case 'running':
      return 'bg-primary text-primary-foreground';
    case 'completed':
      return 'bg-success text-success-foreground';
    case 'failed':
      return 'bg-destructive text-destructive-foreground';
    default:
      return 'bg-muted text-muted-foreground';
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