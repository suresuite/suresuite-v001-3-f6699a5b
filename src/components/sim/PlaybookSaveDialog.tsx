import { useState } from "react";
import { cn } from "@/lib/utils";
import { DIALOG_AS_SHEET } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogFooter, ResponsiveDialogHeader, ResponsiveDialogTitle } from "@/components/shared/ResponsiveDialog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultName?: string;
  onSave: (name: string, description: string) => Promise<void> | void;
}

export function PlaybookSaveDialog({ open, onOpenChange, defaultName = "", onSave }: Props) {
  const [name, setName] = useState(defaultName);
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      {/* §2.6/§4.4 — a centred dialog is the wrong container on a phone.
          DIALOG_AS_SHEET gates its own height cap and scroll behind `md:` so
          the desktop dialog keeps the primitive's geometry exactly. */}
      <ResponsiveDialogContent className={cn(DIALOG_AS_SHEET, "sm:max-w-md md:max-w-md")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="text-base">Save recovery playbook</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Saves the current recovery settings as a reusable playbook for this project.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hurricane response v2"
              className="h-9 min-h-11 md:min-h-0"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description (optional)</Label>
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="When to use this playbook, trade-offs…"
              rows={3}
            />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(name.trim(), desc.trim());
                setName("");
                setDesc("");
                onOpenChange(false);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save playbook"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
