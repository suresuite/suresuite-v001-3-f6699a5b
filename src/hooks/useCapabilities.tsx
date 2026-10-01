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
  capabilitiesReady,
  checkBudget as checkBudgetPure,
  homePathFor,
  isModelAllowed as isModelAllowedPure,
  normalizeCapabilities,
  pageKeyForPath,
  roleFallbackCapabilities,
  serverCapabilitiesFor,
  settleCapabilities,
  type EffectiveCapabilities,
  type FeatureKey,
  type ModelGateResult,
  type ResolvedCapabilities,
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
  /** True while a server read is in flight (the first one, or a refresh). */
  loading: boolean;
  /**
   * True once this user's server set has been read, or the read failed or timed
   * out (then the role fallback governs). Until then the fallback is a guess
   * that knows nothing of org/user overrides, so access decisions wait for it.
   * A refresh does not make it false again.
   */
  ready: boolean;
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

/** A read that has not answered by now stops holding pages on a spinner; the
 *  role fallback governs until it lands, and the real answer still applies. */
const CAPABILITIES_WAIT_MS = 8000;

export const CapabilitiesProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [resolved, setResolved] = useState<ResolvedCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  // Every read takes a number; only the newest may write, so a superseded
  // answer (another user, a sign-out) is dropped rather than applied.
  const seq = useRef(0);
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

  const load = useCallback(async (id: string) => {
    const req = ++seq.current;
    const isCurrent = () => seq.current === req;
    setLoading(true);
    const timer = setTimeout(() => {
      if (isCurrent()) setResolved((prev) => settleCapabilities(prev, id, null));
    }, CAPABILITIES_WAIT_MS);
    let caps: EffectiveCapabilities | null = null;
    try {
      const { data, error } = await (supabase as any).rpc('get_my_capabilities', { _user_id: id });
      if (error) throw error;
      caps = normalizeCapabilities(data);
    } catch (e) {
      console.warn('[capabilities] fetch failed, using role fallback:', e);
    } finally {
      clearTimeout(timer);
    }
    if (!isCurrent()) return;
    // The set and its readiness change in ONE update, so nothing renders a
    // moment of "ready" on the old answer.
    setResolved((prev) => settleCapabilities(prev, id, caps));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (userId) {
      load(userId);
      return;
    }
    // Signed out: drop any read in flight, and forget the answer, so signing
    // back in — even as the same user — waits for a fresh one.
    seq.current++;
    setResolved(null);
    setLoading(false);
  }, [userId, load]);

  const refresh = useCallback(async () => {
    if (userId) await load(userId);
  }, [userId, load]);

  // Keyed by user: a previous user's answer is never this user's, even in the
  // render before the effect above runs.
  const serverCaps = serverCapabilitiesFor(resolved, userId);
  const ready = capabilitiesReady(resolved, userId);

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
      ready,
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
  }, [capabilities, loading, ready, serverCaps, refresh, user, docsReleases, docsLoading, refreshDocs]);

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
};

export const useCapabilities = (): CapabilitiesContextValue => {
  const ctx = useContext(CapabilitiesContext);
  if (ctx === undefined) {
    throw new Error('useCapabilities must be used within a CapabilitiesProvider');
  }
  return ctx;
};
