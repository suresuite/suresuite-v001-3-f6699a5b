import type { UserRole } from '@/hooks/useUserRole';

/**
 * Route → roles allowed map.
 * Use `*` as a wildcard suffix (e.g. `/network/*`).
 * Keep in sync with src/App.tsx routes.
 */
export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  '/': ['admin', 'modeler', 'user'],
  '/project-manager': ['admin', 'modeler'],
  '/network/firm-level': ['admin', 'modeler', 'user'],
  '/network/product-level': ['admin', 'modeler', 'user'],
  '/network/process-level': ['admin', 'modeler', 'user'],
  '/network/interactive-space': ['admin', 'modeler', 'user'],
  '/simulation': ['admin', 'modeler'],
  '/project-intelligence': ['admin', 'modeler', 'user'],
  '/profile': ['admin', 'modeler', 'user'],
  '/admin': ['admin'],
};

function matchRoute(path: string, pattern: string): boolean {
  if (pattern === path) return true;
  if (pattern.endsWith('/*')) {
    return path.startsWith(pattern.slice(0, -2));
  }
  return false;
}

export function getAllowedRoles(path: string): UserRole[] | null {
  // Prefer the most specific (longest) matching pattern
  const matches = Object.keys(ROUTE_PERMISSIONS)
    .filter((p) => matchRoute(path, p))
    .sort((a, b) => b.length - a.length);
  if (matches.length === 0) return null;
  return ROUTE_PERMISSIONS[matches[0]];
}

export function canAccessRoute(path: string, role: UserRole | undefined | null): boolean {
  const allowed = getAllowedRoles(path);
  if (!allowed) return true; // unknown routes default to allowed (e.g. /auth)
  if (!role) return false;
  return allowed.includes(role);
}