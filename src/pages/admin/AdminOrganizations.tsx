import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Ban, Loader2, MoreHorizontal, Pencil, Plus, ShieldCheck, Undo2 } from 'lucide-react';
import { TableEmpty, TableLoading, TableShell, TH_DENSE } from '@/components/shared';
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
  const { user: actor } = useAuth();
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessOrg, setAccessOrg] = useState<OrgRow | null>(null);
  const [renameOrg, setRenameOrg] = useState<OrgRow | null>(null);
  const actorArgs = () => ({ p_actor_id: actor?.id, p_actor_email: actor?.email });

  const load = async () => {
    setLoading(true);
    // Read through a super-admin RPC: direct table reads run as anon without
    // the transaction-local user context, so RLS filters everything out and
    // the page looks empty (same reason the admin mutations are RPCs).
    const { data, error } = await db.rpc('admin_list_organizations', actorArgs());
    if (error) toast.error(error.message);
    setRows(
      ((data ?? []) as any[]).map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        status: o.status,
        created_at: o.created_at,
        members: Number(o.members || 0),
        projects: Number(o.projects || 0),
        cost_mtd: Number(o.cost_mtd || 0),
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const toggleStatus = async (row: OrgRow) => {
    const next = row.status === 'active' ? 'suspended' : 'active';
    const { error } = await db.rpc('admin_set_org_status', {
      ...actorArgs(),
      p_org_id: row.id,
      p_status: next,
    });
    if (error) return toast.error(error.message);
    toast.success(next === 'active' ? 'Reactivated' : 'Suspended');
    load();
  };

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="Organizations"
      description="Every organization on the platform."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            Refresh
          </Button>
          <AddOrgDialog actorArgs={actorArgs} onCreated={load} />
        </div>
      }
    >
      <TableShell>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TH_DENSE}>Name</TableHead>
              <TableHead className={TH_DENSE}>Slug</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Members</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Projects</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Cost (MTD)</TableHead>
              <TableHead className={TH_DENSE}>Status</TableHead>
              <TableHead className={TH_DENSE}>Created</TableHead>
              <TableHead className={`${TH_DENSE} w-[120px] text-right`}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoading colSpan={8} />
            ) : rows.length === 0 ? (
              <TableEmpty colSpan={8} message="No organizations yet." />
            ) : (
              rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell className="text-muted-foreground">{o.slug}</TableCell>
                  <TableCell className="text-right">{o.members}</TableCell>
                  <TableCell className="text-right">{o.projects}</TableCell>
                  <TableCell className="text-right tabular-nums">${o.cost_mtd.toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === 'active' ? 'secondary' : 'destructive'}>
                      {o.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setRenameOrg(o)}>
                          <Pencil className="mr-2 h-4 w-4" /> Rename…
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setAccessOrg(o)}>
                          <ShieldCheck className="mr-2 h-4 w-4" /> Access defaults…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => toggleStatus(o)}>
                          {o.status === 'active' ? (
                            <>
                              <Ban className="mr-2 h-4 w-4" /> Suspend
                            </>
                          ) : (
                            <>
                              <Undo2 className="mr-2 h-4 w-4" /> Reactivate
                            </>
                          )}
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

      {accessOrg && (
        <OrgAccessDrawer
          orgId={accessOrg.id}
          orgName={accessOrg.name}
          open={!!accessOrg}
          onClose={() => setAccessOrg(null)}
        />
      )}

      {renameOrg && (
        <RenameOrgDialog
          org={renameOrg}
          actorArgs={actorArgs}
          onClose={() => setRenameOrg(null)}
          onDone={load}
        />
      )}
    </AdminLayout>
  );
}

function RenameOrgDialog({
  org,
  actorArgs,
  onClose,
  onDone,
}: {
  org: OrgRow;
  actorArgs: () => { p_actor_id?: string; p_actor_email?: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(org.name);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.error('Name is required');
    setSaving(true);
    const { error } = await db.rpc('admin_update_organization', {
      ...actorArgs(),
      p_org_id: org.id,
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
          <DialogTitle>Rename “{org.name}”</DialogTitle>
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

function AddOrgDialog({
  actorArgs,
  onCreated,
}: {
  actorArgs: () => { p_actor_id?: string; p_actor_email?: string };
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const create = async () => {
    if (!name.trim()) return toast.error('Name is required');
    setSaving(true);
    const { error } = await db.rpc('admin_create_organization', {
      ...actorArgs(),
      p_name: name.trim(),
      p_slug: slug.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Organization "${name.trim()}" created`);
    setName('');
    setSlug('');
    setOpen(false);
    onCreated();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setName('');
          setSlug('');
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add organization
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add organization</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              placeholder="Acme Robotics"
            />
          </div>
          <div>
            <Label className="text-xs">Slug (optional)</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="mt-1"
              placeholder="auto-generated from name"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={create} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create organization
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
