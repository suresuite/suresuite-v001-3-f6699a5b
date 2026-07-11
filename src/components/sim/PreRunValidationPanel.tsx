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
import { CheckCircle2, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FindingsList } from "@/components/policies/FindingsList";
import { fieldWalkToRoute } from "@/lib/policies/dataMap";
import type { Finding } from "@/lib/policies/validationService";

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
        <div key={mat} className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] w-32 truncate" title={mat}>{mat}</span>
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
                <SelectTrigger className="h-6 w-40 text-[10px]">
                  <SelectValue placeholder="Pick supplier…" />
                </SelectTrigger>
                <SelectContent>
                  {supplierIds.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-2 text-[10px]"
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
}: Props) {
  if (findings === null) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-[11px] text-muted-foreground">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/50 border-t-transparent" />
        Checking required data for this run…
      </div>
    );
  }

  const blocks = findings.filter((f) => f.severity === "block");
  const warns = findings.filter((f) => f.severity === "warn");

  if (findings.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">
        <ShieldCheck className="h-3.5 w-3.5" />
        Required-data gate: all clear — this configuration dispatches without findings.
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Required-data gate</span>
        <span className="text-[10px] text-muted-foreground">({source})</span>
        {blocks.length > 0 && (
          <Badge variant="destructive" className="h-5 text-[10px]">{blocks.length} blocking</Badge>
        )}
        {warns.length > 0 && (
          <Badge variant="secondary" className="h-5 text-[10px]">{warns.length} warning(s)</Badge>
        )}
      </div>
      <div className="p-2">
        <FindingsList
          findings={findings}
          groupBySeverity
          walkTo={(f) => (f.field ? fieldWalkToRoute(f.field, projectId) : null)}
          action={(f) =>
            f.severity === "block" && f.field === "materials.supplier_link" && f.rows?.length ? (
              <SupplierLinkFix
                projectId={projectId}
                materialIds={f.rows}
                supplierIds={supplierIds}
              />
            ) : null
          }
        />
      </div>
      {warns.length > 0 && (
        <label className="flex items-start gap-2 border-t px-3 py-2 cursor-pointer">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(v) => onAcknowledgedChange(v === true)}
            className="mt-0.5"
          />
          <span className="text-[11px]">
            <b>Acknowledge {warns.length} warning(s) and allow the run</b> — the engine applies its
            neutral defaults to the fields above; the affected KPIs will reflect placeholder
            economics until the data is filled in.
          </span>
        </label>
      )}
      {blocks.length > 0 && (
        <div className="border-t px-3 py-2 text-[11px] text-destructive">
          Blocking findings mirror engine hard failures and cannot be acknowledged — fix them
          above (or via the Project Manager links) to run.
        </div>
      )}
    </div>
  );
}
