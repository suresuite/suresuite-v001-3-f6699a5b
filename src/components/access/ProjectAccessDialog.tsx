// §4 D213 — /admin/projects › Access: everyone with standing on one project, at all three
// levels (platform/tier, role in the project's organization, project role), what each may
// do there today and why, and the project role — the one level set here.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DIALOG_AS_SHEET } from '@/components/shared';
import { cn } from '@/lib/utils';
import {
  PROJECT_LEVEL_NOTE, PROJECT_ROLES, PROJECT_ROLE_INFO, orgRoleLabel, projectRights, projectRoleLabel, tierLabel,
  tierOrgMismatch,
} from '@/lib/auth/accessLevels';
import {
  adminProjectAccess, adminRemoveProjectMember, adminSetProjectMember, type Actor, type ProjectAccessRow,
} from '@/lib/auth/projectRoles';

const NO_ROLE = '__none__';

export function ProjectAccessDialog({ project, actor, onClose }: {
  project: { id: string; name: string; organization: string | null };
  actor: Actor;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ProjectAccessRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await adminProjectAccess(actor, project.id);
    setRows(res.data);
    setError(res.error);
    // The actor does not change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  useEffect(() => { load(); }, [load]);

  const setRole = async (r: ProjectAccessRow, next: string) => {
    if ((r.member_role ?? NO_ROLE) === next) return;
    setBusy(r.user_id);
    const who = r.name || r.email || 'the account';
    const { error: refusal } = next === NO_ROLE
      ? await adminRemoveProjectMember(actor, project.id, r.user_id)
      : await adminSetProjectMember(actor, project.id, r.user_id, next);
    setBusy(null);
    if (refusal) return toast.error(refusal);
    toast.success(next === NO_ROLE ? `${who} no longer holds a role on this project` : `${who} is now ${projectRoleLabel(next)} on this project`);
    load();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className={cn(DIALOG_AS_SHEET, 'md:max-w-3xl md:rounded-sm')}>
        <DialogHeader>
          <DialogTitle>Access — “{project.name}”</DialogTitle>
          <DialogDescription>
            Everyone in {project.organization || 'its organization'}, and anyone else holding a role on this project, with their
            roles at all three levels and what they may do here today. The project role is set here.
          </DialogDescription>
        </DialogHeader>

        {rows === null && !error ? (
          <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <p className="text-[13px] text-[#bf2330]">Could not load this project&rsquo;s access: {error}</p>
        ) : rows && rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nobody belongs to this project&rsquo;s organization yet.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-sm border text-[13px]">
            {(rows ?? []).map((r) => {
              const rights = projectRights({
                accountRole: r.account_role, inProjectOrg: r.in_project_org, isModeler: r.is_modeler, effectiveRole: r.effective_role,
              }).filter((x) => x.key !== 'see');
              const mismatch = r.in_project_org ? tierOrgMismatch(r.account_role, r.org_role) : null;
              const delegated = r.delegated_role && r.delegated_role === r.effective_role && r.delegated_role !== r.member_role;
              return (
                <li key={r.user_id} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {r.name || r.email}
                        {r.is_active === false && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(suspended)</span>}
                      </div>
                      <div className="truncate text-[12px] text-muted-foreground">
                        {tierLabel(r.account_role)} tier &middot; {r.in_project_org ? `${orgRoleLabel(r.org_role)} in the organization` : 'not in this organization'}
                        {r.is_modeler ? ' · owns the project' : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {busy === r.user_id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      <Select
                        value={r.member_role ?? NO_ROLE}
                        onValueChange={(v) => setRole(r, v)}
                        disabled={busy !== null || r.is_modeler || (!r.in_project_org && !r.member_role)}
                      >
                        <SelectTrigger className="h-8 w-32 rounded-sm text-[12px]" aria-label={`Project role of ${r.name || r.email}`}
                          title={r.is_modeler ? 'The project’s owner always holds Owner. Transfer the project to change its owner.' : undefined}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ROLE} className="min-h-11 md:min-h-0">No role</SelectItem>
                          {r.in_project_org && PROJECT_ROLES.map((role) => (
                            <SelectItem key={role} value={role} className="min-h-11 md:min-h-0">{PROJECT_ROLE_INFO[role].label}</SelectItem>
                          ))}
                          {!r.in_project_org && r.member_role && (
                            <SelectItem value={r.member_role} className="min-h-11 md:min-h-0">{projectRoleLabel(r.member_role)}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {(delegated || (r.account_role === 'super_admin' && !r.member_role)) && (
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      Effective role: <span className="font-medium text-foreground">{projectRoleLabel(r.effective_role)}</span>
                      {delegated
                        ? ` — delegated${r.delegation_expires_at ? ` until ${new Date(r.delegation_expires_at).toLocaleDateString()}` : ''}`
                        : ' — a super admin counts as Owner'}
                    </p>
                  )}
                  {!r.in_project_org && r.member_role && (
                    <p className="mt-1 flex gap-1.5 text-[12px] text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0">This account left the project&rsquo;s organization (or the project moved) but still holds this role. Set it to No role unless it should rejoin the organization.</span>
                    </p>
                  )}
                  {mismatch && (
                    <p className="mt-1 flex gap-1.5 text-[12px] text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0">{mismatch}</span>
                    </p>
                  )}

                  <ul className="mt-1.5 grid gap-1 text-[12px] sm:grid-cols-[repeat(3,minmax(0,1fr))]">
                    {rights.map((x) => (
                      <li key={x.key} className={`flex gap-1.5 ${x.allowed ? '' : 'text-muted-foreground'}`} title={x.because}>
                        {x.allowed
                          ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Yes" />
                          : <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-label="No" />}
                        <span className="min-w-0"><span className="font-medium">{x.label}</span> &mdash; {x.because}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{PROJECT_LEVEL_NOTE}</p>
        <p className="text-xs text-muted-foreground">
          To give someone outside {project.organization || 'the organization'} a role here, add them to the organization first (Users &rarr; Roles).
        </p>

        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={onClose} disabled={busy !== null}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
