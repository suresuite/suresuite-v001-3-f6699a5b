// Audit Log (/admin/audit) — SuReSuite "Ledger" redesign.
// Data flow unchanged (admin_audit_logs + actor name lookup). Mono action /
// target, before/after diff kept mono and compact.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import {
  SURFACE, TH, TD, ROW_HOVER, EmptyRow, LoadingRow, useTableSort, useColumnFilters,
  AdminMobileList, AdminMobileRow,
} from '@/components/admin/adminUi';
import { MobileSheet } from '@/components/shared/MobileSheet';
import { M_CODE, MobileRow } from '@/components/mobile';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useRowBudget } from '@/hooks/useViewport';
import { cn } from '@/lib/utils';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface AuditRow {
  id: string; actor_user_id: string | null; action: string; target_type: string | null;
  target_id: string | null; before: unknown; after: unknown; created_at: string; actor_name?: string;
}

const db = supabase as any;

export default function AdminAudit({ isCollapsed, setIsCollapsed }: Props) {
  const isMobile = useIsMobile();
  const entryBudget = useRowBudget(4, 6, 9);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
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
  const openEntry = rows.find((r) => r.id === openEntryId) ?? null;

  return (
    <AdminLayout
      isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="Audit Log" onRefresh={load} refreshLoading={loading}
    >
      {isMobile ? (
        // The five-column ledger summarises into rows; the diff each entry
        // records is what the row opens, in full, rather than four wrapped
        // mono lines under every entry (§10, v2 §5.4).
        <AdminMobileList
          label="Audit log"
          counter={`${sorted.length}`}
          loading={loading}
          empty={sorted.length === 0 ? 'No audit entries yet.' : undefined}
        >
          {sorted.slice(0, entryBudget).map((r) => (
            <AdminMobileRow
              key={r.id}
              label={r.actor_name || '—'}
              sub={`${r.action} · ${new Date(r.created_at).toLocaleString()} · ${r.target_type}${
                r.target_id ? `:${r.target_id.slice(0, 8)}` : ''
              }`}
              actionsTitle={r.action}
              actions={[
                {
                  label: 'Show the change',
                  sub: 'before and after, as recorded',
                  onClick: () => setOpenEntryId(r.id),
                },
              ]}
            />
          ))}
          {sorted.length > entryBudget && (
            <MobileRow
              label={`All ${sorted.length} entries`}
              sub={`${sorted.length - entryBudget} more`}
              onClick={() => setAllOpen(true)}
            />
          )}
        </AdminMobileList>
      ) : (
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <SortTH sortKey="time">Time</SortTH><SortTH sortKey="actor">Actor</SortTH><SortTH sortKey="action">Action</SortTH>
              <SortTH sortKey="target">Target</SortTH><th className={TH}>Changes</th>
            </tr>
            <tr>
              <FilterTH filterKey="time" /><FilterTH filterKey="actor" /><FilterTH filterKey="action" />
              <FilterTH filterKey="target" /><th className="border-b border-[--hair-border] bg-white" />
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
      )}

      {isMobile && (
        <>
          {/* The diff, in full — an error message and a recorded change are
              both on the never-truncate list (§3.1). */}
          <MobileSheet
            open={openEntry != null}
            title={openEntry?.action ?? ''}
            sub={
              openEntry
                ? `${openEntry.actor_name || '—'} · ${new Date(openEntry.created_at).toLocaleString()}`
                : undefined
            }
            onClose={() => setOpenEntryId(null)}
          >
            {openEntry && (
              <div className="flex flex-col gap-3 p-3.5">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#525252]">
                    Before
                  </span>
                  <span className={cn(M_CODE, 'leading-relaxed text-[#3f3f46]')}>
                    {openEntry.before ? JSON.stringify(openEntry.before) : '—'}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#525252]">
                    After
                  </span>
                  <span className={cn(M_CODE, 'leading-relaxed text-[#3f3f46]')}>
                    {openEntry.after ? JSON.stringify(openEntry.after) : '—'}
                  </span>
                </div>
              </div>
            )}
          </MobileSheet>

          <MobileSheet
            open={allOpen}
            title="Audit log"
            sub={`${sorted.length} entries, newest first.`}
            onClose={() => setAllOpen(false)}
          >
            <div className="flex flex-col">
              {sorted.map((r) => (
                <MobileRow
                  key={r.id}
                  label={r.actor_name || '—'}
                  sub={`${r.action} · ${new Date(r.created_at).toLocaleString()} · ${r.target_type}${
                    r.target_id ? `:${r.target_id.slice(0, 8)}` : ''
                  }`}
                  onClick={() => {
                    setAllOpen(false);
                    setOpenEntryId(r.id);
                  }}
                />
              ))}
            </div>
          </MobileSheet>
        </>
      )}
    </AdminLayout>
  );
}
