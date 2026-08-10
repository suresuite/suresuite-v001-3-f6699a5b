// AI Usage (/admin/usage) — SuReSuite "Ledger" redesign.
// Data flow unchanged: last-500 ai_usage_logs (+ user-name lookup), the
// optional model-capability matrix (get_model_capability_matrix) and the
// optional per-org file-workspace rollup (admin_org_file_usage). Status is a
// dot (success=teal, error=red, blocked=grey); Export CSV preserved verbatim.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { SURFACE, KX, TH, TD, ROW_HOVER, StatusDot, MonoChip, EmptyRow, LoadingRow, useTableSort, useColumnFilters, type DotTone } from '@/components/admin/adminUi';
import { TableBlock } from '@/components/shared';
import { aggregateMatrixByModel, type ModelCapabilityRow, type ModelMatrixAggregate } from '@/lib/modelMatrix';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface LogRow { id: string; user_id: string | null; model_code: string | null; provider_code: string | null; prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd: number; latency_ms: number | null; status: string; created_at: string; user_name?: string; }
interface OrgFileUsageRow { org_id: string | null; org_name: string | null; file_count: number; total_bytes: number; retained_bytes: number; expiring_7d: number; }

const humanBytes = (n: number): string => {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};
const statusTone = (s: string): DotTone => (s === 'success' ? 'active' : s === 'blocked' ? 'neutral' : 'error');

const db = supabase as any;

