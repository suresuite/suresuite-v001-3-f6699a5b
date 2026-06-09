import { useMemo } from "react";
import { AlertTriangle, CalendarDays, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTimeUnit, type TimeUnit, UNIT_LABEL_PLURAL, DAYS_PER_UNIT } from "@/hooks/useTimeUnit";

interface Props {
  projectId: string | null | undefined;
  startDate?: string | null;
  endDate?: string | null;
}

const UNITS: TimeUnit[] = ["day", "week", "month"];

export function TimeUnitBar({ projectId, startDate, endDate }: Props) {
  const { unit, setUnit } = useTimeUnit(projectId);

  const horizon = useMemo(() => {
    if (!startDate || !endDate) return null;
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
    const days = Math.round((e - s) / 86_400_000);
    return days;
  }, [startDate, endDate]);

  // Calendar mapping: translate the project's start date into "Day 1 / Week 1 / Month 1".
  const mapping = useMemo(() => {
    if (!unit || !startDate) return null;
    const s = new Date(startDate);
    if (!Number.isFinite(s.getTime())) return null;
    const fmt = (d: Date) =>
      d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const span = DAYS_PER_UNIT[unit];
    const label = unit === "day" ? "Day" : unit === "week" ? "Week" : "Month";
    const period1End = new Date(s.getTime() + (span - 1) * 86_400_000);
    if (unit === "day") {
      return `${label} 1 = ${fmt(s)}`;
    }
    return `${label} 1 = ${fmt(s)} → ${fmt(period1End)} (${span} days each)`;
  }, [unit, startDate]);

  const unset = !unit;

  return (
    <div
      className={cn(
        "rounded-md border bg-card px-3 py-2.5 flex flex-wrap items-center gap-3",
        unset && "border-destructive bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-2">
        <Clock className={cn("h-4 w-4", unset ? "text-destructive" : "text-primary")} />
        <div className="flex flex-col">
          <span className={cn("text-xs font-semibold", unset && "text-destructive")}>
            Planning time unit{unset && " — required"}
          </span>
          <span className="text-[10px] text-muted-foreground">
            Drives column labels (days / weeks / months). Stored as days under the hood.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
        {UNITS.map((u) => (
          <Button
            key={u}
            size="sm"
            variant={unit === u ? "default" : "ghost"}
            className={cn(
              "h-7 px-3 text-xs capitalize",
              unset && unit !== u && "text-destructive hover:text-destructive",
            )}
            onClick={() => setUnit(u)}
          >
            {u}
          </Button>
        ))}
      </div>

      {horizon !== null && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          <span>
            Horizon: <b className="text-foreground">{horizon} days</b>
            {unit && unit !== "day" && (
              <>
                {" "}· <b className="text-foreground">
                  {(horizon / DAYS_PER_UNIT[unit]).toFixed(1)} {UNIT_LABEL_PLURAL[unit]}
                </b>
              </>
            )}
          </span>
        </div>
      )}

      {unset && (
        <Badge variant="destructive" className="h-5 ml-auto gap-1">
          <AlertTriangle className="h-3 w-3" />
          Pick a unit to unlock policies
        </Badge>
      )}

      {mapping && (
        <div className="basis-full flex items-center gap-1.5 text-[11px] text-muted-foreground border-t pt-2 mt-0.5">
          <CalendarDays className="h-3.5 w-3.5" />
          <span>{mapping}</span>
        </div>
      )}
    </div>
  );
}
