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

// ── Student-t (§4 D244) ─────────────────────────────────────────────────────
// A replication study has n = 5…30. At those n the normal quantile understates
// the interval (1.96 vs t₀.₉₇₅,₄ = 2.776), so every CI and every p-value here is
// Student-t. The engine's `scsim.stats` uses scipy's t; these are the same
// numbers to six places.

/** ln Γ(x), Lanczos (g = 7, n = 9). */
function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const xx = x - 1;
  let a = c[0];
  const t = xx + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (Lentz). */
function betaCf(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(lbt);
  return x < (a + 1) / (a + b + 2) ? (bt * betaCf(a, b, x)) / a : 1 - (bt * betaCf(b, a, 1 - x)) / b;
}

/** Student-t CDF with `df` degrees of freedom (df may be fractional — Welch). */
export function studentTCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (!(df > 0)) return NaN;
  const tail = 0.5 * incBeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** Student-t quantile: the t with P(T ≤ t) = p. Bisection on the CDF. */
export function studentTQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) return NaN;
  if (p === 0.5) return 0;
  if (p < 0.5) return -studentTQuantile(1 - p, df);
  let lo = 0;
  let hi = 1;
  while (studentTCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-12 * Math.max(1, hi); i++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Mean and Student-t CI half-width across replications, for one week or one KPI.
 *
 *  Lives here rather than in a component because two result panels need it —
 *  the per-seed explorer and the inventory chart — and a shared function
 *  exported from a component file is a shared function in the wrong place.
 *  It used z (1.96 at 95 %) until WP 10.3: at n = 5 that understated the
 *  half-width by 29 % (§4 D244).
 */
export function meanCI(
  values: number[],
  confidence: number,
): { mean: number; half: number; n: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, half: 0, n: 0 };
  const m = avg(values);
  if (n < 2) return { mean: m, half: 0, n };
  const t = studentTQuantile(1 - (1 - confidence) / 2, n - 1);
  return { mean: m, half: (t * Math.sqrt(variance(values))) / Math.sqrt(n), n };
}

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
 * the truncation point d minimizing z(d) = Σ(b − b̄)² / (n_b − d)² over the batch
 * means after d — the engine's `scsim.stats.warmup.mser5` since 0.2.7. Returns
 * weeks (d × 5). It divided the n−1 sample VARIANCE by (n_b − d)², one factor too
 * many, until `mser5Parity.test.ts` found the button disagreeing with the engine.
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
    const mu = avg(rest);
    const stat = rest.reduce((a, v) => a + (v - mu) ** 2, 0) / (rest.length * rest.length);
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
  /** Two-sided p-value from the Student-t distribution. */
  p: number;
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
  // Two-sided p from the t distribution at the Welch–Satterthwaite df. It was
  // the normal approximation until WP 10.3, which at df = 6 reported 0.028 for
  // what is 0.071 — passing a KPI as different that the t-test does not (D244).
  const p = 2 * (1 - studentTCdf(Math.abs(t), df));
  return { t, df, p: Math.max(0, Math.min(1, p)) };
}
