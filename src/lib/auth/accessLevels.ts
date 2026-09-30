/**
 * §4 D211 — the three access levels, and what every role on each one lets a person do,
 * written ONCE. /profile, /admin/users, /admin/projects and the manual read it from here.
 *
 *   PLATFORM      is the account a super admin?          approved_users.role = 'super_admin'
 *   ORGANIZATION  what may it do inside an organization? the ACCOUNT TIER (approved_users.role:
 *                                                        admin | modeler | user) — which applies
 *                                                        in EVERY organization it belongs to —
 *                                                        and its role IN each one
 *                                                        (organization_members.org_role)
 *   PROJECT       what may it do on one project?         project_members / delegation_grants,
 *                                                        resolved by effective_project_role()
 *
 * The rights below RESTATE the database's rules; they decide nothing. Each names the rule
 * it restates, and `accessLevels.test.ts` reads those rules back out of the migrations, so
 * a rule that moves turns the test red before this text can say something false:
 *
 *   see a project     `Projects: org-wide view` — the project's organization is the
 *                     account's CURRENT one (org_is_current_user_org)
 *   edit its data     the write policies on projects and every project table, and
 *                     has_project_access (the CSV landing): the project's creator
 *                     (`modeler_id`) or an account whose tier is `admin`
 *   promote an upload ingest_apply_run: effective_project_role ≥ editor
 *   export            record_export → capabilities_for_user(user, project): a project role,
 *                     when held, decides; otherwise the account tier's default
 *
 * The owner's decision (2026-09-30, D66): an organization admin is an OWNER of every project
 * in its organization. That is the TARGET, and making it the rule is WP 7.1's; until then
 * these screens say what the rules are, including where they disagree with it.
 */
import type { UserRole } from '@/hooks/useUserRole';
import { PROJECT_ROLE_DEFAULTS, PROJECT_ROLE_RANK, PROJECT_ROLES, type ProjectRole } from '@/lib/capabilities.generated';

export type AccountTier = Exclude<UserRole, 'super_admin'>;
export type OrgRole = 'owner' | 'admin' | 'member';
export { PROJECT_ROLES, type ProjectRole };

export interface RoleInfo {
  label: string;
  /** One line: who this is. */
  summary: string;
  /** What it lets the person do, as the rules stand today. */
  can: string[];
  /** What people expect it to allow and it does not. */
  cannot: string[];
}

export interface LevelInfo {
  key: 'platform' | 'organization' | 'project';
  label: string;
  question: string;
  /** Where the level is stored, in words. */
  where: string;
}

export const LEVELS: LevelInfo[] = [
  {
    key: 'platform',
    label: 'Platform',
    question: 'Does this person run the whole platform?',
    where: 'The account is either a Super admin or a standard account.',
  },
  {
    key: 'organization',
    label: 'Organization',
    question: 'What may this person do inside an organization?',
    where: 'The account tier (Admin, Modeler or User), which applies in every organization the account belongs to, and a role in each organization (Owner, Admin or Member).',
  },
  {
    key: 'project',
    label: 'Project',
    question: 'What may this person do on one project?',
    where: 'A project role on each project (Owner, Editor, Analyst or Viewer). A project’s creator is always its Owner.',
  },
];

export const PLATFORM_ROLES: Record<'super_admin' | 'standard', RoleInfo> = {
  super_admin: {
    label: 'Super admin',
    summary: 'Runs the platform: every organization, account and project.',
    can: [
      'Open /admin: create accounts and organizations, set plans and page/feature overrides',
      'Add anyone to any organization and set their role there',
      'Copy, transfer, rename or delete any project, and set project roles',
      'Counts as Owner on every project, and is exempt from organization access periods',
    ],
    cannot: [
      'See another organization’s projects on the regular pages — those follow the organization you have switched to',
      'Create a project, or edit one it did not create, on the regular pages: the write rules name the Admin tier and the creator, not Super admin',
    ],
  },
  standard: {
    label: 'Standard account',
    summary: 'Everything this account may do comes from the organization and project levels.',
    can: ['Work in the organizations it belongs to, one at a time'],
    cannot: ['Open /admin'],
  },
};

export const ACCOUNT_TIERS: Record<AccountTier, RoleInfo> = {
  admin: {
    label: 'Admin',
    summary: 'Runs the projects of every organization the account belongs to.',
    can: [
      'See every project in the current organization',
      'Create projects',
      'Edit, upload to and delete ANY project in the current organization',
      'Manage the organization’s API keys',
    ],
    cannot: [
      'Manage accounts, organizations or roles — only a super admin can',
      'Promote an uploaded CSV without a project role of Editor or higher',
    ],
  },
  modeler: {
    label: 'Modeler',
    summary: 'Builds and edits their own projects.',
    can: [
      'See every project in the current organization',
      'Create projects, and becomes their Owner',
      'Edit, upload to and delete the projects they created',
      'Manage the organization’s API keys',
    ],
    cannot: [
      'Edit a project someone else created — not even with the project role Editor (planned: WP 7.1)',
    ],
  },
  user: {
    label: 'User',
    summary: 'Reads and analyses the organization’s projects.',
    can: [
      'See every project in the current organization',
      'AI chat, project intelligence, reports and export',
    ],
    cannot: [
      'Create or edit projects',
      'Open Project Manager or Developer API; the Simulation Lab and data-editing features are off by default',
    ],
  },
};

