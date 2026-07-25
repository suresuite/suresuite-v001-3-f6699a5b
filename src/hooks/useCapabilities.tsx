import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { UserRole } from '@/hooks/useUserRole';
import {
  checkBudget as checkBudgetPure,
  homePathFor,
  isModelAllowed as isModelAllowedPure,
  normalizeCapabilities,
  pageKeyForPath,
  roleFallbackCapabilities,
  type EffectiveCapabilities,
  type FeatureKey,
  type ModelGateResult,
} from '@/lib/capabilities';

interface CapabilitiesContextValue {
  /** Resolved set — server-provided when available, role fallback otherwise. */
  capabilities: EffectiveCapabilities | null;
  /** True until the first server fetch resolves (or fails). */
  loading: boolean;
  /** True while gating from the role fallback rather than the server set. */
  usingFallback: boolean;
  refresh: () => Promise<void>;
  /** Page or feature grant by key. */
  can: (key: FeatureKey | string) => boolean;
  canFeature: (key: FeatureKey) => boolean;
  canAccessPage: (pathname: string) => boolean;
  /** First landing route this user may actually open (post-login, "go home"). */
  homePath: string;
  isModelAllowed: (clientModelId: string) => ModelGateResult;
  checkBudget: () => ModelGateResult;
  allowedModelCodes: string[];
  allModelsAllowed: boolean;
}

const CapabilitiesContext = createContext<CapabilitiesContextValue | undefined>(undefined);

export const CapabilitiesProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [serverCaps, setServerCaps] = useState<EffectiveCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const lastUserId = useRef<string | null>(null);

  const load = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc('get_my_capabilities', { _user_id: userId });
      if (error) throw error;
      const normalized = normalizeCapabilities(data);
      // Ignore a resolve that arrives after the user switched away.
      if (lastUserId.current === userId) setServerCaps(normalized);
    } catch (e) {
      console.warn('[capabilities] fetch failed, using role fallback:', e);
      if (lastUserId.current === userId) setServerCaps(null);
    } finally {
      if (lastUserId.current === userId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = user?.id ?? null;
    lastUserId.current = id;
    setServerCaps(null);
    if (id) {
      load(id);
    } else {
      setLoading(false);
    }
  }, [user?.id, load]);

  const refresh = useCallback(async () => {
    if (user?.id) await load(user.id);
  }, [user?.id, load]);

  // Role fallback keeps gating working instantly (and if the fetch fails).
  const capabilities: EffectiveCapabilities | null = useMemo(() => {
    if (serverCaps) return serverCaps;
    if (user) return roleFallbackCapabilities(user.role as UserRole);
    return null;
  }, [serverCaps, user]);

  const value: CapabilitiesContextValue = useMemo(() => {
    const canFeature = (key: FeatureKey): boolean => {
      if (!capabilities) return false;
      return capabilities.features[key] ?? capabilities.is_super_admin;
    };
    const can = (key: FeatureKey | string): boolean => {
      if (!capabilities) return false;
      if (key in capabilities.pages) return capabilities.pages[key];
      return capabilities.features[key] ?? capabilities.is_super_admin;
    };
    const canAccessPage = (pathname: string): boolean => {
      if (!capabilities) return false;
      const key = pageKeyForPath(pathname);
      if (!key) return true; // unmanaged route (e.g. /help) — open
      return capabilities.pages[key] ?? false;
    };
    return {
      capabilities,
      loading,
      usingFallback: !serverCaps,
      refresh,
      can,
      canFeature,
      canAccessPage,
      homePath: homePathFor(capabilities),
      isModelAllowed: (id: string) =>
        capabilities ? isModelAllowedPure(capabilities, id) : { ok: true },
      checkBudget: () => (capabilities ? checkBudgetPure(capabilities) : { ok: true }),
      allowedModelCodes: capabilities?.models.allowed_codes ?? [],
      allModelsAllowed: capabilities?.models.all_allowed ?? true,
    };
  }, [capabilities, loading, serverCaps, refresh]);

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
};

export const useCapabilities = (): CapabilitiesContextValue => {
  const ctx = useContext(CapabilitiesContext);
  if (ctx === undefined) {
    throw new Error('useCapabilities must be used within a CapabilitiesProvider');
  }
  return ctx;
};
