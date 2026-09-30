// @ts-nocheck — schema mismatch: this file uses RPCs (update_own_profile, change_own_password) not present in the current types. Remove once RPCs land.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '@/components/shared/PageLayout';
import { PageHeader } from '@/components/shared/PageHeader';
import { PAGE_GUTTER } from '@/components/shared/PageBody';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { PAGE_CAPABILITIES, FEATURE_CAPABILITIES } from '@/lib/capabilities';
import { AlertCircle, Ban, Check, Copy, Loader2 } from 'lucide-react';
import { describeExpiry, formatDate, passwordStatus, relativeDay } from '@/lib/auth/passwordPolicy';
import { AVATAR_COLORS, DEFAULT_AVATAR_CLASS, avatarClass, isAvatarColor } from '@/lib/avatarColors';
import { formatPlanDate, periodLabel, usage } from '@/lib/auth/organizationPlan';
import { useMyOrganizations } from '@/hooks/useMyOrganizations';
import { MyOrganizationTab } from '@/components/profile/MyOrganizationTab';

/** `super_admin` → "Super admin". The stored value is an enum token, not a label. */
const roleLabel = (role: string | undefined | null) =>
  role ? role.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '';

/**
 * D207 — the organization's access period as one line: "1 month, from 3 Sep 2026".
 * An account with no organization has no plan, and says so.
 */
function validityText(user: { organization?: string | null; users_used?: number | null; access_period?: string | null; access_valid_from?: string | null } | null) {
  if (!user || user.users_used == null) return 'No organization';
  if (!user.access_period) return periodLabel(null);
  return `${periodLabel(user.access_period)}, from ${formatPlanDate(user.access_valid_from)}`;
}

/** The RPCs' refusals, in words (see PLAN.md §4 D206 for where each is raised). */
function accountError(message: string | undefined): string {
  const m = message ?? '';
  if (m.includes('invalid_current_password')) return 'Your current password is incorrect.';
  if (m.includes('password_too_short')) return 'New password must be at least 8 characters.';
  if (m.includes('password_unchanged')) return 'The new password must be different from your current one.';
  if (m.includes('account_inactive')) return 'Your account has been deactivated. Contact your administrator.';
  if (m.includes('not_authenticated')) return 'Your session could not be verified. Please sign out and sign in again.';
  return m || 'Unknown error.';
}

interface ProfileProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

