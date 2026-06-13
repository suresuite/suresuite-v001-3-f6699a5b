import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  DEFAULT_BUNDLE,
  parseFamily,
  type FulfillmentStrategy,
  type PolicyBundle,
  type PolicyFamily,
} from "@/lib/policies/schemas";
import type { OverrideRow } from "@/lib/policies/resolve";

export interface PolicyVersion {
  id: string;
  label: string | null;
  author_email: string | null;
  author_name: string | null;
  parent_version_id: string | null;
  policy_hash: string | null;
  created_at: string;
}

interface UsePoliciesResult {
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  loading: boolean;
  fulfillmentStrategy: FulfillmentStrategy;
  activePreset: string | null;
  presetAppliedAt: Date | null;
  versions: PolicyVersion[];
  currentHash: string | null;
  isDirty: boolean;
  selectedVersionId: string | null;
  setSelectedVersionId: (id: string | null) => void;
  refreshVersions: () => Promise<void>;
  restoreVersion: (versionId: string) => Promise<void>;
  saveDefault: <F extends PolicyFamily>(family: F, value: PolicyBundle[F]) => Promise<void>;
  saveStrategy: (strategy: FulfillmentStrategy) => Promise<void>;
  applyResolvedPreset: (
    slug: string,
    families: PolicyFamily[],
    bundle: PolicyBundle,
  ) => Promise<void>;
  clearActivePreset: () => Promise<void>;
  upsertOverride: (row: OverrideRow) => Promise<void>;
  bulkUpsertOverrides: (rows: OverrideRow[]) => Promise<void>;
  deleteOverride: (scope: "node" | "edge", targetKey: string, family: PolicyFamily) => Promise<void>;
  saveSnapshot: (label?: string) => Promise<string | null>;
}

/**
 * Load + mutate policy defaults and overrides for a project.
 * After every successful mutation, dispatches a `policy.changed` command into
 * the existing sim-command pipeline so KPIs update live.
 */
