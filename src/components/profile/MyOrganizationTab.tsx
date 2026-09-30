// /profile · "My organization" (PLAN.md §4 D217) — who else is in the account's active
// organization and on its projects, and what each of them may do. Read-only: every role
// and right here is the database's answer (`get_my_organization_access`,
// `get_my_project_access` → `project_access_read`, the read /admin/projects shows).
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RoleLegend } from '@/components/admin/UserMemberships';
import { cap, day } from '@/components/admin/projectRoles';
import { useAuth } from '@/hooks/useAuth';
import { useGlobalProject } from '@/hooks/useGlobalProject';
import {
  getMyOrganizationAccess, getMyProjectAccess, holdsProjectRole,
  type MyOrganizationAccess, type ProjectAccess, type ProjectPerson,
} from '@/lib/auth/myOrganizationAccess';
import { Ban, Check, Loader2 } from 'lucide-react';

/** `super_admin` → "Super admin". */
const roleLabel = (role: string | null | undefined) =>
  role ? role.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '';
const personLabel = (p: { name: string | null; email: string | null; user_id: string }) => p.name || p.email || p.user_id;

function DefaultOrg({ id, name, here }: { id: string | null; name: string | null; here: string }) {
  if (!id) return <span className="text-muted-foreground">None set</span>;
  return (
    <span>
      {name ?? 'Unknown organization'}
      {id === here && <span className="text-muted-foreground"> (this one)</span>}
    </span>
  );
}