export const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'member'];

export const ORG_ROLE_INFO: Record<OrgRole, RoleInfo> = {
  owner: {
    label: 'Owner',
    summary: 'Named owner of this organization.',
    can: ['Manage this organization’s API keys, whatever the account tier'],
    cannot: ['Anything else yet: members, plan and project editing are not granted by this role today (the account tier decides)'],
  },
  admin: {
    label: 'Admin',
    summary: 'Administers this organization.',
    can: ['Manage this organization’s API keys, whatever the account tier'],
    cannot: ['Anything else yet: members, plan and project editing are not granted by this role today (the account tier decides)'],
  },
  member: {
    label: 'Member',
    summary: 'Belongs to this organization.',
    can: ['Switch to it and see its projects', 'Take one of its seats (its user limit counts members)'],
    cannot: [],
  },
};

export const PROJECT_ROLE_INFO: Record<ProjectRole, RoleInfo> = {
  owner: {
    label: 'Owner',
    summary: 'Full standing on the project. Its creator is always an Owner.',
    can: ['Promote uploaded CSVs into the project', 'Export from the project'],
    cannot: [],
  },
  editor: {
    label: 'Editor',
    summary: 'Maintains the project’s data.',
    can: ['Promote uploaded CSVs into the project', 'Export from the project'],
    cannot: ['Edit the data directly unless they created the project or hold the Admin tier (planned: WP 7.1)'],
  },
  analyst: {
    label: 'Analyst',
    summary: 'Analyses and exports; does not change inputs.',
    can: ['Export from the project'],
    cannot: ['Promote uploaded CSVs'],
  },
  viewer: {
    label: 'Viewer',
    summary: 'Reads the project.',
    can: [],
    cannot: ['Promote uploaded CSVs', 'Export from the project'],
  },
};

/** The note every project-role surface carries, because the level is only partly live. */
export const PROJECT_LEVEL_NOTE =
  'Today a project role decides who may promote an uploaded CSV (Editor or higher) and who may export. ' +
  'Editing a project’s data still follows the organization level: its creator, or an account with the Admin tier. ' +
  'Planned (WP 7.1): the project role decides editing too, and an organization admin is an Owner of every project in its organization.';

/** D28 — the rules are real rules, but the database cannot yet verify who is asking. */
export const ENFORCEMENT_NOTE =
  'These are the rules the database applies. Until sign-in moves to verified sessions (WP 7.1), ' +
  'the database takes the signed-in account from the browser, so treat them as the intended boundaries rather than a security guarantee.';

/* ───────────────────────────── helpers ───────────────────────────── */

export const isSuperAdmin = (role: string | null | undefined) => role === 'super_admin';

/** The account's platform standing. */
export function platformRole(role: string | null | undefined): RoleInfo {
  return isSuperAdmin(role) ? PLATFORM_ROLES.super_admin : PLATFORM_ROLES.standard;
}

/** The account tier, or null for a super admin (whose standing is the platform level). */
export function accountTier(role: string | null | undefined): AccountTier | null {
  return role === 'admin' || role === 'modeler' || role === 'user' ? role : null;
}

export function tierLabel(role: string | null | undefined): string {
  if (isSuperAdmin(role)) return 'Super admin';
  const tier = accountTier(role);
  return tier ? ACCOUNT_TIERS[tier].label : '—';
}

export function orgRoleLabel(role: string | null | undefined): string {
  return role && role in ORG_ROLE_INFO ? ORG_ROLE_INFO[role as OrgRole].label : '—';
}

export function isProjectRole(role: string | null | undefined): role is ProjectRole {
  return !!role && role in PROJECT_ROLE_RANK;
}

export function projectRoleLabel(role: string | null | undefined): string {
  return isProjectRole(role) ? PROJECT_ROLE_INFO[role].label : 'No role';
}

export function projectRoleRank(role: string | null | undefined): number {
  return isProjectRole(role) ? PROJECT_ROLE_RANK[role] : 0;
}

/**
 * Where the account tier and the role in one organization disagree — the combination
 * that confuses, because today the TIER is what decides and it applies in every
 * organization. Null when they agree (or for a super admin).
 */
