import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { LAYER, tint } from "@/components/intelligence/piUi";
import * as XLSX from "xlsx";
import { StagePolicyTable } from "./StagePolicyTable";
import { PolicyDefaultsCard } from "./PolicyDefaultsCard";
import { ApplyPresetDialog } from "./ApplyPresetDialog";
import { PresetDiffBanner } from "./PresetDiffBanner";
import { RunValidateStage } from "./RunValidateStage";
import { getStage, type StageKey } from "@/lib/policies/stages";
import type { StageRowsQuery } from "@/hooks/useStageGuards";
import { getStagePresets } from "@/lib/policies/presets/stagePresets";
import type { OverrideRow } from "@/lib/policies/resolve";
import type { FulfillmentStrategy, PolicyBundle, PolicyFamily } from "@/lib/policies/schemas";
import type { PresetDefinition, ProjectContext, ResolvedPreset } from "@/lib/policies/resolvePreset";
import {
  downloadWorkbook,
  exportStageWorkbook,
  importStageWorkbook,
} from "@/lib/policies/excel";

interface Props {
  projectId: string | null | undefined;
  stageKey: StageKey;
  defaults: PolicyBundle;
  overrides: OverrideRow[];
  ctx: ProjectContext | null;
  hasData: boolean;
  fulfillmentStrategy: FulfillmentStrategy;
  activePreset: string | null;
  presetAppliedAt: Date | null;
  saveDefault: <F extends PolicyFamily>(family: F, value: PolicyBundle[F]) => Promise<void>;
  bulkUpsertOverrides: (rows: OverrideRow[]) => Promise<void>;
  deleteOverride?: (scope: "node" | "edge", targetKey: string, family: PolicyFamily) => Promise<void>;
  applyResolvedPreset: (slug: string, families: PolicyFamily[], bundle: PolicyBundle) => Promise<void>;
  clearActivePreset: () => Promise<void>;
  saveSnapshot: (label?: string) => Promise<string | null>;
  /** Policy-version context for the Run & Validate credibility card (§9.5). */
  selectedVersionId: string | null;
  policyDirty: boolean;
  /** Lines per setup stage, loaded once at the page level for the step track —
   *  the grid and stage 4's verification read them instead of refetching. */
  rowsByStage: Record<Exclude<StageKey, "run_validate">, StageRowsQuery>;
}

