import { useState } from "react";
import { cn } from "@/lib/utils";
import { PART_TREATMENTS, TABLE_COLLAPSE_ROWS } from "@/lib/chat/partStyles";
import { SourceNote } from "./SourceNote";
import { FROZEN_CELL } from '@/components/shared';

interface TablePayload {
  columns?: string[];
  rows?: Array<Array<string | number | null>>;
}

/** §17.2 data card (table): surface card with the slate rail, its meta.tool
 * source note, and a collapse to TABLE_COLLAPSE_ROWS + "Show all N". */
export function DataTable({ data, sourceTool }: { data: unknown; sourceTool?: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const payload = (data ?? {}) as TablePayload;
  const columns = payload.columns ?? [];
  const rows = payload.rows ?? [];
  if (rows.length === 0) return null;

  const visible = showAll ? rows : rows.slice(0, TABLE_COLLAPSE_ROWS);

  return (
    <div className={cn("mt-2 overflow-hidden", PART_TREATMENTS.data.card)}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={cn(
                    'px-2 py-1.5 text-left font-medium text-muted-foreground',
                    i === 0 && `${FROZEN_CELL} bg-[hsl(var(--muted))] md:bg-transparent`,
                  )}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, r) => (
              <tr key={r} className="border-t border-border">
                {row.map((cell, c) => (
                  <td key={c} className={cn('px-2 py-1.5 text-foreground', c === 0 && FROZEN_CELL)}>
                    {cell ?? "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > TABLE_COLLAPSE_ROWS && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full border-t border-border px-2 py-1 text-left text-[11px] text-primary hover:underline"
        >
          Show all {rows.length}
        </button>
      )}
      <SourceNote tool={sourceTool} />
    </div>
  );
}
