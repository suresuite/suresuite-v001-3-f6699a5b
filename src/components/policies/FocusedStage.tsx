import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Download, Sparkles, Upload, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { StagePolicyTable } from "./StagePolicyTable";
import { ApplyPresetDialog } from "./ApplyPresetDialog";
import { PresetDiffBanner } from "./PresetDiffBanner";
import { RunValidateStage } from "./RunValidateStage";
import { getStage, type StageKey } from "@/lib/policies/stages";
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
  /** Version context for the Run & Validate Adopt step (B0b / §2.5). */
  selectedVersionId: string | null;
  isDirty: boolean;
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
  isDirty,
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
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2 flex-wrap pt-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold leading-tight tracking-tight">
              {stage.title}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">{stage.role}</p>
          </div>
        </div>

        <RunValidateStage
          projectId={projectId}
          plantName={ctx?.plant_name}
          defaults={defaults}
          overrides={overrides}
          fulfillmentStrategy={fulfillmentStrategy}
          saveSnapshot={saveSnapshot}
          selectedVersionId={selectedVersionId}
          isDirty={isDirty}
        />
      </div>
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
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
            Excel
            <ChevronDown className="h-3 w-3 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleExport}>
            <Download className="h-3.5 w-3.5 mr-2" /> Export
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-2" /> Import
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs">
            <Sparkles className="h-3 w-3" />
            Apply preset
            <ChevronDown className="h-3 w-3 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {presets.map((p) => (
            <DropdownMenuItem
              key={p.slug}
              onClick={() => setPresetDraft(p)}
              className="flex flex-col items-start gap-0.5 py-2"
            >
              <span className="font-medium text-sm">{p.name}</span>
              <span className="text-[11px] text-muted-foreground line-clamp-2">
                {p.description}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 flex-wrap pt-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold leading-tight tracking-tight">
            {stage.title} policies
          </h2>
          <p className="text-xs text-muted-foreground mt-1">{stage.role}</p>
        </div>
      </div>


      {showNoData && (
        <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs">
          <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
          <span>
            No supply-chain data yet — upload and combine datasets in <strong>Data Manager</strong>.
          </span>
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
      />

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
