import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

// The new admin tables are on external Supabase and not in generated types.ts.
// Cast to any to bypass typegen mismatch.
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

        // Aggregate top orgs client-side (small volumes).
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

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="Platform Overview"
      description="Platform-wide organizations, users, projects, and AI spend."
    >
      {loading || !kpis ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading metrics…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Organizations" value={fmtN(kpis.orgs)} />
            <Kpi label="Projects" value={fmtN(kpis.projects)} />
            <Kpi label="Users" value={fmtN(kpis.users)} />
            <Kpi label="Active users (7d)" value={fmtN(kpis.activeUsers7d)} />
            <Kpi label="AI requests (all-time)" value={fmtN(kpis.requests)} />
            <Kpi label="AI cost today" value={fmt$(kpis.costToday)} />
            <Kpi label="AI cost MTD" value={fmt$(kpis.costMtd)} />
            <Kpi label="Avg $/request MTD" value={fmt$(kpis.requests ? kpis.costMtd / Math.max(1, kpis.requests) : 0)} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TopTable title="Top users by AI cost (MTD)" rows={topUsers} />
            <TopTable title="Top organizations by AI cost (MTD)" rows={topOrgs} />
          </div>
        </>
      )}
    </AdminLayout>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function TopTable({ title, rows }: { title: string; rows: TopRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                  No usage recorded yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell>{r.label}</TableCell>
                <TableCell className="text-right">{r.requests.toLocaleString()}</TableCell>
                <TableCell className="text-right">${r.cost.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
