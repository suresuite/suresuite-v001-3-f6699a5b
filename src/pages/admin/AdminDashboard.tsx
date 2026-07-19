import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatCard } from '@/components/shared/StatCard';
import { TableEmpty, TH_DENSE } from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

interface Kpis {
  orgs: number;
  projects: number;
  users: number;
  requests: number;
  costMtd: number;
  costToday: number;
  activeUsers7d: number;
}

interface TopRow {
  label: string;
  requests: number;
  cost: number;
}

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
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

        const [
          orgsRes,
          projRes,
          usersRes,
          reqRes,
          mtdRes,
          todayRes,
          activeRes,
          topUsersRes,
          topOrgsRes,
        ] = await Promise.all([
          db.from('organizations').select('id', { count: 'exact', head: true }),
          db.from('projects').select('id', { count: 'exact', head: true }),
          db.from('approved_users').select('id', { count: 'exact', head: true }),
          db.from('ai_usage_logs').select('id', { count: 'exact', head: true }),
          db
            .from('ai_usage_logs')
            .select('cost_usd')
            .gte('created_at', monthStart.toISOString()),
          db
            .from('ai_usage_logs')
            .select('cost_usd')
            .gte('created_at', dayStart.toISOString()),
          db
            .from('ai_usage_logs')
            .select('user_id')
            .gte('created_at', weekAgo.toISOString()),
          db.from('v_admin_user_usage').select('name,email,mtd_requests,mtd_cost_usd')
            .order('mtd_cost_usd', { ascending: false })
            .limit(10),
          db
            .from('ai_usage_logs')
            .select('org_id,cost_usd,id')
            .gte('created_at', monthStart.toISOString()),
        ]);

        if (cancelled) return;

        const sumCost = (rows: any[] | null) =>
          (rows ?? []).reduce((a, r: any) => a + Number(r.cost_usd || 0), 0);

        const uniqueActive = new Set((activeRes.data ?? []).map((r: any) => r.user_id).filter(Boolean));

        setKpis({
          orgs: orgsRes.count ?? 0,
          projects: projRes.count ?? 0,
          users: usersRes.count ?? 0,
          requests: reqRes.count ?? 0,
          costMtd: sumCost(mtdRes.data),
          costToday: sumCost(todayRes.data),
          activeUsers7d: uniqueActive.size,
        });

        setTopUsers(
          (topUsersRes.data ?? []).map((r: any) => ({
            label: r.name || r.email || '—',
            requests: Number(r.mtd_requests || 0),
            cost: Number(r.mtd_cost_usd || 0),
          }))
        );

        const orgAgg = new Map<string, { requests: number; cost: number }>();
        (topOrgsRes.data ?? []).forEach((r: any) => {
          const k = r.org_id || 'unknown';
          const prev = orgAgg.get(k) || { requests: 0, cost: 0 };
          prev.requests += 1;
          prev.cost += Number(r.cost_usd || 0);
          orgAgg.set(k, prev);
        });
        const orgIds = Array.from(orgAgg.keys()).filter((k) => k !== 'unknown');
        let orgNames: Record<string, string> = {};
        if (orgIds.length) {
          const { data: orgs } = await db.from('organizations').select('id,name').in('id', orgIds);
          orgNames = Object.fromEntries((orgs ?? []).map((o: any) => [o.id, o.name]));
        }
        setTopOrgs(
          Array.from(orgAgg.entries())
            .map(([id, v]) => ({ label: orgNames[id] || 'Unassigned', ...v }))
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 10)
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fmt$ = (v: number) => `$${v.toFixed(2)}`;
  const fmtN = (v: number) => v.toLocaleString();
  const avgPerReq = kpis && kpis.requests ? kpis.costMtd / Math.max(1, kpis.requests) : 0;

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="Platform Overview"
    >
      {loading || !kpis ? (
        <div className="space-y-6">
          <StatGridSkeleton />
          <StatGridSkeleton />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <SectionHeader label="Reach" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Organizations" value={fmtN(kpis.orgs)} />
              <StatCard label="Projects" value={fmtN(kpis.projects)} />
              <StatCard label="Users" value={fmtN(kpis.users)} />
              <StatCard label="Active users (7d)" value={fmtN(kpis.activeUsers7d)} />
            </div>
          </section>

          <section>
            <SectionHeader label="AI spend" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Requests" value={fmtN(kpis.requests)} hint="all-time" />
              <StatCard label="Cost today" value={fmt$(kpis.costToday)} />
              <StatCard label="Cost MTD" value={fmt$(kpis.costMtd)} emphasis />
              <StatCard label="Avg $/request" value={fmt$(avgPerReq)} hint="month-to-date" />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TopTable title="Top users" rows={topUsers} />
            <TopTable title="Top organizations" rows={topOrgs} />
          </section>
        </div>
      )}
    </AdminLayout>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
  );
}

function StatGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[92px]" />
      ))}
    </div>
  );
}

function TopTable({ title, rows }: { title: string; rows: TopRow[] }) {
  return (
    <Card className="shadow-xs hover:shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <Badge variant="secondary" className="text-[10px] font-medium tracking-wide">
          MTD
        </Badge>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TH_DENSE}>Name</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Requests</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty colSpan={3} message="No usage recorded yet." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.requests.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    ${r.cost.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
