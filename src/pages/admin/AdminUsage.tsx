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
import { SectionCard, TableEmpty, TableLoading, TableShell, TH_DENSE } from '@/components/shared';
import {
  aggregateMatrixByModel,
  type ModelCapabilityRow,
  type ModelMatrixAggregate,
} from '@/lib/modelMatrix';

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

/** §16.2 admin rollup: one row per org from the admin_org_file_usage view —
 * file count, bytes, retained bytes, expiring-in-7d. Aggregates only. */
interface OrgFileUsageRow {
  org_id: string | null;
  org_name: string | null;
  file_count: number;
  total_bytes: number;
  retained_bytes: number;
  expiring_7d: number;
}

const humanBytes = (n: number): string => {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const db = supabase as any;

export default function AdminUsage({ isCollapsed, setIsCollapsed }: Props) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [fileRows, setFileRows] = useState<OrgFileUsageRow[]>([]);
  const [matrixRows, setMatrixRows] = useState<ModelMatrixAggregate[]>([]);
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
    try {
      // File-workspace rollup (ai-agents.md §16.2) — absent pre-Phase-3
      // deployments simply render no section.
      const { data: usage, error } = await db.from('admin_org_file_usage').select('*');
      setFileRows(!error && Array.isArray(usage) ? (usage as OrgFileUsageRow[]) : []);
    } catch {
      setFileRows([]);
    }
    try {
      // Per-model capability matrix (ai-agents.md §23.3, the §16.2 rollup
      // precedent) — aggregates only. Empty until the first --matrix eval
      // run publishes rows; absent pre-H4 deployments render no section.
      const { data: matrix, error } = await db.rpc('get_model_capability_matrix');
      setMatrixRows(
        !error && Array.isArray(matrix)
          ? aggregateMatrixByModel(matrix as ModelCapabilityRow[])
          : [],
      );
    } catch {
      setMatrixRows([]);
    }
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
      <TableShell>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TH_DENSE}>Time</TableHead>
              <TableHead className={TH_DENSE}>User</TableHead>
              <TableHead className={TH_DENSE}>Model</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Prompt</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Completion</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Total</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Cost</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Latency</TableHead>
              <TableHead className={TH_DENSE}>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoading colSpan={9} />
            ) : rows.length === 0 ? (
              <TableEmpty
                colSpan={9}
                message="No usage recorded yet. Trigger a chat request to see logs here."
              />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>{r.user_name || '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{r.model_code || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.prompt_tokens}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.completion_tokens}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.total_tokens}</TableCell>
                  <TableCell className="text-right tabular-nums">${Number(r.cost_usd).toFixed(4)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.latency_ms ?? '—'}</TableCell>
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
      </TableShell>

      {matrixRows.length > 0 && (
        <SectionCard
          className="mt-6"
          title="Model capability matrix"
          description="Per-model quality from the nightly model-scored eval (ai-agents.md §23). The matrix
            informs the picker and the below-target refusal — it never hides a model and never
            switches one. Rows older than 7 days are stale and stop gating."
        >
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={TH_DENSE}>Model</TableHead>
                  <TableHead className={`${TH_DENSE} text-right`}>Capabilities passing</TableHead>
                  <TableHead className={TH_DENSE}>Below target</TableHead>
                  <TableHead className={TH_DENSE}>Measured</TableHead>
                  <TableHead className={TH_DENSE}>Freshness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrixRows.map((r) => (
                  <TableRow key={r.model_code}>
                    <TableCell className="font-mono text-xs">{r.model_code}</TableCell>
                    <TableCell className="text-right">
                      {r.passing}/{r.total}
                    </TableCell>
                    <TableCell className="max-w-[360px] text-xs text-muted-foreground">
                      {r.belowTarget.length > 0 ? r.belowTarget.join(', ') : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.measuredAt ? new Date(r.measuredAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.stale ? 'outline' : 'secondary'}>
                        {r.stale ? 'stale' : 'fresh'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        </SectionCard>
      )}

      {fileRows.length > 0 && (
        <SectionCard
          className="mt-6"
          title="File workspace by organization"
          description="Rendered reports and exports per org (14-day retention unless Kept; 500 MB retained
            cap per user). Counts and bytes only — file contents stay private to their owners."
        >
          <TableShell>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={TH_DENSE}>Organization</TableHead>
                  <TableHead className={`${TH_DENSE} text-right`}>Files</TableHead>
                  <TableHead className={`${TH_DENSE} text-right`}>Total size</TableHead>
                  <TableHead className={`${TH_DENSE} text-right`}>Kept size</TableHead>
                  <TableHead className={`${TH_DENSE} text-right`}>Expiring ≤ 7d</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fileRows.map((r) => (
                  <TableRow key={r.org_id ?? 'none'}>
                    <TableCell>{r.org_name || (r.org_id ? r.org_id.slice(0, 8) : 'No organization')}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.file_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{humanBytes(Number(r.total_bytes))}</TableCell>
                    <TableCell className="text-right tabular-nums">{humanBytes(Number(r.retained_bytes))}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(r.expiring_7d) > 0 ? (
                        <Badge variant="outline">{r.expiring_7d}</Badge>
                      ) : (
                        '0'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
        </SectionCard>
      )}
    </AdminLayout>
  );
}
