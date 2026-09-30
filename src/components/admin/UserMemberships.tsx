// Organization & projects for one account — /admin/users/:userId (PLAN.md §4 D210).
//
// Reads `admin_get_user_memberships`: the account's organization with its role IN that
// organization, and every project it can reach or is recorded on, each with WHERE the
// access comes from (organization, ownership, membership, delegation) and the rights
// the resolver gives it there (`capabilities_for_user(user, project)` — never computed
// here a second time). Writes through four super-admin verbs; the database refuses
// changing the project modeler's own membership, which the page only mirrors.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminSection, KX, MonoChip, Segmented, StatusDot } from '@/components/admin/adminUi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FROZEN_CELL } from '@/components/shared';
import { cn } from '@/lib/utils';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Actor { id: string; email?: string | null }
interface OrgInfo {
  id: string; name: string; slug: string | null; status: string | null;
  access_valid_until: string | null; org_role: string | null; members: number; projects: number;
}
interface Member {
  project_role: string; expires_at: string | null; expired: boolean;
  rationale: string | null; granted_by: string | null; updated_at: string;
}
interface Delegation { id: string; project_role: string; expires_at: string; rationale: string; grantor: string | null }
interface ProjectAccess {
  project_id: string; name: string; plant_name: string | null;
  organization_id: string | null; organization_name: string | null;
  in_user_org: boolean; is_modeler: boolean; owner_name: string | null;
  visible: boolean; can_edit_project: boolean;
  member: Member | null; delegations: Delegation[];
  effective_role: string | null; capabilities: Record<string, boolean>;
}
interface MembershipData {
  user_id: string; role: string; is_super_admin: boolean;
  organization: OrgInfo | null; projects: ProjectAccess[];
  project_capabilities: { key: string; label: string }[];
  role_matrix: Record<string, Record<string, boolean>>;
}
interface Option { id: string; name: string; organization?: string | null }

interface RpcResult { data: unknown; error: { message: string } | null }
// The admin RPCs are not in the generated Database types; name only what is called.
const db = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult> };
const PROJECT_ROLES = ['owner', 'editor', 'analyst', 'viewer'] as const;
const ORG_ROLES = [{ value: 'owner', label: 'Owner' }, { value: 'admin', label: 'Admin' }, { value: 'member', label: 'Member' }];
const NONE = '__none__';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const day = (iso: string) => new Date(iso).toLocaleDateString();
/** A date input's day → the END of that day, local time, as an instant. */
const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);
const toDateInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function UserMemberships({ actor, userId, userLabel, onOrganizationChanged }: {
  actor: Actor; userId: string; userLabel: string; onOrganizationChanged?: () => void;
}) {
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
    if (err) { toast.error(err.message); return false; }
    toast.success(ok);
    await load();
    return true;
  };

  const moveOrg = async (orgId: string) => {
    if (!data || orgId === data.organization?.id) return;
    const to = orgs.find((o) => o.id === orgId)?.name ?? 'the selected organization';
    const from = data.organization?.name ?? 'no organization';
    if (!confirm(`Move ${userLabel} from ${from} to ${to}?\n\nThey will see ${to}'s projects instead of ${from}'s, and their role in the organization is reset to the default for their platform role. Project memberships are kept.`)) return;
    if (await run('admin_set_user_organization', { p_org_id: orgId }, `Moved to ${to}`)) onOrganizationChanged?.();
  };

  const setMember = (p: ProjectAccess, role: string, expiresAt: string | null) =>
    run('admin_set_project_member', { p_project_id: p.project_id, p_project_role: role, p_expires_at: expiresAt, p_rationale: null },
      `${p.name}: ${role}${expiresAt ? ` until ${day(expiresAt)}` : ''}`);

  const removeMember = (p: ProjectAccess) => {
    if (!confirm(`Remove ${userLabel}'s ${p.member?.project_role} membership on "${p.name}"?`)) return;
    run('admin_remove_project_member', { p_project_id: p.project_id }, `${p.name}: membership removed`);
  };

  if (loading) {
    return <AdminSection title="Organization & projects"><div className="grid h-20 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div></AdminSection>;
  }
  if (error || !data) {
    return <AdminSection title="Organization & projects"><div className="rounded-sm border border-[#bf2330]/40 bg-[#bf2330]/10 p-3 text-sm text-[#bf2330]">{error}</div></AdminSection>;
  }

  const org = data.organization;
  const memberOf = new Set(data.projects.filter((p) => p.member).map((p) => p.project_id));

  return (
    <>
      <AdminSection title="Organization" badge={org?.status === 'suspended' ? 'suspended' : undefined}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(2,minmax(0,1fr))] [&>*]:min-w-0">
          <div>
            <Label className="text-xs">Organization</Label>
            <Select value={org?.id ?? NONE} onValueChange={moveOrg}>
              <SelectTrigger className="mt-1 min-h-11 rounded-sm md:min-h-0"><SelectValue placeholder="No organization" /></SelectTrigger>
              <SelectContent>
                {!org && <SelectItem value={NONE} disabled className="min-h-11 md:min-h-0">No organization</SelectItem>}
                {orgs.map((o) => <SelectItem key={o.id} value={o.id} className="min-h-11 md:min-h-0">{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
              {org
                ? <>Sees every project of {org.name} · {org.members} member(s) · {org.projects} project(s){org.access_valid_until ? ` · access until ${day(org.access_valid_until)}` : ''}</>
                : 'In no organization, so no project is visible through one.'}
            </p>
          </div>
          <div>
            <Label className="text-xs">Role in the organization</Label>
            <div className="mt-1">
              {org ? (
                <Segmented
                  value={org.org_role ?? ''}
                  options={ORG_ROLES}
                  onChange={(v) => v !== org.org_role && run('admin_set_user_org_role', { p_org_role: v }, `Organization role: ${v}`)}
                />
              ) : <span className="text-[12px] text-muted-foreground">Set an organization first</span>}
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
              Owners and admins manage the organization's API keys. Platform role <MonoChip>{data.role.replace('_', ' ')}</MonoChip>
              {data.role === 'admin' ? ' also edits and deletes every project of the organization.' : ''}
            </p>
          </div>
        </div>
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
        <RoleLegend matrix={data.role_matrix} caps={data.project_capabilities} />
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
            {p.in_user_org && <MonoChip>via organization</MonoChip>}
            {!p.in_user_org && <MonoChip>other organization</MonoChip>}
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
      {!p.visible && (
        <div className="mt-1.5 text-[11px] text-[#bf2330]">
          Not visible to this user in the app: project visibility follows the organization. The role still applies to uploads and to the rights below.
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

function RoleLegend({ matrix, caps }: { matrix: Record<string, Record<string, boolean>>; caps: { key: string; label: string }[] }) {
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
        A user's own overrides in Features above take precedence over the project role. Promoting an uploaded file needs Editor or Owner.
      </p>
    </details>
  );
}
