// Organizations (/admin/organizations) — SuReSuite "Ledger" redesign.
// Data flow, RPCs (admin_list_organizations, admin_set_org_status,
// admin_update_organization, admin_create_organization) and the OrgAccessDrawer
// hook-in are unchanged. Table reskinned with mono slug, status dot, and a
// reskinned row action menu; Add-organization lives in the header.
//
// The plan (PLAN.md §4 D207): each organization is valid for 1 week, 1 month, 1 quarter
// or 1 year (or has no expiry), and may have 1, 2, 3 or 5 users and projects (or
// unlimited). Choosing a period — even the same one — renews it from now. The database
// enforces all three: members cannot sign in once the period ends (super admins
// excepted), and a user or project past a limit is refused by a trigger. The Members
// and Projects figures are the counts the limits are measured by.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { AdminMobileList, AdminMobileRow, SURFACE, TH, TD, ROW_HOVER, StatusDot, EmptyRow, LoadingRow, useTableSort, useColumnFilters } from '@/components/admin/adminUi';
import { M } from '@/components/mobile';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Ban, Loader2, MoreHorizontal, Pencil, Plus, ShieldCheck, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { OrgAccessDrawer } from '@/components/admin/OrgAccessDrawer';
import { DIALOG_AS_SHEET, HDR_PRIMARY_BUTTON } from '@/components/shared';
import { cn } from '@/lib/utils';
import {
  ACCESS_PERIODS, COUNT_LIMITS, NONE, NO_EXPIRY_LABEL, UNLIMITED_LABEL,
  formatPlanDate, limitFromSelect, limitLabel, limitToSelect, periodFromSelect, periodLabel, usage,
} from '@/lib/auth/organizationPlan';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface OrgRow {
  id: string; name: string; slug: string; status: string; created_at: string; members: number; projects: number; cost_mtd: number;
  access_period: string | null; access_valid_until: string | null; access_expired: boolean;
  project_limit: number | null; user_limit: number | null;
}

const untilLabel = (o: OrgRow) => (o.access_valid_until ? `${o.access_expired ? 'ended' : 'until'} ${formatPlanDate(o.access_valid_until)}` : '');
const planLabel = (o: OrgRow) => (o.access_period ? `${periodLabel(o.access_period)} · ${untilLabel(o)}` : NO_EXPIRY_LABEL);
/** Suspension is the administrator's switch; an ended period is the clock's. */
const statusLabel = (o: OrgRow) => (o.status !== 'active' ? o.status : o.access_expired ? 'expired' : 'active');
/** Past its limit after the limit was lowered: nothing is removed, nothing can be added. */
const overLimit = (used: number, limit: number | null) => limit != null && used > limit;

