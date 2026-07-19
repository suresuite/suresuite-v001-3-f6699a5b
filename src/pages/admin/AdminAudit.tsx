import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TableEmpty, TableLoading, TableShell, TH_DENSE } from '@/components/shared';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: unknown;
  after: unknown;
  created_at: string;
  actor_name?: string;
}

const db = supabase as any;

export default function AdminAudit({ isCollapsed, setIsCollapsed }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await db
      .from('admin_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    const logs = (data ?? []) as AuditRow[];
    const ids = Array.from(new Set(logs.map((l) => l.actor_user_id).filter(Boolean))) as string[];
    let names: Record<string, string> = {};
    if (ids.length) {
      const { data: users } = await db
        .from('approved_users')
        .select('id,name,email')
        .in('id', ids);
      names = Object.fromEntries((users ?? []).map((u: any) => [u.id, u.name || u.email]));
    }
    setRows(logs.map((l) => ({ ...l, actor_name: l.actor_user_id ? names[l.actor_user_id] : undefined })));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="Audit Log"
      description="Every administrative action, most recent first."
      actions={
        <Button variant="outline" size="sm" onClick={load}>
          Refresh
        </Button>
      }
    >
      <TableShell>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TH_DENSE}>Time</TableHead>
              <TableHead className={TH_DENSE}>Actor</TableHead>
              <TableHead className={TH_DENSE}>Action</TableHead>
              <TableHead className={TH_DENSE}>Target</TableHead>
              <TableHead className={TH_DENSE}>Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoading colSpan={5} />
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={5} message="No audit entries yet." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>{r.actor_name || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.target_type}
                    {r.target_id ? (
                      <span className="font-mono">:{r.target_id.slice(0, 8)}</span>
                    ) : ''}
                  </TableCell>
                  <TableCell className="max-w-[400px] truncate text-xs">
                    <span className="text-muted-foreground">before:</span>{' '}
                    <span className="font-mono text-[11px]">{r.before ? JSON.stringify(r.before) : '—'}</span>
                    <br />
                    <span className="text-muted-foreground">after:</span>{' '}
                    <span className="font-mono text-[11px]">{r.after ? JSON.stringify(r.after) : '—'}</span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableShell>
    </AdminLayout>
  );
}
