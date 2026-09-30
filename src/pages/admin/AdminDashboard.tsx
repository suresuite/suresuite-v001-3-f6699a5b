// Platform Overview (/admin) — SuReSuite "Ledger" redesign.
// Every figure comes from ONE call, `admin_platform_overview` (PLAN.md §4 D205).
// The page used to read `organizations`, `approved_users`, `ai_usage_logs` and
// `v_admin_user_usage` directly; the browser calls as anon with no session, so each
// was refused or filtered to nothing and the page showed zeros over a populated
// platform. Month and day boundaries are the database's (UTC), the same window the
// Users page's MTD uses — they used to come from the browser's local clock.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SURFACE, KX, TH, TD, ROW_HOVER, useTableSort } from '@/components/admin/adminUi';
import { TableBlock } from '@/components/shared';
import { M, MobileGroup, MobilePanel, MobileRow, MobileStatGrid } from '@/components/mobile';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useRowBudget } from '@/hooks/useViewport';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface Kpis { orgs: number; projects: number; users: number; usersSuspended: number; requests: number; requestsMtd: number; costMtd: number; costToday: number; activeUsers7d: number; }
interface TopRow { label: string; requests: number; cost: number; }

const db = supabase as any;

export default function AdminDashboard({ isCollapsed, setIsCollapsed }: Props) {
  const isMobile = useIsMobile();
  const topBudget = useRowBudget(4, 6, 10);
  const { user: actor } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [topUsers, setTopUsers] = useState<TopRow[]>([]);
  const [topOrgs, setTopOrgs] = useState<TopRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await db.rpc('admin_platform_overview', { p_actor_id: actor?.id, p_actor_email: actor?.email });
        if (cancelled) return;
        // A refused read is not an empty platform: say which it is (D205, D203).
        if (error || !data) {
          setLoadError(error?.message === 'forbidden'
            ? 'Only an active super admin can read the platform overview.'
            : `Could not load the overview: ${error?.message ?? 'no data returned'}`);
          return;
        }
        const n = (v: unknown) => Number(v ?? 0);
        setKpis({
          orgs: n(data.organizations), projects: n(data.projects), users: n(data.users),
          usersSuspended: n(data.users_suspended), requests: n(data.requests), requestsMtd: n(data.requests_mtd),
          costMtd: n(data.cost_mtd), costToday: n(data.cost_today), activeUsers7d: n(data.active_users_7d),
        });
        const top = (rows: Array<{ label?: string; requests?: number; cost?: number }> | null | undefined): TopRow[] =>
          (rows ?? []).map((r) => ({ label: String(r.label ?? '—'), requests: n(r.requests), cost: n(r.cost) }));
        setTopUsers(top(data.top_users));
        setTopOrgs(top(data.top_orgs));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [actor?.id, actor?.email]);

  const $ = (v: number) => `$${v.toFixed(2)}`;
  const n = (v: number) => v.toLocaleString();
  // Month-to-date cost over month-to-date requests. It used to divide by ALL-TIME
  // requests, which shrinks the average every month the platform ages.
  const avg = kpis && kpis.requestsMtd ? kpis.costMtd / kpis.requestsMtd : 0;

  const reach = kpis ? [['Organizations', n(kpis.orgs)], ['Projects', n(kpis.projects)], ['Users', kpis.usersSuspended ? `${n(kpis.users)} · ${n(kpis.usersSuspended)} suspended` : n(kpis.users)], ['AI-active · 7d', n(kpis.activeUsers7d)]] : [];
  const spend = kpis ? [['Requests', n(kpis.requests), 'all-time', false], ['Cost today', $(kpis.costToday), 'UTC day', false], ['Cost MTD', $(kpis.costMtd), '', true], ['Avg $/req', $(avg), 'month-to-date · UTC', false]] : [];

  if (isMobile) {
    // §13.4 — the numbers band, as the skin's stat grid. Same eight figures in
    // the same order; the grid derives its columns from the cell count rather
    // than from an index-driven border, and the four-cell case is a fixed 2-up
    // so `auto-fit` cannot orphan the fourth (§9.2).
    return (
      <AdminLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="Platform Overview">
        {loadError ? (
          <MobilePanel label="Platform overview">
            <p className="px-3 py-8 text-center text-[13px] text-[#bf2330]">{loadError}</p>
          </MobilePanel>
        ) : loading || !kpis ? (
          <MobilePanel label="Platform overview">
            <p className="px-3 py-8 text-center text-[13px] text-[#525252]">Loading…</p>
          </MobilePanel>
        ) : (
          <div className="flex flex-col gap-[var(--m-gap)]">
            <MobileGroup label="Reach">
              <MobileStatGrid
                stats={reach.map(([label, value]) => ({ label: String(label), value: String(value) }))}
              />
            </MobileGroup>

            <MobileGroup label="AI spend">
              <MobileStatGrid
                stats={spend.map(([label, value, , emph]) => ({
                  label: String(label),
                  value: String(value),
                  // "Cost MTD" is the figure the band is about — the #F8D448
                  // 2px rule was saying so on desktop; here it is the dot,
                  // which is the only other place a meaning colour is allowed.
                  dot: emph ? M.begin : undefined,
                }))}
              />
            </MobileGroup>

            <MobileGroup label="Month to date">
              <MobilePanel label="Top users" counter={`${topUsers.length}`}>
                {topUsers.length === 0 ? (
                  <p className="px-3 py-8 text-center text-[13px] text-[#525252]">
                    No usage recorded yet.
                  </p>
                ) : (
                  topUsers.slice(0, topBudget).map((r) => (
                    <MobileRow
                      key={r.label}
                      chevron={false}
                      label={r.label}
                      sub={`${r.requests.toLocaleString()} requests`}
                      value={`$${r.cost.toFixed(2)}`}
                    />
                  ))
                )}
              </MobilePanel>

              <MobilePanel label="Top organizations" counter={`${topOrgs.length}`}>
                {topOrgs.length === 0 ? (
                  <p className="px-3 py-8 text-center text-[13px] text-[#525252]">
                    No usage recorded yet.
                  </p>
                ) : (
                  topOrgs.slice(0, topBudget).map((r) => (
                    <MobileRow
                      key={r.label}
                      chevron={false}
                      label={r.label}
                      sub={`${r.requests.toLocaleString()} requests`}
                      value={`$${r.cost.toFixed(2)}`}
                    />
                  ))
                )}
              </MobilePanel>
            </MobileGroup>
          </div>
        )}
      </AdminLayout>
    );
  }

  return (
    <AdminLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="Platform Overview">
      {loadError ? (
        <div className={`${SURFACE} px-4 py-3 text-[13px] text-[#bf2330]`}>{loadError}</div>
      ) : loading || !kpis ? (
        <div className="grid h-40 place-items-center">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[--zinc-border] border-t-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className={`${SURFACE} overflow-hidden`}>
            <div className={`${KX} border-b border-[--hair-border] px-4 py-[9px]`}>Reach</div>
            {/* Spec 2.3/4.5: four 27px figures do not fit 320px. Below md this is a
                2-up whose cell rules come from a 1px grid gap over the divider
                colour, so no cell needs to know its index; md: restores the
                literal grid-cols-4 and the index-driven border-r. */}
            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-px bg-[--hair-divider] md:grid-cols-4 md:gap-0 md:bg-transparent">
              {reach.map(([label, value], i) => (
                <div key={label} className={`min-w-0 bg-white px-[18px] py-[15px] md:bg-transparent ${i < 3 ? 'md:border-r md:border-[--hair-divider]' : ''}`}>
                  <div className={KX}>{label}</div>
                  <div className="mt-2 text-[length:var(--fs-stat)] font-semibold leading-none tracking-[-0.02em] tabular-nums md:text-[27px]">{value}</div>
                </div>
              ))}
            </div>
            <div className={`${KX} border-y border-[--hair-border] px-4 py-[9px]`}>AI spend</div>
            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-px bg-[--hair-divider] md:grid-cols-4 md:gap-0 md:bg-transparent">
              {spend.map(([label, value, hint, emph], i) => (
                <div key={label as string} className={`min-w-0 px-[18px] py-[15px] ${i < 3 ? 'md:border-r md:border-[--hair-divider]' : ''} ${emph ? 'bg-[#fffdf3]' : 'bg-white md:bg-transparent'}`}>
                  <div className={KX}>{label}</div>
                  <div className="mt-2 text-[length:var(--fs-stat)] font-semibold leading-none tracking-[-0.02em] tabular-nums md:text-[27px]">{value}</div>
                  {emph ? <div className="mt-2 h-[2px] w-9 rounded-full bg-[#f8d448]" /> : hint ? <div className="mt-2 font-mono text-[10px] text-[#a3a3a3]">{hint}</div> : null}
                </div>
              ))}
            </div>
          </div>

          {/* Spec 2.3: two ledgers side by side is ~150px each at 320. Stack below
              md; md: restores the literal 2-up. */}
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[repeat(2,minmax(0,1fr))]">
            <TopTable title="Top users" rows={topUsers} />
            <TopTable title="Top organizations" rows={topOrgs} />
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function TopTable({ title, rows }: { title: string; rows: TopRow[] }) {
  const { sorted, SortTH } = useTableSort(rows, {
    label: (r: TopRow) => r.label.toLowerCase(), requests: (r: TopRow) => r.requests, cost: (r: TopRow) => r.cost,
  });
  return (
    // L1: the table's name sits on the canvas above the shell, not in a title bar.
    <TableBlock
      name={title}
      count={rows.length}
      actions={
        <span className="rounded-sm bg-[#f4f4f4] px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] text-[--ledger-quiet]">MTD</span>
      }
    >
      <table className="w-full border-collapse">
        <thead><tr><SortTH sortKey="label">Name</SortTH><SortTH sortKey="requests" align="right">Req</SortTH><SortTH sortKey="cost" align="right">Cost</SortTH></tr></thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={3} className="px-4 py-10 text-center text-[13px] text-muted-foreground">No usage recorded yet.</td></tr>
          ) : sorted.map((r) => (
            <tr key={r.label} className={ROW_HOVER}>
              <td className={`${TD} text-[13px]`}>{r.label}</td>
              <td className={`${TD} text-right font-mono text-[12px] tabular-nums text-muted-foreground`}>{r.requests.toLocaleString()}</td>
              <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>${r.cost.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableBlock>
  );
}