export function tierOrgMismatch(
  role: string | null | undefined, orgRole: string | null | undefined, who: 'account' | 'you' = 'account',
): string | null {
  const tier = accountTier(role);
  if (!tier || !orgRole) return null;
  const [Its, it] = who === 'you' ? ['Your', 'you'] : ['Its', 'it'];
  const runsOrg = orgRole === 'owner' || orgRole === 'admin';
  if (tier === 'admin' && !runsOrg) {
    return `${Its} account tier is Admin, so ${it} can edit every project here even though ${it === 'you' ? 'your' : 'its'} role in this organization is Member.`;
  }
  if (tier !== 'admin' && runsOrg) {
    return `${Its} role here is ${orgRoleLabel(orgRole)}, but ${it === 'you' ? 'your' : 'its'} account tier is ${ACCOUNT_TIERS[tier].label}: ${it} cannot edit other people\u2019s projects here. The ${orgRoleLabel(orgRole)} role only adds API keys today.`;
  }
  return null;
}

/** How to set the two so they agree while the tier is what the rules read. */
export const ALIGNMENT_HINT =
  'Keep them aligned: an account that runs an organization gets the Admin tier and the Owner or Admin role there; everyone else gets Modeler or User and the Member role. ' +
  'The tier applies in every organization, so an account that should run one organization but not another cannot be expressed yet (WP 7.1).';

export interface Right {
  key: 'see' | 'edit' | 'promote' | 'export';
  label: string;
  allowed: boolean;
  because: string;
}

export interface ProjectStanding {
  /** approved_users.role */
  accountRole: string | null | undefined;
  /** The account is a member of the project's organization. */
  inProjectOrg: boolean;
  isCreator: boolean;
  /** What effective_project_role() returned. */
  effectiveRole: string | null | undefined;
}

/**
 * What one account may do on one project, and why — the four rules in this file's
 * header, applied. Seeing a project also needs it to be the CURRENT organization;
 * the account switches.
 */
export function projectRights(s: ProjectStanding): Right[] {
  const role = isProjectRole(s.effectiveRole) ? s.effectiveRole : null;
  const roleText = role ? `project role ${PROJECT_ROLE_INFO[role].label}` : 'no project role';
  const tier = accountTier(s.accountRole);

  const see: Right = s.inProjectOrg
    ? { key: 'see', label: 'See it', allowed: true, because: 'member of its organization' }
    : { key: 'see', label: 'See it', allowed: false, because: 'not a member of its organization' };

  let edit: Right;
  if (!s.inProjectOrg) edit = { key: 'edit', label: 'Edit data & upload', allowed: false, because: 'not a member of its organization' };
  else if (s.isCreator) edit = { key: 'edit', label: 'Edit data & upload', allowed: true, because: 'created the project' };
  else if (tier === 'admin') edit = { key: 'edit', label: 'Edit data & upload', allowed: true, because: 'Admin account tier' };
  else if (isSuperAdmin(s.accountRole)) edit = { key: 'edit', label: 'Edit data & upload', allowed: false, because: 'the rule names the creator and the Admin tier, not Super admin — use /admin' };
  else edit = { key: 'edit', label: 'Edit data & upload', allowed: false, because: `only the creator or an Admin-tier account${role ? `; a ${roleText} does not count yet` : ''}` };

  const promote: Right = projectRoleRank(role) >= PROJECT_ROLE_RANK.editor
    ? { key: 'promote', label: 'Promote uploads', allowed: true, because: isSuperAdmin(s.accountRole) && !s.isCreator ? 'Super admin counts as Owner' : roleText }
    : { key: 'promote', label: 'Promote uploads', allowed: false, because: `needs Editor or higher; has ${roleText}` };

  let exportRight: Right;
  if (role) {
    const allowed = PROJECT_ROLE_DEFAULTS.some((g) => g.projectRole === role && g.capabilityKey === 'export' && g.allowed);
    exportRight = { key: 'export', label: 'Export', allowed, because: roleText };
  } else {
    exportRight = { key: 'export', label: 'Export', allowed: true, because: 'no project role: the account tier’s default applies' };
  }

  return [see, edit, promote, exportRight];
}

/** Where a project role came from, in words. */
export function roleSource(r: {
  isCreator: boolean;
  memberRole: string | null | undefined;
  delegatedRole: string | null | undefined;
  accountRole?: string | null;
  effectiveRole: string | null | undefined;
}): string {
  if (!r.effectiveRole) return '';
  if (r.memberRole && r.memberRole === r.effectiveRole) return r.isCreator ? 'creator' : 'assigned';
  if (r.delegatedRole && r.delegatedRole === r.effectiveRole) return 'delegated';
  if (isSuperAdmin(r.accountRole ?? null)) return 'super admin';
  return 'assigned';
}

/** The project-role refusals the admin verbs raise, as sentences. */
export function projectRoleRefusal(message: string | null | undefined): string {
  const m = /(?:not_in_organization|creator_is_owner|last_owner|not_a_member):\s*(.*)$/s.exec(message ?? '');
  if (!m) return message || 'The change was refused.';
  return m[1].charAt(0).toUpperCase() + m[1].slice(1);
}
