// §4 D278 — what each ACCOUNT role means, authored once.
//
// The manual (`RolesAndCapabilities`) and the role picker on /admin/users both read this
// module. Before D278 the gloss lived in the manual alone and the picker showed bare words,
// so `admin` read like the role that opens the administration area — it does not: /admin
// and every `admin_*` RPC are super-admin-only (`ROUTE_PERMISSIONS`, `_assert_super_admin`).
import type { UserRole } from '@/hooks/useUserRole';

/** Display order: widest first, like PROJECT_ROLES. */
export const ACCOUNT_ROLES: UserRole[] = ['super_admin', 'admin', 'modeler', 'user'];

export const ACCOUNT_ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  modeler: 'Modeler',
  user: 'User',
};

/** The manual's gloss: what the role opens, in a sentence or two. */
export const ACCOUNT_ROLE_GLOSS: Record<UserRole, string> = {
  super_admin:
    'Everything, everywhere — the checks below are skipped entirely, and this is the only role that opens the administration area.',
  admin:
    'The full working surface: every workspace, the Project Manager and the Developer API, with every feature on by default. It does not open the administration area — that is super admin only.',
  modeler:
    "The builder's role. The same default surface as admin — the two differ by what older row rules name and by convention, not by their default grants.",
  user:
    'Read and analyse. Every workspace opens, but creating projects, editing data and running simulations are off by default. An Admin or Owner of an organization may still create projects in it, and delete its projects and their data, while working in that organization.',
};

/** One line per role for the picker on /admin/users, where the gloss would not fit. */
export const ACCOUNT_ROLE_PICKER_LINE: Record<UserRole, string> = {
  super_admin: 'Opens the administration area; every check is skipped.',
  admin: 'Every workspace and feature by default. Does NOT open the administration area.',
  modeler: 'Every workspace and feature by default; builds projects.',
  user: "Read and analyse; editing data and running simulations off by default. Creates and deletes projects only as an organization's Admin or Owner.",
};

/**
 * What an account-role change moves, and what it does not. Read by the manual and by the
 * summary /admin/users shows after a change, so the two cannot describe different rules.
 */
export const ACCOUNT_ROLE_CHANGE_RULE = {
  moves:
    "Changing an account role also moves the person's role in their active organization between member and admin: becoming admin makes them an organization admin, leaving admin makes them a member again. An organization owner stays owner, and their other organizations are not changed.",
  stillDecides: {
    overrides: 'A grant or denial set on the person, or on their organization, still decides over the account role.',
    projectRole: 'On each project the project role still limits the four project rights — a Viewer stays a viewer there.',
    adminArea: 'Only super admin opens the administration area; admin does not.',
  },
  openSessions:
    "A person who is signed in picks the change up when they return to the app's tab, or within five minutes, and is told their role changed.",
} as const;

export const isAccountRole = (r: string | null | undefined): r is UserRole =>
  !!r && (ACCOUNT_ROLES as string[]).includes(r);

export const accountRoleLabel = (r: string | null | undefined): string =>
  isAccountRole(r) ? ACCOUNT_ROLE_LABELS[r] : (r ?? '—');
