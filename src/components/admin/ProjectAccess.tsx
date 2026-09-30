// Members & access for one project — /admin/projects (PLAN.md §4 D215).
//
// Reads `admin_get_project_access`: every account that owns the project, holds a
// membership or a live delegation on it, or belongs to its organization, each with WHERE
// the access comes from and the rights it holds there (`project_rights_for_user`, D219 —
// the resolver plus the upload gate and suspension, the same answer /admin/users/:userId,
// /profile and the app's own gates read, never computed here). Memberships are granted, changed and removed through D211's
// `admin_set_project_member` / `admin_remove_project_member`; the database refuses
// changing the modeler's own membership, which the dialog only mirrors — ownership moves
// with "Transfer or change owner" (D212).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { KX, MonoChip, StatusDot } from '@/components/admin/adminUi';
import { RoleLegend } from '@/components/admin/UserMemberships';
import { PROJECT_ROLES, cap, day, endOfDay, toDateInput } from '@/components/admin/projectRoles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DIALOG_AS_SHEET } from '@/components/shared';
import { cn } from '@/lib/utils';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { projectRightsNotes } from '@/lib/auth/projectRights';

interface Member {
  project_role: string; expires_at: string | null; expired: boolean;
  rationale: string | null; granted_by: string | null; updated_at: string;
}
interface Delegation { id: string; project_role: string; expires_at: string; rationale: string; grantor: string | null }
interface Person {
  user_id: string; name: string | null; email: string | null; account_active: boolean;
  role: string; is_super_admin: boolean; is_modeler: boolean;
  org_role: string | null; in_project_org: boolean; active_in_project_org: boolean;
  visible: boolean; can_edit_project: boolean;
  /** D219 — the upload gate, and the role's answer before it and suspension. */
  may_land_uploads?: boolean; resolved_capabilities?: Record<string, boolean>;
  member: Member | null; delegations: Delegation[];
  effective_role: string | null; capabilities: Record<string, boolean>;
}
interface AccessData {
  project_id: string; name: string; organization_id: string | null; organization_name: string | null;
  modeler_id: string; people: Person[];
  project_capabilities: { key: string; label: string }[];
  role_matrix: Record<string, Record<string, boolean>>;
}
export interface AccessUserOption { id: string; name: string | null; email: string | null; is_active: boolean | null }

interface RpcResult { data: unknown; error: { message: string } | null }
// The admin RPCs are not in the generated Database types; name only what is called.
const db = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => Promise<RpcResult> };
const NONE = '__none__';
const personLabel = (p: { name: string | null; email: string | null; user_id?: string; id?: string }) =>
  p.name || p.email || p.user_id || p.id || '—';

