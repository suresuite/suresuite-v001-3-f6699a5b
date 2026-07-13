import { cn } from "@/lib/utils";
import { PART_TREATMENTS } from "@/lib/chat/partStyles";
import { SourceNote } from "./SourceNote";

interface KpiPayload {
  cards?: Array<{ label: string; value: string | number; hint?: string }>;
}

/** §17.2 data card (KPIs): surface card with the slate rail + source note. */
export function KpiCards({ data, sourceTool }: { data: unknown; sourceTool?: string | null }) {
  const payload = (data ?? {}) as KpiPayload;
  const cards = payload.cards ?? [];
  if (cards.length === 0) return null;
  return (
    <div className={cn("mt-2 overflow-hidden", PART_TREATMENTS.data.card)}>
      <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3">
        {cards.map((c, i) => (
          <div key={i} className="rounded-md border border-border bg-background p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
            <div className="text-sm font-semibold text-foreground">{c.value}</div>
            {c.hint && <div className="text-[10px] text-muted-foreground">{c.hint}</div>}
          </div>
        ))}
      </div>
      <SourceNote tool={sourceTool} />
    </div>
  );
}
