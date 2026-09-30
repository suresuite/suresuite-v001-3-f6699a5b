// §4 D213 — /profile › My Access: the signed-in account's roles at all three levels, and
// what they let it do on each project of its current organization, with the reason.
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Minus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useMyOrganizations } from '@/hooks/useMyOrganizations';
import {
  ACCOUNT_TIERS, PROJECT_LEVEL_NOTE, accountTier, isSuperAdmin, orgRoleLabel, platformRole, projectRights,
  projectRoleLabel, roleSource, tierOrgMismatch,
} from '@/lib/auth/accessLevels';
import { listMyProjectRoles, type MyProjectRoleRow } from '@/lib/auth/projectRoles';
import { AccessLevelsGuide } from './AccessLevelsGuide';

function LevelRow({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0 md:grid-cols-[160px_minmax(0,1fr)]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Level {n} &middot; {label}
      </div>
      <div className="min-w-0 space-y-2 text-sm">{children}</div>
    </section>
  );
}

export function MyRolesCard() {
  const { user } = useAuth();
  const { organizations, current } = useMyOrganizations();
  const [projects, setProjects] = useState<MyProjectRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!user?.id) return;
    setLoading(true);
    listMyProjectRoles(user.id).then((res) => {
      if (!live) return;
      setProjects(res.data);
      setError(res.error);
      setLoading(false);
    });
    return () => { live = false; };
  }, [user?.id, current?.org_id]);

  const role = user?.role ?? null;
  const platform = platformRole(role);
  const tier = accountTier(role);
  const superAdmin = isSuperAdmin(role);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Your roles at three levels</CardTitle>
          <CardDescription>
            Platform, organization and project. Only a super admin changes them; ask yours if something here is not what you expect.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LevelRow n={1} label="Platform">
            <div className="font-medium">{platform.label}</div>
            <p className="text-xs text-muted-foreground">{platform.summary}</p>
          </LevelRow>

          <LevelRow n={2} label="Organization">
            <div>
              <span className="text-muted-foreground">Account tier: </span>
              <span className="font-medium">{tier ? ACCOUNT_TIERS[tier].label : 'Super admin (has every tier’s rights where the rules name it)'}</span>
            </div>
            {tier && <p className="text-xs text-muted-foreground">{ACCOUNT_TIERS[tier].summary} It applies in every organization you belong to.</p>}
            {organizations.length === 0 ? (
              <p className="text-xs text-muted-foreground">You belong to no organization, so you can see no projects.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {organizations.map((o) => {
                  const mismatch = tierOrgMismatch(role, o.org_role, 'you');
                  return (
                    <li key={o.org_id} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
                        <span className="text-xs text-muted-foreground">{orgRoleLabel(o.org_role)}</span>
                        {o.is_current && <Badge variant="secondary">Current</Badge>}
                      </div>
                      {mismatch && (
                        <p className="mt-1 flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="min-w-0">{mismatch}</span>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </LevelRow>

          <LevelRow n={3} label="Project">
            <p className="text-xs text-muted-foreground">
              The projects of {current ? <span className="font-medium text-foreground">{current.name}</span> : 'your current organization'}, and what you may do on each.
            </p>
            {loading ? (
              <div className="flex h-16 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : error ? (
              <p className="text-xs text-destructive">Could not load your project roles: {error}</p>
            ) : projects.length === 0 ? (
              <p className="text-xs text-muted-foreground">There are no projects in this organization yet.</p>
            ) : (
              <ul className="space-y-2">
                {projects.map((p) => {
                  const rights = projectRights({ accountRole: role, inProjectOrg: true, isModeler: p.is_modeler, effectiveRole: p.effective_role })
                    .filter((r) => r.key !== 'see');
                  const source = roleSource({
                    isModeler: p.is_modeler, memberRole: p.member_role, delegatedRole: p.delegated_role,
                    accountRole: role, effectiveRole: p.effective_role,
                  });
                  return (
                    <li key={p.project_id} className="rounded-md border px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{p.project_name}</span>
                        <Badge variant={p.effective_role ? 'outline' : 'secondary'}>
                          {projectRoleLabel(p.effective_role)}{source ? ` · ${source}` : ''}
                        </Badge>
                      </div>
                      <ul className="mt-1.5 grid gap-1 text-xs sm:grid-cols-[repeat(3,minmax(0,1fr))]">
                        {rights.map((r) => (
                          <li key={r.key} className={`flex gap-1.5 ${r.allowed ? '' : 'text-muted-foreground'}`}>
                            {r.allowed
                              ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Yes" />
                              : <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-label="No" />}
                            <span className="min-w-0"><span className="font-medium">{r.label}</span> <span className="text-muted-foreground">&mdash; {r.because}</span></span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{PROJECT_LEVEL_NOTE}</p>
          </LevelRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How roles work</CardTitle>
          <CardDescription>Every role on each level, and what it allows. Yours are marked.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccessLevelsGuide mine={{
            platform: superAdmin ? 'super_admin' : 'standard',
            tier,
            orgRole: current?.org_role ?? null,
          }} />
        </CardContent>
      </Card>
    </div>
  );
}
