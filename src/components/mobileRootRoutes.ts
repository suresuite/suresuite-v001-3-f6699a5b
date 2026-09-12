/**
 * D3-a (RESOLVED, supersedes the narrower §1.3 reading this file originally
 * implemented): the tab bar is hidden if and only if the screen's header
 * shows a back arrow — i.e. it was pushed onto a stack from a root. Every
 * root shows the bar, including a root with no tab of its own (the three
 * network lenses, Developer API, Super Admin, Project Manager, Getting
 * Started, About & help) — with no item active, no marker bar, since none
 * of `MobileNav.tsx`'s four tabs matches that route.
 *
 * Design review caught the bug the old allowlist produced: Network,
 * Developer API and Super Admin shipped with no bottom nav because showing
 * the bar required opting a route IN. This file inverts that: a route
 * shows the bar unless it matches a known PUSHED pattern — a real
 * drill-down with a back target (AdminUserAccess is the one that exists
 * today). A new destination that forgets to register defaults to showing
 * the bar (safe) rather than defaulting to stranding the user (the bug),
 * so most work — the DoD's "grep the router" check is now "does this
 * pattern list account for every real drill-down", a much shorter list to
 * audit than "does every root remember to opt in".
 *
 * `MOBILE_TAB_ROUTES` is the separate, narrower concern: which four routes
 * `MobileNav.tsx`'s `TABS` builds icons and labels for. A route can be a
 * root (bar shown) without being one of these four (no tab highlighted).
 *
 * A plain module, not a component file, so it can export a function
 * without tripping `react-refresh/only-export-components` on
 * `MobileNav.tsx`.
 */
export const MOBILE_TAB_ROUTES = ['/app', '/policies', '/simulation-lab', '/project-intelligence'] as const;

/** Routes reached by drilling into a root — the header shows a back arrow
 *  there and the tab bar hides. Keep this list to genuine stack-pushes
 *  only; a root with no tab of its own (Network, Developer API, Super
 *  Admin, Project Manager, Getting Started, About & help) is NOT here. */
const PUSHED_ROUTE_PATTERNS: RegExp[] = [
  /^\/admin\/users\/[^/]+$/, // AdminUserAccess — drilled in from /admin/users
  // SC Intelligences (handoff §2/§3): every screen pushed from the
  // /project-intelligence root — new question, a thread, the roster, one
  // intelligence, a proposal — carries a detail header and hides the bar.
  /^\/project-intelligence\/new$/,
  /^\/project-intelligence\/thread\/[^/]+$/,
  /^\/project-intelligence\/thread\/[^/]+\/trace$/,
  /^\/project-intelligence\/roster$/,
  /^\/project-intelligence\/roster\/[^/]+$/,
  /^\/project-intelligence\/proposal\/[^/]+$/,
  /^\/project-intelligence\/proposals$/,
  /^\/project-intelligence\/flag\/[^/]+$/,
  /^\/project-intelligence\/chats$/,
  /^\/project-intelligence\/chats\/files$/,
];

export function isMobileRootRoute(pathname: string): boolean {
  return !PUSHED_ROUTE_PATTERNS.some((re) => re.test(pathname));
}
