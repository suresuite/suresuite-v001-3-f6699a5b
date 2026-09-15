// @ts-nocheck — schema mismatch: this file uses RPCs (update_own_profile, change_own_password) not present in the current types. Remove once RPCs land.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '@/components/shared/PageLayout';
import { PageHeader } from '@/components/shared/PageHeader';
import { PAGE_GUTTER } from '@/components/shared/PageBody';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { PAGE_CAPABILITIES, FEATURE_CAPABILITIES } from '@/lib/capabilities';
import { AlertCircle, Ban, Check, Loader2, Upload } from 'lucide-react';

interface ProfileProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

const Profile = ({ isCollapsed, setIsCollapsed }: ProfileProps) => {
  const { user, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const initialTab = params.get('tab') === 'password' ? 'password' : 'profile';
  const forced = params.get('forced') === '1';

  const [tab, setTab] = useState(initialTab);
  const [displayName, setDisplayName] = useState(user?.display_name ?? user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    setDisplayName(user?.display_name ?? user?.name ?? '');
    setPhone(user?.phone ?? '');
  }, [user?.id, user?.display_name, user?.phone, user?.name]);

  const onSaveProfile = async () => {
    setSavingProfile(true);
    const { error } = await supabase.rpc('update_own_profile', {
      p_display_name: displayName || null,
      p_phone: phone || null,
      p_avatar_url: null,
    });
    setSavingProfile(false);
    if (error) {
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
      return;
    }
    await refreshProfile();
    toast({ title: 'Profile updated' });
  };

  const onAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Max 2 MB.', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = data.publicUrl;
      const { error: rpcErr } = await supabase.rpc('update_own_profile', {
        p_display_name: null,
        p_phone: null,
        p_avatar_url: publicUrl,
      });
      if (rpcErr) throw rpcErr;
      await refreshProfile();
      toast({ title: 'Avatar updated' });
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
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
    setSavingPw(true);
    const { error } = await supabase.rpc('change_own_password', {
      p_old_password: oldPw,
      p_new_password: newPw,
    });
    setSavingPw(false);
    if (error) {
      const msg =
        error.message?.includes('invalid_current_password')
          ? 'Your current password is incorrect.'
          : error.message?.includes('password_too_short')
          ? 'New password must be at least 8 characters.'
          : error.message;
      toast({ title: 'Could not change password', description: msg, variant: 'destructive' });
      return;
    }
    setOldPw('');
    setNewPw('');
    setConfirmPw('');
    await refreshProfile();
    toast({ title: 'Password changed', description: 'Your password is updated and valid for 90 days.' });
    if (forced) {
      // Clear the forced flag so guards stop redirecting
      setParams({}, { replace: true });
    }
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


      {forced && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You must change your password before continuing.
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => { setTab(v); setParams(v === 'password' ? { tab: 'password' } : {}, { replace: true }); }} className="max-w-3xl">
        <TabsList>
          <TabsTrigger value="profile" disabled={forced}>Profile</TabsTrigger>
          <TabsTrigger value="access" disabled={forced}>My Access</TabsTrigger>
          <TabsTrigger value="password">Change Password</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile information</CardTitle>
              <CardDescription>Your name and contact details visible to teammates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt="Avatar" /> : null}
                  <AvatarFallback className="bg-primary text-primary-foreground text-lg">{initial}</AvatarFallback>
                </Avatar>
                <div>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatarPick} />
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    {uploading ? 'Uploading…' : 'Upload avatar'}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">PNG or JPG, up to 2 MB.</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={user?.email ?? ''} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Input value={user?.role ?? ''} disabled className="capitalize" />
                </div>
                <div className="space-y-2">
                  <Label>Organization</Label>
                  <Input value={user?.organization ?? ''} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="display_name">Display name</Label>
                  <Input id="display_name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
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

        <TabsContent value="password">
          <Card>
            <CardHeader>
              <CardTitle>Change password</CardTitle>
              <CardDescription>
                Use at least 8 characters. Passwords expire every 90 days for security.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
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
              <Button onClick={onChangePassword} disabled={savingPw || !oldPw || !newPw}>
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