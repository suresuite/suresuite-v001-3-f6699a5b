// §4 D278 — what `admin_set_user_role` returns, and the sentences /admin/users shows for it.
//
// The database computes every part (the organization move, the overrides that still
// decide, the projects D276's rule narrows); this module only words it. Nothing here
// decides a right.
import { accountRoleLabel } from './roleGloss';

export interface RoleChangeOverride {
  key: string;
  label: string | null;
  kind?: 'page' | 'feature';
  layer: 'person' | 'organization';
  allowed: boolean;
  role_default: boolean;
}

export interface RoleChangeProject {
  project_id: string;
  name: string | null;
  project_role: string;
  keys: { key: string; label: string | null }[];
}

export interface RoleChangeSummary {
  role_before: string;
  role_after: string;
  org: {
    org_id: string;
    name: string | null;
    org_role_before: string | null;
    org_role_after: string | null;
  } | null;
  overrides: RoleChangeOverride[];
  narrowed_projects: RoleChangeProject[];
}

/** The RPC's answer, or null when it is not a summary (the pre-D278 body returned nothing). */
export function parseRoleChangeSummary(data: unknown): RoleChangeSummary | null {
  const d = (Array.isArray(data) ? data[0] : data) as Partial<RoleChangeSummary> | null | undefined;
  if (!d || typeof d !== 'object' || typeof d.role_after !== 'string') return null;
  return {
    role_before: String(d.role_before ?? ''),
    role_after: d.role_after,
    org: d.org ?? null,
    overrides: Array.isArray(d.overrides) ? d.overrides : [],
    narrowed_projects: Array.isArray(d.narrowed_projects) ? d.narrowed_projects : [],
  };
}

const onOff = (b: boolean) => (b ? 'on' : 'off');
const LAYER: Record<RoleChangeOverride['layer'], string> = {
  person: 'person override',
  organization: 'organization override',
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface RoleChangeLines {
  /** "Organization role in Acme: member → admin", or why it did not move. Null without an active organization. */
  org: string | null;
  /** "Run Simulations: off by person override (admin default: on)". */
  overrides: string[];
  /** "Viewer on 2 projects (A, B): Edit Input Data, Edit Policies stay off". */
  projects: string[];
}

export function describeRoleChange(s: RoleChangeSummary): RoleChangeLines {
  const role = accountRoleLabel(s.role_after);
  let org: string | null = null;
  if (s.org) {
    const name = s.org.name ?? 'the active organization';
    const before = s.org.org_role_before;
    const after = s.org.org_role_after;
    if (before == null) org = `No membership in ${name}, so no organization role moved.`;
    else if (before !== after) org = `Organization role in ${name}: ${before} → ${after}.`;
    else if (before === 'owner') org = `Organization role in ${name}: stays owner (an owner is never changed by an account role).`;
    else org = `Organization role in ${name}: stays ${before}.`;
  }

  const overrides = s.overrides.map(
    (o) => `${o.label ?? o.key}: ${onOff(o.allowed)} by ${LAYER[o.layer]} (${role} default: ${onOff(o.role_default)}).`,
  );

  // One line per project role, so "Viewer on 2 projects" reads as one fact.
  const byRole = new Map<string, RoleChangeProject[]>();
  for (const p of s.narrowed_projects) {
    byRole.set(p.project_role, [...(byRole.get(p.project_role) ?? []), p]);
  }
  const projects = [...byRole.entries()].map(([projectRole, ps]) => {
    const names = ps.map((p) => p.name ?? p.project_id).join(', ');
    const keys = [...new Set(ps.flatMap((p) => p.keys.map((k) => k.label ?? k.key)))].join(', ');
    return `${cap(projectRole)} on ${ps.length} project${ps.length === 1 ? '' : 's'} (${names}): ${keys} stay off there.`;
  });

  return { org, overrides, projects };
}
