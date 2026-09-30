// Users (/admin/users) — SuReSuite "Ledger" redesign.
// The list is `admin_list_users` (PLAN.md §4 D205): the page used to read the view
// `v_admin_user_usage`, whose super-admin predicate is false for every browser read
// (the app calls as anon with no session), so it listed NOBODY and said "No users
// yet." The organization shown is resolved through `organization_id`, never the
// stale text copy. Since D210 an account may belong to several organizations: the
// cell shows the ACTIVE one (what RLS reads) and counts the rest, and "Organizations"
// adds or removes memberships (`admin_add_org_member` / `admin_remove_org_member`). Mutations (admin_set_user_role, admin_set_user_active,
// admin_create_user) are unchanged and the server now refuses suspending or demoting
// yourself or the last active super admin. The
// table now uses the shared TH/TD treatment, a status dot, inline icon actions
// (Access / Suspend-Enable) instead of ghost buttons, and the primary
// "Add user" lives in the PageHeader actions.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { AdminMobileList, AdminMobileRow, SURFACE, TH, TD, ROW_HOVER, StatusDot, EmptyRow, LoadingRow, useTableSort, useColumnFilters } from '@/components/admin/adminUi';
import { M, MobileButton } from '@/components/mobile';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { DIALOG_AS_SHEET, HDR_PRIMARY_BUTTON, HDR_SEARCH_INPUT } from '@/components/shared';
import { Ban, Building2, Loader2, Plus, SlidersHorizontal, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { planRefusal } from '@/lib/auth/organizationPlan';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface OrgOption { id: string; name: string; }
interface Membership { org_id: string; name: string; status: string; org_role: string; is_current: boolean; }
interface Row {
  user_id: string; name: string | null; email: string | null; role: string;
  organization_id: string | null; organization: string | null; organization_status: string | null;
  org_role: string | null; is_active: boolean | null;
  mtd_requests: number; mtd_cost_usd: number; monthly_budget_usd: number | null;
  memberships: Membership[];
}

/**
 * The organization cell: the ACTIVE organization's name through the uuid (a suspended
 * org says so), and how many others the account also belongs to (D210).
 */
const orgLabel = (r: Row) => {
  const active = r.organization ? (r.organization_status === 'suspended' ? `${r.organization} (suspended org)` : r.organization) : '';
  const others = (r.memberships ?? []).filter((m) => !m.is_current).length;
  return others ? `${active || '—'} +${others}` : active;
};
/** Every organization the account belongs to, for search and the cell's tooltip. */
const allOrgNames = (r: Row) => (r.memberships ?? []).map((m) => m.name).join(', ');

const ORG_ROLES = ['member', 'admin', 'owner'];

const db = supabase as any;
const ROLES = ['user', 'modeler', 'admin', 'super_admin'];

export default function AdminUsers({ isCollapsed, setIsCollapsed }: Props) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { user: actor } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [membershipsOf, setMembershipsOf] = useState<Row | null>(null);

  const actorArgs = () => ({ p_actor_id: actor?.id, p_actor_email: actor?.email });

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const [usage, orgRes] = await Promise.all([
      db.rpc('admin_list_users', actorArgs()),
      db.rpc('admin_list_organizations', actorArgs()),
    ]);
    // A refused read is not an empty platform: say which it is (D205, D203).
    if (usage.error) {
      setLoadError(usage.error.message === 'forbidden'
        ? 'Only an active super admin can list users.'
        : `Could not load users: ${usage.error.message}`);
    }
    const next = (usage.data ?? []) as Row[];
    setRows(next);
    // Keep an open memberships dialog on the fresh row.
    setMembershipsOf((open) => (open ? next.find((r) => r.user_id === open.user_id) ?? null : null));
    setOrgs(((orgRes.data ?? []) as any[]).map((o) => ({ id: o.id, name: o.name })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.name || '').toLowerCase().includes(s) ||
      (r.email || '').toLowerCase().includes(s) ||
      allOrgNames(r).toLowerCase().includes(s));
  }, [rows, q]);

  const colFilterGetters = useMemo(() => ({
    org: (r: Row) => orgLabel(r), name: (r: Row) => r.name || '', email: (r: Row) => r.email || '',
    role: (r: Row) => r.role, status: (r: Row) => (r.is_active !== false ? 'Active' : 'Suspended'),
    req: (r: Row) => String(r.mtd_requests), cost: (r: Row) => String(r.mtd_cost_usd), budget: (r: Row) => String(r.monthly_budget_usd ?? ''),
  }), []);
  const { filtered: colFiltered, FilterTH } = useColumnFilters(filtered, colFilterGetters);

  const sortGetters = useMemo(() => ({
    org: (r: Row) => orgLabel(r).toLowerCase(), name: (r: Row) => (r.name || '').toLowerCase(),
    email: (r: Row) => (r.email || '').toLowerCase(), role: (r: Row) => r.role.toLowerCase(),
    status: (r: Row) => (r.is_active !== false ? 'active' : 'suspended'),
    req: (r: Row) => r.mtd_requests, cost: (r: Row) => r.mtd_cost_usd, budget: (r: Row) => r.monthly_budget_usd ?? -Infinity,
  }), []);
  const { sorted, SortTH } = useTableSort(colFiltered, sortGetters);

  const changeRole = async (row: Row, next: string) => {
    if (next === row.role) return;
    const { error } = await db.rpc('admin_set_user_role', { ...actorArgs(), p_target_user_id: row.user_id, p_role: next });
    if (error) return toast.error(error.message);
    toast.success(`Role updated for ${row.email}`);
    setRows((prev) => prev.map((r) => (r.user_id === row.user_id ? { ...r, role: next } : r)));
  };

  const toggleActive = async (row: Row) => {
    const next = !(row.is_active ?? true);
    const { error } = await db.rpc('admin_set_user_active', { ...actorArgs(), p_target_user_id: row.user_id, p_is_active: next });
    if (error) return toast.error(error.message);
    toast.success(next ? 'Reactivated' : 'Suspended');
    setRows((prev) => prev.map((r) => (r.user_id === row.user_id ? { ...r, is_active: next } : r)));
  };

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="Users"
      onRefresh={load}
      refreshLoading={loading}
      /* The handoff's slot order is search · refresh · Add user, so the two
         are separate slots: `search` renders before the refresh button,
         `actions` after it. */
      search={
        /* §2.4/G3: the header's right slot is `shrink-0`, so a fixed 240px
           search field cannot give width back to the title - at 390px it took
           the row past the viewport. The clamp reaches 240px from 572px up, so
           the desktop width is unchanged. */
        <Input
          placeholder="Search name, email, org…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={cn('h-8 min-h-11 w-[clamp(130px,42vw,240px)] rounded-sm md:w-60', HDR_SEARCH_INPUT)}
        />
      }
      actions={<AddUserDialog orgs={orgs} actorArgs={actorArgs} onCreated={load} />}
    >
      {isMobile ? (
        <AdminMobileList
          label="Users"
          counter={`${sorted.length}`}
          loading={loading}
          empty={loadError ?? (sorted.length === 0 ? (q ? 'No users match these filters.' : 'No users yet.') : undefined)}
          emptyAction={
            q ? (
              <MobileButton weight="secondary" onClick={() => setQ('')}>
                Clear search
              </MobileButton>
            ) : undefined
          }
        >
          {sorted.map((r) => {
            const active = r.is_active !== false;
            const budget = r.monthly_budget_usd ?? null;
            const remaining = budget != null ? budget - Number(r.mtd_cost_usd) : null;
            return (
              <AdminMobileRow
                key={r.user_id}
                label={r.name || '—'}
                dot={active ? M.process : M.blocking}
                sub={`${r.email || '—'} · ${orgLabel(r) || '—'} · ${r.role} · ${Number(
                  r.mtd_requests,
                ).toLocaleString()} req MTD · budget ${budget != null ? `$${budget.toFixed(2)}` : '—'}${
                  remaining != null && remaining < 0 ? ' · over budget' : ''
                }`}
                value={`$${Number(r.mtd_cost_usd).toFixed(2)}`}
                onOpen={() => navigate(`/admin/users/${r.user_id}`)}
                actionsTitle={r.name || r.email || 'User'}
                actions={[
                  {
                    label: 'Manage access',
                    sub: 'per-user capability overrides',
                    onClick: () => navigate(`/admin/users/${r.user_id}`),
                  },
                  {
                    label: 'Organizations',
                    sub: `${(r.memberships ?? []).length} membership(s)`,
                    onClick: () => setMembershipsOf(r),
                  },
                  ...(r.user_id === actor?.id
                    ? []
                    : [{
                        label: active ? 'Suspend' : 'Enable',
                        tone: (active ? 'danger' : 'default') as 'danger' | 'default',
                        onClick: () => toggleActive(r),
                      }]),
                  ...ROLES.filter((role) => role !== r.role).map((role) => ({
                    label: `Change role to ${role}`,
                    onClick: () => changeRole(r, role),
                  })),
                ]}
              />
            );
          })}
        </AdminMobileList>
      ) : (
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <SortTH sortKey="org">Organization</SortTH><SortTH sortKey="name">Name</SortTH><SortTH sortKey="email">Email</SortTH>
              <SortTH sortKey="role">Role</SortTH><SortTH sortKey="status">Status</SortTH>
              <SortTH sortKey="req" align="right">Req MTD</SortTH><SortTH sortKey="cost" align="right">Cost MTD</SortTH>
              <SortTH sortKey="budget" align="right">Budget</SortTH><th className={`${TH} w-[1%]`} />
            </tr>
            <tr>
              <FilterTH filterKey="org" /><FilterTH filterKey="name" /><FilterTH filterKey="email" />
              <FilterTH filterKey="role" /><FilterTH filterKey="status" />
              <FilterTH filterKey="req" align="right" /><FilterTH filterKey="cost" align="right" />
              <FilterTH filterKey="budget" align="right" /><th className="border-b border-[--hair-border] bg-white" />
            </tr></thead>
            <tbody>
              {loading ? <LoadingRow colSpan={9} /> : loadError ? (
                <EmptyRow colSpan={9} message={loadError} />
              ) : sorted.length === 0 ? (
                <EmptyRow colSpan={9} message={q ? 'No users match these filters.' : 'No users yet.'}
                  action={q ? <Button variant="ghost" size="sm" onClick={() => setQ('')}>Clear search</Button> : undefined} />
              ) : sorted.map((r) => {
                const active = r.is_active !== false;
                const budget = r.monthly_budget_usd ?? null;
                const remaining = budget != null ? budget - Number(r.mtd_cost_usd) : null;
                return (
                  <tr key={r.user_id} className={ROW_HOVER}>
                    <td className={`${TD} text-[13px]`} title={allOrgNames(r) || undefined}>{orgLabel(r) || '—'}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <button onClick={() => navigate(`/admin/users/${r.user_id}`)}
                        className="max-w-[260px] truncate text-left text-[13px] font-medium text-[#bf2330] underline-offset-2 hover:underline">
                        {r.name || '—'}
                      </button>
                    </td>
                    <td className={`${TD} text-[12.5px] text-muted-foreground`}>{r.email}</td>
                    <td className={TD}>
                      <Select value={r.role} onValueChange={(v) => changeRole(r, v)}>
                        <SelectTrigger className="h-7 w-32 rounded-sm text-[12px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{ROLES.map((role) => <SelectItem key={role} value={role} className="min-h-11 md:min-h-0">{role}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className={TD}><StatusDot tone={active ? 'active' : 'error'} label={active ? 'Active' : 'Suspended'} /></td>
                    <td className={`${TD} text-right font-mono text-[12px] tabular-nums text-muted-foreground`}>{Number(r.mtd_requests).toLocaleString()}</td>
                    <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>${Number(r.mtd_cost_usd).toFixed(2)}</td>
                    <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>
                      {budget != null ? (
                        <span className={remaining != null && remaining < 0 ? 'text-[#bf2330]' : ''}>${budget.toFixed(2)}</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-right`}>
                      <span className="inline-flex items-center gap-3 text-[#a3a3a3]">
                        <button title="Manage access" className="hover:text-foreground" onClick={() => navigate(`/admin/users/${r.user_id}`)}>
                          <SlidersHorizontal className="h-[15px] w-[15px]" />
                        </button>
                        <button title="Organizations" className="hover:text-foreground" onClick={() => setMembershipsOf(r)}>
                          <Building2 className="h-[15px] w-[15px]" />
                        </button>
                        {r.user_id !== actor?.id && (
                          <button title={active ? 'Suspend' : 'Enable'} className={active ? 'hover:text-[#bf2330]' : 'hover:text-foreground'} onClick={() => toggleActive(r)}>
                            {active ? <Ban className="h-[15px] w-[15px]" /> : <Undo2 className="h-[15px] w-[15px]" />}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}
      {membershipsOf && (
        <MembershipsDialog row={membershipsOf} orgs={orgs} actorArgs={actorArgs}
          onClose={() => setMembershipsOf(null)} onChanged={load} />
      )}
    </AdminLayout>
  );
}

/**
 * D210 — the organizations one account belongs to. Adding counts against the
 * organization's user limit (D207); removing the account's CURRENT organization moves
 * it to its earliest remaining one, or to none. The account itself chooses which of
 * its organizations is current, from its account menu or /profile.
 */
function MembershipsDialog({ row, orgs, actorArgs, onClose, onChanged }: {
  row: Row; orgs: OrgOption[]; actorArgs: () => { p_actor_id?: string; p_actor_email?: string };
  onClose: () => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [addOrg, setAddOrg] = useState<string>('');
  const [addRole, setAddRole] = useState<string>('member');
  const memberships = row.memberships ?? [];
  const available = orgs.filter((o) => !memberships.some((m) => m.org_id === o.id));

  const add = async () => {
    if (!addOrg) return;
    setBusy(true);
    const { error } = await db.rpc('admin_add_org_member', {
      ...actorArgs(), p_target_user_id: row.user_id, p_org_id: addOrg, p_org_role: addRole,
    });
    setBusy(false);
    if (error) return toast.error(planRefusal(error.message) ?? error.message.replace(/^already_a_member:\s*/, ''));
    toast.success(`${row.email} added to ${orgs.find((o) => o.id === addOrg)?.name ?? 'the organization'}`);
    setAddOrg(''); setAddRole('member'); onChanged();
  };

  const remove = async (m: Membership) => {
    setBusy(true);
    const { error } = await db.rpc('admin_remove_org_member', { ...actorArgs(), p_target_user_id: row.user_id, p_org_id: m.org_id });
    setBusy(false);
    if (error) return toast.error(error.message.replace(/^not_a_member:\s*/, ''));
    toast.success(`${row.email} removed from ${m.name}`);
    onChanged();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className={cn(DIALOG_AS_SHEET, 'md:max-w-lg md:rounded-sm')}>
        <DialogHeader><DialogTitle>Organizations — {row.name || row.email}</DialogTitle></DialogHeader>
        <div className="grid gap-3 text-[13px]">
          {memberships.length === 0 ? (
            <p className="text-muted-foreground">This account belongs to no organization, so it can see no organization&rsquo;s projects.</p>
          ) : (
            <ul className="divide-y rounded-sm border">
              {memberships.map((m) => (
                <li key={m.org_id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {m.name}{m.status === 'suspended' ? ' (suspended org)' : ''}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{m.org_role}</span>
                  {m.is_current && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px]">current</span>}
                  <button title={`Remove from ${m.name}`} disabled={busy}
                    className="grid h-11 w-11 place-items-center text-[#a3a3a3] hover:text-[#bf2330] disabled:opacity-50 md:h-7 md:w-7"
                    onClick={() => remove(m)}>
                    <X className="h-[15px] w-[15px]" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            The account works in its <em>current</em> organization and switches between its organizations itself.
            Removing the current one moves it to its next organization.
          </p>
          {available.length > 0 && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_120px_auto] md:items-end">
              <div className="min-w-0">
                <Label className="text-xs">Add to organization</Label>
                <Select value={addOrg} onValueChange={setAddOrg}>
                  <SelectTrigger className="mt-1 rounded-sm"><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>{available.map((o) => <SelectItem key={o.id} value={o.id} className="min-h-11 md:min-h-0">{o.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="min-w-0">
                <Label className="text-xs">Role there</Label>
                <Select value={addRole} onValueChange={setAddRole}>
                  <SelectTrigger className="mt-1 rounded-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{ORG_ROLES.map((r) => <SelectItem key={r} value={r} className="min-h-11 md:min-h-0">{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button className="rounded-sm" onClick={add} disabled={!addOrg || busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={onClose} disabled={busy}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddUserDialog({ orgs, actorArgs, onCreated }: {
  orgs: OrgOption[]; actorArgs: () => { p_actor_id?: string; p_actor_email?: string }; onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [orgId, setOrgId] = useState<string>('none');

  const reset = () => { setName(''); setEmail(''); setPassword(''); setRole('user'); setOrgId('none'); };

  const create = async () => {
    if (!email.trim()) return toast.error('Email is required');
    if (password.length < 8) return toast.error('Password must be at least 8 characters');
    setSaving(true);
    const { error } = await db.rpc('admin_create_user', {
      ...actorArgs(), p_name: name.trim() || null, p_email: email.trim(),
      p_password: password, p_role: role, p_org_id: orgId === 'none' ? null : orgId,
    });
    setSaving(false);
    // The organization's user limit (D207) refuses with a token before the sentence.
    if (error) return toast.error(planRefusal(error.message) ?? error.message);
    toast.success(`User ${email.trim()} created`);
    reset(); setOpen(false); onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className={cn('gap-1.5 rounded-sm', HDR_PRIMARY_BUTTON)}><Plus className="h-3.5 w-3.5" />Add user</Button>
      </DialogTrigger>
      <DialogContent className={cn(DIALOG_AS_SHEET, 'md:max-w-lg md:rounded-sm')}>
        <DialogHeader><DialogTitle>Add user</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label className="text-xs">Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 rounded-sm" placeholder="Jane Doe" /></div>
          <div><Label className="text-xs">Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 rounded-sm" placeholder="jane@company.com" /></div>
          <div>
            <Label className="text-xs">Temporary password</Label>
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 rounded-sm" placeholder="at least 8 characters" />
            <p className="mt-1 text-xs text-muted-foreground">The user must change this on first login.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))]">
            <div className="min-w-0">
              <Label className="text-xs">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="mt-1 rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r} className="min-h-11 md:min-h-0">{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label className="text-xs">Organization</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger className="mt-1 rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="min-h-11 md:min-h-0">— None —</SelectItem>
                  {orgs.map((o) => <SelectItem key={o.id} value={o.id} className="min-h-11 md:min-h-0">{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button className="rounded-sm" onClick={create} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create user</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
