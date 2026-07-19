import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowRightLeft,
  Copy,
  Loader2,
  MoreHorizontal,
  Pencil,
  Settings2,
  Trash2,
} from 'lucide-react';
import { TableEmpty, TableLoading, TableShell, TH_DENSE } from '@/components/shared';
import { toast } from 'sonner';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

interface ProjectRow {
  id: string;
  name: string;
  organization_id: string | null;
  organization: string | null;
  modeler_id: string;
  owner_name: string | null;
  owner_email: string | null;
  plant_name: string;
  supply_chain_model: string;
  bom_level: string;
  data_type: string;
  completed: boolean;
  simulation_start: string | null;
  simulation_end: string | null;
  created_at: string;
  updated_at: string;
}

interface OrgOption {
  id: string;
  name: string;
}

interface UserOption {
  id: string;
  name: string | null;
  email: string | null;
  organization_id: string | null;
  is_active: boolean | null;
}

type DialogKind = 'copy' | 'rename' | 'meta' | 'transfer' | null;

const db = supabase as any;
const NONE = '__none__';

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
        (r.owner_name || '').toLowerCase().includes(s) ||
        (r.owner_email || '').toLowerCase().includes(s) ||
        (r.plant_name || '').toLowerCase().includes(s)
    );
  }, [rows, q]);

  const openDialog = (kind: DialogKind, row: ProjectRow) => {
    setTarget(row);
    setDialog(kind);
  };

  const closeDialog = () => {
    setDialog(null);
    setTarget(null);
  };

  const remove = async (row: ProjectRow) => {
    if (!confirm(`Delete project "${row.name}"? All its data will be removed. This cannot be undone.`))
      return;
    const { error } = await db.rpc('admin_delete_project', {
      ...actorArgs(),
      p_project_id: row.id,
    });
    if (error) return toast.error(error.message);
    toast.success(`Project "${row.name}" deleted`);
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
            placeholder="Search name, org, owner, plant…"
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
      <TableShell>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TH_DENSE}>Name</TableHead>
              <TableHead className={TH_DENSE}>Organization</TableHead>
              <TableHead className={TH_DENSE}>Owner</TableHead>
              <TableHead className={TH_DENSE}>Plant</TableHead>
              <TableHead className={TH_DENSE}>Model</TableHead>
              <TableHead className={TH_DENSE}>Status</TableHead>
              <TableHead className={TH_DENSE}>Created</TableHead>
              <TableHead className={TH_DENSE}>Last activity</TableHead>
              <TableHead className={`${TH_DENSE} w-[60px] text-right`}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoading colSpan={9} />
            ) : filtered.length === 0 ? (
              <TableEmpty
                colSpan={9}
                message={q ? 'No projects match these filters.' : 'No projects yet.'}
                action={
                  q ? (
                    <Button variant="ghost" size="sm" onClick={() => setQ('')}>
                      Clear search
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.organization || '—'}</TableCell>
                  <TableCell>
                    <div>{p.owner_name || '—'}</div>
                    {p.owner_email && (
                      <div className="text-xs text-muted-foreground">{p.owner_email}</div>
                    )}
                  </TableCell>
                  <TableCell>{p.plant_name || '—'}</TableCell>
                  <TableCell>
                    <div className="text-xs">{p.supply_chain_model}</div>
                    <div className="mt-0.5 flex gap-1">
                      <Badge variant="outline" className="text-[10px]">
                        {p.bom_level === 'multi_level' ? 'multi-level BOM' : 'single BOM'}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {p.data_type}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.completed ? 'secondary' : 'outline'}>
                      {p.completed ? 'completed' : 'draft'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(p.updated_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDialog('copy', p)}>
                          <Copy className="mr-2 h-4 w-4" /> Copy…
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDialog('rename', p)}>
                          <Pencil className="mr-2 h-4 w-4" /> Rename…
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDialog('meta', p)}>
                          <Settings2 className="mr-2 h-4 w-4" /> Edit metadata…
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDialog('transfer', p)}>
                          <ArrowRightLeft className="mr-2 h-4 w-4" /> Transfer to organization…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => remove(p)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableShell>

      {target && dialog === 'copy' && (
        <CopyDialog
          project={target}
          orgs={orgs}
          users={users}
          actorArgs={actorArgs}
          onClose={closeDialog}
          onDone={load}
        />
      )}
      {target && dialog === 'rename' && (
        <RenameDialog project={target} actorArgs={actorArgs} onClose={closeDialog} onDone={load} />
      )}
      {target && dialog === 'meta' && (
        <MetaDialog project={target} actorArgs={actorArgs} onClose={closeDialog} onDone={load} />
      )}
      {target && dialog === 'transfer' && (
        <TransferDialog
          project={target}
          orgs={orgs}
          users={users}
          actorArgs={actorArgs}
          onClose={closeDialog}
          onDone={load}
        />
      )}
    </AdminLayout>
  );
}

type ActorArgs = () => { p_actor_id?: string; p_actor_email?: string };

function userLabel(u: UserOption) {
  return u.name ? `${u.name} (${u.email})` : u.email || u.id;
}

