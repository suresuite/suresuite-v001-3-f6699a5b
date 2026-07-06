// Real statistics for the /policies Run & Validate stage — computed from
// persisted run output (run_replications), never from synthetic previews.
// Phase A / G6 / §8.2 of docs/design/next-gen-platform-design.md.

/** Mean of a numeric array (0 for empty). */
const avg = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Sample variance (n-1 denominator). */
const variance = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
};

/** Element-wise mean across replications: series[rep][week] → mean[week]. */
export function crossRepMean(series: number[][]): number[] {
  const n = Math.min(...series.map((s) => s.length));
  if (!Number.isFinite(n) || n <= 0) return [];
  const out = new Array<number>(n);
  for (let t = 0; t < n; t++) {
    let s = 0;
    for (const rep of series) s += rep[t];
    out[t] = s / series.length;
  }
  return out;
}

/**
 * Welch's moving-average warm-up estimator (Welch 1983): smooth the cross-rep
 * mean with a centered window, then report the first index where the smoothed
 * curve stays within `tol` (relative) of the final steady-state level for the
 * rest of the horizon. Returns the warm-up index (weeks) or 0.
 */
export function welchWarmup(series: number[][], window = 5, tol = 0.02): number {
  const m = crossRepMean(series);
  if (m.length < window * 2 + 2) return 0;
  const half = Math.floor(window / 2);
  const smooth: number[] = [];
  for (let t = 0; t < m.length; t++) {
    const lo = Math.max(0, t - half);
    const hi = Math.min(m.length - 1, t + half);
    smooth.push(avg(m.slice(lo, hi + 1)));
  }
  // Steady-state level ≈ mean of the last third of the smoothed curve.
  const tailStart = Math.floor(smooth.length * (2 / 3));
  const steady = avg(smooth.slice(tailStart));
  const scale = Math.abs(steady) > 1e-12 ? Math.abs(steady) : 1;
  for (let t = 0; t < tailStart; t++) {
    const rest = smooth.slice(t, tailStart);
    if (rest.every((v) => Math.abs(v - steady) / scale <= tol)) return t;
  }
  return tailStart;
}

/**
 * MSER-5 (White 1997): batch the cross-rep mean into batches of 5, then pick
 * the truncation point d minimizing the MSER statistic
 * (variance of remaining batches) / (n_remaining²). Returns weeks (d × 5).
 */
export function mser5(series: number[][]): number {
  const m = crossRepMean(series);
  const batch = 5;
  const nBatches = Math.floor(m.length / batch);
  if (nBatches < 4) return 0;
  const means: number[] = [];
  for (let b = 0; b < nBatches; b++) {
    means.push(avg(m.slice(b * batch, (b + 1) * batch)));
  }
  let bestD = 0;
  let bestStat = Number.POSITIVE_INFINITY;
  // Standard practice: don't truncate more than half the run.
  for (let d = 0; d <= Math.floor(nBatches / 2); d++) {
    const rest = means.slice(d);
    const stat = variance(rest) / (rest.length * rest.length);
    if (stat < bestStat) {
      bestStat = stat;
      bestD = d;
    }
  }
  return bestD * batch;
}

export interface KsResult {
  /** Two-sample Kolmogorov–Smirnov statistic D ∈ [0,1]. */
  d: number;
  /** Asymptotic p-value (Kolmogorov distribution approximation). */
  p: number;
}

/** Two-sample Kolmogorov–Smirnov test (real ECDF comparison). */
export function ksStatistic(a: number[], b: number[]): KsResult {
  if (a.length === 0 || b.length === 0) return { d: NaN, p: NaN };
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < sa.length && j < sb.length) {
    const x = Math.min(sa[i], sb[j]);
    while (i < sa.length && sa[i] <= x) i++;
    while (j < sb.length && sb[j] <= x) j++;
    d = Math.max(d, Math.abs(i / sa.length - j / sb.length));
  }
  // Asymptotic p-value: Q_KS(λ) with λ = (√ne + 0.12 + 0.11/√ne)·D.
  const ne = (sa.length * sb.length) / (sa.length + sb.length);
  const lambda = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * d;
  // The alternating series is numerically unstable for tiny λ, where Q_KS ≈ 1.
  if (lambda < 0.3) return { d, p: 1 };
  let p = 0;
  for (let k = 1; k <= 100; k++) {
    p += 2 * (k % 2 === 1 ? 1 : -1) * Math.exp(-2 * k * k * lambda * lambda);
  }
  return { d, p: Math.max(0, Math.min(1, p)) };
}

export interface TTestResult {
  /** Welch t statistic. */
  t: number;
  /** Welch–Satterthwaite degrees of freedom. */
  df: number;
  /** Two-sided p-value (normal approximation of the t distribution). */
  p: number;
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf approximation). */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Welch's two-sample t-test (unequal variances). */
export function welchTTest(a: number[], b: number[]): TTestResult {
  if (a.length < 2 || b.length < 2) return { t: NaN, df: NaN, p: NaN };
  const ma = avg(a);
  const mb = avg(b);
  const va = variance(a) / a.length;
  const vb = variance(b) / b.length;
  const se = Math.sqrt(va + vb);
  if (se === 0) return { t: 0, df: a.length + b.length - 2, p: 1 };
  const t = (ma - mb) / se;
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  // Two-sided p via normal approximation — adequate for df ≥ ~10; for small
  // df it is slightly liberal, acceptable for a pass/fail screen.
  const p = 2 * (1 - normCdf(Math.abs(t)));
  return { t, df, p: Math.max(0, Math.min(1, p)) };
}
