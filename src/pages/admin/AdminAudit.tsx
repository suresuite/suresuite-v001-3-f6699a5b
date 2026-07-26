// Audit Log (/admin/audit) — SuReSuite "Ledger" redesign.
// Data flow unchanged (admin_audit_logs + actor name lookup). Mono action /
// target, before/after diff kept mono and compact.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SURFACE, TH, TD, ROW_HOVER, EmptyRow, LoadingRow, useTableSort, useColumnFilters } from '@/components/admin/adminUi';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface AuditRow {
  id: string; actor_user_id: string | null; action: string; target_type: string | null;
  target_id: string | null; before: unknown; after: unknown; created_at: string; actor_name?: string;
}

const db = supabase as any;

export default function AdminAudit({ isCollapsed, setIsCollapsed }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await db.from('admin_audit_logs').select('*').order('created_at', { ascending: false }).limit(500);
    const logs = (data ?? []) as AuditRow[];
    const ids = Array.from(new Set(logs.map((l) => l.actor_user_id).filter(Boolean))) as string[];
    let names: Record<string, string> = {};
    if (ids.length) {
      const { data: users } = await db.from('approved_users').select('id,name,email').in('id', ids);
      names = Object.fromEntries((users ?? []).map((u: any) => [u.id, u.name || u.email]));
    }
    setRows(logs.map((l) => ({ ...l, actor_name: l.actor_user_id ? names[l.actor_user_id] : undefined })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const colFilterGetters = useMemo(() => ({
    time: (r: AuditRow) => new Date(r.created_at).toLocaleString(), actor: (r: AuditRow) => r.actor_name || '',
    action: (r: AuditRow) => r.action, target: (r: AuditRow) => `${r.target_type || ''} ${r.target_id || ''}`,
  }), []);
  const { filtered, FilterTH } = useColumnFilters(rows, colFilterGetters);
  const sortGetters = useMemo(() => ({
    time: (r: AuditRow) => r.created_at, actor: (r: AuditRow) => (r.actor_name || '').toLowerCase(),
    action: (r: AuditRow) => r.action.toLowerCase(), target: (r: AuditRow) => (r.target_type || '').toLowerCase(),
  }), []);
  const { sorted, SortTH } = useTableSort(filtered, sortGetters);

  return (
    <AdminLayout
      isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="Audit Log" onRefresh={load} refreshLoading={loading}
    >
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <SortTH sortKey="time">Time</SortTH><SortTH sortKey="actor">Actor</SortTH><SortTH sortKey="action">Action</SortTH>
              <SortTH sortKey="target">Target</SortTH><th className={TH}>Changes</th>
            </tr>
            <tr>
              <FilterTH filterKey="time" /><FilterTH filterKey="actor" /><FilterTH filterKey="action" />
              <FilterTH filterKey="target" /><th className="border-b border-[#ebebeb] bg-[#fafafa]" />
            </tr></thead>
            <tbody>
              {loading ? <LoadingRow colSpan={5} /> : sorted.length === 0 ? (
                <EmptyRow colSpan={5} message="No audit entries yet." />
              ) : sorted.map((r) => (
                <tr key={r.id} className={ROW_HOVER}>
                  <td className={`${TD} whitespace-nowrap text-[11.5px] text-muted-foreground`}>{new Date(r.created_at).toLocaleString()}</td>
                  <td className={`${TD} text-[13px]`}>{r.actor_name || '—'}</td>
                  <td className={`${TD} font-mono text-[11.5px]`}>{r.action}</td>
                  <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>
                    {r.target_type}{r.target_id ? <span>:{r.target_id.slice(0, 8)}</span> : ''}
                  </td>
                  <td className={`${TD} max-w-[400px] font-mono text-[10.5px] leading-relaxed text-[#737373]`}>
                    <span className="text-[#a3a3a3]">before</span> {r.before ? JSON.stringify(r.before) : '—'}<br />
                    <span className="text-[#a3a3a3]">after</span> {r.after ? JSON.stringify(r.after) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
