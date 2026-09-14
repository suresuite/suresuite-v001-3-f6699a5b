import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useState } from 'react';
import { AuthProvider } from '@/hooks/useAuth';
import { CapabilitiesProvider } from '@/hooks/useCapabilities';
import { GlobalProjectProvider } from '@/hooks/useGlobalProject';
import { ViewportProvider } from '@/hooks/useViewport';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import ProtectedRoute from '@/components/ProtectedRoute';
import RoleGuard from '@/components/RoleGuard';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';
import { PageLayout } from '@/components/shared/PageLayout';

// Renders on every route, but never in the first frame that matters — so the
// chat tree and its dependencies come after the page, not with it.
const FloatingChatBubble = lazy(() =>
  import('@/components/chat/FloatingChatBubble').then((m) => ({ default: m.FloatingChatBubble })),
);

// The two unauthenticated entry points stay eager. Everything else is lazy.
//
// A lazy route costs one extra round trip — the entry chunk has to run before
// the browser learns the page chunk exists. On an app route that is invisible
// (you arrive already authenticated, and Phase 2's prefetch-on-intent will hide
// it entirely). On the public landing page it would land squarely in LCP, for
// the one visitor whose first impression is the whole point. So `/` and `/auth`
// are paid for up front; the 25 pages behind the login are not.
import Landing from './pages/Landing';
import Auth from './pages/Auth';

