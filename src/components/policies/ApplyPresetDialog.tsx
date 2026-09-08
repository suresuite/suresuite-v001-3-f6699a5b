import { cn } from "@/lib/utils";
import { DIALOG_AS_SHEET } from "@/components/shared";
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, ArrowRight, AlertTriangle } from "lucide-react";
import { diffBundles, resolvePreset, type ProjectContext, type ResolvedPreset } from "@/lib/policies/resolvePreset";
import { FIELD_LABELS, type PolicyBundle, type PolicyFamily } from "@/lib/policies/schemas";
import { strategyWarning } from "@/lib/policies/strategyGating";
import type { PresetDefinition } from "@/lib/policies/resolvePreset";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset: PresetDefinition | null;
  ctx: ProjectContext | null;
  currentBundle: PolicyBundle;
  onApply: (
    resolved: ResolvedPreset,
    selectedFamilies: PolicyFamily[],
  ) => Promise<void> | void;
}

const FAMILY_LABEL: Record<PolicyFamily, string> = {
  sourcing: "Sourcing",
  inventory: "Inventory",
  transport: "Transport",
  fulfillment: "Fulfillment",
  production: "Production",
  recovery: "Recovery",
  demand: "Demand",
};

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ApplyPresetDialog({ open, onOpenChange, preset, ctx, currentBundle, onApply }: Props) {
  const resolved = useMemo<ResolvedPreset | null>(() => {
    if (!preset || !ctx) return null;
    return resolvePreset(preset, ctx);
  }, [preset, ctx]);

  const diffs = useMemo(() => {
    if (!resolved) return [];
    return diffBundles(currentBundle, resolved);
  }, [resolved, currentBundle]);

  const familiesInDiff = useMemo(
    () => Array.from(new Set(diffs.map((d) => d.family))),
    [diffs],
  );

  const [selected, setSelected] = useState<Set<PolicyFamily>>(new Set(familiesInDiff));

  // reset when preset changes
  useMemo(() => {
    setSelected(new Set(familiesInDiff));
  }, [familiesInDiff.join(",")]);

  const warning = preset && ctx ? strategyWarning(ctx.fulfillment_strategy, preset.slug) : null;

  const apply = async () => {
    if (!resolved) return;
    await onApply(resolved, Array.from(selected));
    onOpenChange(false);
  };

  if (!preset) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(DIALOG_AS_SHEET, "md:max-w-3xl")}>
        <DialogHeader>
          <DialogTitle>Apply preset: {preset.name}</DialogTitle>
          <DialogDescription>
            {preset.description} Review every change below — uncheck any family you want to keep unchanged.
          </DialogDescription>
        </DialogHeader>

        {warning && (
          <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
            <span>{warning}</span>
          </div>
        )}

        {!ctx && (
          <div className="text-xs text-muted-foreground">
            Project context not loaded — values shown are schema defaults.
          </div>
        )}

        <ScrollArea className="max-h-[55vh] pr-3">
          <div className="flex flex-col gap-3">
            {familiesInDiff.length === 0 && (
              <p className="text-sm text-muted-foreground">No changes — current settings already match this preset.</p>
            )}
            {familiesInDiff.map((family) => {
              const familyDiffs = diffs.filter((d) => d.family === family);
              const isSelected = selected.has(family);
              return (
                <div key={family} className="rounded-md border p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(c) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (c) next.add(family);
                          else next.delete(family);
                          return next;
                        });
                      }}
                    />
                    <span className="font-medium text-sm">{FAMILY_LABEL[family]}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {familyDiffs.length} change{familyDiffs.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <TooltipProvider>
                    <div className="grid grid-cols-1 gap-1.5">
                      {familyDiffs.map((d) => (
                        <div
                          key={`${d.family}.${d.field}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 text-xs"
                        >
                          <span className="text-muted-foreground truncate">
                            {FIELD_LABELS[d.field] ?? d.field}
                          </span>
                          <span className="font-mono text-muted-foreground line-through">{fmt(d.before)}</span>
                          <span className="flex items-center gap-1 font-mono">
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <span className="font-semibold">{fmt(d.after)}</span>
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">{d.why}</TooltipContent>
                          </Tooltip>
                        </div>
                      ))}
                    </div>
                  </TooltipProvider>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={selected.size === 0}>
            Apply {selected.size} of {familiesInDiff.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
