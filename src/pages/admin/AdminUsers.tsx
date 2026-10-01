// Users (/admin/users) — SuReSuite "Ledger" redesign.
// The list is `admin_list_users` (PLAN.md §4 D205): the page used to read the view
// `v_admin_user_usage`, whose super-admin predicate is false for every browser read
// (the app calls as anon with no session), so it listed NOBODY and said "No users
// yet." The organization shown is resolved through `organization_id`, never the
// stale text copy. Since D210 an account may belong to several organizations, so the
// table has TWO columns: "Default organization" is the membership a super admin marked
// as the account's default (`is_default`, D216 — where EVERY sign-in lands, however
// often the account switched in between; until D216 this column showed the ACTIVE
// organization, which follows every switch), with the active one beneath it when they
// differ; and "Accessible organizations" names every membership — it used to be one
// cell reading "X +3", which hid which three. "Organizations" adds or removes memberships (`admin_add_org_member` / `admin_remove_org_member`). Mutations (admin_set_user_role, admin_set_user_active,
// admin_create_user) are unchanged and the server now refuses suspending or demoting
// yourself or the last active super admin. The
// table now uses the shared TH/TD treatment, a status dot, inline icon actions
// (Access / Suspend-Enable) instead of ghost buttons, and the primary
// "Add user" lives in the PageHeader actions.
//
// §4 D251 — "Forgot password?" on the sign-in page records a request; open requests are
// listed above the table, and "Reset password…" (from a request or from a row) sets a
// temporary password generated in this browser, which the person must change at their
// next sign-in. The request changes nothing by itself: anyone can type an email, so the
// dialog asks the super admin to confirm with the person first.
//
// §4 D161/D213 — "Delete permanently…" is a DIFFERENT verb from Suspend, as on
// /admin/organizations. `admin_delete_user` removes the account and its memberships;
// what the person recorded (uploaded files, runs, lanes) is KEPT with its actor
// anonymised — WP 7.2 (a). The dialog says so and asks for the email, which the
// server checks.
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
import { ConfirmSheet } from '@/components/shared/confirm/ConfirmSheet';
import { confirmBullets } from '@/components/shared/confirm/confirmBullets';
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter, ResponsiveDialogTrigger } from '@/components/shared/ResponsiveDialog';
import { DIALOG_AS_SHEET, HDR_PRIMARY_BUTTON, HDR_SEARCH_INPUT } from '@/components/shared';
import { Ban, Building2, KeyRound, Loader2, Plus, SlidersHorizontal, Star, Trash2, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { planRefusal } from '@/lib/auth/organizationPlan';
import { dismissResetRequest, listResetRequests, resetUserPassword, type ResetRequest } from '@/lib/auth/passwordReset';
import { generateTemporaryPassword } from '@/lib/auth/temporaryPassword';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface OrgOption { id: string; name: string; }
interface Membership { org_id: string; name: string; status: string; org_role: string; is_current: boolean; is_default?: boolean; }
interface Row {
  user_id: string; name: string | null; email: string | null; role: string;
  organization_id: string | null; organization: string | null; organization_status: string | null;
  org_role: string | null; is_active: boolean | null;
  mtd_requests: number; mtd_cost_usd: number; monthly_budget_usd: number | null;
  memberships: Membership[];
}

/**
 * The default organization (D216): the membership a super admin marked as the account's
 * default — where every sign-in lands. Empty when none is set; such an account signs in
 * where it last worked.
 */
const defaultOrg = (r: Row) => (r.memberships ?? []).find((m) => m.is_default) ?? null;
const defaultOrgLabel = (r: Row) => {
  const d = defaultOrg(r);
  return d ? (d.status === 'suspended' ? `${d.name} (suspended org)` : d.name) : '';
};
/**
 * The ACTIVE organization, by name through the uuid (a suspended org says so): where the
 * account works now. The account switches it itself, among its memberships (D210).
 */
const activeOrgLabel = (r: Row) =>
  r.organization ? (r.organization_status === 'suspended' ? `${r.organization} (suspended org)` : r.organization) : '';
/** Every organization the account belongs to — the default first, then the active one, then by name. */
const accessibleOrgs = (r: Row) =>
  [...(r.memberships ?? [])].sort((a, b) =>
    Number(!!b.is_default) - Number(!!a.is_default) || Number(b.is_current) - Number(a.is_current) || a.name.localeCompare(b.name));
const accessibleOrgNames = (r: Row) =>
  accessibleOrgs(r).map((m) => (m.status === 'suspended' ? `${m.name} (suspended org)` : m.name)).join(', ');

const ORG_ROLES = ['member', 'admin', 'owner'];

const db = supabase as any;
/** Who a reset is for — a table row or a request. */
interface ResetTarget { user_id: string; email: string | null; name: string | null }
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
  const [deleteOf, setDeleteOf] = useState<Row | null>(null);
  const [resetOf, setResetOf] = useState<ResetTarget | null>(null);
  const [requests, setRequests] = useState<ResetRequest[]>([]);

  const actorArgs = () => ({ p_actor_id: actor?.id, p_actor_email: actor?.email });

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const [usage, orgRes, resetRes] = await Promise.all([
      db.rpc('admin_list_users', actorArgs()),
      db.rpc('admin_list_organizations', actorArgs()),
      listResetRequests(actorArgs()),
    ]);
    setRequests(resetRes.data);
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
      accessibleOrgNames(r).toLowerCase().includes(s));
  }, [rows, q]);

  const colFilterGetters = useMemo(() => ({
    org: (r: Row) => defaultOrgLabel(r), orgs: (r: Row) => accessibleOrgNames(r), name: (r: Row) => r.name || '', email: (r: Row) => r.email || '',
    role: (r: Row) => r.role, status: (r: Row) => (r.is_active !== false ? 'Active' : 'Suspended'),
    req: (r: Row) => String(r.mtd_requests), cost: (r: Row) => String(r.mtd_cost_usd), budget: (r: Row) => String(r.monthly_budget_usd ?? ''),
  }), []);
  const { filtered: colFiltered, FilterTH } = useColumnFilters(filtered, colFilterGetters);

  const sortGetters = useMemo(() => ({
    org: (r: Row) => defaultOrgLabel(r).toLowerCase(), orgs: (r: Row) => (r.memberships ?? []).length, name: (r: Row) => (r.name || '').toLowerCase(),
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

  const dismissRequest = async (r: ResetRequest) => {
    const { error } = await dismissResetRequest(actorArgs(), r.id);
    if (error) return toast.error(error);
    toast.success(`Request from ${r.email} dismissed`);
    setRequests((prev) => prev.filter((x) => x.id !== r.id));
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
      {requests.length > 0 && (
        <ResetRequestsPanel requests={requests} onReset={(r) => setResetOf(r)} onDismiss={dismissRequest} />
      )}
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
                sub={`${r.email || '—'} · default org ${defaultOrgLabel(r) || 'not set'}${
                  activeOrgLabel(r) && activeOrgLabel(r) !== defaultOrgLabel(r) ? ` · now in ${activeOrgLabel(r)}` : ''} · access ${(r.memberships ?? []).length} org(s) · ${r.role} · ${Number(
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
                  ...(r.user_id === actor?.id
                    ? []
                    : [{
                        label: 'Reset password…',
                        sub: 'temporary password, changed at next sign-in',
                        onClick: () => setResetOf(r),
                      }]),
                  ...ROLES.filter((role) => role !== r.role).map((role) => ({
                    label: `Change role to ${role}`,
                    onClick: () => changeRole(r, role),
                  })),
                  ...(r.user_id === actor?.id
                    ? []
                    : [{
                        label: 'Delete permanently…',
                        tone: 'danger' as const,
                        onClick: () => setDeleteOf(r),
                      }]),
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
              <SortTH sortKey="org">
                <span title="Where the account lands at every sign-in, set here by a super admin. Between sign-ins the account switches among the organizations it can access; the one it works in now is shown beneath when it differs.">Default organization</span>
              </SortTH>
              <SortTH sortKey="orgs">
                <span title="Every organization the account belongs to and can switch to, the default first.">Accessible organizations</span>
              </SortTH>
              <SortTH sortKey="name">Name</SortTH><SortTH sortKey="email">Email</SortTH>
              <SortTH sortKey="role">Role</SortTH><SortTH sortKey="status">Status</SortTH>
              <SortTH sortKey="req" align="right">Req MTD</SortTH><SortTH sortKey="cost" align="right">Cost MTD</SortTH>
              <SortTH sortKey="budget" align="right">Budget</SortTH><th className={`${TH} w-[1%]`} />
            </tr>
            <tr>
              <FilterTH filterKey="org" /><FilterTH filterKey="orgs" /><FilterTH filterKey="name" /><FilterTH filterKey="email" />
              <FilterTH filterKey="role" /><FilterTH filterKey="status" />
              <FilterTH filterKey="req" align="right" /><FilterTH filterKey="cost" align="right" />
              <FilterTH filterKey="budget" align="right" /><th className="border-b border-[--hair-border] bg-white" />
            </tr></thead>
            <tbody>
              {loading ? <LoadingRow colSpan={10} /> : loadError ? (
                <EmptyRow colSpan={10} message={loadError} />
              ) : sorted.length === 0 ? (
                <EmptyRow colSpan={10} message={q ? 'No users match these filters.' : 'No users yet.'}
                  action={q ? <Button variant="ghost" size="sm" onClick={() => setQ('')}>Clear search</Button> : undefined} />
              ) : sorted.map((r) => {
                const active = r.is_active !== false;
                const budget = r.monthly_budget_usd ?? null;
                const remaining = budget != null ? budget - Number(r.mtd_cost_usd) : null;
                return (
                  <tr key={r.user_id} className={ROW_HOVER}>
                    <td className={`${TD} whitespace-nowrap text-[13px]`}>
                      {defaultOrgLabel(r) || <span className="text-muted-foreground" title="No default set: the account signs in where it last worked">not set</span>}
                      {activeOrgLabel(r) && activeOrgLabel(r) !== defaultOrgLabel(r) && (
                        <div className="text-[11px] text-muted-foreground" title="The organization the account is working in now">now in {activeOrgLabel(r)}</div>
                      )}
                    </td>
                    <td className={`${TD} text-[12.5px] text-muted-foreground`}>
                      {(r.memberships ?? []).length === 0 ? '—' : (
                        <button title={`${accessibleOrgNames(r)} — manage organizations`} onClick={() => setMembershipsOf(r)}
                          className="block max-w-[280px] truncate text-left underline-offset-2 hover:text-foreground hover:underline">
                          {accessibleOrgNames(r)}
                        </button>
                      )}
                    </td>
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
                          <button title="Reset password…" className="hover:text-foreground" onClick={() => setResetOf(r)}>
                            <KeyRound className="h-[15px] w-[15px]" />
                          </button>
                        )}
                        {r.user_id !== actor?.id && (
                          <button title={active ? 'Suspend' : 'Enable'} className={active ? 'hover:text-[#bf2330]' : 'hover:text-foreground'} onClick={() => toggleActive(r)}>
                            {active ? <Ban className="h-[15px] w-[15px]" /> : <Undo2 className="h-[15px] w-[15px]" />}
                          </button>
                        )}
                        {r.user_id !== actor?.id && (
                          <button title="Delete permanently…" className="hover:text-[#bf2330]" onClick={() => setDeleteOf(r)}>
                            <Trash2 className="h-[15px] w-[15px]" />
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
      {deleteOf && (
        <DeleteUserDialog row={deleteOf} actorArgs={actorArgs}
          onClose={() => setDeleteOf(null)} onDone={load} />
      )}
      {resetOf && (
        <ResetPasswordDialog target={resetOf} actorArgs={actorArgs}
          onClose={() => setResetOf(null)} onDone={load} />
      )}
    </AdminLayout>
  );
}

/**
 * D210 — the organizations one account belongs to. Adding counts against the
 * organization's user limit (D207). D216 — one of them may be the account's DEFAULT,
 * set here (`admin_set_default_org`): every sign-in lands there. The account switches
 * between its organizations itself (account menu, /profile) and that does not change the
 * default. Removing the organization it is working in moves it to its default, else to
 * its earliest remaining one, or to none.
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

  const setDefault = async (m: Membership | null) => {
    setBusy(true);
    const { error } = await db.rpc('admin_set_default_org', { ...actorArgs(), p_target_user_id: row.user_id, p_org_id: m?.org_id ?? null });
    setBusy(false);
    if (error) return toast.error(error.message.replace(/^not_a_member:\s*/, ''));
    toast.success(m ? `${m.name} is now the default organization of ${row.email}` : `${row.email} has no default organization`);
    onChanged();
  };

  return (
    <ResponsiveDialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <ResponsiveDialogContent className={cn(DIALOG_AS_SHEET, 'md:max-w-lg md:rounded-sm')}>
        <ResponsiveDialogHeader><ResponsiveDialogTitle>Organizations — {row.name || row.email}</ResponsiveDialogTitle></ResponsiveDialogHeader>
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
                  {m.is_default && <span className="rounded-sm bg-foreground px-1.5 py-0.5 text-[11px] text-background" title="Every sign-in lands here">default</span>}
                  {m.is_current && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px]" title="The organization the account is working in now">current</span>}
                  <button title={m.is_default ? `Clear the default (${m.name})` : `Make ${m.name} the default`} disabled={busy}
                    aria-label={m.is_default ? `Clear the default organization` : `Make ${m.name} the default organization`}
                    className={cn('grid h-11 w-11 place-items-center hover:text-foreground disabled:opacity-50 md:h-7 md:w-7', m.is_default ? 'text-foreground' : 'text-[#a3a3a3]')}
                    onClick={() => setDefault(m.is_default ? null : m)}>
                    <Star className="h-[15px] w-[15px]" fill={m.is_default ? 'currentColor' : 'none'} />
                  </button>
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
            Every sign-in lands in the <em>default</em> organization (the star). Between sign-ins the account
            switches to any other it belongs to from its account menu; that does not change the default. With no
            default set, it signs in where it last worked. Removing the organization it is working in moves it to
            its default, else to its next organization.
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
        <ResponsiveDialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={onClose} disabled={busy}>Done</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * Permanent deletion of one account (§4 D161, D213 — WP 7.2 (a)). The server refuses
 * anything the dialog cannot promise: a wrong email, the admin's own account, a super
 * admin, or an account that still owns projects (it names them). What the person
 * recorded stays, with its author shown as unknown.
 */
function DeleteUserDialog({ row, actorArgs, onClose, onDone }: {
  row: Row; actorArgs: () => { p_actor_id?: string; p_actor_email?: string };
  onClose: () => void; onDone: () => void;
}) {
  const isMobile = useIsMobile();
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  // The phone sheet repeats a refusal above its buttons (§2.3); desktop has the toast alone.
  const [failure, setFailure] = useState<string | null>(null);
  const email = row.email ?? '';
  const isSuper = row.role === 'super_admin';
  const matches = !!email && typed.trim().toLowerCase() === email.toLowerCase();
  const remove = async () => {
    if (!matches || isSuper) return;
    setDeleting(true);
    setFailure(null);
    const { data, error } = await db.rpc('admin_delete_user', {
      ...actorArgs(), p_target_user_id: row.user_id, p_confirm_email: typed.trim(),
    });
    setDeleting(false);
    if (error) { setFailure(error.message); return toast.error(error.message); }
    const a = (data?.anonymised ?? {}) as Record<string, number>;
    const kept = Number(a.files_uploaded ?? 0) + Number(a.ingest_runs ?? 0)
      + Number(a.analysis_runs ?? 0) + Number(a.supply_chain_rows ?? 0);
    toast.success(`Deleted ${email}${kept ? ` — ${kept} record(s) they created are kept, with the author shown as unknown` : ''}`);
    onClose(); onDone();
  };
  if (isMobile) {
    // The typed-name ConfirmSheet (mobile redesign §2.3): the same copy as the
    // dialog below, as bullets under its own headings, and the same email check.
    const superReason =
      'This account is a super admin. Change its role first, then delete it — the role change is where the platform makes sure at least one super admin remains.';
    return (
      <ConfirmSheet
        open
        title={`Delete “${row.name || email}” permanently?`}
        groups={isSuper ? [] : [
          {
            label: 'Deleted, forever',
            bullets: [
              'the account — they will no longer be able to sign in',
              'its organization memberships, project roles, delegations, capabilities, AI permissions and AI budget',
            ].map((text) => ({ text, tone: 'red' as const })),
          },
          {
            label: 'Kept, with the author shown as unknown',
            bullets: [
              'files they uploaded and the data promoted from them',
              'analyses they ran and lanes they uploaded',
            ].map((text) => ({ text, tone: 'amber' as const })),
          },
        ]}
        notes={isSuper
          ? ['This cannot be undone. Suspending can be reversed; deleting cannot.']
          : [
              'This cannot be undone. Suspending can be reversed; deleting cannot.',
              'The audit log keeps its entries and shows them as a deleted user. An account that still owns projects cannot be deleted — transfer or delete those projects first.',
            ]}
        typed={isSuper ? undefined : { label: <>Type <span className="font-mono">{email}</span> to confirm</>, value: typed, onChange: setTyped }}
        disabledReason={isSuper ? superReason : matches ? null : `Type ${email} exactly to enable this.`}
        actionLabel="Delete account"
        busy={deleting}
        busyLabel="Deleting…"
        error={failure}
        onConfirm={remove}
        onCancel={() => !deleting && onClose()}
      />
    );
  }
  return (
    <ResponsiveDialog open onOpenChange={(v) => !v && !deleting && onClose()}>
      <ResponsiveDialogContent className={cn(DIALOG_AS_SHEET, 'md:max-w-lg md:rounded-sm')}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Delete “{row.name || email}” permanently</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            This cannot be undone. Suspending can be reversed; deleting cannot.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {isSuper ? (
          <p className="text-[13px] text-muted-foreground">
            This account is a super admin. Change its role first, then delete it — the role change is where the
            platform makes sure at least one super admin remains.
          </p>
        ) : (
          <div className="grid gap-3 text-[13px]">
            <div>
              <p className="font-medium">Deleted, forever:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>the account — they will no longer be able to sign in</li>
                <li>its organization memberships, project roles, delegations, capabilities, AI permissions and AI budget</li>
              </ul>
            </div>
            <div>
              <p className="font-medium">Kept, with the author shown as unknown:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>files they uploaded and the data promoted from them</li>
                <li>analyses they ran and lanes they uploaded</li>
              </ul>
            </div>
            <p className="text-muted-foreground">
              The audit log keeps its entries and shows them as a deleted user. An account that still owns projects
              cannot be deleted — transfer or delete those projects first.
            </p>
            <div>
              <Label className="text-xs">Type <span className="font-mono">{email}</span> to confirm</Label>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 rounded-sm font-mono" autoFocus autoComplete="off" spellCheck={false} />
            </div>
          </div>
        )}
        <ResponsiveDialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" className="rounded-sm" onClick={remove} disabled={isSuper || !matches || deleting}>
            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete account
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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
    <ResponsiveDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <ResponsiveDialogTrigger asChild>
        <Button size="sm" className={cn('gap-1.5 rounded-sm', HDR_PRIMARY_BUTTON)}><Plus className="h-3.5 w-3.5" />Add user</Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className={cn(DIALOG_AS_SHEET, 'md:max-w-lg md:rounded-sm')}>
        <ResponsiveDialogHeader><ResponsiveDialogTitle>Add user</ResponsiveDialogTitle></ResponsiveDialogHeader>
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
        <ResponsiveDialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button className="rounded-sm" onClick={create} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create user</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * §4 D251 — open "Forgot password?" requests. A request only says that somebody typed this
 * email; it is the super admin who decides, after confirming with the person.
 */
function ResetRequestsPanel({ requests, onReset, onDismiss }: {
  requests: ResetRequest[]; onReset: (r: ResetRequest) => void; onDismiss: (r: ResetRequest) => void;
}) {
  return (
    <section className={cn(SURFACE, 'mb-4 p-4')} aria-label="Password reset requests">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[14px] font-semibold">
          Password reset requests <span className="font-mono text-[12px] text-muted-foreground">· {requests.length}</span>
        </h2>
        <p className="m-0 text-[12px] text-muted-foreground">
          Anyone can type an email. Confirm with the person before you reset.
        </p>
      </div>
      <ul className="mt-3 divide-y divide-[--hair-divider]">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 py-2.5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 text-[13px]">
              <div className="truncate font-medium">{r.name || r.email}</div>
              <div className="truncate text-[12px] text-muted-foreground">
                {r.email}{r.organization ? ` · ${r.organization}` : ''} · asked {new Date(r.requested_at).toLocaleString()}
                {!r.is_active && ' · account suspended'}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" className="min-h-11 rounded-sm md:min-h-0" onClick={() => onDismiss(r)}>Dismiss</Button>
              <Button size="sm" className="min-h-11 gap-1.5 rounded-sm md:min-h-0" onClick={() => onReset(r)}>
                <KeyRound className="h-3.5 w-3.5" />Reset password…
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * §4 D251 — set a temporary password. It is generated here, shown to the super admin to
 * pass on, and stored only as a hash; `admin_reset_user_password` forces a change at the
 * next sign-in and closes the person's open request.
 */
function ResetPasswordDialog({ target, actorArgs, onClose, onDone }: {
  target: ResetTarget; actorArgs: () => { p_actor_id?: string; p_actor_email?: string };
  onClose: () => void; onDone: () => void;
}) {
  const [password, setPassword] = useState(() => generateTemporaryPassword());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const who = target.name || target.email || 'this user';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast.success('Temporary password copied');
    } catch {
      toast.error('Could not copy. Select the password and copy it by hand.');
    }
  };

  const reset = async () => {
    setSaving(true);
    const { error } = await resetUserPassword(actorArgs(), target.user_id, password);
    setSaving(false);
    if (error) return toast.error(error);
    setDone(true);
    onDone();
  };

  return (
    <ResponsiveDialog open onOpenChange={(v) => !v && !saving && onClose()}>
      <ResponsiveDialogContent className={cn(DIALOG_AS_SHEET, 'md:max-w-lg md:rounded-sm')}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{done ? 'Password reset' : `Reset password for “${who}”`}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {done
              ? `Send this temporary password to ${target.email ?? who} now. It will not be shown again.`
              : 'Their current password stops working at once. They sign in with the temporary password below and must choose a new one before they can continue.'}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="grid gap-3 text-[13px]">
          <div>
            <Label className="text-xs">Temporary password</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input readOnly value={password} onFocus={(e) => e.currentTarget.select()}
                className="rounded-sm font-mono tracking-[0.04em]" autoComplete="off" spellCheck={false} />
              <Button type="button" variant="outline" size="sm" className="min-h-11 shrink-0 rounded-sm md:min-h-0" onClick={copy}>Copy</Button>
            </div>
            {!done && (
              <button type="button" className="mt-1.5 text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => setPassword(generateTemporaryPassword())} disabled={saving}>
                Generate another
              </button>
            )}
          </div>
          {done ? (
            <p className="text-muted-foreground">
              Send it through a channel you already know belongs to them — their registered email, phone or company chat.
              If it gets lost, reset again.
            </p>
          ) : (
            <p className="rounded-sm border border-[--hair-border] bg-[#fafafa] px-3 py-2 text-muted-foreground">
              Before you reset: confirm the request came from {who}, using contact details you already have for them.
              Never send the password to whoever asked without that check.
            </p>
          )}
        </div>
        <ResponsiveDialogFooter>
          {done ? (
            <Button className="rounded-sm" onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" className="rounded-sm" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button className="rounded-sm" onClick={reset} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reset password
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