const Profile = ({ isCollapsed, setIsCollapsed }: ProfileProps) => {
  const { user, refreshProfile } = useAuth();
  const { toast } = useToast();
  // D210 — every organization this account belongs to; the plan fields below are the ACTIVE one's.
  const { organizations, switching, switchTo } = useMyOrganizations();
  const onSwitch = async (orgId: string) => {
    const refusal = await switchTo(orgId);
    if (refusal) toast({ title: 'Could not switch organization', description: refusal, variant: 'destructive' });
  };
  const [params, setParams] = useSearchParams();
  // A required change is read from the ACCOUNT, not from the URL: `?forced=1` is only
  // where RoleGuard sends you, and editing it away must not unlock the other tabs.
  const pw = passwordStatus(user);
  const locked = pw.mustChange;
  const initialTab = locked || params.get('tab') === 'password'
    ? 'password'
    : params.get('tab') === 'organization' ? 'organization' : 'profile';

  const [tab, setTab] = useState(initialTab);
  const [copiedId, setCopiedId] = useState(false);
  // The user name is the stored `display_name` only; the account name is the
  // placeholder, not a value that "Save changes" would silently copy into it.
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  // The avatar is the user's initial on a colour they choose; there is no image upload
  // (D206). '' is "Default" — the theme's primary colour.
  const [avatarColor, setAvatarColor] = useState(isAvatarColor(user?.avatar_color) ? user.avatar_color : '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    setDisplayName(user?.display_name ?? '');
    setPhone(user?.phone ?? '');
    setAvatarColor(isAvatarColor(user?.avatar_color) ? user.avatar_color : '');
  }, [user?.id, user?.display_name, user?.phone, user?.avatar_color]);

  useEffect(() => {
    if (locked) setTab('password');
  }, [locked]);

  const onSaveProfile = async () => {
    setSavingProfile(true);
    // A blank string CLEARS the field; NULL would leave it unchanged (D206). The first
    // and last name are not sent: they identify the account holder and only an
    // administrator changes them (D209).
    const { error } = await supabase.rpc('update_own_profile', {
      p_display_name: displayName.trim(),
      p_phone: phone.trim(),
      p_avatar_color: avatarColor,
      p_user_id: user?.id,
    });
    setSavingProfile(false);
    if (error) {
      toast({ title: 'Could not save', description: accountError(error.message), variant: 'destructive' });
      return;
    }
    await refreshProfile();
    toast({ title: 'Profile updated' });
  };

  const onCopyId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    } catch {
      toast({ title: 'Could not copy', description: 'Select the ID and copy it manually.', variant: 'destructive' });
    }
  };

  const onChangePassword = async () => {
    if (newPw.length < 8) {
      toast({ title: 'Password too short', description: 'Use at least 8 characters.', variant: 'destructive' });
      return;
    }
    if (newPw !== confirmPw) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (newPw === oldPw) {
      toast({ title: 'Choose a new password', description: accountError('password_unchanged'), variant: 'destructive' });
      return;
    }
    setSavingPw(true);
    const { data: newExpiry, error } = await supabase.rpc('change_own_password', {
      p_old_password: oldPw,
      p_new_password: newPw,
      p_user_id: user?.id,
    });
    setSavingPw(false);
    if (error) {
      toast({ title: 'Could not change password', description: accountError(error.message), variant: 'destructive' });
      return;
    }
    setOldPw('');
    setNewPw('');
    setConfirmPw('');
    // The account row, not this page, decides whether the other pages open again.
    await refreshProfile();
    const until = newExpiry ? new Date(newExpiry as string) : null;
    toast({
      title: 'Password changed',
      description: until && !Number.isNaN(until.getTime())
        ? `Your new password is valid until ${formatDate(until)}.`
        : 'Your password has been updated.',
    });
    if (params.get('forced')) setParams({ tab: 'password' }, { replace: true });
  };

  const initial = (user?.display_name || user?.name || user?.email || '?').charAt(0).toUpperCase();

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className={PAGE_GUTTER}>
        {/* Title only on desktop — the handoff's bar has no subtitle element.
            The prop stays because this page renders one tree at both widths and
            PageHeader hides the line from `md` up; deleting it here would take
            the phone's context line with it. */}
        <PageHeader title="My Profile" subtitle="Manage your account, contact info, and password." />


      {locked && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {pw.expired
              ? `${describeExpiry(pw)} You must change it before continuing.`
              : 'You must set a new password before continuing.'}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => { if (locked) return; setTab(v); setParams(v === 'password' || v === 'organization' ? { tab: v } : {}, { replace: true }); }} className="max-w-3xl">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="profile" disabled={locked}>Profile</TabsTrigger>
          <TabsTrigger value="access" disabled={locked}>My Access</TabsTrigger>
          <TabsTrigger value="organization" disabled={locked}>My Organization</TabsTrigger>
          <TabsTrigger value="password">Change Password</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile information</CardTitle>
              <CardDescription>Who this account belongs to, and the user name and contact details visible to teammates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16 shrink-0">
                  <AvatarFallback className={`${avatarClass(avatarColor)} text-lg`}>{initial}</AvatarFallback>
                </Avatar>
                <div className="space-y-2">
                  <Label id="avatar-color-label">Avatar colour</Label>
                  <div role="radiogroup" aria-labelledby="avatar-color-label" className="flex flex-wrap gap-1.5">
                    {[['', 'Default', DEFAULT_AVATAR_CLASS] as const,
                      ...Object.entries(AVATAR_COLORS).map(([k, v]) => [k, v.label, v.className] as const),
                    ].map(([value, label, fill]) => {
                      const selected = avatarColor === value;
                      return (
                        <button
                          key={value || 'default'}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={label}
                          title={label}
                          onClick={() => setAvatarColor(value)}
                          className={`h-11 w-11 md:h-7 md:w-7 rounded-full ${fill} outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'ring-2 ring-foreground' : ''}`}
                        >
                          {selected && <Check className="mx-auto h-3.5 w-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">Saved with “Save changes”.</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="user_id">User ID</Label>
                  <div className="flex gap-2">
                    <Input id="user_id" value={user?.id ?? ''} readOnly className="font-mono text-xs md:text-sm" onFocus={(e) => e.target.select()} />
                    <Button type="button" variant="outline" size="icon" className="h-11 w-11 md:h-10 md:w-10 shrink-0" onClick={onCopyId} aria-label="Copy user ID" title="Copy user ID">
                      {copiedId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your account's permanent identifier — it does not change when your name or email does.
                    API keys you create on the Developer API page are recorded as created by this ID.
                  </p>
                </div>
                {/* D209 — the account holder's identity, as an administrator recorded it. Read-only
                    here so every action stays attributable to an identified person. */}
                <div className="space-y-2">
                  <Label htmlFor="first_name">First name</Label>
                  <Input id="first_name" value={user?.first_name ?? ''} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name">Last name</Label>
                  <Input id="last_name" value={user?.last_name ?? ''} placeholder="—" disabled />
                </div>
                <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">
                  Your first and last name identify you as the account holder and can only be changed by an administrator.
                </p>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="display_name">User name</Label>
                  <Input id="display_name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={user?.name ?? ''} autoComplete="nickname" />
                  <p className="text-xs text-muted-foreground">The name shown in the navigation bar and account menu. Leave blank to use your full name.</p>
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={user?.email ?? ''} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Input value={roleLabel(user?.role)} disabled />
                </div>
                <div className="space-y-2">
                  <Label>{organizations.length > 1 ? 'Current organization' : 'Organization'}</Label>
                  <Input value={user?.organization ?? ''} disabled />
                </div>
                {/* D210 — an account may belong to several organizations and works in one at a time. */}
                {organizations.length > 1 && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Your organizations</Label>
                    <ul className="divide-y rounded-md border">
                      {organizations.map((o) => (
                        <li key={o.org_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                          <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
                          {o.is_default && <Badge variant="outline" title="You sign in to this organization">Default</Badge>}
                          <span className="text-xs text-muted-foreground">{roleLabel(o.org_role)}</span>
                          {o.access_expired ? (
                            <Badge variant="outline" className="text-muted-foreground">Access ended</Badge>
                          ) : o.is_current ? (
                            <Badge variant="secondary"><Check className="mr-1 h-3 w-3" />Current</Badge>
                          ) : (
                            <Button size="sm" variant="outline" className="min-h-11 md:min-h-0" disabled={switching !== null} onClick={() => onSwitch(o.org_id)}>
                              {switching === o.org_id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                              Switch
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      You work in one organization at a time: the projects you see and create are the current organization&rsquo;s. The plan below is the current organization&rsquo;s. Switching reloads the app.
                      {organizations.some((o) => o.is_default) && <> Each time you sign in you start in your default organization, set by an administrator.</>}
                    </p>
                  </div>
                )}
                {/* D207 — the organization's plan, set by an administrator; read here, never edited. */}
                <div className="space-y-2">
                  <Label>Valid for</Label>
                  <Input value={validityText(user)} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Valid until</Label>
                  <Input
                    value={user?.access_valid_until
                      ? `${formatPlanDate(user.access_valid_until)}${user.access_exempt ? ' (does not apply to super admins)' : ''}`
                      : '—'}
                    disabled
                  />
                </div>
                <div className="space-y-2">
                  <Label>Organization users</Label>
                  <Input value={user?.users_used == null ? '—' : usage(user.users_used, user.user_limit)} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Organization projects</Label>
                  <Input value={user?.projects_used == null ? '—' : usage(user.projects_used, user.project_limit)} disabled />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div>
                <Button onClick={onSaveProfile} disabled={savingProfile}>
                  {savingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save changes
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access">
          <MyAccessTab />
        </TabsContent>

        {/* D217 — who else is in the organization and on its projects, and what each may do. */}
        <TabsContent value="organization">
          <MyOrganizationTab />
        </TabsContent>

        <TabsContent value="password">
          <Card>
            <CardHeader>
              <CardTitle>Change password</CardTitle>
              <CardDescription>
                Use at least 8 characters.
                {pw.maxAgeDays ? ` Passwords expire ${pw.maxAgeDays} days after they are set.` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
              {(pw.changedAt || pw.expiresAt) && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {pw.changedAt && (
                    <>
                      <dt className="text-muted-foreground">Last changed</dt>
                      <dd className="tabular-nums">{formatDate(pw.changedAt)}</dd>
                    </>
                  )}
                  {pw.expiresAt && (
                    <>
                      <dt className="text-muted-foreground">{pw.expired ? 'Expired' : 'Expires'}</dt>
                      <dd className={`tabular-nums ${pw.expired ? 'text-destructive' : ''}`}>
                        {formatDate(pw.expiresAt)}
                        {relativeDay(pw) && (
                          <span className="text-muted-foreground"> · {relativeDay(pw)}</span>
                        )}
                      </dd>
                    </>
                  )}
                </dl>
              )}
              <div className="space-y-2">
                <Label htmlFor="old">Current password</Label>
                <Input id="old" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new">New password</Label>
                <Input id="new" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input id="confirm" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
              </div>
              <Button onClick={onChangePassword} disabled={savingPw || !oldPw || !newPw || !confirmPw}>
                {savingPw && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update password
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </PageLayout>

  );
};

function prettyModel(code: string): string {
  // "google/gemini-2.5-flash" → "Gemini 2.5 Flash"
  const tail = code.includes('/') ? code.split('/').slice(1).join('/') : code;
  return tail
    .replace(/[-_]/g, ' ')
    .replace(/\bgpt\b/gi, 'GPT')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function MyAccessTab() {
  const { capabilities, loading } = useCapabilities();

  if (loading && !capabilities) {
    return (
      <Card>
        <CardContent className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  if (!capabilities) return null;

  const allowedPages = PAGE_CAPABILITIES.filter((c) => capabilities.pages[c.key]);
  const budgets = capabilities.budgets;
  const money = (n: number | null) => (n == null ? null : `$${Number(n).toFixed(2)}`);

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>What you can access</CardTitle>
          <CardDescription>
            A read-only summary of your current access. To request changes, contact your administrator.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Pages */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Pages you can open</h3>
            <div className="flex flex-wrap gap-2">
              {allowedPages.length === 0 ? (
                <span className="text-sm text-muted-foreground">No pages available.</span>
              ) : (
                allowedPages.map((p) => (
                  <span
                    key={p.key}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-sm"
                  >
                    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    {p.label}
                  </span>
                ))
              )}
            </div>
          </section>

          {/* Features */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Features</h3>
            {/* D219 — these are ACCOUNT-wide; on a project the role there decides the four
                project rights, and that is what the app applies. */}
            <p className="mb-2 text-xs text-muted-foreground">
              Account-wide. On each project, Run Simulations, Edit Input Data, Edit Policies and Export
              follow your role on that project — see My Organization for what you may do there.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {FEATURE_CAPABILITIES.map((f) => {
                const on = !!capabilities.features[f.key];
                return (
                  <div
                    key={f.key}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    <span className={on ? '' : 'text-muted-foreground'}>{f.label}</span>
                    {on ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                        <Check className="mr-0.5 h-3 w-3" /> On
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">
                        <Ban className="mr-0.5 h-3 w-3" /> Off
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* AI models */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">AI models you can use</h3>
            {capabilities.models.all_allowed ? (
              <span className="text-sm text-muted-foreground">All enabled models are available to you.</span>
            ) : capabilities.models.allowed_codes.length === 0 ? (
              <span className="text-sm text-muted-foreground">No AI models are enabled for your account.</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {capabilities.models.allowed_codes.map((code) => (
                  <Badge key={code} variant="outline">
                    {prettyModel(code)}
                  </Badge>
                ))}
              </div>
            )}
            {capabilities.models.default_code && (
              <p className="mt-2 text-xs text-muted-foreground">
                Default: {prettyModel(capabilities.models.default_code)}
                {capabilities.models.fallback_code
                  ? ` · Fallback: ${prettyModel(capabilities.models.fallback_code)}`
                  : ''}
              </p>
            )}
          </section>
        </CardContent>
      </Card>

      {/* Budget & usage */}
      <Card>
        <CardHeader>
          <CardTitle>AI budget &amp; usage</CardTitle>
          <CardDescription>Your spend caps and current usage this month.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <UsageBox
              label="Spent this month"
              value={money(budgets.mtd_cost_usd) ?? '$0.00'}
              cap={budgets.monthly_usd != null ? `of ${money(budgets.monthly_usd)}` : 'no monthly cap'}
              over={budgets.monthly_usd != null && budgets.mtd_cost_usd >= budgets.monthly_usd}
            />
            <UsageBox
              label="Spent today"
              value={money(budgets.today_cost_usd) ?? '$0.00'}
              cap={budgets.daily_usd != null ? `of ${money(budgets.daily_usd)}` : 'no daily cap'}
              over={budgets.daily_usd != null && budgets.today_cost_usd >= budgets.daily_usd}
            />
            <UsageBox label="Requests this month" value={budgets.mtd_requests.toLocaleString()} />
            <UsageBox
              label="Requests today"
              value={budgets.today_requests.toLocaleString()}
              cap={budgets.rpd != null ? `of ${budgets.rpd}` : undefined}
              over={budgets.rpd != null && budgets.today_requests >= budgets.rpd}
            />
          </div>
          {budgets.monthly_usd == null && budgets.daily_usd == null && (
            <p className="mt-3 text-xs text-muted-foreground">
              No budget limit is set on your account — usage is tracked but not capped.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UsageBox({
  label,
  value,
  cap,
  over,
}: {
  label: string;
  value: string;
  cap?: string;
  over?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${over ? 'text-destructive' : ''}`}>{value}</div>
      {cap && <div className="text-[11px] text-muted-foreground tabular-nums">{cap}</div>}
    </div>
  );
}

export default Profile;