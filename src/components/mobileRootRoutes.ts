/**
 * The mobile tab bar's root routes (v3 §1.3): the four tab destinations —
 * Home, Policies, Lab, AI. `MobileNav.tsx`'s `TABS` builds its labels and
 * icons from this same list, and re-exports `isMobileRootRoute` for
 * `PageLayout` and `MobileSheet` — one list, so "is this a root or a pushed
 * view" can never disagree between the bar, the chrome reservation and a
 * sheet's bottom offset.
 *
 * A plain module, not a component file, so it can export a function without
 * tripping `react-refresh/only-export-components` on `MobileNav.tsx`.
 */
export const MOBILE_ROOT_ROUTES = ['/app', '/policies', '/simulation-lab', '/project-intelligence'] as const;

export function isMobileRootRoute(pathname: string): boolean {
  return MOBILE_ROOT_ROUTES.some((to) => pathname === to || pathname.startsWith(to + '/'));
}
