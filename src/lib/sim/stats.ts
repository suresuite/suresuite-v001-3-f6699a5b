// Statistics helpers for the simulation lab — replication-level aggregation.
// Pure functions, browser-safe.

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

// Two-sided Student-t critical values for 95% CI, df 1..30, then z=1.96.
const T95: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
  8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145,
  15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086, 21: 2.08,
  22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06, 26: 2.056, 27: 2.052, 28: 2.048,
  29: 2.045, 30: 2.042,
};

export function tCritical95(df: number): number {
  if (df <= 0) return 0;
  if (df <= 30) return T95[df];
  return 1.96;
}

export function ciHalfWidth95(xs: number[]): number {
  if (xs.length < 2) return 0;
  return (tCritical95(xs.length - 1) * std(xs)) / Math.sqrt(xs.length);
}

export interface KpiStat {
  mean: number;
  std: number;
  ci95: number;
  min: number;
  max: number;
  n: number;
}

export function summarize(xs: number[]): KpiStat {
  if (xs.length === 0) {
    return { mean: 0, std: 0, ci95: 0, min: 0, max: 0, n: 0 };
  }
  return {
    mean: mean(xs),
    std: std(xs),
    ci95: ciHalfWidth95(xs),
    min: Math.min(...xs),
    max: Math.max(...xs),
    n: xs.length,
  };
}

/** Paired t-test (CRN-aware). Returns { t, df, pTwoSided } (p approximated). */
export function pairedT(a: number[], b: number[]): { t: number; df: number } {
  const n = Math.min(a.length, b.length);
  if (n < 2) return { t: 0, df: 0 };
  const diffs = a.slice(0, n).map((v, i) => v - b[i]);
  const m = mean(diffs);
  const s = std(diffs);
  if (s === 0) return { t: 0, df: n - 1 };
  return { t: m / (s / Math.sqrt(n)), df: n - 1 };
}
