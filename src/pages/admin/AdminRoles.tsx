// Role Defaults (/admin/roles) — SuReSuite "Ledger" redesign.
// Data flow unchanged (get_role_access, admin_set_capability). Switch matrices
// use the black-pill Toggle; super_admin + /profile stay forced-on and locked.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SURFACE, TH, TD, ROW_HOVER, Toggle } from '@/components/admin/adminUi';
import { MobileSheet } from '@/components/shared/MobileSheet';
import { M, MobileGroup, MobileNote, MobilePanel, MobileRow, MobileToggle } from '@/components/mobile';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { FROZEN_CELL, FROZEN_CELL_ON_TINT } from '@/components/shared';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface Cap { key: string; kind: 'page' | 'feature'; label: string; description?: string | null; sort_order: number; }
type RoleMap = Record<string, Record<string, boolean>>;

const db = supabase as any;
const ROLE_ORDER = ['user', 'modeler', 'admin', 'super_admin'] as const;
const ALWAYS_ON = new Set(['/profile']);

export default function AdminRoles({ isCollapsed, setIsCollapsed }: Props) {
  const { user: actor } = useAuth();
  const isMobile = useIsMobile();
  const [openCapKey, setOpenCapKey] = useState<string | null>(null);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [roles, setRoles] = useState<RoleMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!actor?.id) return;
    setLoading(true); setError(null);
    const { data, error: err } = await db.rpc('get_role_access', { p_actor_id: actor.id, p_actor_email: actor.email });
    if (err) { setError(err.message); setLoading(false); return; }
    setCaps((data?.capabilities ?? []) as Cap[]);
    setRoles((data?.roles ?? {}) as RoleMap);
    setLoading(false);
  }, [actor?.id, actor?.email]);
  useEffect(() => { load(); }, [load]);

  const pages = useMemo(() => caps.filter((c) => c.kind === 'page'), [caps]);
  const features = useMemo(() => caps.filter((c) => c.kind === 'feature'), [caps]);

  const setCell = async (role: string, cap: Cap, allowed: boolean) => {
    if (!actor?.id) return;
    setRoles((prev) => ({ ...prev, [role]: { ...(prev[role] ?? {}), [cap.key]: allowed } }));
    const { error: err } = await db.rpc('admin_set_capability', { p_actor_id: actor.id, p_actor_email: actor.email, p_scope: 'role', p_scope_id: role, p_capability_key: cap.key, p_allowed: allowed });
    if (err) { toast.error(err.message); load(); }
    else toast.success(`${role} · ${cap.label}: ${allowed ? 'allowed' : 'denied'}`);
  };

  const allowedCount = (cap: Cap) =>
    ROLE_ORDER.filter((role) => role === 'super_admin' || ALWAYS_ON.has(cap.key) || !!roles[role]?.[cap.key])
      .length;

  const openCap = caps.find((c) => c.key === openCapKey) ?? null;

  // Below `md` the 5x N matrix is a list, not a sideways-scrolling grid. §9.5
  // allows horizontal scroll only inside a deliberate table sheet, and the
  // "swipe for the remaining roles" hint was an admission that three of the
  // four roles were off-screen. Each capability is a row that says how many
  // roles have it; tapping it opens the four toggles — the same four, with the
  // same forced-on locks and the same handler (v2 §4B).
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
              sub={locked ? 'always on · ' + cap.key : cap.key}
              value={`${on}/${ROLE_ORDER.length}`}
              onClick={() => setOpenCapKey(cap.key)}
            />
          );
        })}
      </MobilePanel>
    </MobileGroup>
  );

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
              return (
                <tr key={cap.key} className={ROW_HOVER}>
                  <td className={`${TD} ${FROZEN_CELL}`}>
                    <div className="flex items-center gap-1.5 text-[13px] font-medium">{cap.label}{locked && <Lock className="h-3 w-3 text-muted-foreground" />}</div>
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
          </MobileNote>
          {renderMobileSection('Pages', pages)}
          {renderMobileSection('Features', features)}

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
        </div>
      ) : (
        <div className="space-y-5">
          <div className="inline-flex items-center gap-1.5 rounded-sm border border-[--zinc-border] px-2.5 py-1 text-[11.5px] text-muted-foreground">
            <Lock className="h-3 w-3" /> Super admins & My Profile are always on
          </div>
          {renderSection('Pages', pages)}
          {renderSection('Features', features)}
        </div>
      )}
    </AdminLayout>
  );
}
