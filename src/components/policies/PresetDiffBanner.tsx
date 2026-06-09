import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, X } from "lucide-react";

interface Props {
  presetName: string;
  appliedAt: Date | null;
  changeCount: number;
  onRevert: () => void;
  onDismiss: () => void;
}

export function PresetDiffBanner({ presetName, appliedAt, changeCount, onRevert, onDismiss }: Props) {
  return (
    <Card className="p-3 flex items-center gap-3 border-primary/40 bg-primary/5">
      <Sparkles className="h-4 w-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          Preset <span className="text-primary">{presetName}</span> applied
          {appliedAt && (
            <span className="text-muted-foreground font-normal text-xs ml-2">
              {appliedAt.toLocaleTimeString()}
            </span>
          )}
        </p>
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">{changeCount} fields</Badge>
          <span>Hover any "preset" chip in the cards below to see the derivation.</span>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onRevert}>
        Revert
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDismiss}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </Card>
  );
}
