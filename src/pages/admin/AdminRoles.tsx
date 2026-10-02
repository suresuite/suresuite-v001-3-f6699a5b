// Role Defaults (/admin/roles) — SuReSuite "Ledger" redesign.
// Data flow: get_role_access (read), admin_set_capability (write),
// admin_preview_role_capability (D276 — what a switch on a project right would change,
// asked BEFORE it is flipped). Switch matrices use the black-pill Toggle; super_admin +
// /profile stay forced-on and locked.
//
// D276, D279 — the four project rights (Run Simulations, Edit Input Data, Edit Policies,
// Export) are decided by one rule, `project_right_decide`: where a person holds a role on
// the project, the PROJECT role decides; the account role decides only for people with no
// role there. This page shows that rule's own output — the effective matrix, the overrides
// that beat it and the right each agent approval needs — and never re-computes it in the
// browser.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SURFACE, TH, TD, ROW_HOVER, Toggle, MonoChip, KX } from '@/components/admin/adminUi';
import { MobileSheet } from '@/components/shared/MobileSheet';
import { ConfirmSheet } from '@/components/shared/confirm/ConfirmSheet';
import type { ConfirmBullet } from '@/components/shared/confirm/confirmBullets';
import { M, MobileGroup, MobileNote, MobilePanel, MobileRow, MobileToggle } from '@/components/mobile';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { FROZEN_CELL, FROZEN_CELL_ON_TINT } from '@/components/shared';
import { RIGHT_DECIDER_LABELS, type RightDecider } from '@/lib/auth/projectRights';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface Cap { key: string; kind: 'page' | 'feature'; label: string; description?: string | null; sort_order: number; }
type RoleMap = Record<string, Record<string, boolean>>;
interface Decision { allowed: boolean; decided_by: RightDecider }
/** account role → project role ('none' = no project role) → key → the rule's answer. */
type Effective = Record<string, Record<string, Record<string, Decision>>>;
interface OrgOverride { org_id: string; org_name: string | null; capability_key: string; allowed: boolean }
interface PersonOverride { user_id: string; name: string | null; capability_key: string; allowed: boolean }
interface Access {
  capabilities: Cap[];
  roles: RoleMap;
  project_scoped?: string[];
  project_roles?: RoleMap;
  effective?: Effective;
  holdings?: Record<string, Record<string, number>>;
  org_overrides?: OrgOverride[];
  person_overrides?: PersonOverride[];
  agent_rights?: Record<string, string | null>;
}
interface PreviewChange {
  user_id: string; name: string | null; project_id: string; project_name: string | null;
  project_role: string; before: boolean; after: boolean;
}
interface Pending { role: string; cap: Cap; allowed: boolean; changes: PreviewChange[] | null; error: string | null }

const db = supabase as any;
const ROLE_ORDER = ['user', 'modeler', 'admin', 'super_admin'] as const;
const PROJECT_ROLE_ORDER = ['viewer', 'analyst', 'editor', 'owner'] as const;
const EFFECTIVE_COLUMNS = ['none', ...PROJECT_ROLE_ORDER] as const;
const ALWAYS_ON = new Set(['/profile']);

const roleName = (r: string) => r.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const projectRoleName = (r: string) => (r === 'none' ? 'No project role' : roleName(r));

/** The rule, in the order `project_right_decide` applies it. Wording only — the answers
 *  on this page come from the function. */
const RULE_STEPS: { decider: RightDecider; text: string }[] = [
  { decider: 'super_admin', text: 'A super admin holds every project right.' },
  { decider: 'person_override', text: 'A person override set on /admin/users decides for that person, on every project.' },
  { decider: 'account_role', text: 'No role on the project: the account role (and its organization’s settings) decides.' },
  { decider: 'project_role', text: 'A role on the project decides: the right is held exactly when the project role includes it. The account role does not limit it.' },
  { decider: 'upload_gate', text: 'Edit Input Data also needs the upload gate: the project’s owner, an Editor or Owner on the project, or an app admin.' },
];

