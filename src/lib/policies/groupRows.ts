/**
 * Row-group collapse for StagePolicyTable — a material's suppliers, a plant's
 * products, a customer's product lanes. Rows arrive already sorted by key A;
 * this groups consecutive runs. A group of 1 is not collapsible.
 */
export interface RowGroup<T> {
  id: string;
  members: { row: T; index: number }[];
}

export function groupByKeyA<T extends { [k: string]: unknown }>(
  rows: T[],
  keyA: string,
): RowGroup<T>[] {
  const out: RowGroup<T>[] = [];
  rows.forEach((row, index) => {
    const id = String(row[keyA] ?? "");
    const last = out[out.length - 1];
    if (last && last.id === id) last.members.push({ row, index });
    else out.push({ id, members: [{ row, index }] });
  });
  return out;
}

export type AggKind = "int" | "num" | "toggle" | "type" | "vector" | "chip" | "text";

/**
 * Aggregate a value column across a group's members for the collapsed summary
 * row — and say which aggregate it is (§5.2): sum for integers, mean for
 * decimals, a primary count for the toggle column, distinct-count for enums.
 */
export function summarise(
  col: { kind: AggKind; dec?: number },
  values: unknown[],
): string {
  const nums = values
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((n) => Number.isFinite(n));
  switch (col.kind) {
    case "int": {
      if (nums.length === 0) return "—";
      const total = nums.reduce((a, b) => a + b, 0);
      return `Σ ${total.toLocaleString("en-US")}`;
    }
    case "num": {
      if (nums.length === 0) return "—";
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return `ø ${mean.toFixed(col.dec ?? 2)}`;
    }
    case "toggle": {
      const primaries = values.filter((v) => v === true).length;
      return `${primaries} / ${values.length} primary`;
    }
    case "type": {
      const distinct = new Set(values.map((v) => String(v ?? "")));
      if (distinct.size === 1) return String([...distinct][0]);
      return `${distinct.size} types`;
    }
    case "vector":
      return "per line";
    case "chip":
    case "text":
    default: {
      const distinct = new Set(values.map((v) => String(v ?? "")));
      if (distinct.size === 0) return "—";
      if (distinct.size === 1) return String([...distinct][0]);
      return "varies";
    }
  }
}