function Loading() {
  return (
    <div className="flex h-24 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{text}</p>;
}

export function MyOrganizationTab() {
  const { user } = useAuth();
  const { globalSelectedProjectId } = useGlobalProject();
  const [org, setOrg] = useState<MyOrganizationAccess | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>('');

  useEffect(() => {
    if (!user?.id) return;
    let live = true;
    getMyOrganizationAccess(user.id).then((res) => {
      if (!live) return;
      setOrg(res.data);
      setOrgError(res.error);
      const ids = res.data?.projects.map((p) => p.project_id) ?? [];
      setProjectId(globalSelectedProjectId && ids.includes(globalSelectedProjectId) ? globalSelectedProjectId : ids[0] ?? '');
    });
    return () => { live = false; };
  // The remembered project only picks the first selection; changing it later must not reload the list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!org && !orgError) {
    return <Card><CardContent><Loading /></CardContent></Card>;
  }
  if (orgError || !org) {
    return <Card><CardContent className="pt-6"><ErrorLine text={orgError ?? 'Unknown error.'} /></CardContent></Card>;
  }
  if (!org.organization) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My organization</CardTitle>
          <CardDescription>Your account does not belong to an organization. Contact your administrator.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const o = org.organization;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            My organization: {o.name}
            {o.is_my_default && <Badge variant="outline" title="You sign in to this organization">Your default</Badge>}
          </CardTitle>
          <CardDescription>
            Everyone who belongs to the organization you are working in, their role in it, and their default
            organization — the one they sign in to. Read-only: an administrator makes changes.
            {o.my_org_role && <> Your role here: <strong className="text-foreground">{roleLabel(o.my_org_role)}</strong>.</>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-2 text-xs text-muted-foreground">{org.members.length} {org.members.length === 1 ? 'member' : 'members'}</div>
          <ul className="divide-y rounded-md border">
            {org.members.map((m) => (
              <li key={m.user_id} className="grid gap-x-4 gap-y-1 px-3 py-2.5 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{personLabel(m)}</span>
                    {m.is_you && <Badge variant="secondary">You</Badge>}
                    {!m.account_active && <Badge variant="outline" className="text-muted-foreground">Suspended</Badge>}
                  </div>
                  {m.name && m.email && <div className="truncate text-xs text-muted-foreground">{m.email}</div>}
                </div>
                <div className="text-xs md:text-sm">
                  <span className="text-muted-foreground md:hidden">Role: </span>
                  {roleLabel(m.org_role)}
                  <span className="text-muted-foreground"> · {roleLabel(m.role)} account</span>
                </div>
                <div className="text-xs md:text-sm">
                  <span className="text-muted-foreground">Default: </span>
                  <DefaultOrg id={m.default_org_id} name={m.default_org_name} here={o.id} />
                  {!m.working_here && <div className="text-xs text-muted-foreground">Working in another organization now</div>}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Members see every project of {o.name} while it is the organization they are working in, with or without a project role.
          </p>
        </CardContent>
      </Card>

      <ProjectsCard
        orgId={o.id}
        orgName={o.name}
        projects={org.projects}
        projectId={projectId}
        onProject={setProjectId}
        userId={user?.id ?? ''}
      />
    </div>
  );
}

function ProjectsCard({ orgId, orgName, projects, projectId, onProject, userId }: {
  orgId: string; orgName: string; projects: MyOrganizationAccess['projects'];
  projectId: string; onProject: (id: string) => void; userId: string;
}) {
  const [access, setAccess] = useState<ProjectAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId || !userId) { setAccess(null); return; }
    let live = true;
    setLoading(true);
    setError(null);
    getMyProjectAccess(userId, projectId).then((res) => {
      if (!live) return;
      setAccess(res.data);
      setError(res.error);
      setLoading(false);
    });
    return () => { live = false; };
  }, [projectId, userId]);

  const withRole = useMemo(() => (access?.people ?? []).filter(holdsProjectRole), [access]);
  const orgOnly = useMemo(() => (access?.people ?? []).filter((p) => !holdsProjectRole(p)), [access]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Projects</CardTitle>
        <CardDescription>
          For each project of {orgName}: everyone who has access, where it comes from, and what they may do there.
          Super admins can reach every project and are listed only when they are recorded on it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{orgName} has no projects yet.</p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="org-access-project">Project</Label>
            <Select value={projectId} onValueChange={onProject}>
              <SelectTrigger id="org-access-project" className="min-h-11 md:min-h-0 md:max-w-md"><SelectValue placeholder="Choose a project…" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.project_id} value={p.project_id} className="min-h-11 md:min-h-0">
                    {p.name}
                    <span className="text-muted-foreground"> · {p.my_role ? `you: ${cap(p.my_role)}` : 'you: via organization'} · {p.role_holders} with a role</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorLine text={error} />
        ) : access ? (
          <>
            <section>
              <h3 className="mb-1 text-sm font-semibold">With a project role · {withRole.length}</h3>
              {withRole.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody holds a role on this project.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {withRole.map((p) => <PersonRow key={p.user_id} p={p} orgId={orgId} orgName={orgName} caps={access.project_capabilities} />)}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-1 text-sm font-semibold">In {orgName}, no project role · {orgOnly.length}</h3>
              {orgOnly.length === 0 ? (
                <p className="text-sm text-muted-foreground">Every member of {orgName} holds a role on this project.</p>
              ) : (
                <>
                  <p className="mb-1 text-xs text-muted-foreground">
                    They see the project while {orgName} is the organization they are working in, and hold no project role on it.
                  </p>
                  <ul className="divide-y rounded-md border">
                    {orgOnly.map((p) => <PersonRow key={p.user_id} p={p} orgId={orgId} orgName={orgName} caps={access.project_capabilities} />)}
                  </ul>
                </>
              )}
            </section>
            <RoleLegend matrix={access.role_matrix} caps={access.project_capabilities}
              note="An administrator can override a person's rights on their account, and that takes precedence over the project role." />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Right({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${on ? '' : 'text-muted-foreground'}`}>
      {on
        ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        : <Ban className="h-3.5 w-3.5" aria-hidden />}
      <span className="sr-only">{on ? 'Yes: ' : 'No: '}</span>{label}
    </span>
  );
}

function PersonRow({ p, orgId, orgName, caps }: {
  p: ProjectPerson; orgId: string; orgName: string; caps: { key: string; label: string }[];
}) {
  const m = p.member;
  return (
    <li className="space-y-1.5 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{personLabel(p)}</span>
        {p.name && p.email && <span className="text-xs text-muted-foreground">{p.email}</span>}
        {p.is_modeler && <Badge variant="secondary">Owner</Badge>}
        {p.is_super_admin && <Badge variant="outline">Super admin</Badge>}
        {!p.account_active && <Badge variant="outline" className="text-muted-foreground">Suspended</Badge>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        <span>Default organization: <span className="text-foreground"><DefaultOrg id={p.default_org_id} name={p.default_org_name} here={orgId} /></span></span>
        <span>{p.in_project_org ? `${roleLabel(p.org_role ?? 'member')} of ${orgName}` : `Not a member of ${orgName}`}</span>
      </div>
      {(m || p.delegations.length > 0) && !p.is_modeler && (
        <div className="text-xs text-muted-foreground">
          {m && (
            m.expired
              ? <span className="text-destructive">{cap(m.project_role)} membership expired{m.expires_at ? ` ${day(m.expires_at)}` : ''} — it grants nothing until renewed.</span>
              : <span>{cap(m.project_role)} member{m.expires_at ? ` until ${day(m.expires_at)}` : ''}{m.granted_by ? ` · granted by ${m.granted_by}` : ''}</span>
          )}
          {p.delegations.map((d) => (
            <div key={d.id}>Delegated {cap(d.project_role)} by {d.grantor ?? 'unknown'} until {day(d.expires_at)}</div>
          ))}
        </div>
      )}
      {!p.visible && (
        <div className="text-xs text-muted-foreground">
          {p.in_project_org
            ? `Sees the project after switching to ${orgName}.`
            : `Does not see the project in the app: visibility follows the organization. The role still applies to uploads and to the rights below.`}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-xs text-muted-foreground">
          Project role: <strong className="text-foreground">{p.effective_role ? cap(p.effective_role) : 'none'}</strong>
        </span>
        <Right on={p.visible} label="Sees project" />
        <Right on={p.can_edit_project} label="Edits project settings" />
        {caps.map((c) => <Right key={c.key} on={!!p.capabilities[c.key]} label={c.label} />)}
      </div>
    </li>
  );
}
