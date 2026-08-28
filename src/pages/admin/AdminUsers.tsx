// Users (/admin/users) — SuReSuite "Ledger" redesign.
// Data flow, RPCs (admin_set_user_role, admin_set_user_active, admin_create_user)
// and search/filter logic are unchanged from the original AdminUsers.tsx. The
// table now uses the shared TH/TD treatment, a status dot, inline icon actions
// (Access / Suspend-Enable) instead of ghost buttons, and the primary
// "Add user" lives in the PageHeader actions.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SURFACE, TH, TD, ROW_HOVER, StatusDot, EmptyRow, LoadingRow, useTableSort, useColumnFilters } from '@/components/admin/adminUi';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Ban, Loader2, Plus, SlidersHorizontal, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface OrgOption { id: string; name: string; }
interface Row {
  user_id: string; name: string | null; email: string | null; role: string;
  organization: string | null; is_active: boolean | null;
  mtd_requests: number; mtd_cost_usd: number; monthly_budget_usd: number | null;
}

const db = supabase as any;
const ROLES = ['user', 'modeler', 'admin', 'super_admin'];

export default function AdminUsers({ isCollapsed, setIsCollapsed }: Props) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { user: actor } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const actorArgs = () => ({ p_actor_id: actor?.id, p_actor_email: actor?.email });

  const load = async () => {
    setLoading(true);
    const [usage, orgRes] = await Promise.all([
      db.from('v_admin_user_usage').select('*').order('mtd_cost_usd', { ascending: false }),
      db.rpc('admin_list_organizations', actorArgs()),
    ]);
    if (usage.error) toast.error(usage.error.message);
    setRows((usage.data ?? []) as Row[]);
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
      (r.organization || '').toLowerCase().includes(s));
  }, [rows, q]);

  const colFilterGetters = useMemo(() => ({
    org: (r: Row) => r.organization || '', name: (r: Row) => r.name || '', email: (r: Row) => r.email || '',
    role: (r: Row) => r.role, status: (r: Row) => (r.is_active !== false ? 'Active' : 'Suspended'),
    req: (r: Row) => String(r.mtd_requests), cost: (r: Row) => String(r.mtd_cost_usd), budget: (r: Row) => String(r.monthly_budget_usd ?? ''),
  }), []);
  const { filtered: colFiltered, FilterTH } = useColumnFilters(filtered, colFilterGetters);

  const sortGetters = useMemo(() => ({
    org: (r: Row) => (r.organization || '').toLowerCase(), name: (r: Row) => (r.name || '').toLowerCase(),
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
      actions={
        <div className="flex items-center gap-2">
          <Input placeholder="Search name, email, org…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-60 rounded-sm" />
          <AddUserDialog orgs={orgs} actorArgs={actorArgs} onCreated={load} />
        </div>
      }
    >
      {isMobile ? (
        <div className={cn(SURFACE, 'overflow-hidden')}>
          {loading ? (
            <div className="px-4 py-14 text-center text-[13px] text-muted-foreground">Loading…</div>
          ) : sorted.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <p className="mx-auto max-w-sm text-[13px] text-muted-foreground">
                {q ? 'No users match these filters.' : 'No users yet.'}
              </p>
              {q && (
                <Button variant="ghost" size="sm" className="mt-2 h-11 md:h-8" onClick={() => setQ('')}>
                  Clear search
                </Button>
              )}
            </div>
          ) : (
            sorted.map((r) => {
              const active = r.is_active !== false;
              const budget = r.monthly_budget_usd ?? null;
              const remaining = budget != null ? budget - Number(r.mtd_cost_usd) : null;
              return (
                <div key={r.user_id} className="border-b border-[--hair-divider] p-3 last:border-b-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/admin/users/${r.user_id}`)}
                      className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-[#bf2330] underline-offset-2 hover:underline"
                    >
                      {r.name || '—'}
                    </button>
                    <span className="shrink-0">
                      <StatusDot tone={active ? 'active' : 'error'} label={active ? 'Active' : 'Suspended'} />
                    </span>
                  </div>

                  <div className="mt-1.5 break-words font-mono text-[11px] text-muted-foreground">
                    {r.email || '—'} · {r.organization || '—'}
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-[3px] border border-[--zinc-border] px-1.5 py-px">
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Req MTD</span>
                      <span className="font-mono text-[11.5px] tabular-nums text-foreground">{Number(r.mtd_requests).toLocaleString()}</span>
                    </span>
                    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-[3px] border border-[--zinc-border] px-1.5 py-px">
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Cost MTD</span>
                      <span className="font-mono text-[11.5px] tabular-nums text-foreground">${Number(r.mtd_cost_usd).toFixed(2)}</span>
                    </span>
                    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-[3px] border border-[--zinc-border] px-1.5 py-px">
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Budget</span>
                      <span className={cn('font-mono text-[11.5px] tabular-nums', remaining != null && remaining < 0 ? 'text-[#bf2330]' : 'text-foreground')}>
                        {budget != null ? `$${budget.toFixed(2)}` : '—'}
                      </span>
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <Select value={r.role} onValueChange={(v) => changeRole(r, v)}>
                      <SelectTrigger className="h-9 w-32 rounded-sm text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{ROLES.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent>
                    </Select>
                    <span className="inline-flex items-center gap-1 text-[#a3a3a3]">
                      <button title="Manage access" className="grid h-11 w-11 place-items-center hover:text-foreground" onClick={() => navigate(`/admin/users/${r.user_id}`)}>
                        <SlidersHorizontal className="h-[15px] w-[15px]" />
                      </button>
                      <button title={active ? 'Suspend' : 'Enable'} className={cn('grid h-11 w-11 place-items-center', active ? 'hover:text-[#bf2330]' : 'hover:text-foreground')} onClick={() => toggleActive(r)}>
                        {active ? <Ban className="h-[15px] w-[15px]" /> : <Undo2 className="h-[15px] w-[15px]" />}
                      </button>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
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
              {loading ? <LoadingRow colSpan={9} /> : sorted.length === 0 ? (
                <EmptyRow colSpan={9} message={q ? 'No users match these filters.' : 'No users yet.'}
                  action={q ? <Button variant="ghost" size="sm" onClick={() => setQ('')}>Clear search</Button> : undefined} />
              ) : sorted.map((r) => {
                const active = r.is_active !== false;
                const budget = r.monthly_budget_usd ?? null;
                const remaining = budget != null ? budget - Number(r.mtd_cost_usd) : null;
                return (
                  <tr key={r.user_id} className={ROW_HOVER}>
                    <td className={`${TD} text-[13px]`}>{r.organization || '—'}</td>
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
                        <SelectContent>{ROLES.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent>
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
                        <button title={active ? 'Suspend' : 'Enable'} className={active ? 'hover:text-[#bf2330]' : 'hover:text-foreground'} onClick={() => toggleActive(r)}>
                          {active ? <Ban className="h-[15px] w-[15px]" /> : <Undo2 className="h-[15px] w-[15px]" />}
                        </button>
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
    </AdminLayout>
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
    if (error) return toast.error(error.message);
    toast.success(`User ${email.trim()} created`);
    reset(); setOpen(false); onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="rounded-sm"><Plus className="mr-1.5 h-3.5 w-3.5" /> Add user</Button>
      </DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader><DialogTitle>Add user</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label className="text-xs">Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 rounded-sm" placeholder="Jane Doe" /></div>
          <div><Label className="text-xs">Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 rounded-sm" placeholder="jane@company.com" /></div>
          <div>
            <Label className="text-xs">Temporary password</Label>
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 rounded-sm" placeholder="at least 8 characters" />
            <p className="mt-1 text-xs text-muted-foreground">The user must change this on first login.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="mt-1 rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Organization</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger className="mt-1 rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
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
