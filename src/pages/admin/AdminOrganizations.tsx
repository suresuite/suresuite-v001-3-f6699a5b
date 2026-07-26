// Organizations (/admin/organizations) — SuReSuite "Ledger" redesign.
// Data flow, RPCs (admin_list_organizations, admin_set_org_status,
// admin_update_organization, admin_create_organization) and the OrgAccessDrawer
// hook-in are unchanged. Table reskinned with mono slug, status dot, and a
// reskinned row action menu; Add-organization lives in the header.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SURFACE, TH, TD, ROW_HOVER, StatusDot, EmptyRow, LoadingRow, useTableSort, useColumnFilters } from '@/components/admin/adminUi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Ban, Loader2, MoreHorizontal, Pencil, Plus, ShieldCheck, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { OrgAccessDrawer } from '@/components/admin/OrgAccessDrawer';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface OrgRow { id: string; name: string; slug: string; status: string; created_at: string; members: number; projects: number; cost_mtd: number; }

const db = supabase as any;

export default function AdminOrganizations({ isCollapsed, setIsCollapsed }: Props) {
  const { user: actor } = useAuth();
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessOrg, setAccessOrg] = useState<OrgRow | null>(null);
  const [renameOrg, setRenameOrg] = useState<OrgRow | null>(null);
  const actorArgs = () => ({ p_actor_id: actor?.id, p_actor_email: actor?.email });

  const load = async () => {
    setLoading(true);
    const { data, error } = await db.rpc('admin_list_organizations', actorArgs());
    if (error) toast.error(error.message);
    setRows(((data ?? []) as any[]).map((o) => ({ id: o.id, name: o.name, slug: o.slug, status: o.status, created_at: o.created_at, members: Number(o.members || 0), projects: Number(o.projects || 0), cost_mtd: Number(o.cost_mtd || 0) })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleStatus = async (row: OrgRow) => {
    const next = row.status === 'active' ? 'suspended' : 'active';
    const { error } = await db.rpc('admin_set_org_status', { ...actorArgs(), p_org_id: row.id, p_status: next });
    if (error) return toast.error(error.message);
    toast.success(next === 'active' ? 'Reactivated' : 'Suspended'); load();
  };

  const colFilterGetters = useMemo(() => ({
    name: (o: OrgRow) => o.name, slug: (o: OrgRow) => o.slug, members: (o: OrgRow) => String(o.members),
    projects: (o: OrgRow) => String(o.projects), cost: (o: OrgRow) => String(o.cost_mtd), status: (o: OrgRow) => o.status,
    created: (o: OrgRow) => new Date(o.created_at).toLocaleDateString(),
  }), []);
  const { filtered: colFiltered, FilterTH } = useColumnFilters(rows, colFilterGetters);
  const sortGetters = useMemo(() => ({
    name: (o: OrgRow) => o.name.toLowerCase(), slug: (o: OrgRow) => o.slug.toLowerCase(), members: (o: OrgRow) => o.members,
    projects: (o: OrgRow) => o.projects, cost: (o: OrgRow) => o.cost_mtd, status: (o: OrgRow) => o.status, created: (o: OrgRow) => o.created_at,
  }), []);
  const { sorted, SortTH } = useTableSort(colFiltered, sortGetters);

  return (
    <AdminLayout
      isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="Organizations"
      onRefresh={load} refreshLoading={loading}
      actions={<AddOrgDialog actorArgs={actorArgs} onCreated={load} />}
    >
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <SortTH sortKey="name">Name</SortTH><SortTH sortKey="slug">Slug</SortTH>
              <SortTH sortKey="members" align="right">Members</SortTH><SortTH sortKey="projects" align="right">Projects</SortTH>
              <SortTH sortKey="cost" align="right">Cost MTD</SortTH><SortTH sortKey="status">Status</SortTH><SortTH sortKey="created">Created</SortTH><th className={`${TH} w-[1%]`} />
            </tr>
            <tr>
              <FilterTH filterKey="name" /><FilterTH filterKey="slug" />
              <FilterTH filterKey="members" align="right" /><FilterTH filterKey="projects" align="right" />
              <FilterTH filterKey="cost" align="right" /><FilterTH filterKey="status" /><FilterTH filterKey="created" /><th className="border-b border-[#ebebeb] bg-[#fafafa]" />
            </tr></thead>
            <tbody>
              {loading ? <LoadingRow colSpan={8} /> : sorted.length === 0 ? (
                <EmptyRow colSpan={8} message="No organizations yet." />
              ) : sorted.map((o) => (
                <tr key={o.id} className={ROW_HOVER}>
                  <td className={`${TD} max-w-[260px] truncate text-[13px] font-medium`}>{o.name}</td>
                  <td className={`${TD} font-mono text-[12px] text-muted-foreground`}>{o.slug}</td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>{o.members}</td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>{o.projects}</td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>${o.cost_mtd.toFixed(2)}</td>
                  <td className={TD}><StatusDot tone={o.status === 'active' ? 'active' : 'error'} label={o.status} /></td>
                  <td className={`${TD} text-[12px] text-muted-foreground`}>{new Date(o.created_at).toLocaleDateString()}</td>
                  <td className={`${TD} text-right`}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setRenameOrg(o)}><Pencil className="mr-2 h-4 w-4" /> Rename…</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setAccessOrg(o)}><ShieldCheck className="mr-2 h-4 w-4" /> Access defaults…</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => toggleStatus(o)}>
                          {o.status === 'active' ? <><Ban className="mr-2 h-4 w-4" /> Suspend</> : <><Undo2 className="mr-2 h-4 w-4" /> Reactivate</>}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {accessOrg && <OrgAccessDrawer orgId={accessOrg.id} orgName={accessOrg.name} open={!!accessOrg} onClose={() => setAccessOrg(null)} />}
      {renameOrg && <RenameOrgDialog org={renameOrg} actorArgs={actorArgs} onClose={() => setRenameOrg(null)} onDone={load} />}
    </AdminLayout>
  );
}

function RenameOrgDialog({ org, actorArgs, onClose, onDone }: { org: OrgRow; actorArgs: () => any; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(org.name);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) return toast.error('Name is required');
    setSaving(true);
    const { error } = await db.rpc('admin_update_organization', { ...actorArgs(), p_org_id: org.id, p_name: name.trim() });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Renamed to "${name.trim()}"`); onClose(); onDone();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-sm">
        <DialogHeader><DialogTitle>Rename “{org.name}”</DialogTitle></DialogHeader>
        <div><Label className="text-xs">New name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 rounded-sm" autoFocus /></div>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="rounded-sm" onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddOrgDialog({ actorArgs, onCreated }: { actorArgs: () => any; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const create = async () => {
    if (!name.trim()) return toast.error('Name is required');
    setSaving(true);
    const { error } = await db.rpc('admin_create_organization', { ...actorArgs(), p_name: name.trim(), p_slug: slug.trim() || null });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Organization "${name.trim()}" created`); setName(''); setSlug(''); setOpen(false); onCreated();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setName(''); setSlug(''); } }}>
      <DialogTrigger asChild><Button size="sm" className="rounded-sm"><Plus className="mr-1.5 h-3.5 w-3.5" /> Add organization</Button></DialogTrigger>
      <DialogContent className="rounded-sm">
        <DialogHeader><DialogTitle>Add organization</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 rounded-sm" placeholder="Acme Robotics" /></div>
          <div><Label className="text-xs">Slug (optional)</Label><Input value={slug} onChange={(e) => setSlug(e.target.value)} className="mt-1 rounded-sm font-mono" placeholder="auto-generated from name" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button className="rounded-sm" onClick={create} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create organization</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
