import { cn } from "@/lib/utils";
import { PART_TREATMENTS } from "@/lib/chat/partStyles";
import { SourceNote } from "./SourceNote";

/** §17.2 data card (bullets): surface card with the slate rail + source note. */
export function BulletList({ data, sourceTool }: { data: unknown; sourceTool?: string | null }) {
  const items = Array.isArray(data) ? (data as unknown[]).map(String) : [];
  if (items.length === 0) return null;
  return (
    <div className={cn("mt-2 overflow-hidden", PART_TREATMENTS.data.card)}>
      <ul className="list-disc space-y-1 py-2 pl-7 pr-2 text-xs text-foreground">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
      <SourceNote tool={sourceTool} />
    </div>
  );
}
