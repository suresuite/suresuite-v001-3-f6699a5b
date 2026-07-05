import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
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
import { Loader2 } from 'lucide-react';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

interface LogRow {
  id: string;
  user_id: string | null;
  model_code: string | null;
  provider_code: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  status: string;
  created_at: string;
  user_name?: string;
}

const db = supabase as any;

export default function AdminUsage({ isCollapsed, setIsCollapsed }: Props) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await db
      .from('ai_usage_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    const logs = (data ?? []) as LogRow[];
    const userIds = Array.from(new Set(logs.map((l) => l.user_id).filter(Boolean))) as string[];
    let names: Record<string, string> = {};
    if (userIds.length) {
      const { data: users } = await db
        .from('approved_users')
        .select('id,name,email')
        .in('id', userIds);
      names = Object.fromEntries((users ?? []).map((u: any) => [u.id, u.name || u.email]));
    }
    setRows(logs.map((l) => ({ ...l, user_name: l.user_id ? names[l.user_id] : undefined })));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const exportCsv = () => {
    const header = [
      'timestamp',
      'user',
      'model',
      'provider',
      'prompt_tokens',
      'completion_tokens',
      'total_tokens',
      'cost_usd',
      'latency_ms',
      'status',
    ];
    const csv = [
      header.join(','),
      ...rows.map((r) =>
        [
          r.created_at,
          r.user_name || r.user_id || '',
          r.model_code || '',
          r.provider_code || '',
          r.prompt_tokens,
          r.completion_tokens,
          r.total_tokens,
          r.cost_usd,
          r.latency_ms ?? '',
          r.status,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="AI Usage"
      description="Most recent 500 AI requests across the platform."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
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
              <TableHead>Time</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Prompt</TableHead>
              <TableHead className="text-right">Completion</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Latency</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  No usage recorded yet. Trigger a chat request to see logs here.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>{r.user_name || '—'}</TableCell>
                  <TableCell className="text-xs">{r.model_code || '—'}</TableCell>
                  <TableCell className="text-right">{r.prompt_tokens}</TableCell>
                  <TableCell className="text-right">{r.completion_tokens}</TableCell>
                  <TableCell className="text-right">{r.total_tokens}</TableCell>
                  <TableCell className="text-right">${Number(r.cost_usd).toFixed(4)}</TableCell>
                  <TableCell className="text-right">{r.latency_ms ?? '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === 'success'
                          ? 'secondary'
                          : r.status === 'blocked'
                          ? 'outline'
                          : 'destructive'
                      }
                    >
                      {r.status}
                    </Badge>
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
