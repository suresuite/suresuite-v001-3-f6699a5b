// Label variants for the adaptive-text ladder (mobile UI spec §3.2).
//
// WHY THIS FILE EXISTS
// A label that does not fit at 320px gets a SHORTER VARIANT — it never gets
// truncated into ambiguity, and it never gets uppercased or abbreviated to
// squeeze in. The variants live here, beside the display vocabulary, rather
// than inline at the call site, so:
//
//   1. the full and short forms are reviewable together, in one place;
//   2. adding one is a display-vocabulary change, not a logic change
//      (spec §0.1 A) — no caller behaviour moves;
//   3. two screens showing the same destination cannot disagree.
//
// HOW TO ADD ONE
// Only add a variant for a label that genuinely overflows at 320px. Check
// first — most fit, and a needless variant is churn. `short` must stay
// unambiguous on its own: "Space" is fine for "Interactive space" because
// nothing else in the nav is called Space. "Product" for "Product-Level" is
// fine for the same reason. Never shorten to an initialism a user has not
// been taught.
//
// NEVER put a number, a unit, a status word or an error in here. Those are
// forbidden from the ladder entirely (spec §3.1) — if a numeric row does not
// fit, the TABLE scrolls (§2.7); the number does not change.

export interface Label {
  /** The canonical label. Used at >=sm, and always in `title`/aria. */
  full: string;
  /** The <sm form. Must be unambiguous standing alone. */
  short: string;
}

const L = (full: string, short: string): Label => ({ full, short });

/**
 * Navigation destinations. `full` matches NAV_SECTIONS in Navbar.tsx term for
 * term — including the hyphenated title-case the sidebar uses ("Product-Level",
 * not "Product level"). If you change a label there, change it here.
 */
export const NAV_LABELS = {
  gettingStarted: L('Getting Started', 'Start'),
  projectManager: L('Project Manager', 'Projects'),
  productLevel: L('Product-Level', 'Product'),
  processLevel: L('Process-Level', 'Process'),
  firmLevel: L('Firm-Level', 'Firm'),
  interactiveSpace: L('Interactive space', 'Space'),
  policies: L('Policies', 'Policies'),
  simulationLab: L('Simulation Lab', 'Lab'),
  projectIntelligence: L('Project Intelligence', 'AI'),
  developerApi: L('Developer API', 'API'),
  superAdmin: L('Super Admin', 'Admin'),
  aboutHelp: L('About & Help', 'Help'),
} satisfies Record<string, Label>;

/**
 * Simulation Lab panes. The rail labels are short already; these are the
 * in-content tab labels, which are not.
 */
export const LAB_LABELS = {
  setup: L('Scenario setup', 'Setup'),
  events: L('Disruption schedule', 'Events'),
  run: L('Run & validation', 'Run'),
  results: L('Results', 'Results'),
  compare: L('Compare scenarios', 'Compare'),
} satisfies Record<string, Label>;

/**
 * Project data viewer tabs (ProjectDataViewer.tsx). `full` must match the
 * dataset labels the viewer already declares — a tab with no rows does not
 * render at all, so these are only ever shown for tabs that have data.
 */
export const DATASET_LABELS = {
  bom: L('BOM', 'BOM'),
  inbound: L('Inbound', 'Inbound'),
  outbound: L('Outbound', 'Outbound'),
  nodeList: L('Node List', 'Nodes'),
  deepNodes: L('Deep Nodes', 'Deep N'),
  deepEdges: L('Deep Edges', 'Deep E'),
  deepSummary: L('Deep Summary', 'Summary'),
} satisfies Record<string, Label>;

/**
 * Admin sections. `full` is the page title; `short` is the tab/chip form.
 */
export const ADMIN_LABELS = {
  dashboard: L('Dashboard', 'Home'),
  users: L('Users', 'Users'),
  access: L('User access', 'Access'),
  roles: L('Role defaults', 'Roles'),
  organizations: L('Organizations', 'Orgs'),
  projects: L('Projects', 'Projects'),
  models: L('AI Models', 'Models'),
  usage: L('AI Usage', 'Usage'),
  audit: L('Audit log', 'Audit'),
} satisfies Record<string, Label>;

/**
 * Per-user access panes (AdminUserAccess.tsx).
 */
export const ACCESS_LABELS = {
  pages: L('Pages', 'Pages'),
  features: L('Features', 'Features'),
  models: L('AI models', 'Models'),
  budgets: L('Budgets & limits', 'Budgets'),
  preview: L('Preview as user', 'Preview'),
} satisfies Record<string, Label>;