export function FocusedStage({
  projectId,
  stageKey,
  defaults,
  overrides,
  ctx,
  hasData,
  fulfillmentStrategy,
  activePreset,
  presetAppliedAt,
  saveDefault,
  bulkUpsertOverrides,
  deleteOverride,
  applyResolvedPreset,
  clearActivePreset,
  saveSnapshot,
  selectedVersionId,
  policyDirty,
  rowsByStage,
}: Props) {
  const stage = getStage(stageKey);
  const presets = useMemo(() => getStagePresets(stageKey), [stageKey]);
  const [presetDraft, setPresetDraft] = useState<PresetDefinition | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const stageOverrides = useMemo(
    () => overrides.filter((o) => stage.families.includes(o.family)),
    [overrides, stage],
  );

  const showBanner =
    activePreset != null &&
    !bannerDismissed &&
    activePreset.startsWith(`${stageKey}:`);

  const onApplyPreset = async (resolved: ResolvedPreset, families: PolicyFamily[]) => {
    const scoped = families.filter((f) => stage.families.includes(f));
    if (scoped.length === 0) {
      toast.warning("No changes for this stage.");
      return;
    }
    await applyResolvedPreset(resolved.slug, scoped, resolved.bundle);
    setBannerDismissed(false);
    toast.success(`Applied "${resolved.name}" to ${stage.title}`);
  };

  const handleExport = () => {
    const wb = exportStageWorkbook(stage.title, stage.families, defaults, stageOverrides);
    const ts = new Date().toISOString().slice(0, 10);
    downloadWorkbook(wb, `policies-${stage.key}-${ts}.xlsx`);
    toast.success("Exported workbook");
  };

  const handleImportFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const result = importStageWorkbook(wb, stage.families, defaults);
      if (result.errors.length) {
        toast.error(`Import had ${result.errors.length} error(s) — see console`);
        console.error("Excel import errors:", result.errors);
      }
      for (const f of stage.families) {
        const v = (result.defaultsPatch as Record<string, unknown>)[f];
        if (v) await saveDefault(f, v as PolicyBundle[typeof f]);
      }
      if (result.overrides.length) {
        await bulkUpsertOverrides(result.overrides);
      }
      toast.success(
        `Imported: ${Object.keys(result.defaultsPatch).length} default(s), ${result.overrides.length} override(s)`,
      );
    } catch (err) {
      console.error(err);
      toast.error("Failed to read workbook");
    }
  };

  const showNoData = !hasData && (!ctx || (ctx.supplier_count === 0 && ctx.customer_count === 0));

  if (stageKey === "run_validate") {
    return (
      <RunValidateStage
        projectId={projectId}
        plantName={ctx?.plant_name}
        defaults={defaults}
        overrides={overrides}
        fulfillmentStrategy={fulfillmentStrategy}
        saveSnapshot={saveSnapshot}
        selectedVersionId={selectedVersionId}
        policyDirty={policyDirty}
        supplierRows={rowsByStage.supplier.rows}
        plantRows={rowsByStage.plant.rows}
        customerRows={rowsByStage.customer.rows}
      />
    );
  }

  const tableLeftActions = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportFile(f);
          e.target.value = "";
        }}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-[26px] px-2.5 text-[11.5px]">
            Excel ▾
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleExport} className="text-[12px]">
            Export
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileRef.current?.click()} className="text-[12px]">
            Import
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-[26px] px-2.5 text-[11.5px]">
            Apply preset ▾
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[340px]">
          {presets.map((p) => (
            <DropdownMenuItem
              key={p.slug}
              onClick={() => setPresetDraft(p)}
              className="flex flex-col items-start gap-0.5 py-1.5"
            >
              <span className="text-[12px] font-medium">{p.name}</span>
              <span className="font-mono text-[10.5px] text-muted-foreground line-clamp-2">
                {p.description}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <div className="flex flex-col gap-2">
      {showNoData && (
        <div
          className="flex items-center gap-2 rounded-sm border px-2.5 py-1.5 font-mono text-[11px]"
          style={{ borderColor: tint(LAYER.brand, 0.4), color: LAYER.brand }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: LAYER.brand }} />
          no supply-chain data — upload and combine datasets in Data Manager
        </div>
      )}

      {showBanner && (
        <PresetDiffBanner
          presetName={activePreset!.replace(/^[^:]+:/, "")}
          appliedAt={presetAppliedAt}
          changeCount={stageOverrides.length}
          onRevert={() => {
            clearActivePreset();
            setBannerDismissed(true);
          }}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      <StagePolicyTable
        projectId={projectId}
        plantName={ctx?.plant_name}
        stageKey={stageKey}
        defaults={defaults}
        overrides={overrides}
        fulfillmentStrategy={fulfillmentStrategy}
        bulkUpsertOverrides={bulkUpsertOverrides}
        deleteOverride={deleteOverride}
        saveSnapshot={saveSnapshot}
        leftActions={tableLeftActions}
        stageRows={rowsByStage[stageKey]}
      />

      {/* Fulfillment (allocation, backorder, service level) is consumed by the
          engine at the PROJECT scope only (P-C.1/P-C.2), never per customer×product.
          So it is edited here as a project-wide default rather than a grid column —
          which is why the customer grid above no longer carries backorder/price cells. */}
      {stageKey === "customer" && (
        <PolicyDefaultsCard
          family="fulfillment"
          value={defaults.fulfillment}
          onSave={(v) => saveDefault("fulfillment", v as PolicyBundle["fulfillment"])}
        />
      )}

      <ApplyPresetDialog
        open={presetDraft != null}
        onOpenChange={(o) => !o && setPresetDraft(null)}
        preset={presetDraft}
        ctx={ctx}
        currentBundle={defaults}
        onApply={onApplyPreset}
      />
    </div>
  );
}
