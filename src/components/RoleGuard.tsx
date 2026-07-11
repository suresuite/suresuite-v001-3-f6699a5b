import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';
import type { UserRole } from '@/hooks/useUserRole';

interface RoleGuardProps {
  children: ReactNode;
  /** Optional explicit role override; defaults to effective page capability. */
  allow?: UserRole[];
}

/**
 * Route-level access guard. Must be rendered inside <ProtectedRoute>.
 * - If user is missing → redirect to /auth.
 * - If user.force_password_change → redirect to /profile (Change Password tab),
 *   unless we're already there.
 * - Otherwise gate on the user's *effective page capability* (role default merged
 *   with org/user overrides), falling back to role-based routing while the
 *   capability set loads or if it fails to fetch.
 */
const RoleGuard = ({ children, allow }: RoleGuardProps) => {
  const { user } = useAuth();
  const { canAccessPage } = useCapabilities();
  const location = useLocation();

  if (!user) return <Navigate to="/auth" replace />;

  if (user.force_password_change && !location.pathname.startsWith('/profile')) {
    return <Navigate to="/profile?tab=password&forced=1" replace />;
  }

  // Explicit role allow-list still supported for bespoke routes.
  if (allow) {
    if (!allow.includes(user.role as UserRole)) return <Navigate to="/forbidden" replace />;
    return <>{children}</>;
  }

  if (!canAccessPage(location.pathname)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
};

export default RoleGuard;