export default function AdminUsage({ isCollapsed, setIsCollapsed }: Props) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [fileRows, setFileRows] = useState<OrgFileUsageRow[]>([]);
  const [matrixRows, setMatrixRows] = useState<ModelMatrixAggregate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await db.from('ai_usage_logs').select('*').order('created_at', { ascending: false }).limit(500);
    const logs = (data ?? []) as LogRow[];
    const userIds = Array.from(new Set(logs.map((l) => l.user_id).filter(Boolean))) as string[];
    let names: Record<string, string> = {};
    if (userIds.length) {
      const { data: users } = await db.from('approved_users').select('id,name,email').in('id', userIds);
      names = Object.fromEntries((users ?? []).map((u: any) => [u.id, u.name || u.email]));
    }
    setRows(logs.map((l) => ({ ...l, user_name: l.user_id ? names[l.user_id] : undefined })));
    try {
      const { data: usage, error } = await db.from('admin_org_file_usage').select('*');
      setFileRows(!error && Array.isArray(usage) ? (usage as OrgFileUsageRow[]) : []);
    } catch { setFileRows([]); }
    try {
      const { data: matrix, error } = await db.rpc('get_model_capability_matrix');
      setMatrixRows(!error && Array.isArray(matrix) ? aggregateMatrixByModel(matrix as ModelCapabilityRow[]) : []);
    } catch { setMatrixRows([]); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const exportCsv = () => {
    const header = ['timestamp', 'user', 'model', 'provider', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'cost_usd', 'latency_ms', 'status'];
    const csv = [header.join(','), ...rows.map((r) => [r.created_at, r.user_name || r.user_id || '', r.model_code || '', r.provider_code || '', r.prompt_tokens, r.completion_tokens, r.total_tokens, r.cost_usd, r.latency_ms ?? '', r.status].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const colFilterGetters = useMemo(() => ({
    time: (r: LogRow) => new Date(r.created_at).toLocaleString(), user: (r: LogRow) => r.user_name || '', model: (r: LogRow) => r.model_code || '',
    prompt: (r: LogRow) => String(r.prompt_tokens), completion: (r: LogRow) => String(r.completion_tokens), total: (r: LogRow) => String(r.total_tokens),
    cost: (r: LogRow) => String(r.cost_usd), latency: (r: LogRow) => String(r.latency_ms ?? ''), status: (r: LogRow) => r.status,
  }), []);
  const { filtered: colFiltered, FilterTH } = useColumnFilters(rows, colFilterGetters);
  const sortGetters = useMemo(() => ({
    time: (r: LogRow) => r.created_at, user: (r: LogRow) => (r.user_name || '').toLowerCase(), model: (r: LogRow) => (r.model_code || '').toLowerCase(),
    prompt: (r: LogRow) => r.prompt_tokens, completion: (r: LogRow) => r.completion_tokens, total: (r: LogRow) => r.total_tokens,
    cost: (r: LogRow) => r.cost_usd, latency: (r: LogRow) => r.latency_ms ?? -1, status: (r: LogRow) => r.status,
  }), []);
  const { sorted, SortTH } = useTableSort(colFiltered, sortGetters);

  return (
    <AdminLayout
      isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="AI Usage" onRefresh={load} refreshLoading={loading}
      actions={<Button variant="outline" size="sm" className="rounded-sm" onClick={exportCsv}>Export CSV</Button>}
    >
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <SortTH sortKey="time">Time</SortTH><SortTH sortKey="user">User</SortTH><SortTH sortKey="model">Model</SortTH>
              <SortTH sortKey="prompt" align="right">Prompt</SortTH><SortTH sortKey="completion" align="right">Completion</SortTH>
              <SortTH sortKey="total" align="right">Total</SortTH><SortTH sortKey="cost" align="right">Cost</SortTH>
              <SortTH sortKey="latency" align="right">Latency</SortTH><SortTH sortKey="status">Status</SortTH>
            </tr>
            <tr>
              <FilterTH filterKey="time" /><FilterTH filterKey="user" /><FilterTH filterKey="model" />
              <FilterTH filterKey="prompt" align="right" /><FilterTH filterKey="completion" align="right" />
              <FilterTH filterKey="total" align="right" /><FilterTH filterKey="cost" align="right" />
              <FilterTH filterKey="latency" align="right" /><FilterTH filterKey="status" />
            </tr></thead>
            <tbody>
              {loading ? <LoadingRow colSpan={9} /> : sorted.length === 0 ? (
                <EmptyRow colSpan={9} message="No usage recorded yet. Trigger a chat request to see logs here." />
              ) : sorted.map((r) => (
                <tr key={r.id} className={ROW_HOVER}>
                  <td className={`${TD} whitespace-nowrap text-[11.5px] text-muted-foreground`}>{new Date(r.created_at).toLocaleString()}</td>
                  <td className={`${TD} text-[13px]`}>{r.user_name || '—'}</td>
                  <td className={`${TD} font-mono text-[11.5px]`}>{r.model_code || '—'}</td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>{Number(r.prompt_tokens).toLocaleString()}</td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>{Number(r.completion_tokens).toLocaleString()}</td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>{Number(r.total_tokens).toLocaleString()}</td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>${Number(r.cost_usd).toFixed(4)}</td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums text-muted-foreground`}>{r.latency_ms ?? '—'}</td>
                  <td className={TD}><StatusDot tone={statusTone(r.status)} label={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {matrixRows.length > 0 && (
        // L1: name on the canvas above the shell.
        <TableBlock
          className="mt-5"
          name="Model capability matrix · nightly eval (§23)"
          count={matrixRows.length}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr><th className={TH}>Model</th><th className={`${TH} text-right`}>Passing</th><th className={TH}>Below target</th><th className={TH}>Measured</th><th className={TH}>Freshness</th></tr></thead>
              <tbody>
                {matrixRows.map((r) => (
                  <tr key={r.model_code} className={ROW_HOVER}>
                    <td className={`${TD} font-mono text-[11.5px]`}>{r.model_code}</td>
                    <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>{r.passing}/{r.total}</td>
                    <td className={`${TD} max-w-[360px] text-[11.5px] text-muted-foreground`}>{r.belowTarget.length > 0 ? r.belowTarget.join(', ') : '—'}</td>
                    <td className={`${TD} text-[11.5px] text-muted-foreground`}>{r.measuredAt ? new Date(r.measuredAt).toLocaleString() : '—'}</td>
                    <td className={TD}><StatusDot tone={r.stale ? 'neutral' : 'active'} label={r.stale ? 'stale' : 'fresh'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableBlock>
      )}

      {fileRows.length > 0 && (
        // L1: name on the canvas above the shell.
        <TableBlock
          className="mt-5"
          name="File workspace by organization (§16.2)"
          count={fileRows.length}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr><th className={TH}>Organization</th><th className={`${TH} text-right`}>Files</th><th className={`${TH} text-right`}>Total size</th><th className={`${TH} text-right`}>Kept size</th><th className={`${TH} text-right`}>Expiring ≤ 7d</th></tr></thead>
              <tbody>
                {fileRows.map((r) => (
                  <tr key={r.org_id ?? 'none'} className={ROW_HOVER}>
                    <td className={`${TD} text-[13px]`}>{r.org_name || (r.org_id ? r.org_id.slice(0, 8) : 'No organization')}</td>
                    <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>{r.file_count}</td>
                    <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>{humanBytes(Number(r.total_bytes))}</td>
                    <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>{humanBytes(Number(r.retained_bytes))}</td>
                    <td className={`${TD} text-right`}>{Number(r.expiring_7d) > 0 ? <MonoChip>{r.expiring_7d}</MonoChip> : <span className="font-mono text-[12px] text-muted-foreground">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TableBlock>
      )}
    </AdminLayout>
  );
}