export function ProjectAccessDialog({ projectId, projectName, users, actorId, actorEmail, onClose }: {
  projectId: string; projectName: string; users: AccessUserOption[];
  actorId?: string; actorEmail?: string | null; onClose: () => void;
}) {
  const [data, setData] = useState<AccessData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const actorArgs = useMemo(() => ({ p_actor_id: actorId, p_actor_email: actorEmail }), [actorId, actorEmail]);

  const load = useCallback(async () => {
    setError(null);
    const res = await db.rpc('admin_get_project_access', { ...actorArgs, p_project_id: projectId });
    if (res.error) setError(res.error.message === 'forbidden'
      ? 'Only an active super admin can read who is on a project.'
      : `Could not load the project's members: ${res.error.message}`);
    else setData(res.data as AccessData);
    setLoading(false);
  }, [actorArgs, projectId]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { error: err } = await db.rpc(fn, { ...actorArgs, p_project_id: projectId, ...args });
    if (err) {
      toast.error(err.message);
      return false;
    }
    toast.success(ok);
    await load();
    return true;
  };

  const setMember = (p: Person, role: string, expiresAt: string | null, rationale: string | null = null) =>
    run('admin_set_project_member', { p_target_user_id: p.user_id, p_project_role: role, p_expires_at: expiresAt, p_rationale: rationale },
      `${personLabel(p)}: ${role}${expiresAt ? ` until ${day(expiresAt)}` : ''}`);

  const removeMember = (p: Person) => {
    if (!confirm(`Remove ${personLabel(p)}'s ${p.member?.project_role} membership on "${projectName}"?`)) return;
    run('admin_remove_project_member', { p_target_user_id: p.user_id }, `${personLabel(p)}: membership removed`);
  };

  const withRole = useMemo(() => (data?.people ?? []).filter((p) => p.is_modeler || p.member || p.delegations.length > 0), [data]);
  const orgOnly = useMemo(() => (data?.people ?? []).filter((p) => !(p.is_modeler || p.member || p.delegations.length > 0)), [data]);
  const addable = useMemo(() => {
    const recorded = new Set((data?.people ?? []).filter((p) => p.is_modeler || p.member).map((p) => p.user_id));
    return users.filter((u) => u.is_active !== false && !recorded.has(u.id));
  }, [data, users]);
  const orgName = data?.organization_name ?? 'its organization';

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className={cn(
          DIALOG_AS_SHEET,
          'gap-0 p-0 md:max-w-3xl md:rounded-sm',
        )}
      >
        <DialogHeader className="border-b border-[--hair-border] px-4 pb-3 pr-12 pt-4 md:px-6 md:pr-12 md:pt-6">
          <DialogTitle>Members &amp; access — “{projectName}”</DialogTitle>
          <DialogDescription>
            Who can see and work on this project, where their access comes from, and what they may do.
            Super admins are owner on every project and are listed only when they are recorded here.
          </DialogDescription>
        </DialogHeader>

        {/* The body caps its own height, so scrolling doesn't depend on how
            DialogContent or DIALOG_AS_SHEET lay out their children. */}
        <div className="max-h-[calc(90dvh-9rem)] overflow-y-auto overscroll-contain px-4 py-4 md:max-h-[calc(85vh-9rem)] md:px-6 md:pb-6">
          {loading ? (
            <div className="grid h-24 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : error || !data ? (
            <div className="rounded-sm border border-[#bf2330]/40 bg-[#bf2330]/10 p-3 text-sm text-[#bf2330]">{error}</div>
          ) : (
            <div className="grid gap-4">
              <AddMember users={addable} orgName={orgName}
                onAdd={(userId, role, expiresAt, rationale) =>
                  run('admin_set_project_member', { p_target_user_id: userId, p_project_role: role, p_expires_at: expiresAt, p_rationale: rationale || null },
                    `Added as ${role}`)} />

              <section>
                <div className={`${KX} mb-1`}>With a project role · {withRole.length}</div>
                {withRole.length === 0 ? (
                  <div className="py-2 text-[12px] text-muted-foreground">Nobody holds a role on this project.</div>
                ) : (
                  <div className="divide-y divide-[#e8e8ea] md:divide-[--hair-divider]">
                    {withRole.map((p) => (
                      <PersonRow key={p.user_id} p={p} orgName={orgName} caps={data.project_capabilities}
                        onRole={(role) => (role === NONE ? removeMember(p) : setMember(p, role, p.member && !p.member.expired ? p.member.expires_at : null))}
                        onExpiry={(iso) => p.member && setMember(p, p.member.project_role, iso)}
                        onRemove={() => removeMember(p)} />
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className={`${KX} mb-1`}>In {orgName}, no project role · {orgOnly.length}</div>
                {orgOnly.length === 0 ? (
                  <div className="py-2 text-[12px] text-muted-foreground">
                    {data.organization_id ? `Every member of ${orgName} holds a role on this project.` : 'The project belongs to no organization.'}
                  </div>
                ) : (
                  <>
                    <p className="mb-1 text-[11px] text-muted-foreground">
                      They see the project while {orgName} is the organization they are working in, and hold no project role on it.
                    </p>
                    <div className="divide-y divide-[#e8e8ea] md:divide-[--hair-divider]">
                      {orgOnly.map((p) => (
                        <PersonRow key={p.user_id} p={p} orgName={orgName} caps={data.project_capabilities}
                          onRole={(role) => role !== NONE && setMember(p, role, null)}
                          onExpiry={() => undefined} onRemove={() => undefined} />
                      ))}
                    </div>
                  </>
                )}
              </section>

              <RoleLegend matrix={data.role_matrix} caps={data.project_capabilities}
                note="A person's own overrides on their user page take precedence over the project role. Edit Input Data also needs the upload gate: uploads are accepted only from the project's owner or an app admin." />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

function PersonRow({ p, orgName, caps, onRole, onExpiry, onRemove }: {
  p: Person; orgName: string; caps: { key: string; label: string }[];
  onRole: (role: string) => void; onExpiry: (iso: string | null) => void; onRemove: () => void;
}) {
  const m = p.member;
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="text-[length:var(--fs-row)] font-medium text-[#171717] md:text-[13px] md:text-foreground">
            <Link to={`/admin/users/${p.user_id}`} className="hover:underline">{personLabel(p)}</Link>
            {p.name && p.email && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{p.email}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {p.is_modeler && <MonoChip tone="solid">owner (modeler)</MonoChip>}
            {p.is_super_admin && <MonoChip>super admin</MonoChip>}
            {p.in_project_org ? <MonoChip>{p.org_role ?? 'member'} of {orgName}</MonoChip> : <MonoChip>not in {orgName}</MonoChip>}
            {p.in_project_org && !p.active_in_project_org && <MonoChip>working in another organization</MonoChip>}
            {!p.account_active && <MonoChip>suspended</MonoChip>}
            {p.delegations.map((d) => (
              <MonoChip key={d.id}>delegated {d.project_role} by {d.grantor ?? 'unknown'} until {day(d.expires_at)}</MonoChip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className={`${KX} mb-1`}>Project role</div>
            {p.is_modeler ? (
              <div className="flex min-h-11 items-center text-[12px] md:min-h-8" title="The modeler stays a standing owner — use Transfer or change owner to change it">Owner (fixed)</div>
            ) : (
              <Select value={m?.project_role ?? NONE} onValueChange={onRole}>
                <SelectTrigger className="min-h-11 w-[124px] rounded-sm md:h-8 md:min-h-0" aria-label={`Project role of ${personLabel(p)}`}><SelectValue /></SelectTrigger>
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
                aria-label={`Membership of ${personLabel(p)} ends`}
                value={m.expired ? '' : toDateInput(m.expires_at)}
                onChange={(e) => onExpiry(endOfDay(e.target.value))}
                className="min-h-11 w-[150px] rounded-sm font-mono text-[12px] md:h-8 md:min-h-0"
              />
            </div>
          )}
          {m && !p.is_modeler && (
            <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8" title="Remove membership" aria-label={`Remove ${personLabel(p)}'s membership`} onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {m && !p.is_modeler && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {m.expired
            ? <span className="text-[#bf2330]">Membership expired {m.expires_at ? day(m.expires_at) : ''} — it grants nothing until renewed.</span>
            : m.expires_at ? `Membership until ${day(m.expires_at)}` : 'Standing membership'}
          {m.granted_by && ` · granted by ${m.granted_by}`}
          {m.rationale && ` · "${m.rationale}"`}
        </div>
      )}
      {!p.visible && p.account_active && (
        <div className={`mt-1.5 text-[11px] ${p.in_project_org ? 'text-muted-foreground' : 'text-[#bf2330]'}`}>
          {p.in_project_org
            ? `Sees the project after switching to ${orgName}: visibility follows the organization they are working in.`
            : `Does not see the project in the app: not a member of ${orgName}, and visibility follows the organization. The role still applies to uploads and to the rights below.`}
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

function AddMember({ users, orgName, onAdd }: {
  users: AccessUserOption[]; orgName: string;
  onAdd: (userId: string, role: string, expiresAt: string | null, rationale: string) => Promise<boolean>;
}) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('viewer');
  const [until, setUntil] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!userId) return;
    setBusy(true);
    const ok = await onAdd(userId, role, endOfDay(until), why.trim());
    setBusy(false);
    if (ok) { setUserId(''); setUntil(''); setWhy(''); }
  };
  return (
    <div className="border-b border-[--hair-border] pt-4">
      <div className={`${KX} mb-2`}>Add a member</div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,2fr)_124px_150px_minmax(0,1.5fr)_auto] md:items-end [&>*]:min-w-0">
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="min-h-11 rounded-sm md:h-8 md:min-h-0"><SelectValue placeholder="Choose a person…" /></SelectTrigger>
          <SelectContent>
            {users.length === 0
              ? <SelectItem value={NONE} disabled className="min-h-11 md:min-h-0">No other active account</SelectItem>
              : users.map((u) => (
                <SelectItem key={u.id} value={u.id} className="min-h-11 md:min-h-0">{u.name ? `${u.name} (${u.email})` : u.email || u.id}</SelectItem>
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
        <Button size="sm" className="min-h-11 gap-1 rounded-sm md:min-h-0" disabled={!userId || busy} onClick={submit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Leave the date empty for a standing membership. Someone outside {orgName} is recorded but does not see the project until they belong to it.
      </p>
    </div>
  );
}
}