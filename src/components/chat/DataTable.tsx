interface TablePayload {
  columns?: string[];
  rows?: Array<Array<string | number | null>>;
}

export function DataTable({ data }: { data: unknown }) {
  const payload = (data ?? {}) as TablePayload;
  const columns = payload.columns ?? [];
  const rows = payload.rows ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            {columns.map((c, i) => (
              <th key={i} className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 25).map((row, r) => (
            <tr key={r} className="border-t border-border">
              {row.map((cell, c) => (
                <td key={c} className="px-2 py-1.5 text-foreground">
                  {cell ?? "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 25 && (
        <div className="px-2 py-1 text-[10px] text-muted-foreground">
          Showing 25 of {rows.length} rows
        </div>
      )}
    </div>
  );
}
