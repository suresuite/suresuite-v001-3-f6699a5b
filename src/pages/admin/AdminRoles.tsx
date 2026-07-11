import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

interface Cap {
  key: string;
  kind: 'page' | 'feature';
  label: string;
  description?: string | null;
  sort_order: number;
}

// role → capability_key → allowed
type RoleMap = Record<string, Record<string, boolean>>;

const db = supabase as any;
// Editable roles (super_admin is always-on and shown locked).
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
    setLoading(true);
    setError(null);
    const { data, error: err } = await db.rpc('get_role_access', {
      p_actor_id: actor.id,
      p_actor_email: actor.email,
    });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setCaps((data?.capabilities ?? []) as Cap[]);
    setRoles((data?.roles ?? {}) as RoleMap);
    setLoading(false);
  }, [actor?.id, actor?.email]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = useMemo(() => caps.filter((c) => c.kind === 'page'), [caps]);
  const features = useMemo(() => caps.filter((c) => c.kind === 'feature'), [caps]);

  const setCell = async (role: string, cap: Cap, allowed: boolean) => {
    if (!actor?.id) return;
    setRoles((prev) => ({ ...prev, [role]: { ...(prev[role] ?? {}), [cap.key]: allowed } }));
    const { error: err } = await db.rpc('admin_set_capability', {
      p_actor_id: actor.id,
      p_actor_email: actor.email,
      p_scope: 'role',
      p_scope_id: role,
      p_capability_key: cap.key,
      p_allowed: allowed,
    });
    if (err) {
      toast.error(err.message);
      load();
    } else {
      toast.success(`${role} · ${cap.label}: ${allowed ? 'allowed' : 'denied'}`);
    }
  };

  const renderSection = (title: string, rows: Cap[]) => (
    <div className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>
      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[46%]">Capability</TableHead>
              {ROLE_ORDER.map((r) => (
                <TableHead key={r} className="text-center capitalize">
                  {r.replace('_', ' ')}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((cap) => {
              const locked = ALWAYS_ON.has(cap.key);
              return (
                <TableRow key={cap.key}>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {cap.label}
                      {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                    </div>
                    {cap.description && (
                      <div className="text-xs text-muted-foreground">{cap.description}</div>
                    )}
                  </TableCell>
                  {ROLE_ORDER.map((role) => {
                    const forcedOn = role === 'super_admin' || locked;
                    const checked = forcedOn ? true : !!roles[role]?.[cap.key];
                    return (
                      <TableCell key={role} className="text-center">
                        <div className="flex justify-center">
                          <Switch
                            checked={checked}
                            disabled={forcedOn}
                            onCheckedChange={(v) => setCell(role, cap, v)}
                          />
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="Role defaults"
      description="Baseline capability grants per role. Individual users inherit these unless overridden on their access page."
    >
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-normal">
              <Lock className="mr-1 h-3 w-3" /> Super admins &amp; My Profile are always on
            </Badge>
          </div>
          {renderSection('Pages', pages)}
          {renderSection('Features', features)}
        </>
      )}
    </AdminLayout>
  );
}