/** One Select for a count limit — 1, 2, 3, 5 or unlimited. */
function LimitSelect({ value, noun, onChange, className }: {
  value: number | null; noun: 'project' | 'user'; onChange: (v: string) => void; className?: string;
}) {
  return (
    <Select value={limitToSelect(value)} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'h-7 w-[108px] rounded-sm text-[12px]'}><SelectValue /></SelectTrigger>
      <SelectContent>
        {COUNT_LIMITS.map((l) => <SelectItem key={l} value={String(l)} className="min-h-11 md:min-h-0">{limitLabel(l, noun)}</SelectItem>)}
        <SelectItem value={NONE} className="min-h-11 md:min-h-0">{UNLIMITED_LABEL}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function PeriodSelect({ value, onChange, className }: { value: string | null; onChange: (v: string) => void; className?: string }) {
  return (
    <Select value={value ?? NONE} onValueChange={onChange}>
      <SelectTrigger className={className ?? 'h-7 w-[108px] rounded-sm text-[12px]'}><SelectValue /></SelectTrigger>
      <SelectContent>
        {ACCESS_PERIODS.map((p) => <SelectItem key={p.value} value={p.value} className="min-h-11 md:min-h-0">{p.label}</SelectItem>)}
        <SelectItem value={NONE} className="min-h-11 md:min-h-0">{NO_EXPIRY_LABEL}</SelectItem>
      </SelectContent>
    </Select>
  );
}

const db = supabase as any;

export default function AdminOrganizations({ isCollapsed, setIsCollapsed }: Props) {
  const isMobile = useIsMobile();
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
    setRows(((data ?? []) as any[]).map((o) => ({
      id: o.id, name: o.name, slug: o.slug, status: o.status, created_at: o.created_at,
      members: Number(o.members || 0), projects: Number(o.projects || 0), cost_mtd: Number(o.cost_mtd || 0),
      access_period: o.access_period ?? null, access_valid_until: o.access_valid_until ?? null,
      access_expired: !!o.access_expired, project_limit: o.project_limit ?? null, user_limit: o.user_limit ?? null,
    })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleStatus = async (row: OrgRow) => {
    const next = row.status === 'active' ? 'suspended' : 'active';
    const { error } = await db.rpc('admin_set_org_status', { ...actorArgs(), p_org_id: row.id, p_status: next });
    if (error) return toast.error(error.message);
    toast.success(next === 'active' ? 'Reactivated' : 'Suspended'); load();
  };

  const changePeriod = async (row: OrgRow, value: string) => {
    const period = periodFromSelect(value);
    const { data: until, error } = await db.rpc('admin_set_org_access_period', { ...actorArgs(), p_org_id: row.id, p_period: period });
    if (error) return toast.error(error.message);
    toast.success(period
      ? `${row.name}: valid for ${periodLabel(period)}, until ${new Date(until).toLocaleString()}`
      : `${row.name}: no expiry`);
    load();
  };

  const changeLimits = async (row: OrgRow, next: { project_limit?: number | null; user_limit?: number | null }) => {
    const project_limit = next.project_limit !== undefined ? next.project_limit : row.project_limit;
    const user_limit = next.user_limit !== undefined ? next.user_limit : row.user_limit;
    const { error } = await db.rpc('admin_set_org_limits', {
      ...actorArgs(), p_org_id: row.id, p_project_limit: project_limit, p_user_limit: user_limit,
    });
    if (error) return toast.error(error.message);
    const over = [
      project_limit != null && row.projects >= project_limit && next.project_limit !== undefined
        ? `already holds ${row.projects} project(s), so no new project until one is deleted` : null,
      user_limit != null && row.members >= user_limit && next.user_limit !== undefined
        ? `already has ${row.members} user(s), so no new user until one is removed` : null,
    ].filter(Boolean);
    toast.success(`${row.name}: ${limitLabel(project_limit, 'project')}, ${limitLabel(user_limit, 'user')}${over.length ? ` — ${over.join('; ')}` : ''}`);
    load();
  };

  const colFilterGetters = useMemo(() => ({
    name: (o: OrgRow) => o.name, slug: (o: OrgRow) => o.slug, members: (o: OrgRow) => String(o.members),
    projects: (o: OrgRow) => String(o.projects), cost: (o: OrgRow) => String(o.cost_mtd), status: (o: OrgRow) => statusLabel(o),
    created: (o: OrgRow) => new Date(o.created_at).toLocaleDateString(), plan: (o: OrgRow) => planLabel(o),
  }), []);
  const { filtered: colFiltered, FilterTH } = useColumnFilters(rows, colFilterGetters);
  const sortGetters = useMemo(() => ({
    name: (o: OrgRow) => o.name.toLowerCase(), slug: (o: OrgRow) => o.slug.toLowerCase(), members: (o: OrgRow) => o.members,
    projects: (o: OrgRow) => o.projects, cost: (o: OrgRow) => o.cost_mtd, status: (o: OrgRow) => statusLabel(o), created: (o: OrgRow) => o.created_at,
    plan: (o: OrgRow) => (o.access_valid_until ? new Date(o.access_valid_until).getTime() : Infinity),
  }), []);
  const { sorted, SortTH } = useTableSort(colFiltered, sortGetters);

  return (
    <AdminLayout
      isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="Organizations"
      onRefresh={load} refreshLoading={loading}
      actions={<AddOrgDialog actorArgs={actorArgs} onCreated={load} />}
    >
      {isMobile ? (
        <AdminMobileList
          label="Organizations"
          counter={`${sorted.length}`}
          loading={loading}
          empty={sorted.length === 0 ? 'No organizations yet.' : undefined}
        >
          {sorted.map((o) => (
            <AdminMobileRow
              key={o.id}
              label={o.name}
              dot={o.status === 'active' && !o.access_expired ? M.process : M.blocking}
              sub={`${o.slug} · ${statusLabel(o)} · ${planLabel(o)} · users ${usage(o.members, o.user_limit)} · projects ${usage(o.projects, o.project_limit)} · created ${new Date(o.created_at).toLocaleDateString()}`}
              value={`$${o.cost_mtd.toFixed(2)}`}
              actions={[
                { label: 'Rename…', onClick: () => setRenameOrg(o) },
                { label: 'Access defaults…', onClick: () => setAccessOrg(o) },
                ...ACCESS_PERIODS.map((p) => ({
                  label: o.access_period === p.value ? `Renew ${p.label} from today` : `Valid for ${p.label}`,
                  onClick: () => changePeriod(o, p.value),
                })),
                ...(o.access_period ? [{ label: 'Remove expiry', onClick: () => changePeriod(o, NONE) }] : []),
                ...[...COUNT_LIMITS, null].filter((l) => l !== o.user_limit).map((l) => ({
                  label: `User limit: ${l ?? UNLIMITED_LABEL}`,
                  onClick: () => changeLimits(o, { user_limit: l }),
                })),
                ...[...COUNT_LIMITS, null].filter((l) => l !== o.project_limit).map((l) => ({
                  label: `Project limit: ${l ?? UNLIMITED_LABEL}`,
                  onClick: () => changeLimits(o, { project_limit: l }),
                })),
                {
                  label: o.status === 'active' ? 'Suspend' : 'Reactivate',
                  tone: o.status === 'active' ? 'danger' : 'default',
                  onClick: () => toggleStatus(o),
                },
              ]}
            />
          ))}
        </AdminMobileList>
      ) : (
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <SortTH sortKey="name">Name</SortTH><SortTH sortKey="slug">Slug</SortTH>
              <SortTH sortKey="plan">Valid for</SortTH>
              <SortTH sortKey="members">Users</SortTH><SortTH sortKey="projects">Projects</SortTH>
              <SortTH sortKey="cost" align="right">Cost MTD</SortTH><SortTH sortKey="status">Status</SortTH><SortTH sortKey="created">Created</SortTH><th className={`${TH} w-[1%]`} />
            </tr>
            <tr>
              <FilterTH filterKey="name" /><FilterTH filterKey="slug" />
              <FilterTH filterKey="plan" />
              <FilterTH filterKey="members" /><FilterTH filterKey="projects" />
              <FilterTH filterKey="cost" align="right" /><FilterTH filterKey="status" /><FilterTH filterKey="created" /><th className="border-b border-[--hair-border] bg-white" />
            </tr></thead>
            <tbody>
              {loading ? <LoadingRow colSpan={9} /> : sorted.length === 0 ? (
                <EmptyRow colSpan={9} message="No organizations yet." />
              ) : sorted.map((o) => (
                <tr key={o.id} className={ROW_HOVER}>
                  <td className={`${TD} max-w-[260px] truncate text-[13px] font-medium`}>{o.name}</td>
                  <td className={`${TD} font-mono text-[12px] text-muted-foreground`}>{o.slug}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <div className="flex items-center gap-2">
                      <PeriodSelect value={o.access_period} onChange={(v) => changePeriod(o, v)} />
                      {o.access_period && (
                        <button
                          title={`Renew ${periodLabel(o.access_period)} from today`}
                          className={cn('text-[11.5px] underline-offset-2 hover:underline', o.access_expired ? 'text-[#bf2330]' : 'text-muted-foreground')}
                          onClick={() => changePeriod(o, o.access_period!)}>
                          {untilLabel(o)}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <div className="flex items-center gap-2">
                      <span className={cn('w-8 text-right font-mono text-[12px] tabular-nums', overLimit(o.members, o.user_limit) && 'text-[#bf2330]')}
                        title="Accounts in this organization, against its user limit">{o.members}</span>
                      <LimitSelect value={o.user_limit} noun="user" onChange={(v) => changeLimits(o, { user_limit: limitFromSelect(v) })} />
                    </div>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <div className="flex items-center gap-2">
                      <span className={cn('w-8 text-right font-mono text-[12px] tabular-nums', overLimit(o.projects, o.project_limit) && 'text-[#bf2330]')}
                        title="Projects in this organization, against its project limit">{o.projects}</span>
                      <LimitSelect value={o.project_limit} noun="project" onChange={(v) => changeLimits(o, { project_limit: limitFromSelect(v) })} />
                    </div>
                  </td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>${o.cost_mtd.toFixed(2)}</td>
                  <td className={TD}><StatusDot tone={o.status === 'active' && !o.access_expired ? 'active' : 'error'} label={statusLabel(o)} /></td>
                  <td className={`${TD} text-[12px] text-muted-foreground`}>{new Date(o.created_at).toLocaleDateString()}</td>
                  <td className={`${TD} text-right`}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="min-h-11 md:min-h-0" onClick={() => setRenameOrg(o)}><Pencil className="mr-2 h-4 w-4" /> Rename…</DropdownMenuItem>
                        <DropdownMenuItem className="min-h-11 md:min-h-0" onClick={() => setAccessOrg(o)}><ShieldCheck className="mr-2 h-4 w-4" /> Access defaults…</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="min-h-11 md:min-h-0" onClick={() => toggleStatus(o)}>
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
      )}

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
      <DialogContent className={cn(DIALOG_AS_SHEET, 'md:max-w-lg md:rounded-sm')}>
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
  // D207 — asked for on every new organization. The defaults are the shortest useful
  // plan; an administrator widens it deliberately.
  const [period, setPeriod] = useState<string>('month');
  const [userLimit, setUserLimit] = useState<string>('1');
  const [projectLimit, setProjectLimit] = useState<string>('1');
  const reset = () => { setName(''); setSlug(''); setPeriod('month'); setUserLimit('1'); setProjectLimit('1'); };
  const create = async () => {
    if (!name.trim()) return toast.error('Name is required');
    setSaving(true);
    const { error } = await db.rpc('admin_create_organization', {
      ...actorArgs(), p_name: name.trim(), p_slug: slug.trim() || null,
      p_access_period: periodFromSelect(period),
      p_project_limit: limitFromSelect(projectLimit),
      p_user_limit: limitFromSelect(userLimit),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Organization "${name.trim()}" created`); reset(); setOpen(false); onCreated();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild><Button size="sm" className={cn('gap-1.5 rounded-sm', HDR_PRIMARY_BUTTON)}><Plus className="h-3.5 w-3.5" />Add organization</Button></DialogTrigger>
      <DialogContent className={cn(DIALOG_AS_SHEET, 'md:max-w-lg md:rounded-sm')}>
        <DialogHeader><DialogTitle>Add organization</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 rounded-sm" placeholder="Acme Robotics" /></div>
          <div><Label className="text-xs">Slug (optional)</Label><Input value={slug} onChange={(e) => setSlug(e.target.value)} className="mt-1 rounded-sm font-mono" placeholder="auto-generated from name" /></div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))]">
            <div className="min-w-0">
              <Label className="text-xs">Valid for</Label>
              <PeriodSelect value={period === NONE ? null : period} onChange={setPeriod} className="mt-1 rounded-sm" />
            </div>
            <div className="min-w-0">
              <Label className="text-xs">Users</Label>
              <LimitSelect value={limitFromSelect(userLimit)} noun="user" onChange={setUserLimit} className="mt-1 rounded-sm" />
            </div>
            <div className="min-w-0">
              <Label className="text-xs">Projects</Label>
              <LimitSelect value={limitFromSelect(projectLimit)} noun="project" onChange={setProjectLimit} className="mt-1 rounded-sm" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The period is counted from when the organization is created; after it ends its members cannot sign in (super admins excepted) until it is renewed.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button className="rounded-sm" onClick={create} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create organization</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
