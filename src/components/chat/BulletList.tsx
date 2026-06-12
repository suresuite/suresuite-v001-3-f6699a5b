export function BulletList({ data }: { data: unknown }) {
  const items = Array.isArray(data) ? (data as unknown[]).map(String) : [];
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-foreground">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}
