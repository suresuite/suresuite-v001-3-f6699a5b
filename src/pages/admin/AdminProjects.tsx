// Projects (/admin/projects) — SuReSuite "Ledger" redesign.
// Data flow, RPCs (admin_list_projects/organizations/users_basic, copy/rename/
// update_meta/transfer/delete) and search unchanged. Model column shows a mono
// BOM/data chip pair; status is an outlined chip; row actions live in a menu.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SURFACE, TH, TD, ROW_HOVER, MonoChip, EmptyRow, LoadingRow, useTableSort, useColumnFilters } from '@/components/admin/adminUi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ArrowRightLeft, Copy, Loader2, MoreHorizontal, Pencil, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface ProjectRow { id: string; name: string; organization_id: string | null; organization: string | null; modeler_id: string; owner_name: string | null; owner_email: string | null; plant_name: string; supply_chain_model: string; bom_level: string; data_type: string; completed: boolean; simulation_start: string | null; simulation_end: string | null; created_at: string; updated_at: string; }
interface OrgOption { id: string; name: string; }
interface UserOption { id: string; name: string | null; email: string | null; organization_id: string | null; is_active: boolean | null; }
type DialogKind = 'copy' | 'rename' | 'meta' | 'transfer' | null;

const db = supabase as any;
const NONE = '__none__';
const userLabel = (u: UserOption) => (u.name ? `${u.name} (${u.email})` : u.email || u.id);

