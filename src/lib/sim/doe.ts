// Design-of-experiments generators (browser-side preview).

export interface Factor {
  key: string;
  label: string;
  levels: (number | string)[];
}

export function fullFactorial(factors: Factor[]): Record<string, number | string>[] {
  if (factors.length === 0) return [];
  const out: Record<string, number | string>[] = [{}];
  for (const f of factors) {
    const next: Record<string, number | string>[] = [];
    for (const row of out) {
      for (const lvl of f.levels) next.push({ ...row, [f.key]: lvl });
    }
    out.length = 0;
    out.push(...next);
  }
  return out;
}

/** Latin hypercube on continuous numeric factors. */
export function latinHypercube(
  factors: Factor[],
  n: number,
): Record<string, number | string>[] {
  const rows: Record<string, number | string>[] = [];
  for (let i = 0; i < n; i++) rows.push({});
  for (const f of factors) {
    const nums = f.levels.filter((l) => typeof l === "number") as number[];
    if (nums.length >= 2) {
      const lo = Math.min(...nums);
      const hi = Math.max(...nums);
      const bins = Array.from({ length: n }, (_, i) => lo + ((i + Math.random()) / n) * (hi - lo));
      // shuffle
      for (let i = bins.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bins[i], bins[j]] = [bins[j], bins[i]];
      }
      rows.forEach((r, i) => (r[f.key] = +bins[i].toFixed(3)));
    } else {
      // categorical — sample uniformly
      rows.forEach((r) => (r[f.key] = f.levels[Math.floor(Math.random() * f.levels.length)]));
    }
  }
  return rows;
}
