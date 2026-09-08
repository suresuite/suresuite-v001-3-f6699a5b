import { cn } from "@/lib/utils";
import { DIALOG_AS_SHEET } from "@/components/shared";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { PolicyBundle, PolicyFamily } from "@/lib/policies/schemas";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  family: PolicyFamily;
  defaults: PolicyBundle;
  targetKeys: string[];
  scope: "node" | "edge";
  onApply: (patch: Record<string, unknown>) => Promise<void>;
}

/**
 * Lets the user enter a sparse patch (any subset of fields) to apply to all
 * selected rows. Empty fields are skipped so the override stays sparse.
 */
export function BulkEditDialog({ open, onOpenChange, family, defaults, targetKeys, onApply }: Props) {
  const [patch, setPatch] = useState<Record<string, string>>({});
  const base = defaults[family] as Record<string, unknown>;
  const fields = Object.keys(base).filter((k) => {
    const v = base[k];
    return v === null || typeof v !== "object";
  });

  const handleApply = async () => {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === "" || v === undefined) continue;
      const baseVal = base[k];
      if (typeof baseVal === "number") {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) cleaned[k] = n;
      } else if (typeof baseVal === "boolean") {
        cleaned[k] = v === "true";
      } else {
        cleaned[k] = v;
      }
    }
    await onApply(cleaned);
    setPatch({});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(DIALOG_AS_SHEET, "md:max-w-lg")}>
        <DialogHeader>
          <DialogTitle>Bulk edit · {family}</DialogTitle>
          <DialogDescription>
            Apply a patch to {targetKeys.length} selected row{targetKeys.length === 1 ? "" : "s"}.
            Leave a field blank to leave it unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2 max-h-72 overflow-auto">
          {fields.map((k) => (
            <div key={k} className="flex flex-col gap-1">
              <Label className="text-xs">{k}</Label>
              <Input
                placeholder={String(base[k] ?? "")}
                value={patch[k] ?? ""}
                onChange={(e) => setPatch((p) => ({ ...p, [k]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleApply}>Apply to {targetKeys.length}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