export default function AdminProjects({ isCollapsed, setIsCollapsed }: Props) {
  const { user: actor } = useAuth();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [target, setTarget] = useState<ProjectRow | null>(null);
  const actorArgs = () => ({ p_actor_id: actor?.id, p_actor_email: actor?.email });

  const load = async () => {
    setLoading(true);
    const [projRes, orgRes, userRes] = await Promise.all([
      db.rpc('admin_list_projects', actorArgs()),
      db.rpc('admin_list_organizations', actorArgs()),
      db.rpc('admin_list_users_basic', actorArgs()),
    ]);
    if (projRes.error) toast.error(projRes.error.message);
    setRows((projRes.data ?? []) as ProjectRow[]);
    setOrgs(((orgRes.data ?? []) as any[]).map((o) => ({ id: o.id, name: o.name })));
    setUsers((userRes.data ?? []) as UserOption[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(s) || (r.organization || '').toLowerCase().includes(s) || (r.owner_name || '').toLowerCase().includes(s) || (r.owner_email || '').toLowerCase().includes(s) || (r.plant_name || '').toLowerCase().includes(s));
  }, [rows, q]);

  const colFilterGetters = useMemo(() => ({
    name: (p: ProjectRow) => p.name, org: (p: ProjectRow) => p.organization || '', owner: (p: ProjectRow) => `${p.owner_name || ''} ${p.owner_email || ''}`,
    plant: (p: ProjectRow) => p.plant_name || '', model: (p: ProjectRow) => p.supply_chain_model, status: (p: ProjectRow) => (p.completed ? 'completed' : 'draft'),
    updated: (p: ProjectRow) => new Date(p.updated_at).toLocaleDateString(),
  }), []);
  const { filtered: colFiltered, FilterTH } = useColumnFilters(filtered, colFilterGetters);
  const sortGetters = useMemo(() => ({
    name: (p: ProjectRow) => p.name.toLowerCase(), org: (p: ProjectRow) => (p.organization || '').toLowerCase(),
    owner: (p: ProjectRow) => (p.owner_name || p.owner_email || '').toLowerCase(), plant: (p: ProjectRow) => (p.plant_name || '').toLowerCase(),
    model: (p: ProjectRow) => p.supply_chain_model.toLowerCase(),
    status: (p: ProjectRow) => (p.completed ? 1 : 0), updated: (p: ProjectRow) => p.updated_at,
  }), []);
  const { sorted, SortTH } = useTableSort(colFiltered, sortGetters);

  const openDialog = (kind: DialogKind, row: ProjectRow) => { setTarget(row); setDialog(kind); };
  const closeDialog = () => { setDialog(null); setTarget(null); };

  const remove = async (row: ProjectRow) => {
    if (!confirm(`Delete project "${row.name}"? All its data will be removed. This cannot be undone.`)) return;
    const { error } = await db.rpc('admin_delete_project', { ...actorArgs(), p_project_id: row.id });
    if (error) return toast.error(error.message);
    toast.success(`Project "${row.name}" deleted`); load();
  };

  return (
    <AdminLayout
      isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="Projects"
      onRefresh={load} refreshLoading={loading}
      actions={<Input placeholder="Search name, org, owner, plant…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-64 rounded-sm" />}
    >
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <SortTH sortKey="name">Name</SortTH><SortTH sortKey="org">Organization</SortTH><SortTH sortKey="owner">Owner</SortTH>
              <SortTH sortKey="plant">Plant</SortTH><SortTH sortKey="model">Model</SortTH><SortTH sortKey="status">Status</SortTH>
              <SortTH sortKey="updated">Last activity</SortTH><th className={`${TH} w-[1%]`} />
            </tr>
            <tr>
              <FilterTH filterKey="name" /><FilterTH filterKey="org" /><FilterTH filterKey="owner" />
              <FilterTH filterKey="plant" /><FilterTH filterKey="model" /><FilterTH filterKey="status" /><FilterTH filterKey="updated" /><th className="border-b border-[#ebebeb] bg-[#fafafa]" />
            </tr></thead>
            <tbody>
              {loading ? <LoadingRow colSpan={8} /> : sorted.length === 0 ? (
                <EmptyRow colSpan={8} message={q ? 'No projects match these filters.' : 'No projects yet.'}
                  action={q ? <Button variant="ghost" size="sm" onClick={() => setQ('')}>Clear search</Button> : undefined} />
              ) : sorted.map((p) => (
                <tr key={p.id} className={ROW_HOVER}>
                  <td className={`${TD} max-w-[240px] truncate text-[13px] font-medium`}>{p.name}</td>
                  <td className={`${TD} text-[13px]`}>{p.organization || '—'}</td>
                  <td className={TD}><div className="text-[13px]">{p.owner_name || '—'}</div>{p.owner_email && <div className="text-[11px] text-muted-foreground">{p.owner_email}</div>}</td>
                  <td className={`${TD} text-[13px]`}>{p.plant_name || '—'}</td>
                  <td className={TD}>
                    <div className="text-[12px]">{p.supply_chain_model}</div>
                    <div className="mt-1 flex gap-1">
                      <MonoChip>{p.bom_level === 'multi_level' ? 'multi-level BOM' : 'single BOM'}</MonoChip>
                      <MonoChip>{p.data_type}</MonoChip>
                    </div>
                  </td>
                  <td className={TD}>
                    <span className={`rounded-[4px] border px-1.5 py-0.5 text-[11px] ${p.completed ? 'border-[#d4d4d4] text-foreground' : 'border-[#e4e4e4] text-muted-foreground'}`}>{p.completed ? 'completed' : 'draft'}</span>
                  </td>
                  <td className={`${TD} text-[12px] text-muted-foreground`}>{new Date(p.updated_at).toLocaleDateString()}</td>
                  <td className={`${TD} text-right`}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDialog('copy', p)}><Copy className="mr-2 h-4 w-4" /> Copy…</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDialog('rename', p)}><Pencil className="mr-2 h-4 w-4" /> Rename…</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDialog('meta', p)}><Settings2 className="mr-2 h-4 w-4" /> Edit metadata…</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDialog('transfer', p)}><ArrowRightLeft className="mr-2 h-4 w-4" /> Transfer to organization…</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-[#bf2330] focus:text-[#bf2330]" onClick={() => remove(p)}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {target && dialog === 'copy' && <CopyDialog project={target} orgs={orgs} users={users} actorArgs={actorArgs} onClose={closeDialog} onDone={load} />}
      {target && dialog === 'rename' && <RenameDialog project={target} actorArgs={actorArgs} onClose={closeDialog} onDone={load} />}
      {target && dialog === 'meta' && <MetaDialog project={target} actorArgs={actorArgs} onClose={closeDialog} onDone={load} />}
      {target && dialog === 'transfer' && <TransferDialog project={target} orgs={orgs} users={users} actorArgs={actorArgs} onClose={closeDialog} onDone={load} />}
    </AdminLayout>
  );
}