export function usePolicies(projectId: string | null | undefined): UsePoliciesResult {
  const { user } = useAuth();
  const [defaults, setDefaults] = useState<PolicyBundle>(DEFAULT_BUNDLE);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fulfillmentStrategy, setFulfillmentStrategy] = useState<FulfillmentStrategy>("make_to_stock");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [presetAppliedAt, setPresetAppliedAt] = useState<Date | null>(null);
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [currentHash, setCurrentHash] = useState<string | null>(null);

  const refreshCurrentHash = useCallback(async () => {
    if (!projectId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data, error } = await sb.rpc("current_policy_hash", { p_project_id: projectId });
    if (error) {
      console.error("current_policy_hash failed", error);
      return;
    }
    setCurrentHash((data as string | null) ?? null);
  }, [projectId]);

  const dispatchSim = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!projectId) return;
      try {
        await supabase.functions.invoke("sim-command", {
          body: {
            project_id: projectId,
            kind: "policy.changed",
            payload,
            client_ts: Date.now(),
          },
        });
      } catch (err) {
        console.error("policy sim-command failed", err);
      }
    },
    [projectId],
  );

  // initial load
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [defRes, ovRes] = await Promise.all([
        sb.from("policy_defaults").select("*").eq("project_id", projectId).maybeSingle(),
        sb.from("policy_overrides").select("*").eq("project_id", projectId),
      ]);
      if (cancelled) return;
      if (defRes.data) {
        setDefaults({
          sourcing: parseFamily("sourcing", defRes.data.sourcing),
          inventory: parseFamily("inventory", defRes.data.inventory),
          transport: parseFamily("transport", defRes.data.transport),
          fulfillment: parseFamily("fulfillment", defRes.data.fulfillment),
          production: parseFamily("production", defRes.data.production),
          recovery: parseFamily("recovery", defRes.data.recovery),
          demand: parseFamily("demand", defRes.data.demand),
        });
        if (defRes.data.fulfillment_strategy) {
          setFulfillmentStrategy(defRes.data.fulfillment_strategy as FulfillmentStrategy);
        }
        setActivePreset((defRes.data.active_preset as string | null) ?? null);
        setPresetAppliedAt(
          defRes.data.preset_applied_at ? new Date(defRes.data.preset_applied_at) : null,
        );
      } else {
        setDefaults(DEFAULT_BUNDLE);
      }
      setOverrides((ovRes.data ?? []) as OverrideRow[]);
      setLoading(false);
      void refreshCurrentHash();
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshCurrentHash]);

  // realtime
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`policies:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "policy_defaults", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Record<string, unknown> | null;
          if (!row) return;
          setDefaults({
            sourcing: parseFamily("sourcing", row.sourcing),
            inventory: parseFamily("inventory", row.inventory),
            transport: parseFamily("transport", row.transport),
            fulfillment: parseFamily("fulfillment", row.fulfillment),
            production: parseFamily("production", row.production),
            recovery: parseFamily("recovery", row.recovery),
            demand: parseFamily("demand", row.demand),
          });
          void refreshCurrentHash();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "policy_overrides", filter: `project_id=eq.${projectId}` },
        (payload) => {
          setOverrides((prev) => {
            const next = [...prev];
            const row = payload.new as OverrideRow | undefined;
            const old = payload.old as { id?: string } | undefined;
            const idx = next.findIndex(
              (r) => row && r.scope === row.scope && r.target_key === row.target_key && r.family === row.family,
            );
            if (payload.eventType === "DELETE" && old) {
              return next.filter(
                (r) =>
                  !(
                    "id" in r &&
                    (r as unknown as { id: string }).id === old.id
                  ),
              );
            }
            if (!row) return next;
            if (idx >= 0) next[idx] = row;
            else next.push(row);
            return next;
          });
          void refreshCurrentHash();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, refreshCurrentHash]);

  const saveDefault = useCallback(
    async <F extends PolicyFamily>(family: F, value: PolicyBundle[F]) => {
      if (!projectId) return;
      // optimistic
      setDefaults((prev) => ({ ...prev, [family]: value }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { error } = await sb.rpc("save_policy_defaults", {
        p_project_id: projectId,
        p_family: family,
        p_value: value,
      });
      if (error) {
        console.error("saveDefault failed", error);
        toast.error(`Save failed: ${error.message ?? error}`);
        throw error;
      }
      await dispatchSim({ family, scope: "default", patch: value });
      void refreshCurrentHash();
    },
    [projectId, dispatchSim, refreshCurrentHash],
  );

  const upsertOverride = useCallback(
    async (row: OverrideRow) => {
      if (!projectId) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { error } = await sb.rpc("bulk_upsert_policy_overrides", {
        p_project_id: projectId,
        p_rows: JSON.stringify([{ scope: row.scope, target_key: row.target_key, family: row.family, patch: row.patch }]),
      });
      if (error) {
        console.error("upsertOverride failed", error);
        toast.error(`Save failed: ${error.message ?? error}`);
        throw error;
      }
      await dispatchSim({
        family: row.family,
        scope: row.scope,
        target_key: row.target_key,
        patch: row.patch,
      });
      void refreshCurrentHash();
    },
    [projectId, dispatchSim, refreshCurrentHash],
  );

  const bulkUpsertOverrides = useCallback(
    async (rows: OverrideRow[]) => {
      if (!projectId || rows.length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const payload = rows.map((r) => ({
        scope: r.scope,
        target_key: r.target_key,
        family: r.family,
        patch: r.patch,
      }));
      const { error } = await sb.rpc("bulk_upsert_policy_overrides", {
        p_project_id: projectId,
        p_rows: payload,
      });
      if (error) {
        console.error("bulkUpsertOverrides failed", error);
        toast.error(`Save failed: ${error.message ?? error}`);
        throw error;
      }
      // one sim command per family
      const byFamily = new Map<PolicyFamily, OverrideRow[]>();
      for (const r of rows) {
        const list = byFamily.get(r.family) ?? [];
        list.push(r);
        byFamily.set(r.family, list);
      }
      await Promise.all(
        Array.from(byFamily.entries()).map(([family, list]) =>
          dispatchSim({
            family,
            scope: "bulk",
            target_keys: list.map((r) => r.target_key),
            patch: list[0]?.patch,
          }),
        ),
      );
      void refreshCurrentHash();
    },
    [projectId, dispatchSim, refreshCurrentHash],
  );

  const deleteOverride = useCallback(
    async (scope: "node" | "edge", targetKey: string, family: PolicyFamily) => {
      if (!projectId) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { error } = await sb.rpc("delete_policy_override", {
        p_project_id: projectId,
        p_scope: scope,
        p_target_key: targetKey,
        p_family: family,
      });
      if (error) {
        console.error("deleteOverride failed", error);
        return;
      }
      await dispatchSim({ family, scope, target_key: targetKey, patch: {} });
      void refreshCurrentHash();
    },
    [projectId, dispatchSim, refreshCurrentHash],
  );

  const saveStrategy = useCallback(
    async (strategy: FulfillmentStrategy) => {
      if (!projectId) return;
      setFulfillmentStrategy(strategy);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { error } = await sb.rpc("save_policy_defaults", {
        p_project_id: projectId,
        p_family: "fulfillment",
        p_value: defaults.fulfillment,
        p_strategy: strategy,
      });
      if (error) {
        console.error("saveStrategy failed", error);
        return;
      }
      await dispatchSim({ family: "fulfillment", scope: "strategy", patch: { strategy } });
      void refreshCurrentHash();
    },
    [projectId, defaults.fulfillment, dispatchSim, refreshCurrentHash],
  );

  const applyResolvedPreset = useCallback(
    async (slug: string, families: PolicyFamily[], bundle: PolicyBundle) => {
      if (!projectId) return;
      const appliedAt = new Date();
      setDefaults((prev) => {
        const next = { ...prev };
        for (const f of families) {
          (next as Record<string, unknown>)[f] = bundle[f];
        }
        return next;
      });
      setActivePreset(slug);
      setPresetAppliedAt(appliedAt);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const familyResults = await Promise.all(
        families.map((f) =>
          sb.rpc("save_policy_defaults", {
            p_project_id: projectId,
            p_family: f,
            p_value: bundle[f],
          }),
        ),
      );
      const familyError = familyResults.find((r: { error: unknown }) => r.error)?.error;
      if (familyError) {
        console.error("applyResolvedPreset failed", familyError);
        return;
      }
      const { error } = await sb.rpc("save_policy_defaults", {
        p_project_id: projectId,
        p_family: families[0],
        p_value: bundle[families[0]],
        p_active_preset: slug,
        p_preset_applied_at: appliedAt.toISOString(),
      });
      if (error) {
        console.error("applyResolvedPreset (preset) failed", error);
        return;
      }
      await Promise.all(
        families.map((family) =>
          dispatchSim({ family, scope: "preset", preset: slug, patch: bundle[family] }),
        ),
      );
      void refreshCurrentHash();
    },
    [projectId, dispatchSim, refreshCurrentHash],
  );

  const clearActivePreset = useCallback(async () => {
    if (!projectId) return;
    setActivePreset(null);
    setPresetAppliedAt(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.rpc("clear_policy_preset", { p_project_id: projectId });
    if (error) console.error("clearActivePreset failed", error);
  }, [projectId]);

  const refreshVersions = useCallback(async () => {
    if (!projectId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Prefer the RPC (works around RLS quirks); fall back to a direct select.
    const { data: rpcData, error: rpcErr } = await sb.rpc("list_policy_versions", {
      p_project_id: projectId,
    });
    if (!rpcErr && rpcData) {
      setVersions(rpcData as PolicyVersion[]);
      return;
    }
    const { data, error } = await sb
      .from("policy_versions")
      .select("id,label,author_email,author_name,parent_version_id,policy_hash,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("refreshVersions failed", error);
      return;
    }
    setVersions((data ?? []) as PolicyVersion[]);
  }, [projectId]);

  useEffect(() => {
    void refreshVersions();
  }, [refreshVersions]);

  const saveSnapshot = useCallback(
    async (label?: string): Promise<string | null> => {
      if (!projectId) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error } = await sb.rpc("snapshot_policy", {
        p_project_id: projectId,
        p_label: label ?? null,
        p_user_id: user?.id ?? null,
        p_user_email: user?.email ?? null,
        p_user_name: user?.display_name ?? user?.name ?? null,
        p_parent_version_id: selectedVersionId,
      });
      if (error) {
        console.error("saveSnapshot failed", error);
        toast.error(`Snapshot failed: ${error.message ?? error}`);
        return null;
      }
      toast.success("Simulation model version saved");
      const newId = data as string;
      setSelectedVersionId(newId);
      void refreshVersions();
      void refreshCurrentHash();
      return newId;
    },
    [projectId, user, selectedVersionId, refreshVersions, refreshCurrentHash],
  );

  const restoreVersion = useCallback(
    async (versionId: string) => {
      if (!projectId) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { error } = await sb.rpc("restore_policy_version", { p_version_id: versionId });
      if (error) {
        console.error("restoreVersion failed", error);
        toast.error(`Load failed: ${error.message ?? error}`);
        return;
      }
      setSelectedVersionId(versionId);
      toast.success("Model version loaded");
      // Trigger a reload of defaults via the existing realtime channel; also refetch immediately.
      const { data } = await sb
        .from("policy_defaults")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle();
      if (data) {
        setDefaults({
          sourcing: parseFamily("sourcing", data.sourcing),
          inventory: parseFamily("inventory", data.inventory),
          transport: parseFamily("transport", data.transport),
          fulfillment: parseFamily("fulfillment", data.fulfillment),
          production: parseFamily("production", data.production),
          recovery: parseFamily("recovery", data.recovery),
          demand: parseFamily("demand", data.demand),
        });
      }
      const { data: ovData } = await sb
        .from("policy_overrides")
        .select("*")
        .eq("project_id", projectId);
      setOverrides((ovData ?? []) as OverrideRow[]);
      void refreshCurrentHash();
    },
    [projectId, refreshCurrentHash],
  );

  const selectedVersion = versions.find((v) => v.id === selectedVersionId) ?? null;
  const isDirty =
    !selectedVersion ||
    !selectedVersion.policy_hash ||
    !currentHash ||
    selectedVersion.policy_hash !== currentHash;

  return {
    defaults,
    overrides,
    loading,
    fulfillmentStrategy,
    activePreset,
    presetAppliedAt,
    versions,
    currentHash,
    isDirty,
    selectedVersionId,
    setSelectedVersionId,
    refreshVersions,
    restoreVersion,
    saveDefault,
    saveStrategy,
    applyResolvedPreset,
    clearActivePreset,
    upsertOverride,
    bulkUpsertOverrides,
    deleteOverride,
    saveSnapshot,
  };
}
