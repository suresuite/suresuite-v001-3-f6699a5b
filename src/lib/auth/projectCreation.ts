/**
 * §4 D303 — who may create a project, as the database answers it.
 *
 * The rule is `project_creation_right` (`20261008000001`), authored once: a super admin; a
 * Modeler or Admin account; otherwise an Admin or Owner of the organization the account is
 * WORKING IN — its active organization, which is where `create_project` puts the new
 * project. It reaches the browser inside `get_my_capabilities` as `project_creation`, and
 * the New Project button reads it instead of the account role. Nothing here decides; this
 * module types the answer and says it in words.
 */

export type ProjectCreationDecider = 'super_admin' | 'account_role' | 'organization_role' | 'none' | 'no_account';

export interface ProjectCreationRight {
  allowed: boolean;
  decided_by: ProjectCreationDecider;
  account_role: string | null;
  /** The ACTIVE organization — where a new project lands. */
  organization_id: string | null;
  organization_name: string | null;
  /** The account's role in that organization: owner · admin · member. */
  org_role: string | null;
}

const DECIDERS: ReadonlyArray<ProjectCreationDecider> = ['super_admin', 'account_role', 'organization_role', 'none', 'no_account'];

/** The raw jsonb, or `null` when it is absent (a server older than D303) or malformed. */
export function normalizeProjectCreation(raw: unknown): ProjectCreationRight | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const by = o.decided_by as ProjectCreationDecider;
  if (typeof o.allowed !== 'boolean' || !DECIDERS.includes(by)) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    allowed: o.allowed,
    decided_by: by,
    account_role: str(o.account_role),
    organization_id: str(o.organization_id),
    organization_name: str(o.organization_name),
    org_role: str(o.org_role),
  };
}

/**
 * The browser's answer when the server set is not there: the account role alone, which is
 * what the button read before D303. It knows nothing of the organization role, so an
 * organization admin waits for the server's answer rather than being shown a guess.
 */
export function projectCreationFromRole(role: string | null | undefined): ProjectCreationRight {
  const r = role ?? null;
  const by: ProjectCreationDecider =
    r === 'super_admin' ? 'super_admin' : r === 'admin' || r === 'modeler' ? 'account_role' : 'none';
  return {
    allowed: by !== 'none', decided_by: by, account_role: r,
    organization_id: null, organization_name: null, org_role: null,
  };
}

/** One line under the create form: where the project goes, and why this person may create it. */
export function projectCreationNote(right: ProjectCreationRight | null | undefined): string | null {
  if (!right?.allowed || !right.organization_name) return null;
  const where = `The project is created in ${right.organization_name}, the organization you are working in.`;
  if (right.decided_by === 'organization_role') {
    return `${where} You may create it as ${right.org_role === 'owner' ? 'its owner' : 'an admin of it'}.`;
  }
  return where;
}