function CopyDialog({
  project,
  orgs,
  users,
  actorArgs,
  onClose,
  onDone,
}: {
  project: ProjectRow;
  orgs: OrgOption[];
  users: UserOption[];
  actorArgs: ActorArgs;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(`${project.name} (copy)`);
  const [orgId, setOrgId] = useState<string>(project.organization_id ?? NONE);
  const [ownerId, setOwnerId] = useState<string>(project.modeler_id ?? NONE);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.error('Name is required');
    setSaving(true);
    const { error } = await db.rpc('admin_copy_project', {
      ...actorArgs(),
      p_project_id: project.id,
      p_new_name: name.trim(),
      p_target_org_id: orgId === NONE || orgId === project.organization_id ? null : orgId,
      p_new_owner_id: ownerId === NONE || ownerId === project.modeler_id ? null : ownerId,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Project copied as "${name.trim()}"`);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy “{project.name}”</DialogTitle>
          <DialogDescription>
            Copies the project and its model data (item master, logistics, BOM, network, policies).
            Simulation runs and version history are not copied.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">New name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Organization</Label>
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Keep current" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Keep current ({project.organization || '—'})</SelectItem>
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Keep current" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  Keep current ({project.owner_name || project.owner_email || '—'})
                </SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {userLabel(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Copy project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  project,
  actorArgs,
  onClose,
  onDone,
}: {
  project: ProjectRow;
  actorArgs: ActorArgs;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.error('Name is required');
    setSaving(true);
    const { error } = await db.rpc('admin_rename_project', {
      ...actorArgs(),
      p_project_id: project.id,
      p_name: name.trim(),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Renamed to "${name.trim()}"`);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename “{project.name}”</DialogTitle>
        </DialogHeader>
        <div>
          <Label className="text-xs">New name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetaDialog({
  project,
  actorArgs,
  onClose,
  onDone,
}: {
  project: ProjectRow;
  actorArgs: ActorArgs;
  onClose: () => void;
  onDone: () => void;
}) {
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
    const { error } = await db.rpc('admin_update_project_meta', {
      ...actorArgs(),
      p_project_id: project.id,
      p_plant: plant.trim() || null,
      p_model: model,
      p_bom_level: bomLevel,
      p_data_type: dataType,
      p_simulation_start: simStart || null,
      p_simulation_end: simEnd || null,
      p_completed: completed,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Metadata updated for "${project.name}"`);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit metadata — “{project.name}”</DialogTitle>
          <DialogDescription>Model settings of the project itself.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Plant</Label>
            <Input value={plant} onChange={(e) => setPlant(e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Supply chain model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Make-To-Order">Make-To-Order</SelectItem>
                  <SelectItem value="Make-To-Stock">Make-To-Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">BOM level</Label>
              <Select value={bomLevel} onValueChange={setBomLevel}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single level</SelectItem>
                  <SelectItem value="multi_level">Multi level</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Data type</Label>
              <Select value={dataType} onValueChange={setDataType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="curated">Curated</SelectItem>
                  <SelectItem value="uncurated">Uncurated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch checked={completed} onCheckedChange={setCompleted} id="proj-completed" />
              <Label htmlFor="proj-completed" className="text-xs">
                Completed
              </Label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Simulation start</Label>
              <Input
                type="date"
                value={simStart}
                onChange={(e) => setSimStart(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Simulation end</Label>
              <Input
                type="date"
                value={simEnd}
                onChange={(e) => setSimEnd(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  project,
  orgs,
  users,
  actorArgs,
  onClose,
  onDone,
}: {
  project: ProjectRow;
  orgs: OrgOption[];
  users: UserOption[];
  actorArgs: ActorArgs;
  onClose: () => void;
  onDone: () => void;
}) {
  const [orgId, setOrgId] = useState<string>('');
  const [ownerId, setOwnerId] = useState<string>(NONE);
  const [saving, setSaving] = useState(false);

  // Suggest users of the target organization first so ownership can move with
  // the project; all users remain selectable.
  const sortedUsers = useMemo(() => {
    if (!orgId) return users;
    return [...users].sort(
      (a, b) => Number(b.organization_id === orgId) - Number(a.organization_id === orgId)
    );
  }, [users, orgId]);

  const save = async () => {
    if (!orgId) return toast.error('Pick a target organization');
    setSaving(true);
    const { error } = await db.rpc('admin_transfer_project', {
      ...actorArgs(),
      p_project_id: project.id,
      p_org_id: orgId,
      p_new_owner_id: ownerId === NONE ? null : ownerId,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    const orgName = orgs.find((o) => o.id === orgId)?.name ?? 'organization';
    toast.success(`"${project.name}" transferred to ${orgName}`);
    onClose();
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer “{project.name}”</DialogTitle>
          <DialogDescription>
            Moves the project (and all its data) from{' '}
            <span className="font-medium">{project.organization || 'no organization'}</span> to
            another organization. Optionally hand ownership to a user there.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Target organization</Label>
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select organization…" />
              </SelectTrigger>
              <SelectContent>
                {orgs
                  .filter((o) => o.id !== project.organization_id)
                  .map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">New owner (optional)</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  Keep current owner ({project.owner_name || project.owner_email || '—'})
                </SelectItem>
                {sortedUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {userLabel(u)}
                    {orgId && u.organization_id === orgId ? ' · target org' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !orgId}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Transfer project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
