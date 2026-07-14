import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * File-workspace client hooks — v1.2 Phase 3 (ai-agents.md §16.2).
 *
 * Reads flow through the owner-scoped `list_user_files` RPC (which performs
 * the lazy retention sweep — an expired unretained file never appears);
 * Keep rides `set_file_retained` (the 500 MB cap is enforced in SQL and
 * surfaces here as a typed failure); downloads go through the report-render
 * function's `download` action, which mints a 60-minute signed URL after an
 * ownership check — the client never touches the bucket directly (no public
 * bucket, no unsigned URLs).
 */

export interface UserFile {
  id: string;
  org_id: string | null;
  user_id: string;
  project_id: string | null;
  proposal_id: string | null;
  kind: "report_xlsx" | "report_pdf" | "export_csv" | "upload";
  name: string;
  path: string;
  size_bytes: number;
  retained: boolean;
  expires_at: string;
  created_at: string;
}

/** Client visibility flag mirroring the server flag FILE_WORKSPACE_ENABLED
 * (the §9/Q29h convention; both default off ⇒ no workspace surfaces render
 * and Phase 2 behavior is untouched. The server enforces regardless). */
export function fileWorkspaceUiEnabled(): boolean {
  return import.meta.env.VITE_FILE_WORKSPACE_ENABLED === "true";
}

/** §16.2: the expiry warning surfaces at T-3 days (§10 Q25 DEFAULT). */
export const EXPIRY_WARNING_DAYS = 3;

export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function expiryCountdown(expiresAt: string): string {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `expires in ${days}d`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `expires in ${hours}h`;
}

export function expiresWithinDays(file: Pick<UserFile, "retained" | "expires_at">, days: number): boolean {
  if (file.retained) return false;
  const ms = Date.parse(file.expires_at) - Date.now();
  return Number.isFinite(ms) && ms > 0 && ms <= days * 86_400_000;
}

// The user_files table/RPCs postdate the generated supabase types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface UserFilesApi {
  files: UserFile[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Keep toggle — returns the typed failure message (e.g. the 500 MB
   * retained cap) or null on success. */
  keep: (fileId: string, retained: boolean) => Promise<string | null>;
  /** Opens a 60-minute signed URL in a new tab; returns an error or null. */
  download: (fileId: string) => Promise<string | null>;
  remove: (fileId: string) => Promise<string | null>;
}

/** Files owned by the current user; `projectId` filters to one project,
 * null lists everything (the "All projects" scope). */
export function useUserFiles(projectId: string | null): UserFilesApi {
  const { user } = useAuth();
  const [files, setFiles] = useState<UserFile[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setFiles([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await db.rpc("list_user_files", {
        p_user_id: user.id,
        p_project_id: projectId,
      });
      if (!error && Array.isArray(data)) setFiles(data as UserFile[]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const keep = useCallback(async (fileId: string, retained: boolean): Promise<string | null> => {
    const { error } = await db.rpc("set_file_retained", {
      p_file_id: fileId,
      p_user_id: user?.id ?? null,
      p_retained: retained,
    });
    await refresh();
    return error ? error.message ?? "Keep failed." : null;
  }, [user?.id, refresh]);

  const download = useCallback(async (fileId: string): Promise<string | null> => {
    try {
      const { data, error } = await db.functions.invoke("report-render", {
        body: { action: "download", fileId, userId: user?.id },
      });
      if (error) return error.message ?? "Download failed.";
      if (data?.error) return String(data.error);
      if (typeof data?.url === "string") {
        window.open(data.url, "_blank", "noopener");
        return null;
      }
      return "Download failed — no URL returned.";
    } catch (e) {
      return e instanceof Error ? e.message : "Download failed.";
    }
  }, [user?.id]);

  const remove = useCallback(async (fileId: string): Promise<string | null> => {
    const { error } = await db.rpc("delete_user_file", {
      p_file_id: fileId,
      p_user_id: user?.id ?? null,
    });
    await refresh();
    return error ? error.message ?? "Delete failed." : null;
  }, [user?.id, refresh]);

  return { files, loading, refresh, keep, download, remove };
}
