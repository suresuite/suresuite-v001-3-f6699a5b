// How long a run keeps its weekly series, and the editor's Keep / Release.
// Phase 10 / WP 10.6 · §4 D246 · blueprint §9.2, §11.6.
//
// Every figure is a column of the run (`retention`, `series_expires_at`,
// `series_bytes`, `series_expired_at`, `run_key`); an expired run says what was
// removed and what reproduces it (T1).
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjectRights } from "@/hooks/useProjectRights";
import type { SimulationRun } from "@/hooks/useSimulationRun";
import { retentionText } from "@/lib/sim/runSeries";

export function RunRetentionLine({ run, onChanged }: { run: SimulationRun; onChanged?: () => void }) {
  const { user } = useAuth();
  const rights = useProjectRights(run.project_id);
  const [busy, setBusy] = useState(false);
  const text = retentionText(run);
  if (!text) return null;
  // The RPC enforces editor/owner; the button is offered to those who edit.
  const canPin = rights.can("data_edit_policies") && !run.series_expired_at && run.retention !== "evidence";
  const next = run.retention === "pinned" ? "standard" : "pinned";
  const set = async () => {
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("set_run_retention", {
        p_run_id: run.id,
        p_retention: next,
        _actor_user_id: user?.id ?? null,
      });
      if (error) throw new Error(error.message ?? String(error));
      toast.success(next === "pinned" ? "Series pinned — kept until released." : "Series released to standard retention.");
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-sm border border-[--hair-rule] bg-white px-3 py-[7px] text-[12px] text-[#52525b]"
      data-testid="run-retention"
    >
      <span className="min-w-0 flex-1 [text-wrap:pretty]">{text}</span>
      {canPin ? (
        <button
          type="button"
          onClick={set}
          disabled={busy}
          className="min-h-11 rounded-sm border border-[--hair-rule] px-2.5 text-[12px] text-[#18181b] hover:bg-[#fafafa] md:min-h-0 md:py-[3px]"
        >
          {run.retention === "pinned" ? "Release" : "Keep series"}
        </button>
      ) : null}
    </div>
  );
}
