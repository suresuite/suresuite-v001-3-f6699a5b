// Organizations & projects for one account — /admin/users/:userId (PLAN.md §4 D211).
//
// Reads `admin_get_user_memberships`: every organization the account belongs to (D210)
// with its role in each and which one is ACTIVE, and every project it can reach or is
// recorded on, each with WHERE the access comes from (active organization, another of
// its organizations, ownership, membership, delegation) and the rights it holds there
// (`project_rights_for_user`, D230 — the answer the app's own gates read, never computed
// here a second time). Organization memberships are added and removed through D210's
// `admin_add_org_member` / `admin_remove_org_member`; the org role and project
// memberships through D211's verbs. The database refuses changing the project
// modeler's own membership, which the page only mirrors. Which organization is active
// is the account's own choice (account menu, /profile) and is shown, not set, here.
// Which one is the DEFAULT — where every sign-in lands (D216) — is set here, through
// `admin_set_default_org`, and the account cannot change it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminSection, KX, MonoChip, Segmented, StatusDot } from '@/components/admin/adminUi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FROZEN_CELL } from '@/components/shared';
import { cn } from '@/lib/utils';
import { Loader2, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { projectRightsNotes } from '@/lib/auth/projectRights';
import { planRefusal } from '@/lib/auth/organizationPlan';
import { PROJECT_ROLES, cap, day, endOfDay, toDateInput } from '@/components/admin/projectRoles';
import { useConfirm } from '@/components/shared/confirm/useConfirm';

interface Actor { id: string; email?: string | null }
interface OrgInfo {
  id: string; name: string; slug: string | null; status: string | null;
  access_valid_until: string | null; org_role: string; is_active: boolean; is_default?: boolean; members: number; projects: number;
}
interface Member {
  project_role: string; expires_at: string | null; expired: boolean;
  rationale: string | null; granted_by: string | null; updated_at: string;
}
interface Delegation { id: string; project_role: string; expires_at: string; rationale: string; grantor: string | null }
interface ProjectAccess {
  project_id: string; name: string; plant_name: string | null;
  organization_id: string | null; organization_name: string | null;
  in_active_org: boolean; in_member_org: boolean; is_modeler: boolean; owner_name: string | null;
  visible: boolean; can_edit_project: boolean;
  /** D230 — the upload gate, and the role's answer before it and suspension. */
  may_land_uploads?: boolean; resolved_capabilities?: Record<string, boolean>;
  member: Member | null; delegations: Delegation[];
  effective_role: string | null; capabilities: Record<string, boolean>;
}
interface MembershipData {
  user_id: string; role: string; is_super_admin: boolean;
  active_organization_id: string | null; default_organization_id?: string | null; organizations: OrgInfo[]; projects: ProjectAccess[];
  project_capabilities: { key: string; label: string }[];
  role_matrix: Record<string, Record<string, boolean>>;
}
interface Option { id: string; name: string; organization?: string | null }

interface RpcResult { data: unknown; error: { message: string } | null }
// The admin RPCs are not in the generated Database types; name only what is called.
const db = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult> };
const ORG_ROLES = [{ value: 'owner', label: 'Owner' }, { value: 'admin', label: 'Admin' }, { value: 'member', label: 'Member' }];
const NONE = '__none__';