type ActorArgs = () => { p_actor_id?: string; p_actor_email?: string };

function CopyDialog({ project, orgs, users, actorArgs, onClose, onDone }: { project: ProjectRow; orgs: OrgOption[]; users: UserOption[]; actorArgs: ActorArgs; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(`${project.name} (copy)`);
  const [orgId, setOrgId] = useState<string>(project.organization_id ?? NONE);
  const [ownerId, setOwnerId] = useState<string>(project.modeler_id ?? NONE);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) return toast.error('Name is required');
    setSaving(true);
    const { error } = await db.rpc('admin_copy_project', { ...actorArgs(), p_project_id: project.id, p_new_name: name.trim(), p_target_org_id: orgId === NONE || orgId === project.organization_id ? null : orgId, p_new_owner_id: ownerId === NONE || ownerId === project.modeler_id ? null : ownerId });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Project copied as "${name.trim()}"`); onClose(); onDone();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-sm">
        <DialogHeader><DialogTitle>Copy “{project.name}”</DialogTitle><DialogDescription>Copies the project and its model data (item master, logistics, BOM, network, policies). Simulation runs and version history are not copied.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div><Label className="text-xs">New name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 rounded-sm" /></div>
          <div><Label className="text-xs">Organization</Label>
            <Select value={orgId} onValueChange={setOrgId}><SelectTrigger className="mt-1 rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>Keep current ({project.organization || '—'})</SelectItem>{orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}><SelectTrigger className="mt-1 rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>Keep current ({project.owner_name || project.owner_email || '—'})</SelectItem>{users.map((u) => <SelectItem key={u.id} value={u.id}>{userLabel(u)}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="rounded-sm" onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Copy project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ project, actorArgs, onClose, onDone }: { project: ProjectRow; actorArgs: ActorArgs; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) return toast.error('Name is required');
    setSaving(true);
    const { error } = await db.rpc('admin_rename_project', { ...actorArgs(), p_project_id: project.id, p_name: name.trim() });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Renamed to "${name.trim()}"`); onClose(); onDone();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-sm">
        <DialogHeader><DialogTitle>Rename “{project.name}”</DialogTitle></DialogHeader>
        <div><Label className="text-xs">New name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 rounded-sm" autoFocus /></div>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="rounded-sm" onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetaDialog({ project, actorArgs, onClose, onDone }: { project: ProjectRow; actorArgs: ActorArgs; onClose: () => void; onDone: () => void }) {
  const [plant, setPlant] = useState(project.plant_name || '');
  const [model, setModel] = useState(project.supply_chain_model);
  const [bomLevel, setBomLevel] = useState(project.bom_level || 'single');
  const [dataType, setDataType] = useState(project.data_type || 'curated');
  const [simStart, setSimStart] = useState(project.simulation_start || '');
  const [simEnd, setSimEnd] = useState(project.simulation_end || '');
  const [completed, setCompleted] = useState(project.completed);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const { error } = await db.rpc('admin_update_project_meta', { ...actorArgs(), p_project_id: project.id, p_plant: plant.trim() || null, p_model: model, p_bom_level: bomLevel, p_data_type: dataType, p_simulation_start: simStart || null, p_simulation_end: simEnd || null, p_completed: completed });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Metadata updated for "${project.name}"`); onClose(); onDone();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-sm">
        <DialogHeader><DialogTitle>Edit metadata — “{project.name}”</DialogTitle><DialogDescription>Model settings of the project itself.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div><Label className="text-xs">Plant</Label><Input value={plant} onChange={(e) => setPlant(e.target.value)} className="mt-1 rounded-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Supply chain model</Label>
              <Select value={model} onValueChange={setModel}><SelectTrigger className="mt-1 rounded-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Make-To-Order">Make-To-Order</SelectItem><SelectItem value="Make-To-Stock">Make-To-Stock</SelectItem></SelectContent></Select></div>
            <div><Label className="text-xs">BOM level</Label>
              <Select value={bomLevel} onValueChange={setBomLevel}><SelectTrigger className="mt-1 rounded-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Single level</SelectItem><SelectItem value="multi_level">Multi level</SelectItem></SelectContent></Select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Data type</Label>
              <Select value={dataType} onValueChange={setDataType}><SelectTrigger className="mt-1 rounded-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="curated">Curated</SelectItem><SelectItem value="uncurated">Uncurated</SelectItem></SelectContent></Select></div>
            <div className="flex items-end gap-2 pb-1"><Switch checked={completed} onCheckedChange={setCompleted} id="proj-completed" /><Label htmlFor="proj-completed" className="text-xs">Completed</Label></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Simulation start</Label><Input type="date" value={simStart} onChange={(e) => setSimStart(e.target.value)} className="mt-1 rounded-sm" /></div>
            <div><Label className="text-xs">Simulation end</Label><Input type="date" value={simEnd} onChange={(e) => setSimEnd(e.target.value)} className="mt-1 rounded-sm" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="rounded-sm" onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ project, orgs, users, actorArgs, onClose, onDone }: { project: ProjectRow; orgs: OrgOption[]; users: UserOption[]; actorArgs: ActorArgs; onClose: () => void; onDone: () => void }) {
  const [orgId, setOrgId] = useState<string>('');
  const [ownerId, setOwnerId] = useState<string>(NONE);
  const [saving, setSaving] = useState(false);
  const sortedUsers = useMemo(() => { if (!orgId) return users; return [...users].sort((a, b) => Number(b.organization_id === orgId) - Number(a.organization_id === orgId)); }, [users, orgId]);
  const save = async () => {
    if (!orgId) return toast.error('Pick a target organization');
    setSaving(true);
    const { error } = await db.rpc('admin_transfer_project', { ...actorArgs(), p_project_id: project.id, p_org_id: orgId, p_new_owner_id: ownerId === NONE ? null : ownerId });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`"${project.name}" transferred to ${orgs.find((o) => o.id === orgId)?.name ?? 'organization'}`); onClose(); onDone();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-sm">
        <DialogHeader><DialogTitle>Transfer “{project.name}”</DialogTitle><DialogDescription>Moves the project (and all its data) from <span className="font-medium">{project.organization || 'no organization'}</span> to another organization. Optionally hand ownership to a user there.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div><Label className="text-xs">Target organization</Label>
            <Select value={orgId} onValueChange={setOrgId}><SelectTrigger className="mt-1 rounded-sm"><SelectValue placeholder="Select organization…" /></SelectTrigger>
              <SelectContent>{orgs.filter((o) => o.id !== project.organization_id).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">New owner (optional)</Label>
            <Select value={ownerId} onValueChange={setOwnerId}><SelectTrigger className="mt-1 rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>Keep current owner ({project.owner_name || project.owner_email || '—'})</SelectItem>{sortedUsers.map((u) => <SelectItem key={u.id} value={u.id}>{userLabel(u)}{orgId && u.organization_id === orgId ? ' · target org' : ''}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="rounded-sm" onClick={save} disabled={saving || !orgId}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Transfer project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
