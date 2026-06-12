interface KpiPayload {
  cards?: Array<{ label: string; value: string | number; hint?: string }>;
}

export function KpiCards({ data }: { data: unknown }) {
  const payload = (data ?? {}) as KpiPayload;
  const cards = payload.cards ?? [];
  if (cards.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {cards.map((c, i) => (
        <div key={i} className="rounded-md border border-border bg-card p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{c.label}</div>
          <div className="text-sm font-semibold text-foreground">{c.value}</div>
          {c.hint && <div className="text-[10px] text-muted-foreground">{c.hint}</div>}
        </div>
      ))}
    </div>
  );
}