export function UserMemberships({ actor, userId, userLabel, onOrganizationChanged }: {
  actor: Actor; userId: string; userLabel: string; onOrganizationChanged?: () => void;
}) {
  const confirm = useConfirm();
  const [data, setData] = useState<MembershipData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<Option[]>([]);
  const [allProjects, setAllProjects] = useState<Option[]>([]);
  const actorArgs = useMemo(() => ({ p_actor_id: actor.id, p_actor_email: actor.email }), [actor.id, actor.email]);

  const load = useCallback(async () => {
    setError(null);
    const [res, orgRes, projRes] = await Promise.all([
      db.rpc('admin_get_user_memberships', { ...actorArgs, p_target_user_id: userId }),
      db.rpc('admin_list_organizations', actorArgs),
      db.rpc('admin_list_projects', actorArgs),
    ]);
    if (res.error) setError(res.error.message === 'forbidden'
      ? 'Only an active super admin can read organization and project access.'
      : `Could not load organization and project access: ${res.error.message}`);
    else setData(res.data as MembershipData);
    setOrgs(((orgRes.data ?? []) as Option[]).map((o) => ({ id: o.id, name: o.name })));
    setAllProjects(((projRes.data ?? []) as Option[]).map((p) => ({ id: p.id, name: p.name, organization: p.organization })));
    setLoading(false);
  }, [actorArgs, userId]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { error: err } = await db.rpc(fn, { ...actorArgs, p_target_user_id: userId, ...args });
    if (err) {
      toast.error(planRefusal(err.message) ?? err.message.replace(/^(already_a_member|not_a_member):\s*/, ''));
      return false;
    }
    toast.success(ok);
    await load();
    return true;
  };

  const addOrg = async (orgId: string, orgRole: string) => {
    const name = orgs.find((o) => o.id === orgId)?.name ?? 'the organization';
    if (await run('admin_add_org_member', { p_org_id: orgId, p_org_role: orgRole }, `Added to ${name}`)) onOrganizationChanged?.();
  };

  const removeOrg = async (o: OrgInfo) => {
    const home = data?.organizations.find((m) => m.is_default && m.id !== o.id);
    const next = (o.is_active
      ? `\n\nIt is their active organization, so they move to ${home ? `their default, ${home.name}` : 'their earliest remaining one, or to none'}.`
      : '') + (o.is_default ? '\n\nIt is their default organization; they will have none until another is set.' : '');
    const title = `Remove ${userLabel} from ${o.name}?`;
    if (!(await confirm({ message: `${title} They stop seeing its projects. Project memberships are kept.${next}`, title, actionLabel: 'Remove' }))) return;
    if (await run('admin_remove_org_member', { p_org_id: o.id }, `Removed from ${o.name}`)) onOrganizationChanged?.();
  };

  const setDefault = (o: OrgInfo | null) =>
    run('admin_set_default_org', { p_org_id: o?.id ?? null },
      o ? `${o.name} is now ${userLabel}'s default organization` : `${userLabel} has no default organization`);

  const setMember = (p: ProjectAccess, role: string, expiresAt: string | null) =>
    run('admin_set_project_member', { p_project_id: p.project_id, p_project_role: role, p_expires_at: expiresAt, p_rationale: null },
      `${p.name}: ${role}${expiresAt ? ` until ${day(expiresAt)}` : ''}`);

  const removeMember = async (p: ProjectAccess) => {
    const message = `Remove ${userLabel}'s ${p.member?.project_role} membership on "${p.name}"?`;
    if (!(await confirm({ message, title: message, actionLabel: 'Remove' }))) return;
    run('admin_remove_project_member', { p_project_id: p.project_id }, `${p.name}: membership removed`);
  };

  if (loading) {
    return <AdminSection title="Organization & projects"><div className="grid h-20 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div></AdminSection>;
  }
  if (error || !data) {
    return <AdminSection title="Organization & projects"><div className="rounded-sm border border-[#bf2330]/40 bg-[#bf2330]/10 p-3 text-sm text-[#bf2330]">{error}</div></AdminSection>;
  }

  const memberOf = new Set(data.projects.filter((p) => p.member).map((p) => p.project_id));
  const active = data.organizations.find((o) => o.is_active) ?? null;
  const home = data.organizations.find((o) => o.is_default) ?? null;

  return (
    <>
      <AdminSection title="Organizations" badge={`${data.organizations.length}`}>
        {data.organizations.length === 0 ? (
          <div className="py-2 text-[12px] text-muted-foreground">In no organization, so no project is visible through one.</div>
        ) : (
          <div className="divide-y divide-[#e8e8ea] md:divide-[--hair-divider]">
            {data.organizations.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[length:var(--fs-row)] font-medium text-[#171717] md:text-[13px] md:text-foreground">
                    {o.name}
                    {o.is_default && <MonoChip tone="solid">default</MonoChip>}
                    {o.is_active && <MonoChip>active</MonoChip>}
                    {o.status === 'suspended' && <MonoChip>suspended</MonoChip>}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {o.members} member(s) · {o.projects} project(s){o.access_valid_until ? ` · access until ${day(o.access_valid_until)}` : ''}
                    {!o.is_active && ' · its projects are visible when they switch to it'}
                  </div>
                </div>
                <Segmented
                  value={o.org_role}
                  options={ORG_ROLES}
                  onChange={(v) => v !== o.org_role && run('admin_set_user_org_role', { p_org_id: o.id, p_org_role: v }, `${o.name}: ${v}`)}
                />
                <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8"
                  title={o.is_default ? 'Default organization — every sign-in lands here. Click to clear.' : 'Make this the default organization — every sign-in lands here'}
                  aria-label={o.is_default ? `Clear the default organization (${o.name})` : `Make ${o.name} the default organization`}
                  onClick={() => setDefault(o.is_default ? null : o)}>
                  <Star className="h-4 w-4" fill={o.is_default ? 'currentColor' : 'none'} />
                </Button>
                <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8" title="Remove from organization" aria-label={`Remove from ${o.name}`} onClick={() => removeOrg(o)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <AddOrganization
          orgs={orgs.filter((o) => !data.organizations.some((m) => m.id === o.id))}
          onAdd={addOrg}
        />
        <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
          {home
            ? <>Signs in to <strong className="text-foreground">{home.name}</strong>, every time (the star). </>
            : data.organizations.length > 0 ? <>No default organization: signs in where they last worked — the star sets one. </> : null}
          {active
            ? <>Working in <strong className="text-foreground">{active.name}</strong> now — the user switches between their organizations from their account menu, which does not change the default. </>
            : null}
          Owners and admins manage an organization's API keys. Platform role <MonoChip>{data.role.replace('_', ' ')}</MonoChip>
          {data.role === 'admin' || data.role === 'super_admin' ? ' also edits and deletes every project of the active organization.' : ''}
        </p>
      </AdminSection>

      <AdminSection title="Projects" badge={`${data.projects.length} project${data.projects.length === 1 ? '' : 's'}`}>
        {data.is_super_admin && (
          <p className="mb-3 text-[12px] text-muted-foreground">Super admin: owner on every project. Memberships below are recorded but do not limit them.</p>
        )}
        {data.projects.length === 0 ? (
          <div className="py-2 text-[12px] text-muted-foreground">No project is visible to this user or recorded for them.</div>
        ) : (
          <div className="divide-y divide-[#e8e8ea] md:divide-[--hair-divider]">
            {data.projects.map((p) => (
              <ProjectRow key={p.project_id} p={p} caps={data.project_capabilities}
                onRole={(role) => (role === NONE ? removeMember(p) : setMember(p, role, p.member && !p.member.expired ? p.member.expires_at : null))}
                onExpiry={(iso) => p.member && setMember(p, p.member.project_role, iso)}
                onRemove={() => removeMember(p)} />
            ))}
          </div>
        )}
        <AddMembership
          projects={allProjects.filter((o) => !memberOf.has(o.id))}
          onAdd={(projectId, role, expiresAt, rationale) =>
            run('admin_set_project_member', { p_project_id: projectId, p_project_role: role, p_expires_at: expiresAt, p_rationale: rationale || null },
              `Added as ${role}`)}
        />
        <RoleLegend matrix={data.role_matrix} caps={data.project_capabilities}
          note="A user's own overrides in Features above take precedence over the project role. Edit Input Data also needs the upload gate: uploads are accepted only from the project's owner, an Editor or Owner on it, or an app admin." />
      </AdminSection>
    </>
  );
}

function ProjectRow({ p, caps, onRole, onExpiry, onRemove }: {
  p: ProjectAccess; caps: { key: string; label: string }[];
  onRole: (role: string) => void; onExpiry: (iso: string | null) => void; onRemove: () => void;
}) {
  const m = p.member;
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="text-[length:var(--fs-row)] font-medium text-[#171717] md:text-[13px] md:text-foreground">
            {p.name}{p.plant_name && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{p.plant_name}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{p.organization_name ?? 'No organization'}</span>
            {p.is_modeler && <MonoChip tone="solid">owner (modeler)</MonoChip>}
            {!p.is_modeler && p.owner_name && <span>· owned by {p.owner_name}</span>}
            {p.in_active_org && <MonoChip>via active organization</MonoChip>}
            {!p.in_active_org && p.in_member_org && <MonoChip>via another of their organizations</MonoChip>}
            {!p.in_member_org && <MonoChip>outside their organizations</MonoChip>}
            {p.delegations.map((d) => (
              <MonoChip key={d.id}>delegated {d.project_role} by {d.grantor ?? 'unknown'} until {day(d.expires_at)}</MonoChip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className={`${KX} mb-1`}>Project role</div>
            {p.is_modeler ? (
              <div className="flex min-h-11 items-center text-[12px] md:min-h-8" title="The modeler stays a standing owner — transfer the project on /admin/projects to change it">Owner (fixed)</div>
            ) : (
              <Select value={m?.project_role ?? NONE} onValueChange={onRole}>
                <SelectTrigger className="min-h-11 w-[124px] rounded-sm md:h-8 md:min-h-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="min-h-11 md:min-h-0">{m ? 'Remove' : 'None'}</SelectItem>
                  {PROJECT_ROLES.map((r) => <SelectItem key={r} value={r} className="min-h-11 md:min-h-0">{cap(r)}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          {m && !p.is_modeler && (
            <div>
              <div className={`${KX} mb-1`}>Until</div>
              <Input
                type="date"
                aria-label={`Membership on ${p.name} ends`}
                value={m.expired ? '' : toDateInput(m.expires_at)}
                onChange={(e) => onExpiry(endOfDay(e.target.value))}
                className="min-h-11 w-[150px] rounded-sm font-mono text-[12px] md:h-8 md:min-h-0"
              />
            </div>
          )}
          {m && !p.is_modeler && (
            <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8" title="Remove membership" aria-label={`Remove membership on ${p.name}`} onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {m && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {m.expired
            ? <span className="text-[#bf2330]">Membership expired {m.expires_at ? day(m.expires_at) : ''} — it grants nothing until renewed.</span>
            : m.expires_at ? `Membership until ${day(m.expires_at)}` : 'Standing membership'}
          {m.granted_by && ` · granted by ${m.granted_by}`}
          {m.rationale && ` · "${m.rationale}"`}
        </div>
      )}
      {/* D231 — the rights below are the rights in this project (while working in its
          organization); where they are working right now is a note, not a right. */}
      {!p.visible && !p.in_member_org && (
        <div className="mt-1.5 text-[11px] text-[#bf2330]">
          Not visible to this user in the app: they are not in this project&apos;s organization, and visibility follows the organization. The role still applies to uploads.
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-[11px] text-muted-foreground">Effective: <strong className="text-foreground">{p.effective_role ? cap(p.effective_role) : 'no project role'}</strong></span>
        <StatusDot tone={p.visible ? 'active' : 'neutral'} label="Sees project" />
        <StatusDot tone={p.can_edit_project ? 'active' : 'neutral'} label="Edits project settings" />
        {caps.map((c) => (
          <StatusDot key={c.key} tone={p.capabilities[c.key] ? 'active' : 'neutral'} label={c.label} />
        ))}
      </div>
      {projectRightsNotes(p).map((n) => <div key={n} className="mt-1 text-[11px] text-muted-foreground">{n}</div>)}
    </div>
  );
}

function AddOrganization({ orgs, onAdd }: { orgs: Option[]; onAdd: (orgId: string, orgRole: string) => Promise<void> }) {
  const [orgId, setOrgId] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!orgId) return;
    setBusy(true);
    await onAdd(orgId, role);
    setBusy(false);
    setOrgId('');
  };
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,2fr)_124px_auto] md:items-center [&>*]:min-w-0">
      <Select value={orgId} onValueChange={setOrgId}>
        <SelectTrigger className="min-h-11 rounded-sm md:h-8 md:min-h-0"><SelectValue placeholder="Add to an organization…" /></SelectTrigger>
        <SelectContent>
          {orgs.length === 0
            ? <SelectItem value={NONE} disabled className="min-h-11 md:min-h-0">No other organization</SelectItem>
            : orgs.map((o) => <SelectItem key={o.id} value={o.id} className="min-h-11 md:min-h-0">{o.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={role} onValueChange={setRole}>
        <SelectTrigger className="min-h-11 rounded-sm md:h-8 md:min-h-0"><SelectValue /></SelectTrigger>
        <SelectContent>{ORG_ROLES.map((r) => <SelectItem key={r.value} value={r.value} className="min-h-11 md:min-h-0">{r.label}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" variant="outline" className="min-h-11 gap-1 rounded-sm md:min-h-0" disabled={!orgId || busy} onClick={submit}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add
      </Button>
    </div>
  );
}

function AddMembership({ projects, onAdd }: {
  projects: Option[];
  onAdd: (projectId: string, role: string, expiresAt: string | null, rationale: string) => Promise<boolean>;
}) {
  const [projectId, setProjectId] = useState('');
  const [role, setRole] = useState('viewer');
  const [until, setUntil] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!projectId) return;
    setBusy(true);
    const ok = await onAdd(projectId, role, endOfDay(until), why.trim());
    setBusy(false);
    if (ok) { setProjectId(''); setUntil(''); setWhy(''); }
  };
  return (
    <div className="mt-4 border-t border-[--hair-border] pt-4">
      <div className={`${KX} mb-2`}>Add to a project</div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,2fr)_124px_150px_minmax(0,1.5fr)_auto] md:items-end [&>*]:min-w-0">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="min-h-11 rounded-sm md:h-8 md:min-h-0"><SelectValue placeholder="Choose a project…" /></SelectTrigger>
          <SelectContent>
            {projects.length === 0
              ? <SelectItem value={NONE} disabled className="min-h-11 md:min-h-0">No other project</SelectItem>
              : projects.map((o) => (
                <SelectItem key={o.id} value={o.id} className="min-h-11 md:min-h-0">{o.name}{o.organization ? ` · ${o.organization}` : ''}</SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="min-h-11 rounded-sm md:h-8 md:min-h-0"><SelectValue /></SelectTrigger>
          <SelectContent>{PROJECT_ROLES.map((r) => <SelectItem key={r} value={r} className="min-h-11 md:min-h-0">{cap(r)}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="date" aria-label="Membership ends (empty = standing)" value={until} onChange={(e) => setUntil(e.target.value)}
          className="min-h-11 rounded-sm font-mono text-[12px] md:h-8 md:min-h-0" />
        <Input placeholder="Why (optional)" value={why} onChange={(e) => setWhy(e.target.value)} className="min-h-11 rounded-sm text-[12px] md:h-8 md:min-h-0" />
        <Button size="sm" className="min-h-11 gap-1 rounded-sm md:min-h-0" disabled={!projectId || busy} onClick={submit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">Leave the date empty for a standing membership.</p>
    </div>
  );
}

export function RoleLegend({ matrix, caps, note = "A user's own overrides in Features above take precedence over the project role." }: {
  matrix: Record<string, Record<string, boolean>>; caps: { key: string; label: string }[]; note?: string;
}) {
  if (caps.length === 0) return null;
  return (
    <details className="mt-4 text-[12px]">
      <summary className="cursor-pointer select-none text-muted-foreground">What each project role grants</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[420px] text-left">
          <thead>
            <tr><th className={cn(KX, FROZEN_CELL, 'py-1 pr-3 font-normal')}>Role</th>{caps.map((c) => <th key={c.key} className={`${KX} py-1 pr-3 font-normal`}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {PROJECT_ROLES.map((r) => (
              <tr key={r} className="border-t border-[--hair-divider]">
                <td className={cn(FROZEN_CELL, 'py-1.5 pr-3 font-medium')}>{cap(r)}</td>
                {caps.map((c) => <td key={c.key} className="py-1.5 pr-3"><StatusDot tone={matrix[r]?.[c.key] ? 'active' : 'neutral'} label={matrix[r]?.[c.key] ? 'Yes' : 'No'} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {note} Promoting an uploaded file needs Editor or Owner.
      </p>
    </details>
  );
}
