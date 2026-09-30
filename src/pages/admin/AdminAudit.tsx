// Audit Log (/admin/audit) — SuReSuite "Ledger" redesign.
//
// §4 D185: this page used to read `audit_logs` straight through PostgREST. The
// browser calls as `anon`, the table's RLS resolves the reader through a GUC an
// anonymous request never carries, and RLS answers a refused read with ZERO ROWS —
// so the page said "No audit entries yet." over a log that was being written. It
// now reads through `admin_audit_log_read`, which names its reader like every other
// /admin RPC, over a window (24 h / 7 d / 30 d) and every plane, and returns a
// per-person and per-action summary computed over the whole window by the server.
//
// §4 D186: the log is write-once and hash-chained. `admin_audit_log_verify` walks
// the chain; the head it returns is shown so an admin can record it OUTSIDE the
// database, which is the only thing that detects a rewritten or truncated chain.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import {
  SURFACE, KX, TH, TD, ROW_HOVER, EmptyRow, LoadingRow, useTableSort, useColumnFilters,
  AdminMobileList, AdminMobileRow, Segmented, StatusDot, MonoChip,
} from '@/components/admin/adminUi';
import { MobileSheet } from '@/components/shared/MobileSheet';
import { M_CODE, MobileRow } from '@/components/mobile';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useRowBudget } from '@/hooks/useViewport';
import { cn } from '@/lib/utils';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }

type Plane = 'admin' | 'data' | 'access';
interface AuditRow {
  id: string; seq: number | null; plane: Plane;
  actor_user_id: string | null; actor_name: string | null; actor_email: string | null; actor_deleted: boolean;
  action: string; target_type: string | null; target_id: string | null; target_name: string | null;
  before: unknown; after: Record<string, unknown> | null; created_at: string; sealed: boolean;
  projects: { id: string; name: string }[] | null;
}
interface ActorSummary {
  actor_user_id: string | null; actor_name: string | null; actor_email: string | null; actor_org: string | null;
  actor_deleted: boolean; total: number; sign_ins: number; data_writes: number; rows_written: number;
  admin_actions: number; exports: number; first_at: string; last_at: string;
}
interface ActionSummary { plane: Plane; action: string; target_type: string | null; n: number; people: number; last_at: string; }
interface FailedSignIn { account_id: string; account: string; n: number; last_at: string; }
interface ReadResult {
  total: number; returned: number; rows: AuditRow[];
  by_actor: ActorSummary[]; by_action: ActionSummary[]; failed_sign_ins: FailedSignIn[];
}
interface VerifyResult {
  ok: boolean; checked: number; head_seq: number | null; head_hash: string | null; unsealed: number;
  first_break: { seq: number; id: string | null; reason: string } | null; verified_at: string;
}

// The two RPCs are newer than the generated `Database` types, so the call is typed here.
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const db = supabase as unknown as { rpc: Rpc };
const ROW_LIMIT = 1000;

const RANGES = [
  { value: '1d', label: 'Last 24 hours', ms: 24 * 3600e3 },
  { value: '7d', label: 'Last 7 days', ms: 7 * 24 * 3600e3 },
  { value: '30d', label: 'Last 30 days', ms: 30 * 24 * 3600e3 },
] as const;
const PLANES = [
  { value: 'all', label: 'All' },
  { value: 'access', label: 'Sign-ins & exports' },
  { value: 'data', label: 'Data changes' },
  { value: 'admin', label: 'Admin' },
];

const fmtTime = (iso: string) => new Date(iso).toLocaleString();
const fmtInt = (n: number) => n.toLocaleString();

/** Who a row is about, in words — never a blank for a row with no actor. */
function actorLabel(r: { actor_name: string | null; actor_user_id: string | null; actor_deleted: boolean }) {
  if (r.actor_name) return r.actor_name;
  if (r.actor_deleted) return 'deleted user';
  return r.actor_user_id ? 'unknown user' : 'no actor';
}

/** What happened, in one line a person can read. The raw action stays beside it. */
function describe(r: AuditRow): string {
  const a = r.after ?? {};
  const projects = (r.projects ?? []).map((p) => p.name).join(', ');
  if (r.plane === 'data') {
    const n = Number(a.rows_after ?? 0) || Number(a.rows_before ?? 0);
    const verb = r.action === 'insert' ? 'added' : r.action === 'update' ? 'changed' : r.action === 'delete' ? 'removed' : r.action;
    const who = a.actor_known === false ? ' (actor not recorded)' : '';
    return `${verb} ${fmtInt(n)} row${n === 1 ? '' : 's'} in ${r.target_type ?? '?'}${projects ? ` · ${projects}` : ''}${who}`;
  }
  if (r.action === 'auth.sign_in') return 'signed in';
  if (r.action === 'auth.sign_in_failed') return `wrong password for ${r.target_name ?? 'an account'}`;
  if (r.action.startsWith('export.')) {
    return `${r.action === 'export.allowed' ? 'exported' : 'export refused'}${a.export_kind ? ` · ${String(a.export_kind)}` : ''}`;
  }
  return r.target_name ? `${r.action} · ${r.target_name}` : r.action;
}

