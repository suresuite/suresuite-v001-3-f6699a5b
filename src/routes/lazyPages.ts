// Every routed page, lazily loaded — and the one place that knows which chunk
// belongs to which URL.
//
// WHY THIS FILE EXISTS
// Phase 1 made all 25 pages lazy, which moved ~1.46 MB gzip off first paint but
// put a spinner in front of the first visit to each page. Phase 2 pays that back
// by prefetching the chunk when the user shows INTENT — hovering a sidebar item,
// touching a tab — so by the time the click lands the chunk is already cached
// and the Suspense fallback never renders.
//
// That only works if the prefetcher calls the SAME `import()` specifier React
// uses, which is why the loaders live here rather than inline in App.tsx. Two
// copies of `import('@/pages/Foo')` in two files would work today and drift
// apart later.

import { lazy } from 'react';

// Each loader is named so `ROUTE_LOADERS` below references a function rather
// than repeating an import specifier that could fall out of sync.
const loadOrbitMrpCallback = () => import('@/pages/OrbitMrpCallback');
const loadDataManager = () => import('@/pages/DataManager');
const loadProductLevelNetwork = () => import('@/pages/ProductLevelNetwork');
const loadProcessLevelNetwork = () => import('@/pages/ProcessLevelNetwork');
const loadFirmLevelNetwork = () => import('@/pages/FirmLevelNetwork');
const loadInteractiveNetworkSpace = () => import('@/pages/InteractiveNetworkSpace');
const loadGettingStarted = () => import('@/pages/GettingStarted');
const loadProjectPolicies = () => import('@/pages/ProjectPolicies');
const loadSimulationLab = () => import('@/pages/SimulationLab');
const loadProjectIntelligence = () => import('@/pages/ProjectIntelligence');
const loadProfile = () => import('@/pages/Profile');
const loadDeveloperApi = () => import('@/pages/DeveloperApi');
const loadForbidden = () => import('@/pages/Forbidden');
const loadNotFound = () => import('@/pages/NotFound');
const loadDocsLayout = () => import('@/components/docs/DocsLayout');
const loadHelpPage = () => import('@/pages/help/HelpPage');
const loadAbout = () => import('@/pages/About');
const loadAdminDashboard = () => import('@/pages/admin/AdminDashboard');
const loadAdminUsers = () => import('@/pages/admin/AdminUsers');
const loadAdminUserAccess = () => import('@/pages/admin/AdminUserAccess');
const loadAdminRoles = () => import('@/pages/admin/AdminRoles');
const loadAdminOrganizations = () => import('@/pages/admin/AdminOrganizations');
const loadAdminProjects = () => import('@/pages/admin/AdminProjects');
const loadAdminModels = () => import('@/pages/admin/AdminModels');
const loadAdminUsage = () => import('@/pages/admin/AdminUsage');
const loadAdminAudit = () => import('@/pages/admin/AdminAudit');

export const OrbitMrpCallback = lazy(loadOrbitMrpCallback);
export const DataManager = lazy(loadDataManager);
export const ProductLevelNetwork = lazy(loadProductLevelNetwork);
export const ProcessLevelNetwork = lazy(loadProcessLevelNetwork);
export const FirmLevelNetwork = lazy(loadFirmLevelNetwork);
export const InteractiveNetworkSpace = lazy(loadInteractiveNetworkSpace);
export const GettingStarted = lazy(loadGettingStarted);
export const ProjectPolicies = lazy(loadProjectPolicies);
export const SimulationLab = lazy(loadSimulationLab);
export const ProjectIntelligence = lazy(loadProjectIntelligence);
export const Profile = lazy(loadProfile);
export const DeveloperApi = lazy(loadDeveloperApi);
export const Forbidden = lazy(loadForbidden);
export const NotFound = lazy(loadNotFound);
export const DocsLayout = lazy(loadDocsLayout);
export const HelpPage = lazy(loadHelpPage);
export const About = lazy(loadAbout);
export const AdminDashboard = lazy(loadAdminDashboard);
export const AdminUsers = lazy(loadAdminUsers);
export const AdminUserAccess = lazy(loadAdminUserAccess);
export const AdminRoles = lazy(loadAdminRoles);
export const AdminOrganizations = lazy(loadAdminOrganizations);
export const AdminProjects = lazy(loadAdminProjects);
export const AdminModels = lazy(loadAdminModels);
export const AdminUsage = lazy(loadAdminUsage);
export const AdminAudit = lazy(loadAdminAudit);

/** URL → the chunk(s) that URL needs. Keyed by the `to` values in
 *  `NAV_SECTIONS` (Navbar.tsx) and `TABS` (MobileNav.tsx), since navigation is
 *  where intent shows up. `/help` needs two: its layout and its first page. */
const ROUTE_LOADERS: Record<string, Array<() => Promise<unknown>>> = {
  '/app': [loadGettingStarted],
  '/project-manager': [loadDataManager],
  '/network/product-level': [loadProductLevelNetwork],
  '/network/process-level': [loadProcessLevelNetwork],
  '/network/firm-level': [loadFirmLevelNetwork],
  '/network/interactive-space': [loadInteractiveNetworkSpace],
  '/policies': [loadProjectPolicies],
  '/simulation-lab': [loadSimulationLab],
  '/project-intelligence': [loadProjectIntelligence],
  '/developer': [loadDeveloperApi],
  '/profile': [loadProfile],
  '/about': [loadAbout],
  '/help': [loadDocsLayout, loadHelpPage],
  '/admin': [loadAdminDashboard],
  '/admin/users': [loadAdminUsers],
  '/admin/roles': [loadAdminRoles],
  '/admin/organizations': [loadAdminOrganizations],
  '/admin/projects': [loadAdminProjects],
  '/admin/models': [loadAdminModels],
  '/admin/usage': [loadAdminUsage],
  '/admin/audit': [loadAdminAudit],
  '/integrations/orbit-mrp/callback': [loadOrbitMrpCallback],
  '/forbidden': [loadForbidden],
};

/** Speculative work is not free on a metered or slow connection: it is the
 *  user's data spent on a page they may never open. Where the browser tells us
 *  (Chrome, Edge, Android), honour it; where it does not (Safari, Firefox),
 *  prefetching a single route chunk on a deliberate hover is the better bet. */
function connectionAllowsPrefetch(): boolean {
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!conn) return true;
  if (conn.saveData) return false;
  return conn.effectiveType !== '2g' && conn.effectiveType !== 'slow-2g';
}

// One attempt per path per page load. A failed prefetch is forgotten rather
// than retried on every hover — React.lazy will surface the real error at
// navigation time if the chunk is genuinely unreachable.
const attempted = new Set<string>();

/**
 * Warm the chunk(s) behind a URL. Safe to call on every hover and touch: it
 * dedupes, it is a no-op for an unknown path, and a rejection is swallowed
 * because nothing is waiting on it.
 */
export function prefetchRoute(path: string): void {
  if (attempted.has(path)) return;
  const loaders = ROUTE_LOADERS[path];
  if (!loaders || !connectionAllowsPrefetch()) return;

  attempted.add(path);
  for (const load of loaders) {
    load().catch(() => {
      attempted.delete(path);
    });
  }
}
