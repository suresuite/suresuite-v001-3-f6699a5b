import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2, Plus, SlidersHorizontal } from 'lucide-react';
import { TableEmpty, TableLoading, TableShell, TH_DENSE } from '@/components/shared';
import { toast } from 'sonner';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

interface OrgOption {
  id: string;
  name: string;
}

interface Row {
  user_id: string;
  name: string | null;
  email: string | null;
  role: string;
  organization: string | null;
  is_active: boolean | null;
  mtd_requests: number;
  mtd_cost_usd: number;
  monthly_budget_usd: number | null;
}

const db = supabase as any;
const ROLES = ['user', 'modeler', 'admin', 'super_admin'];

export default function AdminUsers({ isCollapsed, setIsCollapsed }: Props) {
  const navigate = useNavigate();
  const { user: actor } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true);
    const [usage, orgRes] = await Promise.all([
      db.from('v_admin_user_usage').select('*').order('mtd_cost_usd', { ascending: false }),
      // RPC instead of a direct read: RLS hides organizations from the
      // context-less anon connection the browser uses.
      db.rpc('admin_list_organizations', actorArgs()),
    ]);
    if (usage.error) toast.error(usage.error.message);
    setRows((usage.data ?? []) as Row[]);
    setOrgs(((orgRes.data ?? []) as any[]).map((o) => ({ id: o.id, name: o.name })));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const actorArgs = () => ({ p_actor_id: actor?.id, p_actor_email: actor?.email });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        (r.name || '').toLowerCase().includes(s) ||
        (r.email || '').toLowerCase().includes(s) ||
        (r.organization || '').toLowerCase().includes(s)
    );
  }, [rows, q]);

  const changeRole = async (row: Row, next: string) => {
    if (next === row.role) return;
    const { error } = await db.rpc('admin_set_user_role', {
      ...actorArgs(),
      p_target_user_id: row.user_id,
      p_role: next,
    });
    if (error) return toast.error(error.message);
    toast.success(`Role updated for ${row.email}`);
    setRows((prev) =>
      prev.map((r) => (r.user_id === row.user_id ? { ...r, role: next } : r))
    );
  };

  const toggleActive = async (row: Row) => {
    const next = !(row.is_active ?? true);
    const { error } = await db.rpc('admin_set_user_active', {
      ...actorArgs(),
      p_target_user_id: row.user_id,
      p_is_active: next,
    });
    if (error) return toast.error(error.message);
    toast.success(next ? 'Reactivated' : 'Suspended');
    setRows((prev) =>
      prev.map((r) => (r.user_id === row.user_id ? { ...r, is_active: next } : r))
    );
  };

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="Users"
      actions={
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search name, email, org…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-64"
          />
          <Button variant="outline" size="sm" onClick={load}>
            Refresh
          </Button>
          <AddUserDialog orgs={orgs} actorArgs={actorArgs} onCreated={load} />
        </div>
      }
    >
      <TableShell>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TH_DENSE}>Name</TableHead>
              <TableHead className={TH_DENSE}>Email</TableHead>
              <TableHead className={TH_DENSE}>Organization</TableHead>
              <TableHead className={TH_DENSE}>Role</TableHead>
              <TableHead className={TH_DENSE}>Status</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Req (MTD)</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Cost (MTD)</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Budget</TableHead>
              <TableHead className={`${TH_DENSE} w-[120px] text-right`}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoading colSpan={9} />
            ) : filtered.length === 0 ? (
              <TableEmpty
                colSpan={9}
                message={q ? 'No users match these filters.' : 'No users yet.'}
                action={
                  q ? (
                    <Button variant="ghost" size="sm" onClick={() => setQ('')}>
                      Clear search
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              filtered.map((r) => {
                const budget = r.monthly_budget_usd ?? null;
                const remaining = budget != null ? budget - Number(r.mtd_cost_usd) : null;
                return (
                  <TableRow key={r.user_id}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/users/${r.user_id}`)}
                        className="text-left font-medium text-primary underline-offset-2 hover:underline"
                        title={`Manage ${r.name || r.email}'s individual access`}
                      >
                        {r.name || '—'}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.email}</TableCell>
                    <TableCell>{r.organization || '—'}</TableCell>
                    <TableCell>
                      <Select value={r.role} onValueChange={(v) => changeRole(r, v)}>
                        <SelectTrigger className="h-8 w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {r.is_active === false ? (
                        <Badge variant="destructive">Suspended</Badge>
                      ) : (
                        <Badge variant="secondary">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(r.mtd_requests).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      ${Number(r.mtd_cost_usd).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      {budget != null ? (
                        <span
                          className={
                            remaining != null && remaining < 0
                              ? 'text-destructive'
                              : 'text-foreground'
                          }
                        >
                          ${budget.toFixed(2)}
                          {remaining != null && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({remaining.toFixed(2)} left)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/admin/users/${r.user_id}`)}
                        title="Manage this individual user's pages, features, AI models & budget"
                      >
                        <SlidersHorizontal className="mr-1 h-3 w-3" /> Access
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleActive(r)}
                      >
                        {r.is_active === false ? 'Enable' : 'Suspend'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableShell>
    </AdminLayout>
  );
}

function AddUserDialog({
  orgs,
  actorArgs,
  onCreated,
}: {
  orgs: OrgOption[];
  actorArgs: () => { p_actor_id?: string; p_actor_email?: string };
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [orgId, setOrgId] = useState<string>('none');

  const reset = () => {
    setName('');
    setEmail('');
    setPassword('');
    setRole('user');
    setOrgId('none');
  };

  const create = async () => {
    if (!email.trim()) return toast.error('Email is required');
    if (password.length < 8) return toast.error('Password must be at least 8 characters');
    setSaving(true);
    const { error } = await db.rpc('admin_create_user', {
      ...actorArgs(),
      p_name: name.trim() || null,
      p_email: email.trim(),
      p_password: password,
      p_role: role,
      p_org_id: orgId === 'none' ? null : orgId,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`User ${email.trim()} created`);
    reset();
    setOpen(false);
    onCreated();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" placeholder="Jane Doe" />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1"
              placeholder="jane@company.com"
            />
          </div>
          <div>
            <Label className="text-xs">Temporary password</Label>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1"
              placeholder="at least 8 characters"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              The user must change this on first login.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Organization</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={create} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
