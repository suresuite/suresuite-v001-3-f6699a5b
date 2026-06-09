import { Truck, Factory, Users, PlayCircle, ChevronRight } from "lucide-react";
import { STAGES, type StageKey } from "@/lib/policies/stages";
import type { ProjectContext } from "@/lib/policies/resolvePreset";
import type { OverrideRow } from "@/lib/policies/resolve";
import { cn } from "@/lib/utils";

const ICONS: Record<StageKey, typeof Factory> = {
  supplier: Truck,
  plant: Factory,
  customer: Users,
  run_validate: PlayCircle,
};

interface Props {
  active: StageKey;
  ctx: ProjectContext | null;
  overrides: OverrideRow[];
  hasData: boolean;
  onSelect: (s: StageKey) => void;
}

export function StageRail({ active, onSelect }: Props) {
  return (
    <div className="flex items-stretch gap-4 overflow-x-auto pb-2">
      {STAGES.map((stage, i) => {
        const Icon = ICONS[stage.key];
        const isActive = stage.key === active;
        return (
          <div key={stage.key} className="flex items-center gap-2 flex-1 min-w-[220px]">
            <button
              type="button"
              onClick={() => onSelect(stage.key)}
              className={cn(
                "relative flex items-center gap-5 rounded-lg border px-6 py-6 text-left transition-all flex-1 min-h-[112px]",
                isActive
                  ? "bg-primary text-primary-foreground border-primary shadow-lg scale-[1.02]"
                  : "bg-card hover:bg-muted/40 border-border",
              )}
            >
              <Icon className={cn("h-10 w-10 shrink-0", isActive ? "" : "text-muted-foreground")} />
              <div className="flex flex-col min-w-0 flex-1 gap-1">
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-widest font-semibold",
                    isActive ? "opacity-80" : "text-muted-foreground",
                  )}
                >
                  Stage {i + 1}
                </span>
                <span className="text-2xl font-bold leading-tight truncate tracking-tight">
                  {stage.title}
                </span>
              </div>
            </button>
            {i < STAGES.length - 1 && (
              <ChevronRight className="h-6 w-6 text-muted-foreground shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

