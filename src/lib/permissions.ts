import type { UserRole } from '@/hooks/useUserRole';

/**
 * Route → roles allowed map.
 * Use `*` as a wildcard suffix (e.g. `/network/*`).
 * super_admin is granted access to everything by default in canAccessRoute().
 */
export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  '/': ['admin', 'modeler', 'user', 'super_admin'],
  '/project-manager': ['admin', 'modeler', 'super_admin'],
  '/network/firm-level': ['admin', 'modeler', 'user', 'super_admin'],
  '/network/product-level': ['admin', 'modeler', 'user', 'super_admin'],
  '/network/process-level': ['admin', 'modeler', 'user', 'super_admin'],
  '/network/interactive-space': ['admin', 'modeler', 'user', 'super_admin'],
  '/policies': ['admin', 'modeler', 'user', 'super_admin'],
  '/simulation-lab': ['admin', 'modeler', 'user', 'super_admin'],
  '/project-intelligence': ['admin', 'modeler', 'user', 'super_admin'],
  // Developer API keys: matches who can mint keys (_api_key_management_org)
  '/developer': ['admin', 'modeler', 'super_admin'],
  '/profile': ['admin', 'modeler', 'user', 'super_admin'],
  '/admin': ['super_admin'],
  '/admin/*': ['super_admin'],
};

function matchRoute(path: string, pattern: string): boolean {
  if (pattern === path) return true;
  if (pattern.endsWith('/*')) {
    return path.startsWith(pattern.slice(0, -2));
  }
  return false;
}

export function getAllowedRoles(path: string): UserRole[] | null {
  const matches = Object.keys(ROUTE_PERMISSIONS)
    .filter((p) => matchRoute(path, p))
    .sort((a, b) => b.length - a.length);
  if (matches.length === 0) return null;
  return ROUTE_PERMISSIONS[matches[0]];
}

export function canAccessRoute(path: string, role: UserRole | undefined | null): boolean {
  if (role === 'super_admin') return true;
  const allowed = getAllowedRoles(path);
  if (!allowed) return true;
  if (!role) return false;
  return allowed.includes(role);
}
