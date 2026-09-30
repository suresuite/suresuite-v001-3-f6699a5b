// D210 — the signed-in account's organizations and the switch between them, for the
// account menu and /profile. See `src/lib/auth/myOrganizations.ts`.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { listMyOrganizations, switchMyOrganization, type MyOrganization } from '@/lib/auth/myOrganizations';

export function useMyOrganizations() {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<MyOrganization[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) { setOrganizations([]); return; }
    setLoading(true);
    const res = await listMyOrganizations(user.id);
    setOrganizations(res.data);
    setError(res.error);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  /** Resolves with the refusal, or never settles usefully: success reloads the app. */
  const switchTo = useCallback(async (orgId: string): Promise<string | null> => {
    if (!user?.id) return 'Not signed in.';
    setSwitching(orgId);
    const { error: refusal } = await switchMyOrganization(user.id, orgId);
    if (refusal) setSwitching(null);
    return refusal;
  }, [user?.id]);

  const current = organizations.find((o) => o.is_current) ?? null;
  return { organizations, current, loading, error, switching, switchTo, reload: load };
}
