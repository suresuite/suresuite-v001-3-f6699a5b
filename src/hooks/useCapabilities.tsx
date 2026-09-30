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
import {
  canReadAnySection,
  canReadDocsPath,
  canReadSection,
  docsReaderLevel,
  hasPublicSection,
  isDocsPath,
  type DocsAudience,
  type DocsReleases,
} from '@/lib/ui/docsVisibility';
import { fetchDocsReleases } from '@/lib/docs/docsReleasesApi';

/** Who may read which part of the manual — see `docsVisibility.ts`. */
export interface DocsAccess {
  /** section key → audience; null until read, and while unreadable (fail closed). */
  releases: DocsReleases | null;
  /** True until the first read of the releases resolves (or fails). */
  loading: boolean;
  /** The highest audience this reader may see. */
  level: DocsAudience;
  canReadSection: (sectionKey: string) => boolean;
  /** At least one section is open to this reader — the manual's front door. */
  anyReadable: boolean;
  /** At least one section is public — the public site's Docs links follow it. */
  anyPublic: boolean;
  refresh: () => Promise<void>;
}

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
  docs: DocsAccess;
}

const CapabilitiesContext = createContext<CapabilitiesContextValue | undefined>(undefined);

export const CapabilitiesProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [serverCaps, setServerCaps] = useState<EffectiveCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const lastUserId = useRef<string | null>(null);
  const [docsReleases, setDocsReleases] = useState<DocsReleases | null>(null);
  const [docsLoading, setDocsLoading] = useState(true);

  // Read for everyone, signed in or not: a public section must render before
  // sign-in. A failed read leaves `null`, which every rule reads as
  // confidential — the manual closes rather than opens.
  const refreshDocs = useCallback(async () => {
    try {
      setDocsReleases(await fetchDocsReleases());
    } catch (e) {
      console.warn('[docs] section releases could not be read; every section is confidential:', e);
      setDocsReleases(null);
    } finally {
      setDocsLoading(false);
    }
  }, []);
  useEffect(() => {
    refreshDocs();
  }, [refreshDocs]);

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
    const docsLevel = docsReaderLevel({
      signedIn: Boolean(user),
      isSuperAdmin: capabilities?.is_super_admin ?? false,
      hasConfidentialGrant: capabilities ? canFeature('docs_confidential') : false,
    });
    const docs: DocsAccess = {
      releases: docsReleases,
      loading: docsLoading,
      level: docsLevel,
      canReadSection: (sectionKey: string) => canReadSection(docsReleases, sectionKey, docsLevel),
      anyReadable: canReadAnySection(docsReleases, docsLevel),
      anyPublic: hasPublicSection(docsReleases),
      refresh: refreshDocs,
    };
    const canAccessPage = (pathname: string): boolean => {
      // The manual has no page capability of its own: each SECTION has an
      // audience a super admin sets (docsVisibility.ts). Decided before the
      // signed-in check, because a public section is open to nobody-in-particular.
      if (isDocsPath(pathname)) return canReadDocsPath(pathname, docsReleases, docsLevel);
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
      docs,
    };
  }, [capabilities, loading, serverCaps, refresh, user, docsReleases, docsLoading, refreshDocs]);

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
};

export const useCapabilities = (): CapabilitiesContextValue => {
  const ctx = useContext(CapabilitiesContext);
  if (ctx === undefined) {
    throw new Error('useCapabilities must be used within a CapabilitiesProvider');
  }
  return ctx;
};
