// Lab-side surface of the §8.1 required-data gate (Phase B0 / G6 / §8.1–8.2).
//
// Renders the SAME findings the sim-command pre-dispatch gate computes —
// client-side via the shared grading module before dispatch, and the server's
// own typed copy after a 422 — so a rejection is never a concatenated toast.
// Warn-level findings carry the explicit acknowledgment control that maps to
// payload.acknowledge_warnings; block-level findings mirror engine hard
// failures and stay blocking. Where a remediation RPC exists
// (assign_material_supplier for the unsourced-BOM blocker) the fix is offered
// inline on the finding row.
import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FindingsPanel } from "./RunGate";
import { fieldWalkToRoute } from "@/lib/policies/dataMap";
import type { Finding } from "@/lib/policies/validationService";
import { FreshnessBadge } from "@/components/trust/FreshnessBadge";
import { TrustReportPanel } from "@/components/trust/TrustReportPanel";

interface Props {
  projectId: string;
  /** Typed gate findings (UI vocabulary); null while project data loads. */
  findings: Finding[] | null;
  /** Where the findings came from — the server copy wins after a 422. */
  source: "pre-run check" | "gate rejection";
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
  /** Known supplier ids — options for the assign-supplier one-click fix. */
  supplierIds: string[];
  /** Display name for the trust report's heading; falls back to the id. */
  projectName?: string;
}

/** Inline remediation for the unsourced-BOM blocker: one select + apply per
 *  missing material, calling the assign_material_supplier RPC (migration
 *  20260705000002) — the exact fix the /policies grid offers. */
function SupplierLinkFix({
  projectId,
  materialIds,
  supplierIds,
}: {
  projectId: string;
  materialIds: string[];
  supplierIds: string[];
}) {
  const { user } = useAuth();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState<string | null>(null);
  const [fixed, setFixed] = useState<Set<string>>(new Set());

  if (supplierIds.length === 0) {
    return (
      <div className="text-[10px] opacity-80 mt-1">
        No suppliers exist yet to assign — upload inbound logistics first.
      </div>
    );
  }

  const apply = async (materialId: string) => {
    const supplierId = chosen[materialId];
    if (!supplierId) return;
    setApplying(materialId);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("assign_material_supplier", {
        p_project_id: projectId,
        p_material_id: materialId,
        p_supplier_id: supplierId,
        p_user_id: user?.id ?? null,
        p_user_email: user?.email ?? null,
      });
      if (error) throw error;
      setFixed((cur) => new Set(cur).add(materialId));
      toast.success(`Supplier "${supplierId}" assigned to "${materialId}" — re-grading…`);
    } catch (e) {
      toast.error(`Assign failed: ${(e as Error).message ?? e}`);
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="flex flex-col gap-1 mt-1.5">
      {materialIds.map((mat) => (
        <div key={mat} className="flex flex-col items-stretch gap-1.5 md:flex-row md:items-center">
          <span className="font-mono text-[10px] w-full truncate md:w-32" title={mat}>{mat}</span>
          {fixed.has(mat) ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> supplier assigned
            </span>
          ) : (
            <>
              <Select
                value={chosen[mat] ?? ""}
                onValueChange={(v) => setChosen((c) => ({ ...c, [mat]: v }))}
              >
                <SelectTrigger className="h-6 min-h-11 w-full min-w-0 text-[10px] md:min-h-0 md:w-40">
                  <SelectValue placeholder="Pick supplier…" />
                </SelectTrigger>
                <SelectContent>
                  {supplierIds.map((s) => (
                    <SelectItem key={s} value={s} className="min-h-11 text-xs md:min-h-0">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-6 min-h-11 gap-1 px-2 text-[10px] md:min-h-0"
                disabled={!chosen[mat] || applying === mat}
                onClick={() => void apply(mat)}
              >
                <Wrench className="h-3 w-3" />
                {applying === mat ? "Assigning…" : "Assign"}
              </Button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function PreRunValidationPanel({
  projectId,
  findings,
  source,
  acknowledged,
  onAcknowledgedChange,
  supplierIds,
  projectName,
}: Props) {
  const [showTrust, setShowTrust] = useState(false);

  if (findings === null) {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-[--hair-rule] bg-white px-3 py-[10px] text-[12.5px] text-[#52525b]">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#d4d4d8] border-t-transparent" />
        Checking required data for this run…
      </div>
    );
  }

  const warns = findings.filter((f) => f.severity === "warn").length;

  return (
    <div className="space-y-3">
      {/* WP 4.4 · A3. The freshness badge answers "is what I am looking at
          current?" in one line; the report below answers "is this model built on
          good data?", limits first. Both are COMPUTED at read time — opening
          this panel writes nothing (§4 D70). */}
      <div className="flex items-center gap-2">
        <FreshnessBadge projectId={projectId} />
        <button
          type="button"
          onClick={() => setShowTrust((v) => !v)}
          className="text-[11.5px] text-[#52525b] underline-offset-2 hover:text-foreground hover:underline"
        >
          {showTrust ? "hide data trust report" : "data trust report"}
        </button>
      </div>
      {showTrust && (
        <TrustReportPanel
          projectId={projectId}
          projectName={projectName ?? projectId}
          findings={findings}
        />
      )}
    <FindingsPanel
      findings={findings}
      source={source}
      warns={warns}
      acknowledged={acknowledged}
      onAcknowledge={() => onAcknowledgedChange(!acknowledged)}
      renderFix={(finding) => {
        const route = finding.field ? fieldWalkToRoute(finding.field, projectId) : null;
        const supplierFix =
          finding.severity === "block" &&
          finding.field === "materials.supplier_link" &&
          finding.rows?.length ? (
            <SupplierLinkFix
              projectId={projectId}
              materialIds={finding.rows}
              supplierIds={supplierIds}
            />
          ) : null;
        if (!route && !supplierFix) return null;
        return (
          <>
            {supplierFix}
            {route && (
              <Link
                to={route}
                // §2.4: pad the hit area, negate the layout cost.
                className="-my-[13px] mt-[3px] inline-flex min-h-11 items-center py-[13px] text-[11.5px] text-[#52525b] underline-offset-2 hover:text-foreground hover:underline md:my-0 md:mt-[3px] md:inline-block md:min-h-0 md:py-0"
                title="Open the editor for this field in the Project Manager"
              >
                fix data ↗
              </Link>
            )}
          </>
        );
      }}
    />
    </div>
  );
}