export default function AdminRoles({ isCollapsed, setIsCollapsed }: Props) {
  const { user: actor } = useAuth();
  const isMobile = useIsMobile();
  const [openCapKey, setOpenCapKey] = useState<string | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [roles, setRoles] = useState<RoleMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!actor?.id) return;
    setLoading(true); setError(null);
    const { data, error: err } = await db.rpc('get_role_access', { p_actor_id: actor.id, p_actor_email: actor.email });
    if (err) { setError(err.message); setLoading(false); return; }
    setAccess((data ?? { capabilities: [], roles: {} }) as Access);
    setRoles(((data?.roles ?? {}) as RoleMap));
    setLoading(false);
  }, [actor?.id, actor?.email]);
  useEffect(() => { load(); }, [load]);

  const caps = useMemo(() => access?.capabilities ?? [], [access]);
  const pages = useMemo(() => caps.filter((c) => c.kind === 'page'), [caps]);
  const features = useMemo(() => caps.filter((c) => c.kind === 'feature'), [caps]);
  const scoped = useMemo(() => new Set(access?.project_scoped ?? []), [access]);
  const scopedCaps = useMemo(() => features.filter((c) => scoped.has(c.key)), [features, scoped]);
  const labelOf = useCallback((key: string) => caps.find((c) => c.key === key)?.label ?? key, [caps]);
  /** The D276 read is present (the migration has deployed). */
  const hasRule = !!access?.effective && scoped.size > 0;

  const write = async (role: string, cap: Cap, allowed: boolean) => {
    if (!actor?.id) return false;
    setRoles((prev) => ({ ...prev, [role]: { ...(prev[role] ?? {}), [cap.key]: allowed } }));
    const { error: err } = await db.rpc('admin_set_capability', { p_actor_id: actor.id, p_actor_email: actor.email, p_scope: 'role', p_scope_id: role, p_capability_key: cap.key, p_allowed: allowed });
    if (err) { toast.error(err.message); load(); return false; }
    toast.success(`${role} · ${cap.label}: ${allowed ? 'allowed' : 'denied'}`);
    return true;
  };

  // A project right is never flipped blind: the preview names who it would move first.
  const setCell = async (role: string, cap: Cap, allowed: boolean) => {
    if (!actor?.id) return;
    if (!scoped.has(cap.key)) { await write(role, cap, allowed); return; }
    setPending({ role, cap, allowed, changes: null, error: null });
    const { data, error: err } = await db.rpc('admin_preview_role_capability', {
      p_actor_id: actor.id, p_actor_email: actor.email, p_role: role, p_capability_key: cap.key, p_allowed: allowed,
    });
    setPending((p) => (p && p.role === role && p.cap.key === cap.key
      ? { ...p, changes: err ? [] : ((data?.changes ?? []) as PreviewChange[]), error: err ? err.message : null }
      : p));
  };

  const confirmPending = async () => {
    if (!pending) return;
    setSaving(true);
    const ok = await write(pending.role, pending.cap, pending.allowed);
    setSaving(false);
    if (ok) { setPending(null); load(); }
  };

  const allowedCount = (cap: Cap) =>
    ROLE_ORDER.filter((role) => role === 'super_admin' || ALWAYS_ON.has(cap.key) || !!roles[role]?.[cap.key])
      .length;

  const openCap = caps.find((c) => c.key === openCapKey) ?? null;

  const overrides = [
    ...(access?.org_overrides ?? []).map((o) => ({ kind: 'Organization' as const, id: o.org_id, name: o.org_name ?? o.org_id, key: o.capability_key, allowed: o.allowed })),
    ...(access?.person_overrides ?? []).map((o) => ({ kind: 'Person' as const, id: o.user_id, name: o.name ?? o.user_id, key: o.capability_key, allowed: o.allowed })),
  ];

  const agentRows = Object.entries(access?.agent_rights ?? {}).sort(([a], [b]) => a.localeCompare(b));

  // ── confirm copy for a project-right switch ────────────────────────────────
  const pendingBullets: ConfirmBullet[] = !pending ? [] : pending.changes == null ? [
    { tone: 'neutral', text: 'Checking who this would change…' },
  ] : pending.changes.length === 0 ? [
    { tone: 'neutral', text: `No project member changes: a role on a project decides ${pending.cap.label} there on its own. This switch applies where a ${roleName(pending.role)} account holds no project role.` },
  ] : [
    {
      tone: 'amber',
      text: `${pending.changes.length} project membership${pending.changes.length === 1 ? '' : 's'} would ${pending.allowed ? 'gain' : 'lose'} ${pending.cap.label}.`,
    },
    ...pending.changes.slice(0, 8).map((c) => ({
      tone: (pending.allowed ? 'neutral' : 'red') as ConfirmBullet['tone'],
      text: `${c.name ?? c.user_id} · ${c.project_name ?? c.project_id} (${roleName(c.project_role)})`,
    })),
    ...(pending.changes.length > 8 ? [{ tone: 'neutral' as const, text: `…and ${pending.changes.length - 8} more.` }] : []),
  ];

  // ── mobile ────────────────────────────────────────────────────────────────
  const renderMobileSection = (title: string, rows: Cap[]) => (
    <MobileGroup label={title} key={title}>
      <MobilePanel label={title} counter={`${rows.length}`}>
        {rows.map((cap) => {
          const locked = ALWAYS_ON.has(cap.key);
          const on = allowedCount(cap);
          return (
            <MobileRow
              key={cap.key}
              dot={on === ROLE_ORDER.length ? M.process : on === 1 ? M.idle : undefined}
              label={cap.label}
              sub={locked ? 'always on · ' + cap.key : scoped.has(cap.key) ? 'only without a project role · ' + cap.key : cap.key}
              value={`${on}/${ROLE_ORDER.length}`}
              onClick={() => setOpenCapKey(cap.key)}
            />
          );
        })}
      </MobilePanel>
    </MobileGroup>
  );

  // ── desktop sections ───────────────────────────────────────────────────────
  const renderSection = (title: string, rows: Cap[]) => (
    <div>
      <h2 className="mb-2 text-[13px] font-semibold">{title}</h2>
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse">
          <thead><tr>
            <th className={`${TH} ${FROZEN_CELL_ON_TINT} w-[46%]`}>Capability</th>
            {ROLE_ORDER.map((r) => <th key={r} className={`${TH} text-center`}>{r.replace('_', ' ')}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((cap) => {
              const locked = ALWAYS_ON.has(cap.key);
              const isScoped = scoped.has(cap.key);
              return (
                <tr key={cap.key} className={ROW_HOVER}>
                  <td className={`${TD} ${FROZEN_CELL}`}>
                    <div className="flex items-center gap-1.5 text-[13px] font-medium">
                      {cap.label}{locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                      {isScoped && <MonoChip>no project role</MonoChip>}
                    </div>
                    {isScoped && (
                      <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                        Applies only where a person holds no role on the project. A project role decides on its own.
                      </div>
                    )}
                  </td>
                  {ROLE_ORDER.map((role) => {
                    const forcedOn = role === 'super_admin' || locked;
                    const checked = forcedOn ? true : !!roles[role]?.[cap.key];
                    return (
                      <td key={role} className={`${TD} text-center`}>
                        <div className="flex justify-center"><Toggle checked={checked} disabled={forcedOn} onCheckedChange={(v) => setCell(role, cap, v)} /></div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {/* Spec 2.7: this matrix is the one admin table that keeps its columns on
            a phone, so it needs the scroll affordance. Desktop never sees it. */}
        <p className="border-t border-[--hair-divider] px-4 py-2 text-[11.5px] text-muted-foreground md:hidden">
          swipe the table sideways for the remaining roles
        </p>
      </div>
    </div>
  );

  const ruleCard = (
    <div className={`${SURFACE} p-4`}>
      <div className={KX}>How a project right is decided</div>
      <p className="mt-1 text-[13px]">
        {scopedCaps.map((c) => c.label).join(', ')} are decided per project. Where a person holds a role on
        the project, <strong>the project role decides</strong>: an Owner or Editor holds all four whatever their
        account role. The account role decides only for people with no role on the project.
      </p>
      <ol className="mt-3 space-y-1.5 text-[12.5px]">
        {RULE_STEPS.map((s, i) => (
          <li key={s.decider} className="flex gap-2">
            <span className="w-4 text-right font-mono text-[11px] text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1">{s.text}</span>
            <MonoChip tone="solid">{RIGHT_DECIDER_LABELS[s.decider]}</MonoChip>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[11.5px] text-muted-foreground">
        Every table below is computed by the database from this rule (<code>project_right_decide</code>),
        the same function every gate, /profile and the AI agents read. Agent approvals need the same
        project right as the edit made by hand.
      </p>
    </div>
  );

  const projectRolesSection = (
    <div>
      <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
        Project roles <Lock className="h-3 w-3 text-muted-foreground" />
      </h2>
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse">
            <thead><tr>
              <th className={`${TH} ${FROZEN_CELL_ON_TINT} w-[46%]`}>What the project role grants</th>
              {PROJECT_ROLE_ORDER.map((r) => <th key={r} className={`${TH} text-center`}>{r}</th>)}
            </tr></thead>
            <tbody>
              {scopedCaps.map((cap) => (
                <tr key={cap.key} className={ROW_HOVER}>
                  <td className={`${TD} ${FROZEN_CELL} text-[13px] font-medium`}>{cap.label}</td>
                  {/* Read-only, so words rather than a locked switch that reads as "off". */}
                  {PROJECT_ROLE_ORDER.map((pr) => {
                    const on = !!access?.project_roles?.[pr]?.[cap.key];
                    return (
                      <td key={pr} className={`${TD} text-center text-[12.5px] ${on ? 'font-medium' : 'text-muted-foreground'}`}>
                        {on ? 'Grants' : 'No'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[--hair-divider] px-4 py-2 text-[11.5px] text-muted-foreground">
          Changed by a migration, not here, so the manual’s role table and /profile’s legend cannot drift from it.
          Members are assigned on /admin/projects.
        </p>
      </div>
    </div>
  );

  const effectiveSection = (
    <div>
      <h2 className="mb-1 text-[13px] font-semibold">Effective rights on a project</h2>
      <p className="mb-2 text-[12px] text-muted-foreground">
        Account role × project role, as the rule answers today from the two matrices above. Struck through: not held.
        Counts are active memberships in that cell now.
      </p>
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead><tr>
              <th className={`${TH} ${FROZEN_CELL_ON_TINT}`}>Account role</th>
              {EFFECTIVE_COLUMNS.map((pr) => <th key={pr} className={TH}>{projectRoleName(pr)}</th>)}
            </tr></thead>
            <tbody>
              {ROLE_ORDER.map((ar) => (
                <tr key={ar} className={ROW_HOVER}>
                  <td className={`${TD} ${FROZEN_CELL} text-[13px] font-medium`}>{roleName(ar)}</td>
                  {EFFECTIVE_COLUMNS.map((pr) => {
                    const cell = access?.effective?.[ar]?.[pr] ?? {};
                    const n = pr === 'none' ? null : access?.holdings?.[ar]?.[pr] ?? 0;
                    return (
                      <td key={pr} className={`${TD} align-top`}>
                        <ul className="space-y-0.5 text-[12px]">
                          {scopedCaps.map((c) => {
                            const d = cell[c.key];
                            const tone = d?.allowed ? 'text-foreground' : 'text-muted-foreground line-through';
                            return (
                              <li key={c.key} className={tone} title={d ? RIGHT_DECIDER_LABELS[d.decided_by] : undefined}>
                                {c.label}{c.key === 'data_edit_inputs' && d?.allowed && pr === 'none' && ar !== 'super_admin' && ar !== 'admin' ? ' *' : ''}
                              </li>
                            );
                          })}
                        </ul>
                        {n != null && <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">{n} now</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[--hair-divider] px-4 py-2 text-[11.5px] text-muted-foreground">
          * With no project role, Edit Input Data holds only for the project’s owner, because uploads accept the owner,
          an Editor or Owner on the project, or an app admin.
          Organization and person overrides, listed below, change these answers for the people they name.
        </p>
      </div>
    </div>
  );

  const overridesSection = (
    <div>
      <h2 className="mb-2 text-[13px] font-semibold">Overrides on project rights ({overrides.length})</h2>
      <div className={`${SURFACE} overflow-hidden`}>
        {overrides.length === 0 ? (
          <p className="px-4 py-3 text-[12.5px] text-muted-foreground">None. The matrices above are the whole story.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse">
              <thead><tr>
                <th className={`${TH} ${FROZEN_CELL_ON_TINT}`}>Who</th>
                <th className={TH}>Right</th>
                <th className={TH}>Set to</th>
                <th className={TH}>Effect</th>
              </tr></thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={`${o.kind}:${o.id}:${o.key}`} className={ROW_HOVER}>
                    <td className={`${TD} ${FROZEN_CELL} text-[13px]`}>
                      <Link
                        to={o.kind === 'Person' ? `/admin/users/${o.id}` : '/admin/organizations'}
                        className="font-medium hover:underline"
                      >{o.name}</Link>
                      <span className="ml-1.5 text-[11.5px] text-muted-foreground">{o.kind}</span>
                    </td>
                    <td className={`${TD} text-[12.5px]`}>{labelOf(o.key)}</td>
                    <td className={`${TD} text-[12.5px]`}>{o.allowed ? 'Allowed' : 'Denied'}</td>
                    <td className={`${TD} text-[11.5px] text-muted-foreground`}>
                      {o.kind === 'Person'
                        ? 'Decides for this person on every project, above the project role.'
                        : 'Replaces the account role on this organization’s projects, for people with no role on the project.'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const agentSection = (
    <div>
      <h2 className="mb-2 text-[13px] font-semibold">AI agent approvals</h2>
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse">
            <thead><tr>
              <th className={`${TH} ${FROZEN_CELL_ON_TINT}`}>Proposal</th>
              <th className={TH}>Approver also needs, on that project</th>
            </tr></thead>
            <tbody>
              {agentRows.map(([artifact, key]) => (
                <tr key={artifact} className={ROW_HOVER}>
                  <td className={`${TD} ${FROZEN_CELL}`}><MonoChip>{artifact}</MonoChip></td>
                  <td className={`${TD} text-[12.5px]`}>{key ? labelOf(key) : <span className="text-muted-foreground">Nothing: it changes no project data</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[--hair-divider] px-4 py-2 text-[11.5px] text-muted-foreground">
          On top of Agent Apply (or Agent Proposals and Decision Reports for a report). An agent never approves
          more than its approver could do by hand.
        </p>
      </div>
    </div>
  );

  const confirm = (
    <ConfirmSheet
      open={pending != null}
      title={pending ? `${pending.allowed ? 'Allow' : 'Deny'} ${pending.cap.label} for ${roleName(pending.role)} accounts?` : ''}
      bullets={pendingBullets}
      notes={pending ? [
        'Applies only to people with no role on a project. Owners and Editors keep the right their project role gives them.',
      ] : []}
      actionLabel={pending?.allowed ? 'Allow' : 'Deny'}
      tone={pending?.allowed ? 'neutral' : 'destructive'}
      busy={saving}
      busyLabel="Saving…"
      error={pending?.error ?? null}
      disabledReason={pending?.changes == null ? 'Checking who this would change…' : null}
      onConfirm={confirmPending}
      onCancel={() => setPending(null)}
    />
  );

  return (
    <AdminLayout
      isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="Role defaults"
      onRefresh={load} refreshLoading={loading}
    >
      {loading ? (
        <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="rounded-sm border border-[#bf2330]/40 bg-[#bf2330]/10 p-4 text-sm text-[#bf2330]">{error}</div>
      ) : isMobile ? (
        <div className="flex flex-col gap-[var(--m-gap)]">
          {/* §13.6 — the screen's one caveat, and it is a caveat rather than a
              blocking consequence: it explains two locks, it does not stop
              anyone. */}
          <MobileNote tone="caveat" mark="·">
            Super admins and My Profile are always on. Their toggles are shown, locked and
            explained rather than hidden.
            {hasRule && ` ${scopedCaps.map((c) => c.label).join(', ')} follow the project role wherever a person holds one; these switches apply only without one.`}
          </MobileNote>
          {renderMobileSection('Pages', pages)}
          {renderMobileSection('Features', features)}
          {hasRule && (
            <MobileGroup label="Project roles">
              <MobilePanel label="Project roles grant" counter={`${PROJECT_ROLE_ORDER.length}`}>
                {PROJECT_ROLE_ORDER.map((pr) => (
                  <MobileRow
                    key={pr}
                    chevron={false}
                    label={roleName(pr)}
                    sub={scopedCaps.filter((c) => access?.project_roles?.[pr]?.[c.key]).map((c) => c.label).join(', ') || 'nothing — view only'}
                  />
                ))}
              </MobilePanel>
            </MobileGroup>
          )}
          <MobileSheet
            open={openCap != null}
            title={openCap?.label ?? ''}
            sub={openCap ? `${openCap.key} — which roles get this by default.` : undefined}
            onClose={() => setOpenCapKey(null)}
          >
            {openCap && (
              <div className="flex flex-col">
                {ROLE_ORDER.map((role) => {
                  const forcedOn = role === 'super_admin' || ALWAYS_ON.has(openCap.key);
                  const checked = forcedOn ? true : !!roles[role]?.[openCap.key];
                  return (
                    <MobileRow
                      key={role}
                      chevron={false}
                      label={role.replace('_', ' ')}
                      sub={forcedOn ? 'always on — cannot be changed' : undefined}
                      trailing={
                        <MobileToggle
                          checked={checked}
                          disabled={forcedOn}
                          label={`${role} · ${openCap.label}`}
                          onChange={(v) => setCell(role, openCap, v)}
                        />
                      }
                    />
                  );
                })}
              </div>
            )}
          </MobileSheet>
          {confirm}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="inline-flex items-center gap-1.5 rounded-sm border border-[--zinc-border] px-2.5 py-1 text-[11.5px] text-muted-foreground">
            <Lock className="h-3 w-3" /> Super admins & My Profile are always on
          </div>
          {hasRule ? ruleCard : (
            <div className="rounded-sm border border-[#e0930b]/40 bg-[#e0930b]/10 p-3 text-[12.5px]">
              The project-rights rule could not be read from the database yet, so this page shows the account
              defaults only. It appears once migration <code>20261002000004</code> is deployed.
            </div>
          )}
          {renderSection('Pages', pages)}
          {renderSection('Features', features)}
          {hasRule && projectRolesSection}
          {hasRule && effectiveSection}
          {hasRule && overridesSection}
          {hasRule && agentSection}
          {confirm}
        </div>
      )}
    </AdminLayout>
  );
}