function targetLabel(r: AuditRow) {
  if (r.target_name) return r.target_name;
  return `${r.target_type ?? ''}${r.target_id ? `:${r.target_id.slice(0, 8)}` : ''}`;
}

const PLANE_TONE: Record<Plane, string> = {
  admin: 'text-[#7c3aed]',
  data: 'text-[#0e7490]',
  access: 'text-[#b45309]',
};

export default function AdminAudit({ isCollapsed, setIsCollapsed }: Props) {
  const { user: actor } = useAuth();
  const isMobile = useIsMobile();
  const entryBudget = useRowBudget(4, 6, 9);
  const [range, setRange] = useState<string>('7d');
  const [plane, setPlane] = useState<string>('all');
  const [data, setData] = useState<ReadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);

  const actorArgs = useCallback(() => ({ p_actor_id: actor?.id, p_actor_email: actor?.email }), [actor?.id, actor?.email]);

  const load = useCallback(async () => {
    if (!actor?.id) return;
    setLoading(true);
    setError(null);
    const ms = RANGES.find((r) => r.value === range)?.ms ?? RANGES[1].ms;
    const { data: out, error: err } = await db.rpc('admin_audit_log_read', {
      ...actorArgs(),
      p_since: new Date(Date.now() - ms).toISOString(),
      p_plane: plane === 'all' ? null : plane,
      p_limit: ROW_LIMIT,
    });
    if (err) {
      setError(err.message === 'forbidden' ? 'Only a super admin can read the audit log.' : err.message);
      setData(null);
    } else {
      setData(out as ReadResult);
    }
    setLoading(false);
  }, [actor?.id, actorArgs, range, plane]);

  const runVerify = useCallback(async () => {
    if (!actor?.id) return;
    setVerifying(true);
    setVerifyError(null);
    const { data: out, error: err } = await db.rpc('admin_audit_log_verify', actorArgs());
    if (err) setVerifyError(err.message);
    else setVerify(out as VerifyResult);
    setVerifying(false);
  }, [actor?.id, actorArgs]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { runVerify(); }, [runVerify]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const colFilterGetters = useMemo(() => ({
    time: (r: AuditRow) => fmtTime(r.created_at),
    plane: (r: AuditRow) => r.plane,
    actor: (r: AuditRow) => `${actorLabel(r)} ${r.actor_email ?? ''}`,
    action: (r: AuditRow) => `${r.action} ${describe(r)}`,
    target: (r: AuditRow) => `${targetLabel(r)} ${(r.projects ?? []).map((p) => p.name).join(' ')}`,
  }), []);
  const { filtered, FilterTH } = useColumnFilters(rows, colFilterGetters);
  const sortGetters = useMemo(() => ({
    time: (r: AuditRow) => r.created_at,
    plane: (r: AuditRow) => r.plane,
    actor: (r: AuditRow) => actorLabel(r).toLowerCase(),
    action: (r: AuditRow) => r.action.toLowerCase(),
    target: (r: AuditRow) => targetLabel(r).toLowerCase(),
  }), []);
  const { sorted, SortTH } = useTableSort(filtered, sortGetters);
  const openEntry = rows.find((r) => r.id === openEntryId) ?? null;

  const people = (data?.by_actor ?? []).filter((a) => a.actor_user_id);
  const unattributed = (data?.by_actor ?? []).find((a) => !a.actor_user_id);
  const signIns = people.reduce((s, a) => s + a.sign_ins, 0);
  const dataWrites = (data?.by_actor ?? []).reduce((s, a) => s + a.data_writes, 0);
  const failed = (data?.failed_sign_ins ?? []).reduce((s, f) => s + f.n, 0);
  const rangeLabel = RANGES.find((r) => r.value === range)?.label.toLowerCase() ?? '';

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
      <Segmented value={plane} onChange={setPlane} options={PLANES} />
    </div>
  );

  const tiles = [
    { k: 'Entries', v: data ? fmtInt(data.total) : '—', sub: rangeLabel },
    { k: 'People active', v: data ? fmtInt(people.length) : '—', sub: 'with at least one entry' },
    { k: 'Sign-ins', v: data ? fmtInt(signIns) : '—', sub: failed ? `${fmtInt(failed)} failed` : 'no failed attempts' },
    { k: 'Data changes', v: data ? fmtInt(dataWrites) : '—', sub: 'write statements' },
  ];

  const integrity = (
    <div className={cn(SURFACE, 'flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between')}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className={KX}>Integrity</span>
        {verifyError ? (
          <StatusDot tone="error" label={`Could not verify: ${verifyError}`} />
        ) : !verify ? (
          <StatusDot tone="neutral" label={verifying ? 'Verifying the chain…' : 'Not verified yet'} />
        ) : verify.ok ? (
          <>
            <StatusDot tone="active" label={`Chain intact — ${fmtInt(verify.checked)} entries verified${verify.unsealed ? `, ${fmtInt(verify.unsealed)} awaiting seal` : ''}`} />
            {verify.head_hash && (
              <span className="break-all font-mono text-[11px] text-muted-foreground">
                head #{verify.head_seq} · {verify.head_hash}
              </span>
            )}
          </>
        ) : (
          <>
            <StatusDot tone="error" label={`Chain broken at entry #${verify.first_break?.seq}`} />
            <span className="text-[12px] text-[#bf2330]">{verify.first_break?.reason}</span>
          </>
        )}
        <span className="text-[11.5px] text-muted-foreground">
          Entries cannot be edited or deleted, and each is sealed to the one before it. Record the head
          outside the database now and then: it is what proves the log was not rewritten or cut short.
        </span>
      </div>
      <div className="flex shrink-0 gap-2">
        {verify?.head_hash && (
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(`#${verify.head_seq} ${verify.head_hash} ${verify.verified_at}`)}
            className="min-h-11 rounded-sm border border-[--zinc-border] bg-white px-3 text-[12px] md:min-h-0 md:py-1.5"
          >
            Copy head
          </button>
        )}
        <button
          type="button"
          onClick={runVerify}
          disabled={verifying}
          className="min-h-11 rounded-sm border border-[--zinc-border] bg-white px-3 text-[12px] disabled:opacity-55 md:min-h-0 md:py-1.5"
        >
          {verifying ? 'Verifying…' : 'Verify now'}
        </button>
      </div>
    </div>
  );

  const truncated = data && data.total > data.returned
    ? `Showing the newest ${fmtInt(data.returned)} of ${fmtInt(data.total)} entries. The counts above cover all of them.`
    : null;

  return (
    <AdminLayout
      isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="Audit Log" onRefresh={load} refreshLoading={loading}
    >
      <div className="flex flex-col gap-4">
        {controls}
        {error && (
          <div className={cn(SURFACE, 'px-4 py-3 text-[13px] text-[#bf2330]')}>{error}</div>
        )}

        {isMobile ? (
          <>
            <AdminMobileList label="Summary" counter={rangeLabel} loading={loading}>
              {tiles.map((t) => (
                <AdminMobileRow key={t.k} label={t.k} value={t.v} sub={t.sub} />
              ))}
              {people.length > 0 && (
                <MobileRow label="Who is using it" sub={`${people.length} people`} onClick={() => setPeopleOpen(true)} />
              )}
            </AdminMobileList>
            {integrity}
            {/* The ledger summarises into rows; the change each entry records is
                what the row opens, in full (§10, v2 §5.4). */}
            <AdminMobileList
              label="Audit log"
              counter={`${sorted.length}`}
              loading={loading}
              empty={sorted.length === 0 ? `No audit entries in the ${rangeLabel}.` : undefined}
            >
              {sorted.slice(0, entryBudget).map((r) => (
                <AdminMobileRow
                  key={r.id}
                  label={actorLabel(r)}
                  sub={`${describe(r)} · ${fmtTime(r.created_at)}`}
                  actionsTitle={r.action}
                  actions={[{ label: 'Show the entry', sub: 'as recorded', onClick: () => setOpenEntryId(r.id) }]}
                />
              ))}
              {sorted.length > entryBudget && (
                <MobileRow
                  label={`All ${sorted.length} entries`}
                  sub={`${sorted.length - entryBudget} more`}
                  onClick={() => setAllOpen(true)}
                />
              )}
            </AdminMobileList>
            {truncated && <p className="text-[11.5px] text-muted-foreground">{truncated}</p>}
          </>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3">
              {tiles.map((t) => (
                <div key={t.k} className={cn(SURFACE, 'flex flex-col gap-1 px-4 py-3')}>
                  <span className={KX}>{t.k}</span>
                  <span className="text-[22px] font-medium tabular-nums">{t.v}</span>
                  <span className="text-[11.5px] text-muted-foreground">{t.sub}</span>
                </div>
              ))}
            </div>

            {integrity}

            <div className="grid grid-cols-2 gap-4">
              <div className={cn(SURFACE, 'overflow-hidden')}>
                <div className="px-4 py-2.5"><span className={KX}>Who is using it</span></div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead><tr>
                      <th className={cn(TH, 'sticky left-0')}>Person</th>
                      <th className={cn(TH, 'text-right')}>Sign-ins</th>
                      <th className={cn(TH, 'text-right')}>Data changes</th>
                      <th className={cn(TH, 'text-right')}>Rows</th>
                      <th className={cn(TH, 'text-right')}>Admin</th>
                      <th className={TH}>Last active</th>
                    </tr></thead>
                    <tbody>
                      {loading ? <LoadingRow colSpan={6} /> : (data?.by_actor ?? []).length === 0 ? (
                        <EmptyRow colSpan={6} message={`Nobody did anything recorded in the ${rangeLabel}.`} />
                      ) : (data?.by_actor ?? []).map((a) => (
                        <tr key={a.actor_user_id ?? 'none'} className={ROW_HOVER}>
                          <td className={cn(TD, 'sticky left-0 bg-white')}>
                            <div className="text-[13px]">{actorLabel(a)}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {a.actor_user_id ? [a.actor_email, a.actor_org].filter(Boolean).join(' · ') : 'service writes and failed sign-ins'}
                            </div>
                          </td>
                          <td className={cn(TD, 'text-right tabular-nums text-[13px]')}>{fmtInt(a.sign_ins)}</td>
                          <td className={cn(TD, 'text-right tabular-nums text-[13px]')}>{fmtInt(a.data_writes)}</td>
                          <td className={cn(TD, 'text-right tabular-nums text-[13px]')}>{fmtInt(a.rows_written)}</td>
                          <td className={cn(TD, 'text-right tabular-nums text-[13px]')}>{fmtInt(a.admin_actions)}</td>
                          <td className={cn(TD, 'whitespace-nowrap text-[11.5px] text-muted-foreground')}>{fmtTime(a.last_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className={cn(SURFACE, 'overflow-hidden')}>
                <div className="px-4 py-2.5"><span className={KX}>What they do</span></div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead><tr>
                      <th className={cn(TH, 'sticky left-0')}>Action</th>
                      <th className={TH}>On</th>
                      <th className={cn(TH, 'text-right')}>Times</th>
                      <th className={cn(TH, 'text-right')}>People</th>
                      <th className={TH}>Last</th>
                    </tr></thead>
                    <tbody>
                      {loading ? <LoadingRow colSpan={5} /> : (data?.by_action ?? []).length === 0 ? (
                        <EmptyRow colSpan={5} message="Nothing recorded." />
                      ) : (data?.by_action ?? []).map((a) => (
                        <tr key={`${a.plane}:${a.action}:${a.target_type}`} className={ROW_HOVER}>
                          <td className={cn(TD, 'sticky left-0 bg-white font-mono text-[11.5px]')}>
                            <span className={PLANE_TONE[a.plane]}>{a.plane}</span> {a.action}
                          </td>
                          <td className={cn(TD, 'font-mono text-[11px] text-muted-foreground')}>{a.target_type ?? '—'}</td>
                          <td className={cn(TD, 'text-right tabular-nums text-[13px]')}>{fmtInt(a.n)}</td>
                          <td className={cn(TD, 'text-right tabular-nums text-[13px]')}>{fmtInt(a.people)}</td>
                          <td className={cn(TD, 'whitespace-nowrap text-[11.5px] text-muted-foreground')}>{fmtTime(a.last_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {unattributed && unattributed.total > 0 && (
              <p className="text-[11.5px] text-muted-foreground">
                {fmtInt(unattributed.total)} entries name no actor: writes made by a service with no user behind
                it, API-key calls, and failed sign-ins (whoever typed the wrong password is not proven to be the
                account holder, so the account is recorded as the target instead).
              </p>
            )}

            <div className={cn(SURFACE, 'overflow-hidden')}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead><tr>
                    <SortTH sortKey="time">Time</SortTH><SortTH sortKey="plane">Plane</SortTH><SortTH sortKey="actor">Actor</SortTH>
                    <SortTH sortKey="action">Action</SortTH><SortTH sortKey="target">Target</SortTH><th className={TH}>Recorded</th>
                  </tr>
                  <tr>
                    <FilterTH filterKey="time" /><FilterTH filterKey="plane" /><FilterTH filterKey="actor" />
                    <FilterTH filterKey="action" /><FilterTH filterKey="target" />
                    <th className="border-b border-[--hair-border] bg-white" />
                  </tr></thead>
                  <tbody>
                    {loading ? <LoadingRow colSpan={6} /> : sorted.length === 0 ? (
                      <EmptyRow colSpan={6} message={`No audit entries in the ${rangeLabel}.`} />
                    ) : sorted.map((r) => (
                      <tr key={r.id} className={ROW_HOVER}>
                        <td className={`${TD} whitespace-nowrap text-[11.5px] text-muted-foreground`}>{fmtTime(r.created_at)}</td>
                        <td className={cn(TD, 'font-mono text-[11px]', PLANE_TONE[r.plane])}>{r.plane}</td>
                        <td className={`${TD} text-[13px]`}>
                          <div>{actorLabel(r)}</div>
                          {r.actor_email && r.actor_email !== r.actor_name && (
                            <div className="text-[11px] text-muted-foreground">{r.actor_email}</div>
                          )}
                        </td>
                        <td className={TD}>
                          <div className="text-[12.5px]">{describe(r)}</div>
                          <div className="font-mono text-[10.5px] text-muted-foreground">{r.action}</div>
                        </td>
                        <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>
                          {targetLabel(r)}
                          {(r.projects ?? []).length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {(r.projects ?? []).map((p) => <MonoChip key={p.id}>{p.name}</MonoChip>)}
                            </div>
                          )}
                        </td>
                        <td className={`${TD} max-w-[400px] font-mono text-[10.5px] leading-relaxed text-[#737373]`}>
                          {r.plane === 'data' ? (
                            <span>tier {String(r.after?.tier ?? '?')} · {r.sealed ? `sealed #${r.seq}` : 'awaiting seal'}</span>
                          ) : (
                            <>
                              <span className="text-[#a3a3a3]">before</span> {r.before ? JSON.stringify(r.before) : '—'}<br />
                              <span className="text-[#a3a3a3]">after</span> {r.after ? JSON.stringify(r.after) : '—'}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {truncated && <p className="text-[11.5px] text-muted-foreground">{truncated}</p>}
          </>
        )}
      </div>

      {isMobile && (
        <>
          {/* The entry, in full — a recorded change is on the never-truncate list (§3.1). */}
          <MobileSheet
            open={openEntry != null}
            title={openEntry ? describe(openEntry) : ''}
            sub={openEntry ? `${actorLabel(openEntry)} · ${fmtTime(openEntry.created_at)}` : undefined}
            onClose={() => setOpenEntryId(null)}
          >
            {openEntry && (
              <div className="flex flex-col gap-3 p-3.5">
                {([
                  ['Action', `${openEntry.plane} · ${openEntry.action}`],
                  ['Target', targetLabel(openEntry)],
                  ['Seal', openEntry.sealed ? `#${openEntry.seq}` : 'awaiting seal'],
                  ['Before', openEntry.before ? JSON.stringify(openEntry.before) : '—'],
                  ['After', openEntry.after ? JSON.stringify(openEntry.after) : '—'],
                ] as const).map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#525252]">{k}</span>
                    <span className={cn(M_CODE, 'leading-relaxed text-[#3f3f46]')}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </MobileSheet>

          <MobileSheet
            open={allOpen}
            title="Audit log"
            sub={`${sorted.length} entries, newest first.`}
            onClose={() => setAllOpen(false)}
          >
            <div className="flex flex-col">
              {sorted.map((r) => (
                <MobileRow
                  key={r.id}
                  label={actorLabel(r)}
                  sub={`${describe(r)} · ${fmtTime(r.created_at)}`}
                  onClick={() => { setAllOpen(false); setOpenEntryId(r.id); }}
                />
              ))}
            </div>
          </MobileSheet>

          <MobileSheet
            open={peopleOpen}
            title="Who is using it"
            sub={rangeLabel}
            onClose={() => setPeopleOpen(false)}
          >
            <div className="flex flex-col">
              {people.map((a) => (
                <MobileRow
                  key={a.actor_user_id ?? 'none'}
                  label={actorLabel(a)}
                  sub={`${fmtInt(a.sign_ins)} sign-ins · ${fmtInt(a.data_writes)} data changes · last ${fmtTime(a.last_at)}`}
                />
              ))}
            </div>
          </MobileSheet>
        </>
      )}
    </AdminLayout>
  );
}
