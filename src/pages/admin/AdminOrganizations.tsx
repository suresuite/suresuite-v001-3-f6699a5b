import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { OrgAccessDrawer } from '@/components/admin/OrgAccessDrawer';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  members: number;
  projects: number;
  cost_mtd: number;
}

const db = supabase as any;

export default function AdminOrganizations({ isCollapsed, setIsCollapsed }: Props) {
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessOrg, setAccessOrg] = useState<OrgRow | null>(null);

  const load = async () => {
    setLoading(true);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [orgsRes, memRes, projRes, useRes] = await Promise.all([
      db.from('organizations').select('*').order('name'),
      db.from('organization_members').select('org_id'),
      db.from('projects').select('organization_id'),
      db
        .from('ai_usage_logs')
        .select('org_id,cost_usd')
        .gte('created_at', monthStart.toISOString()),
    ]);
    const memCount = new Map<string, number>();
    (memRes.data ?? []).forEach((r: any) => {
      memCount.set(r.org_id, (memCount.get(r.org_id) || 0) + 1);
    });
    const projCount = new Map<string, number>();
    (projRes.data ?? []).forEach((r: any) => {
      if (r.organization_id)
        projCount.set(r.organization_id, (projCount.get(r.organization_id) || 0) + 1);
    });
    const cost = new Map<string, number>();
    (useRes.data ?? []).forEach((r: any) => {
      if (r.org_id) cost.set(r.org_id, (cost.get(r.org_id) || 0) + Number(r.cost_usd || 0));
    });
    setRows(
      ((orgsRes.data ?? []) as any[]).map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        status: o.status,
        created_at: o.created_at,
        members: memCount.get(o.id) || 0,
        projects: projCount.get(o.id) || 0,
        cost_mtd: cost.get(o.id) || 0,
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const toggleStatus = async (row: OrgRow) => {
    const next = row.status === 'active' ? 'suspended' : 'active';
    const { error } = await db.from('organizations').update({ status: next }).eq('id', row.id);
    if (error) return toast.error(error.message);
    await db.rpc('log_admin_action', {
      p_action: 'org.set_status',
      p_target_type: 'organizations',
      p_target_id: row.id,
      p_before: { status: row.status },
      p_after: { status: next },
    });
    load();
  };

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="Organizations"
      description="Every organization on the platform."
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
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead className="text-right">Projects</TableHead>
              <TableHead className="text-right">Cost (MTD)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[120px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell className="text-muted-foreground">{o.slug}</TableCell>
                  <TableCell className="text-right">{o.members}</TableCell>
                  <TableCell className="text-right">{o.projects}</TableCell>
                  <TableCell className="text-right">${o.cost_mtd.toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === 'active' ? 'secondary' : 'destructive'}>
                      {o.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setAccessOrg(o)} title="Access defaults">
                      <ShieldCheck className="mr-1 h-3 w-3" /> Access
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleStatus(o)}>
                      {o.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {accessOrg && (
        <OrgAccessDrawer
          orgId={accessOrg.id}
          orgName={accessOrg.name}
          open={!!accessOrg}
          onClose={() => setAccessOrg(null)}
        />
      )}
    </AdminLayout>
  );
}