const OrbitMrpCallback = lazy(() => import('./pages/OrbitMrpCallback'));
const DataManager = lazy(() => import('./pages/DataManager'));
const ProductLevelNetwork = lazy(() => import('./pages/ProductLevelNetwork'));
const ProcessLevelNetwork = lazy(() => import('./pages/ProcessLevelNetwork'));
const FirmLevelNetwork = lazy(() => import('./pages/FirmLevelNetwork'));
const InteractiveNetworkSpace = lazy(() => import('./pages/InteractiveNetworkSpace'));
const GettingStarted = lazy(() => import('./pages/GettingStarted'));
const ProjectPolicies = lazy(() => import('./pages/ProjectPolicies'));
const SimulationLab = lazy(() => import('./pages/SimulationLab'));
const ProjectIntelligence = lazy(() => import('./pages/ProjectIntelligence'));
const Profile = lazy(() => import('./pages/Profile'));
const DeveloperApi = lazy(() => import('./pages/DeveloperApi'));
const Forbidden = lazy(() => import('./pages/Forbidden'));
const NotFound = lazy(() => import('./pages/NotFound'));
const About = lazy(() => import('./pages/About'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminUserAccess = lazy(() => import('./pages/admin/AdminUserAccess'));
const AdminRoles = lazy(() => import('./pages/admin/AdminRoles'));
const AdminOrganizations = lazy(() => import('./pages/admin/AdminOrganizations'));
const AdminProjects = lazy(() => import('./pages/admin/AdminProjects'));
const AdminModels = lazy(() => import('./pages/admin/AdminModels'));
const AdminUsage = lazy(() => import('./pages/admin/AdminUsage'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit'));

/** Shown while a route chunk arrives. Deliberately the same spinner
 *  `ProtectedRoute` shows while it resolves the session — from the user's side
 *  both are "the page is coming", and two different waits would read as two
 *  different kinds of slow. */
function RouteFallback() {
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="mt-2 text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

const queryClient = new QueryClient();

function App() {
  const [isCollapsed, setIsCollapsed] = useState(true);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Light-locked: the product has no dark design. forcedTheme pins the class
          regardless of the OS setting or a stale localStorage value. The .dark block
          in index.css is legacy and inert once this is set — do not delete it. */}
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
        forcedTheme="light"
      >
        {/* One viewport listener for the app (v2 §5.1). Everything that sizes
            itself to the device reads this; nothing adds a resize listener of
            its own. */}
        <ViewportProvider>
        <AuthProvider>
          <CapabilitiesProvider>
          <GlobalProjectProvider>
            <Router>
              <RouteErrorBoundary>
              <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/integrations/orbit-mrp/callback" element={<ProtectedRoute><OrbitMrpCallback /></ProtectedRoute>} />
              <Route path="/forbidden" element={<Forbidden isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />} />
                <Route path="/" element={<Landing />} />
                <Route
                  path="/app"
                  element={
                    <ProtectedRoute>
                    <RoleGuard><GettingStarted 
                        isCollapsed={isCollapsed} 
                        setIsCollapsed={setIsCollapsed} 
                    /></RoleGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/project-manager"
                  element={
                    <ProtectedRoute>
                    <RoleGuard><DataManager 
                        isCollapsed={isCollapsed} 
                        setIsCollapsed={setIsCollapsed} 
                    /></RoleGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/network/firm-level"
                  element={
                    <ProtectedRoute>
                    <RoleGuard><FirmLevelNetwork 
                        isCollapsed={isCollapsed} 
                        setIsCollapsed={setIsCollapsed} 
                    /></RoleGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/network/product-level"
                  element={
                    <ProtectedRoute>
                    <RoleGuard><ProductLevelNetwork 
                        isCollapsed={isCollapsed} 
                        setIsCollapsed={setIsCollapsed} 
                    /></RoleGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/network/process-level"
                  element={
                    <ProtectedRoute>
                    <RoleGuard><ProcessLevelNetwork 
                        isCollapsed={isCollapsed} 
                        setIsCollapsed={setIsCollapsed} 
                    /></RoleGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/network/interactive-space"
                  element={
                    <ProtectedRoute>
                    <RoleGuard><InteractiveNetworkSpace 
                        isCollapsed={isCollapsed} 
                        setIsCollapsed={setIsCollapsed} 
                    /></RoleGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/policies"
                  element={
                    <ProtectedRoute>
                      <RoleGuard><ProjectPolicies isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/simulation-lab"
                  element={
                    <ProtectedRoute>
                      <RoleGuard><SimulationLab isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/project-intelligence/*"
                  element={
                    <ProtectedRoute>
                    <RoleGuard><ProjectIntelligence 
                        isCollapsed={isCollapsed} 
                        setIsCollapsed={setIsCollapsed} 
                    /></RoleGuard>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/developer"
                  element={
                    <ProtectedRoute>
                      <RoleGuard><DeveloperApi isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard>
                    </ProtectedRoute>
                  }
                />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <RoleGuard><Profile isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard>
                  </ProtectedRoute>
                }
              />
                {/* Docs/help site is hidden from all access — see CLAUDE.md task history. */}
                <Route path="/help" element={<NotFound />} />
                <Route path="/help/:slug" element={<NotFound />} />
                <Route path="/about" element={<About />} />

                {/* Super Admin routes */}
                <Route path="/admin" element={<ProtectedRoute><RoleGuard><AdminDashboard isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/users" element={<ProtectedRoute><RoleGuard><AdminUsers isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/users/:userId" element={<ProtectedRoute><RoleGuard><AdminUserAccess isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/roles" element={<ProtectedRoute><RoleGuard><AdminRoles isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/organizations" element={<ProtectedRoute><RoleGuard><AdminOrganizations isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/projects" element={<ProtectedRoute><RoleGuard><AdminProjects isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/models" element={<ProtectedRoute><RoleGuard><AdminModels isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/usage" element={<ProtectedRoute><RoleGuard><AdminUsage isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/audit" element={<ProtectedRoute><RoleGuard><AdminAudit isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />

                {/* Unknown URL — the host rewrites every path to index.html so the
                    SPA can deep-link, which means 404s land here, not on the host. */}
                <Route path="*" element={<NotFound isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />} />
              </Routes>
              </Suspense>
              </RouteErrorBoundary>
              {/* Own boundary: the bubble renders on every route, so a throw
                  here must not take the routed page down with it. Its own
                  Suspense too — the bubble arriving a beat late is invisible,
                  but sharing the route boundary would hold the whole page
                  behind it. */}
              <RouteErrorBoundary fallback={null}>
                <Suspense fallback={null}>
                  <FloatingChatBubble />
                </Suspense>
              </RouteErrorBoundary>
            </Router>
          </GlobalProjectProvider>
          </CapabilitiesProvider>
        </AuthProvider>
        </ViewportProvider>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;