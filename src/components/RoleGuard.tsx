import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { canAccessRoute, getAllowedRoles } from '@/lib/permissions';
import type { UserRole } from '@/hooks/useUserRole';

interface RoleGuardProps {
  children: ReactNode;
  /** Optional explicit override; defaults to ROUTE_PERMISSIONS lookup by current pathname */
  allow?: UserRole[];
}

/**
 * Route-level RBAC guard. Must be rendered inside <ProtectedRoute>.
 * - If user is missing → redirect to /auth.
 * - If user.force_password_change → redirect to /profile (Change Password tab),
 *   unless we're already there.
 * - If role is not allowed → redirect to /forbidden.
 */
const RoleGuard = ({ children, allow }: RoleGuardProps) => {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/auth" replace />;

  if (user.force_password_change && !location.pathname.startsWith('/profile')) {
    return <Navigate to="/profile?tab=password&forced=1" replace />;
  }

  const allowed = allow ?? getAllowedRoles(location.pathname) ?? null;
  if (allowed && !allowed.includes(user.role as UserRole)) {
    return <Navigate to="/forbidden" replace />;
  }

  // Fallback consistency with helper (handles wildcard paths)
  if (!allow && !canAccessRoute(location.pathname, user.role as UserRole)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
};

export default RoleGuard;