import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Input } from '@/components/ui/input';
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
import { toast } from 'sonner';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

interface ProjectRow {
  id: string;
  name: string;
  organization: string | null;
  modeler_id: string;
  supply_chain_model: string;
  created_at: string;
  updated_at: string;
  owner?: string;
}

const db = supabase as any;

export default function AdminProjects({ isCollapsed, setIsCollapsed }: Props) {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error } = await db
      .from('projects')
      .select('id,name,organization,modeler_id,supply_chain_model,created_at,updated_at')
      .order('updated_at', { ascending: false });
    if (error) toast.error(error.message);
    const projects = (data ?? []) as ProjectRow[];
    const modelerIds = Array.from(new Set(projects.map((p) => p.modeler_id).filter(Boolean)));
    let ownerMap: Record<string, string> = {};
    if (modelerIds.length) {
      const { data: users } = await db
        .from('approved_users')
        .select('id,name,email')
        .in('id', modelerIds);
      ownerMap = Object.fromEntries(
        (users ?? []).map((u: any) => [u.id, u.name || u.email])
      );
    }
    setRows(projects.map((p) => ({ ...p, owner: ownerMap[p.modeler_id] })));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        (r.organization || '').toLowerCase().includes(s) ||
        (r.owner || '').toLowerCase().includes(s)
    );
  }, [rows, q]);

  const remove = async (row: ProjectRow) => {
    if (!confirm(`Delete project "${row.name}"? This cannot be undone.`)) return;
    const { error } = await db.from('projects').delete().eq('id', row.id);
    if (error) return toast.error(error.message);
    toast.success('Deleted');
    await db.rpc('log_admin_action', {
      p_action: 'project.delete',
      p_target_type: 'projects',
      p_target_id: row.id,
      p_before: row,
      p_after: null,
    });
    load();
  };

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="Projects"
      description="Every project across every organization."
      actions={
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search name, org, owner…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-64"
          />
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
              <TableHead>Name</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last activity</TableHead>
              <TableHead className="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No projects match.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.organization || '—'}</TableCell>
                  <TableCell>{p.owner || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.supply_chain_model}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.updated_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => remove(p)}>
                      Delete
                    </Button>
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
