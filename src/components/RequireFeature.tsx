import { type ReactNode } from 'react';
import { useCapabilities } from '@/hooks/useCapabilities';
import type { FeatureKey } from '@/lib/capabilities';

interface RequireFeatureProps {
  feature: FeatureKey;
  children: ReactNode;
  /** Rendered instead of children when the feature is not granted. */
  fallback?: ReactNode;
}

/**
 * Feature-level gate. Renders children only when the logged-in user's effective
 * capability set grants `feature`; otherwise renders `fallback` (nothing by
 * default). Use for AI, Simulation, export, etc. buttons and panels.
 *
 *   <RequireFeature feature="ai_chat"><AskAiButton /></RequireFeature>
 */
export function RequireFeature({ feature, children, fallback = null }: RequireFeatureProps) {
  const { canFeature } = useCapabilities();
  return <>{canFeature(feature) ? children : fallback}</>;
}

export default RequireFeature;
