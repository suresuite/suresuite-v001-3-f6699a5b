// Platform Overview (/admin) — SuReSuite "Ledger" redesign.
// Data flow unchanged from the original AdminDashboard.tsx: same KPI counts,
// MTD spend rollups, and top-user/top-org aggregation. Only the presentation
// changed — StatCard/Card grids became a single bordered KPI ledger with mono
// kickers, and the two Top tables use the shared TH/TD treatment.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SURFACE, KX, TH, TD, ROW_HOVER, useTableSort } from '@/components/admin/adminUi';
import { TableBlock } from '@/components/shared';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface Kpis { orgs: number; projects: number; users: number; requests: number; costMtd: number; costToday: number; activeUsers7d: number; }
interface TopRow { label: string; requests: number; cost: number; }

const db = supabase as any;

export default function AdminDashboard({ isCollapsed, setIsCollapsed }: Props) {
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [topUsers, setTopUsers] = useState<TopRow[]>([]);
  const [topOrgs, setTopOrgs] = useState<TopRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const [orgsRes, projRes, usersRes, reqRes, mtdRes, todayRes, activeRes, topUsersRes, topOrgsRes] = await Promise.all([
          db.from('organizations').select('id', { count: 'exact', head: true }),
          db.from('projects').select('id', { count: 'exact', head: true }),
          db.from('approved_users').select('id', { count: 'exact', head: true }),
          db.from('ai_usage_logs').select('id', { count: 'exact', head: true }),
          db.from('ai_usage_logs').select('cost_usd').gte('created_at', monthStart.toISOString()),
          db.from('ai_usage_logs').select('cost_usd').gte('created_at', dayStart.toISOString()),
          db.from('ai_usage_logs').select('user_id').gte('created_at', weekAgo.toISOString()),
          db.from('v_admin_user_usage').select('name,email,mtd_requests,mtd_cost_usd').order('mtd_cost_usd', { ascending: false }).limit(10),
          db.from('ai_usage_logs').select('org_id,cost_usd,id').gte('created_at', monthStart.toISOString()),
        ]);
        if (cancelled) return;
        const sumCost = (rows: any[] | null) => (rows ?? []).reduce((a, r: any) => a + Number(r.cost_usd || 0), 0);
        const uniqueActive = new Set((activeRes.data ?? []).map((r: any) => r.user_id).filter(Boolean));
        setKpis({
          orgs: orgsRes.count ?? 0, projects: projRes.count ?? 0, users: usersRes.count ?? 0,
          requests: reqRes.count ?? 0, costMtd: sumCost(mtdRes.data), costToday: sumCost(todayRes.data),
          activeUsers7d: uniqueActive.size,
        });
        setTopUsers((topUsersRes.data ?? []).map((r: any) => ({ label: r.name || r.email || '—', requests: Number(r.mtd_requests || 0), cost: Number(r.mtd_cost_usd || 0) })));
        const orgAgg = new Map<string, { requests: number; cost: number }>();
        (topOrgsRes.data ?? []).forEach((r: any) => {
          const k = r.org_id || 'unknown';
          const prev = orgAgg.get(k) || { requests: 0, cost: 0 };
          prev.requests += 1; prev.cost += Number(r.cost_usd || 0); orgAgg.set(k, prev);
        });
        const orgIds = Array.from(orgAgg.keys()).filter((k) => k !== 'unknown');
        let orgNames: Record<string, string> = {};
        if (orgIds.length) {
          const { data: orgs } = await db.from('organizations').select('id,name').in('id', orgIds);
          orgNames = Object.fromEntries((orgs ?? []).map((o: any) => [o.id, o.name]));
        }
        setTopOrgs(Array.from(orgAgg.entries()).map(([id, v]) => ({ label: orgNames[id] || 'Unassigned', ...v })).sort((a, b) => b.cost - a.cost).slice(0, 10));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const $ = (v: number) => `$${v.toFixed(2)}`;
  const n = (v: number) => v.toLocaleString();
  const avg = kpis && kpis.requests ? kpis.costMtd / Math.max(1, kpis.requests) : 0;

  const reach = kpis ? [['Organizations', n(kpis.orgs)], ['Projects', n(kpis.projects)], ['Users', n(kpis.users)], ['Active · 7d', n(kpis.activeUsers7d)]] : [];
  const spend = kpis ? [['Requests', n(kpis.requests), 'all-time', false], ['Cost today', $(kpis.costToday), '', false], ['Cost MTD', $(kpis.costMtd), '', true], ['Avg $/req', $(avg), 'month-to-date', false]] : [];

  return (
    <AdminLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="Platform Overview">
      {loading || !kpis ? (
        <div className="grid h-40 place-items-center">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[--zinc-border] border-t-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className={`${SURFACE} overflow-hidden`}>
            <div className={`${KX} border-b border-[--hair-border] px-4 py-[9px]`}>Reach</div>
            <div className="grid grid-cols-4">
              {reach.map(([label, value], i) => (
                <div key={label} className={i < 3 ? 'border-r border-[--hair-divider] px-[18px] py-[15px]' : 'px-[18px] py-[15px]'}>
                  <div className={KX}>{label}</div>
                  <div className="mt-2 text-[27px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{value}</div>
                </div>
              ))}
            </div>
            <div className={`${KX} border-y border-[--hair-border] px-4 py-[9px]`}>AI spend</div>
            <div className="grid grid-cols-4">
              {spend.map(([label, value, hint, emph], i) => (
                <div key={label as string} className={`px-[18px] py-[15px] ${i < 3 ? 'border-r border-[--hair-divider]' : ''} ${emph ? 'bg-[#fffdf3]' : ''}`}>
                  <div className={KX}>{label}</div>
                  <div className="mt-2 text-[27px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{value}</div>
                  {emph ? <div className="mt-2 h-[2px] w-9 rounded-full bg-[#f8d448]" /> : hint ? <div className="mt-2 font-mono text-[10px] text-[#a3a3a3]">{hint}</div> : null}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <TopTable title="Top users" rows={topUsers} />
            <TopTable title="Top organizations" rows={topOrgs} />
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function TopTable({ title, rows }: { title: string; rows: TopRow[] }) {
  const { sorted, SortTH } = useTableSort(rows, {
    label: (r: TopRow) => r.label.toLowerCase(), requests: (r: TopRow) => r.requests, cost: (r: TopRow) => r.cost,
  });
  return (
    // L1: the table's name sits on the canvas above the shell, not in a title bar.
    <TableBlock
      name={title}
      count={rows.length}
      actions={
        <span className="rounded-sm bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] text-[--ledger-quiet]">MTD</span>
      }
    >
      <table className="w-full border-collapse">
        <thead><tr><SortTH sortKey="label">Name</SortTH><SortTH sortKey="requests" align="right">Req</SortTH><SortTH sortKey="cost" align="right">Cost</SortTH></tr></thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={3} className="px-4 py-10 text-center text-[13px] text-muted-foreground">No usage recorded yet.</td></tr>
          ) : sorted.map((r) => (
            <tr key={r.label} className={ROW_HOVER}>
              <td className={`${TD} text-[13px]`}>{r.label}</td>
              <td className={`${TD} text-right font-mono text-[12px] tabular-nums text-muted-foreground`}>{r.requests.toLocaleString()}</td>
              <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>${r.cost.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableBlock>
  );
}
