import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthProvider } from '@/hooks/useAuth';
import { GlobalProjectProvider } from '@/hooks/useGlobalProject';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import ProtectedRoute from '@/components/ProtectedRoute';
import RoleGuard from '@/components/RoleGuard';

// Import pages
import Auth from './pages/Auth';
import DataManager from './pages/DataManager';
import ProductLevelNetwork from './pages/ProductLevelNetwork';
import ProcessLevelNetwork from './pages/ProcessLevelNetwork';
import FirmLevelNetwork from './pages/FirmLevelNetwork';
import InteractiveNetworkSpace from './pages/InteractiveNetworkSpace';
import GettingStarted from './pages/GettingStarted';
import ProjectPolicies from './pages/ProjectPolicies';
import SimulationLab from './pages/SimulationLab';
import ProjectIntelligence from './pages/ProjectIntelligence';
import Profile from './pages/Profile';
import Forbidden from './pages/Forbidden';
import DocsLayout from '@/components/docs/DocsLayout';
import HelpPage from './pages/help/HelpPage';
import { FloatingChatBubble } from '@/components/chat/FloatingChatBubble';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUsers from './pages/admin/AdminUsers';
import AdminOrganizations from './pages/admin/AdminOrganizations';
import AdminProjects from './pages/admin/AdminProjects';
import AdminModels from './pages/admin/AdminModels';
import AdminUsage from './pages/admin/AdminUsage';
import AdminAudit from './pages/admin/AdminAudit';

const queryClient = new QueryClient();

function App() {
  const [isCollapsed, setIsCollapsed] = useState(true);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AuthProvider>
          <GlobalProjectProvider>
            <Router>
              <Routes>
                <Route path="/auth" element={<Auth />} />
              <Route path="/forbidden" element={<Forbidden />} />
                <Route
                  path="/"
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
                  path="/project-intelligence"
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
                path="/profile"
                element={
                  <ProtectedRoute>
                    <RoleGuard><Profile isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard>
                  </ProtectedRoute>
                }
              />
                <Route path="/help" element={<DocsLayout />}>
                  <Route index element={<HelpPage slug="overview" />} />
                  <Route path=":slug" element={<HelpPage />} />
                </Route>
                <Route path="/about" element={<Navigate to="/help" replace />} />

                {/* Super Admin routes */}
                <Route path="/admin" element={<ProtectedRoute><RoleGuard><AdminDashboard isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/users" element={<ProtectedRoute><RoleGuard><AdminUsers isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/organizations" element={<ProtectedRoute><RoleGuard><AdminOrganizations isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/projects" element={<ProtectedRoute><RoleGuard><AdminProjects isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/models" element={<ProtectedRoute><RoleGuard><AdminModels isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/usage" element={<ProtectedRoute><RoleGuard><AdminUsage isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
                <Route path="/admin/audit" element={<ProtectedRoute><RoleGuard><AdminAudit isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} /></RoleGuard></ProtectedRoute>} />
              </Routes>
              <FloatingChatBubble />
            </Router>
          </GlobalProjectProvider>
        </AuthProvider>
      </ThemeProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;