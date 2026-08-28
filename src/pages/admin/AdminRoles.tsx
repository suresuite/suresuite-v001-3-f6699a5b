// Role Defaults (/admin/roles) — SuReSuite "Ledger" redesign.
// Data flow unchanged (get_role_access, admin_set_capability). Switch matrices
// use the black-pill Toggle; super_admin + /profile stay forced-on and locked.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SURFACE, TH, TD, ROW_HOVER, Toggle } from '@/components/admin/adminUi';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface Cap { key: string; kind: 'page' | 'feature'; label: string; description?: string | null; sort_order: number; }
type RoleMap = Record<string, Record<string, boolean>>;

const db = supabase as any;
const ROLE_ORDER = ['user', 'modeler', 'admin', 'super_admin'] as const;
const ALWAYS_ON = new Set(['/profile']);

export default function AdminRoles({ isCollapsed, setIsCollapsed }: Props) {
  const { user: actor } = useAuth();
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

  const renderSection = (title: string, rows: Cap[]) => (
    <div>
      <h2 className="mb-2 text-[13px] font-semibold">{title}</h2>
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse">
          <thead><tr>
            <th className={`${TH} w-[46%]`}>Capability</th>
            {ROLE_ORDER.map((r) => <th key={r} className={`${TH} text-center`}>{r.replace('_', ' ')}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((cap) => {
              const locked = ALWAYS_ON.has(cap.key);
              return (
                <tr key={cap.key} className={ROW_HOVER}>
                  <td className={TD}>
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
