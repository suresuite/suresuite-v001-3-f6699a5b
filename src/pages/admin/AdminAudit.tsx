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
import { Loader2 } from 'lucide-react';

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
      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No audit entries yet.
                </TableCell>
              </TableRow>
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
                    {r.target_id ? `:${r.target_id.slice(0, 8)}` : ''}
                  </TableCell>
                  <TableCell className="max-w-[400px] truncate text-xs">
                    <span className="text-muted-foreground">before:</span>{' '}
                    {r.before ? JSON.stringify(r.before) : '—'}
                    <br />
                    <span className="text-muted-foreground">after:</span>{' '}
                    {r.after ? JSON.stringify(r.after) : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </AdminLayout>
  );
}
