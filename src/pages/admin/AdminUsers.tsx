import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Input } from '@/components/ui/input';
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
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
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
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error } = await db
      .from('v_admin_user_usage')
      .select('*')
      .order('mtd_cost_usd', { ascending: false });
    if (error) toast.error(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

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

  const audit = async (
    action: string,
    target_id: string,
    before: unknown,
    after: unknown
  ) => {
    try {
      await db.rpc('log_admin_action', {
        p_action: action,
        p_target_type: 'approved_users',
        p_target_id: target_id,
        p_before: before,
        p_after: after,
      });
    } catch (e) {
      /* non-fatal */
    }
  };

  const changeRole = async (row: Row, next: string) => {
    if (next === row.role) return;
    const { error } = await db
      .from('approved_users')
      .update({ role: next })
      .eq('id', row.user_id);
    if (error) return toast.error(error.message);
    toast.success(`Role updated for ${row.email}`);
    audit('user.role_change', row.user_id, { role: row.role }, { role: next });
    setRows((prev) =>
      prev.map((r) => (r.user_id === row.user_id ? { ...r, role: next } : r))
    );
  };

  const toggleActive = async (row: Row) => {
    const next = !(row.is_active ?? true);
    const { error } = await db
      .from('approved_users')
      .update({ is_active: next })
      .eq('id', row.user_id);
    if (error) return toast.error(error.message);
    toast.success(next ? 'Reactivated' : 'Suspended');
    audit('user.set_active', row.user_id, { is_active: row.is_active }, { is_active: next });
    setRows((prev) =>
      prev.map((r) => (r.user_id === row.user_id ? { ...r, is_active: next } : r))
    );
  };

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="Users"
      description="Every account across every organization."
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
        </div>
      }
    >
      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Req (MTD)</TableHead>
              <TableHead className="text-right">Cost (MTD)</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead className="w-[120px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  No users match.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const budget = r.monthly_budget_usd ?? null;
                const remaining = budget != null ? budget - Number(r.mtd_cost_usd) : null;
                return (
                  <TableRow key={r.user_id}>
                    <TableCell className="font-medium">{r.name || '—'}</TableCell>
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
                    <TableCell className="text-right">
                      {Number(r.mtd_requests).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
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
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/admin/users/${r.user_id}`)}
                        title="Manage pages, features, AI models & budget"
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
      </div>
    </AdminLayout>
  );
}
