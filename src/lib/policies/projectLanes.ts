// Single fetcher for the logistics/BOM lane rows the policies UI needs.
//
// WHY RPC-FIRST: the app authenticates via a custom RPC (no supabase.auth
// session — the client runs as `anon`), and the lane tables' original RLS
// policies gate on a session GUC that does not survive PostgREST connection
// pooling, so direct `.from()` reads silently return 0 rows until the
// `20260705000001_open_logistics_reads.sql` migration is applied.
// `get_project_datasets` is SECURITY DEFINER, takes the user explicitly, and
// is the exact path ProjectDataViewer uses — it provably returns the rows.
// Direct reads remain only as a fallback.
import { supabase } from "@/integrations/supabase/client";

export interface ProjectLanes {
  /** inbound_logistics rows (all columns). */
  inbound: Record<string, unknown>[];
  /** outbound_logistics rows (all columns). */
  outbound: Record<string, unknown>[];
  /** projects.bom_level — 'single' or 'multi'/'multi_level'. */
  bomLevel: string;
  /** BOM rows: single- or multi-level shape depending on bomLevel. */
  bom: Record<string, unknown>[];
}

const EMPTY: ProjectLanes = { inbound: [], outbound: [], bomLevel: "single", bom: [] };

async function fetchDirect(projectId: string): Promise<ProjectLanes> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [inQ, outQ, bomSingleQ, bomMultiQ] = await Promise.all([
    sb.from("inbound_logistics").select("*").eq("project_id", projectId).limit(10000),
    sb.from("outbound_logistics").select("*").eq("project_id", projectId).limit(10000),
    sb.from("bom_single_level").select("*").eq("project_id", projectId).limit(10000),
    sb.from("bom_multi_level").select("*").eq("project_id", projectId).limit(10000),
  ]);
  if (inQ.error) console.warn("[projectLanes] inbound_logistics read failed", inQ.error);
  if (outQ.error) console.warn("[projectLanes] outbound_logistics read failed", outQ.error);
  const multi = bomMultiQ.data ?? [];
  const single = bomSingleQ.data ?? [];
  return {
    inbound: inQ.data ?? [],
    outbound: outQ.data ?? [],
    bomLevel: multi.length > 0 ? "multi" : "single",
    bom: multi.length > 0 ? multi : single,
  };
}

export async function fetchProjectLanes(
  projectId: string | null | undefined,
  user: { id: string; email: string } | null | undefined,
): Promise<ProjectLanes> {
  if (!projectId) return EMPTY;
  if (user?.id && user?.email) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_project_datasets", {
        p_project_id: projectId,
        p_user_id: user.id,
        p_user_email: user.email,
      });
      if (error) throw error;
      const ds = (data ?? {}) as Record<string, unknown>;
      return {
        inbound: (ds.inbound as Record<string, unknown>[]) ?? [],
        outbound: (ds.outbound as Record<string, unknown>[]) ?? [],
        bomLevel: String(ds.bom_level ?? "single"),
        bom: (ds.bom as Record<string, unknown>[]) ?? [],
      };
    } catch (err) {
      console.warn("[projectLanes] get_project_datasets failed — falling back to direct reads", err);
    }
  }
  return fetchDirect(projectId);
}
