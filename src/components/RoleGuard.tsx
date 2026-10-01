import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';
import type { UserRole } from '@/hooks/useUserRole';
import { passwordStatus } from '@/lib/auth/passwordPolicy';
import { routeGate } from '@/lib/auth/routeGate';
import PageSpinner from '@/components/PageSpinner';

interface RoleGuardProps {
  children: ReactNode;
  /** Optional explicit role override; defaults to effective page capability. */
  allow?: UserRole[];
}

/**
 * Route-level access guard. Must be rendered inside <ProtectedRoute>.
 * - If user is missing → redirect to /auth.
 * - If the password must be changed — an administrator forced it, or it has
 *   expired (`passwordStatus`, PLAN.md §4 D206) → redirect to /profile (Change
 *   Password tab), unless we're already there.
 * - Otherwise gate on the user's *effective page capability* (role default merged
 *   with org/user overrides) — and WAIT for it. Until the server's set lands the
 *   only answer is the role fallback, which knows nothing of the overrides: it
 *   mounted pages a restricted user may not open, and bounced users off pages
 *   they were granted. If the read fails or times out, the fallback governs.
 * The order and the rules are `routeGate` (src/lib/auth/routeGate.ts).
 */
const RoleGuard = ({ children, allow }: RoleGuardProps) => {
  const { user } = useAuth();
  const { canAccessPage, ready } = useCapabilities();
  const location = useLocation();

  const gate = routeGate({
    signedIn: Boolean(user),
    mustChangePassword: passwordStatus(user).mustChange,
    pathname: location.pathname,
    role: user?.role ?? null,
    allow,
    ready,
    canAccess: canAccessPage(location.pathname),
  });

  if (gate.kind === 'redirect') return <Navigate to={gate.to} replace />;
  if (gate.kind === 'wait') return <PageSpinner />;
  return <>{children}</>;
};

export default RoleGuard;
