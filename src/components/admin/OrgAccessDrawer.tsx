import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Cap {
  key: string;
  kind: 'page' | 'feature';
  label: string;
  description?: string | null;
  sort_order: number;
  org_override: boolean | null;
}

interface Props {
  orgId: string;
  orgName: string;
  open: boolean;
  onClose: () => void;
}

type Tri = 'inherit' | 'allow' | 'deny';

const db = supabase as any;

function triOf(v: boolean | null): Tri {
  if (v === null || v === undefined) return 'inherit';
  return v ? 'allow' : 'deny';
}

/**
 * Org-level capability defaults (add-on: a layer between role and user). An org
 * override wins over the role default but is still overridable per user.
 */
export function OrgAccessDrawer({ orgId, orgName, open, onClose }: Props) {
  const { user: actor } = useAuth();
  const [caps, setCaps] = useState<Cap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !actor?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await db.rpc('get_org_access', {
        p_actor_id: actor.id,
        p_actor_email: actor.email,
        p_org_id: orgId,
      });
      if (cancelled) return;
      if (error) toast.error(error.message);
      setCaps((data?.capabilities ?? []) as Cap[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, orgId, actor?.id, actor?.email]);

  const setOverride = async (cap: Cap, tri: Tri) => {
    if (!actor?.id) return;
    const allowed = tri === 'inherit' ? null : tri === 'allow';
    setCaps((prev) => prev.map((c) => (c.key === cap.key ? { ...c, org_override: allowed } : c)));
    const { error } = await db.rpc('admin_set_capability', {
      p_actor_id: actor.id,
      p_actor_email: actor.email,
      p_scope: 'org',
      p_scope_id: orgId,
      p_capability_key: cap.key,
      p_allowed: allowed,
    });
    if (error) toast.error(error.message);
    else toast.success(`${cap.label}: ${tri === 'inherit' ? 'inheriting role default' : tri}`);
  };

  const pages = caps.filter((c) => c.kind === 'page');
  const features = caps.filter((c) => c.kind === 'feature');

  const renderRows = (rows: Cap[]) => (
    <div className="divide-y divide-border">
      {rows.map((cap) => (
        <div key={cap.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 md:gap-y-3">
          <div className="min-w-0 flex-1 text-sm font-medium text-foreground">{cap.label}</div>
          <ToggleGroup
            type="single"
            value={triOf(cap.org_override)}
            onValueChange={(v) => v && setOverride(cap, v as Tri)}
          >
            <ToggleGroupItem value="inherit" className="h-7 min-h-11 px-2 text-xs md:min-h-0">Inherit</ToggleGroupItem>
            <ToggleGroupItem value="allow" className="h-7 min-h-11 px-2 text-xs md:min-h-0">Allow</ToggleGroupItem>
            <ToggleGroupItem value="deny" className="h-7 min-h-11 px-2 text-xs md:min-h-0">Deny</ToggleGroupItem>
          </ToggleGroup>
        </div>
      ))}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto md:max-w-lg">
        <SheetHeader>
          <SheetTitle>Organization access defaults</SheetTitle>
          <SheetDescription>
            {orgName} — applied to every member unless a user override says otherwise.
          </SheetDescription>
        </SheetHeader>
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <section>
              <h4 className="mb-2 text-sm font-medium">Pages</h4>
              {renderRows(pages)}
            </section>
            <section>
              <h4 className="mb-2 text-sm font-medium">Features</h4>
              {renderRows(features)}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
