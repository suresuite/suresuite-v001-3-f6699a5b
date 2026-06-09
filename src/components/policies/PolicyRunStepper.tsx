// Horizontal stepper used in the Run & Validate wizard.
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  id: string;
  label: string;
  description?: string;
}

interface Props {
  steps: Step[];
  current: number;
  completed: Set<number>;
  onJump?: (i: number) => void;
}

export function PolicyRunStepper({ steps, current, completed, onJump }: Props) {
  return (
    <ol className="flex items-center w-full gap-2">
      {steps.map((s, i) => {
        const isCurrent = i === current;
        const isDone = completed.has(i);
        const reachable = isDone || i === current || i < current;
        return (
          <li key={s.id} className="flex-1 flex items-center gap-2 min-w-0">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onJump?.(i)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md border w-full text-left transition-colors min-w-0",
                isCurrent && "border-primary bg-primary/5",
                !isCurrent && isDone && "border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10",
                !isCurrent && !isDone && "border-border bg-card",
                !reachable && "opacity-50 cursor-not-allowed",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  isCurrent && "bg-primary text-primary-foreground",
                  !isCurrent && isDone && "bg-emerald-500 text-white",
                  !isCurrent && !isDone && "bg-muted text-muted-foreground",
                )}
              >
                {isDone && !isCurrent ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-xs font-semibold truncate">{s.label}</span>
                {s.description && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    {s.description}
                  </span>
                )}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "h-px w-4 shrink-0",
                  isDone ? "bg-emerald-500/60" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
