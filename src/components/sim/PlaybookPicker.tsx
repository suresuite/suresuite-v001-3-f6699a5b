import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bookmark, Save, RotateCcw, Trash2 } from "lucide-react";
import type { RecoveryPlaybook } from "@/hooks/useRecoveryPlaybooks";
import { PlaybookSaveDialog } from "./PlaybookSaveDialog";

interface Props {
  playbooks: RecoveryPlaybook[];
  selectedId: string | null;
  /** True when the current scenario recovery differs from the linked playbook config. */
  modified: boolean;
  onSelect: (playbook: RecoveryPlaybook | null) => void;
  onSaveAs: (name: string, description: string) => Promise<void> | void;
  onSaveChanges?: () => Promise<void> | void;
  onResetToPlaybook?: () => void;
  onDelete?: (id: string) => Promise<void> | void;
  canEditSelected?: boolean;
}

export function PlaybookPicker({
  playbooks,
  selectedId,
  modified,
  onSelect,
  onSaveAs,
  onSaveChanges,
  onResetToPlaybook,
  onDelete,
  canEditSelected,
}: Props) {
  const [saveOpen, setSaveOpen] = useState(false);
  const system = useMemo(() => playbooks.filter((p) => p.is_system), [playbooks]);
  const project = useMemo(() => playbooks.filter((p) => !p.is_system), [playbooks]);
  const selected = playbooks.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={selectedId ?? "__none"}
        onValueChange={(v) => {
          if (v === "__none") onSelect(null);
          else onSelect(playbooks.find((p) => p.id === v) ?? null);
        }}
      >
        {/* §2.4/G3 Case B: full width below `md`, the 220px literal at `md`. */}
        <SelectTrigger className="h-8 min-h-11 w-full min-w-0 text-xs md:min-h-0 md:w-[220px]">
          <SelectValue placeholder="Choose a playbook…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none" className="min-h-11 md:min-h-0">
            — Custom (no playbook) —
          </SelectItem>
          {system.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-[10px] uppercase tracking-wider">System</SelectLabel>
              {system.map((p) => (
                <SelectItem key={p.id} value={p.id} className="min-h-11 text-xs md:min-h-0">
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {project.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-[10px] uppercase tracking-wider">Project</SelectLabel>
              {project.map((p) => (
                <SelectItem key={p.id} value={p.id} className="min-h-11 text-xs md:min-h-0">
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>

      {selected && modified && (
        <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
          Modified from {selected.name}
        </Badge>
      )}

      {selected && modified && onResetToPlaybook && (
        <Button size="sm" variant="ghost" className="h-7 min-h-11 gap-1 text-xs md:min-h-0" onClick={onResetToPlaybook}>
          <RotateCcw className="h-3 w-3" /> Reset
        </Button>
      )}

      {selected && modified && canEditSelected && onSaveChanges && (
        <Button size="sm" variant="outline" className="h-7 min-h-11 gap-1 text-xs md:min-h-0" onClick={() => void onSaveChanges()}>
          <Save className="h-3 w-3" /> Save changes
        </Button>
      )}

      <Button
        size="sm"
        variant="outline"
        className="h-7 min-h-11 gap-1 text-xs md:min-h-0"
        onClick={() => setSaveOpen(true)}
      >
        <Bookmark className="h-3 w-3" /> Save as new
      </Button>

      {selected && canEditSelected && onDelete && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 min-h-11 min-w-11 gap-1 text-xs text-destructive hover:text-destructive md:min-h-0 md:min-w-0"
          onClick={() => void onDelete(selected.id)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}

      <PlaybookSaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        defaultName={selected ? `${selected.name} (copy)` : ""}
        onSave={onSaveAs}
      />
    </div>
  );
}
