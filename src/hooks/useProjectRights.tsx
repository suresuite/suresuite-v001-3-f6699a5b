// D219 — the signed-in account's rights on one project, for the app's gates.
//
// Every gate that /profile's "My organization" tab describes reads THIS: Run Simulations
// (/simulation-lab, /policies' Run & Validate), Edit Input Data (uploads, item masters,
// supplier assignment), Edit Policies (every /policies write), Export (every export
// button) and the project-settings edit. The answer is the database's
// (`get_my_project_rights` → `project_rights_for_user`), so a button and the right a page
// lists cannot disagree.
//
// ONE declared fallback: when the read is UNAVAILABLE (the function not deployed yet, a
// network failure) the gates apply the account-wide rule they applied before D219 —
// `useCapabilities` plus, for input edits and settings, the owner-or-admin rule — and
// `usingFallback` says so. A REFUSAL (`forbidden`, `account_inactive`) is not a failure to
// read: it grants nothing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';
import {
  getMyProjectRights, projectRightRefusal, PROJECT_RIGHT_LABELS,
  type ProjectRight, type ProjectRights, type RightsReadFailure,
} from '@/lib/auth/projectRights';

type Entry = { at: number; promise: ReturnType<typeof getMyProjectRights> };
const TTL_MS = 30_000;
const cache = new Map<string, Entry>();

/** Several cards on one page ask for the same project at once: one read serves them. */
function read(userId: string, projectId: string) {
  const key = `${userId}:${projectId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = getMyProjectRights(userId, projectId);
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

/** Forget every cached answer (after a role or membership change). */
export function invalidateProjectRights() {
  cache.clear();
}

export interface ProjectRightsGate {
  rights: ProjectRights | null;
  loading: boolean;
  /** The read failed and the gates apply the pre-D219 account-wide rule. */
  usingFallback: boolean;
  can: (right: ProjectRight) => boolean;
  canEditProject: boolean;
  /** Why `right` is not held, in words; null when it is (or while loading). */
  refusal: (right: ProjectRight) => string | null;
}

export function useProjectRights(
  projectId: string | null | undefined,
  /** The project's owner, for the declared fallback's owner-or-admin rule. */
  opts: { modelerId?: string | null } = {},
): ProjectRightsGate {
  const { user } = useAuth();
  const { canFeature } = useCapabilities();
  const [state, setState] = useState<{
    key: string; data: ProjectRights | null; failure: RightsReadFailure | null;
  } | null>(null);

  const key = user?.id && projectId ? `${user.id}:${projectId}` : '';

  useEffect(() => {
    if (!user?.id || !projectId) return;
    let live = true;
    read(user.id, projectId).then((res) => {
      if (live) setState({ key: `${user.id}:${projectId}`, data: res.data, failure: res.failure });
    });
    return () => { live = false; };
  }, [user?.id, projectId]);

  const current = state && state.key === key ? state : null;
  const loading = !!key && !current;
  const usingFallback = current?.failure === 'unavailable';
  const rights = current?.data ?? null;
  const modelerId = opts.modelerId;
  const role = user?.role;

  const ownerOrAdmin = !!user?.id && (modelerId === user.id || role === 'admin');

  const can = useCallback((right: ProjectRight): boolean => {
    if (!current) return false;
    if (usingFallback) {
      const account = canFeature(right);
      // The owner-or-admin half applies where the caller knows the owner.
      return right === 'data_edit_inputs' && modelerId !== undefined ? account && ownerOrAdmin : account;
    }
    return !!rights?.capabilities[right];
  }, [current, usingFallback, rights, canFeature, ownerOrAdmin, modelerId]);

  const canEditProject = !current
    ? false
    : usingFallback
      ? ownerOrAdmin || role === 'super_admin'
      : !!rights?.can_edit_project;

  const refusal = useCallback((right: ProjectRight): string | null => {
    if (!current || can(right)) return null;
    if (usingFallback) return `${PROJECT_RIGHT_LABELS[right]} isn't enabled for your account.`;
    return projectRightRefusal(right, rights);
  }, [current, can, usingFallback, rights]);

  return useMemo(
    () => ({ rights, loading, usingFallback, can, canEditProject, refusal }),
    [rights, loading, usingFallback, can, canEditProject, refusal],
  );
}
