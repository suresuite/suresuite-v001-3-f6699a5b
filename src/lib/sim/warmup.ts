// Welch's method + MSER-5 for warm-up cutoff detection.
// Browser-side mirror of sim-worker/sim_worker/warmup.py — used for explainer
// previews. Worker runs the authoritative computation.

export function welchMovingAverage(series: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  const out: number[] = [];
  for (let i = half; i < series.length - half; i++) {
    let s = 0;
    for (let j = i - half; j <= i + half; j++) s += series[j];
    out.push(s / window);
  }
  return out;
}

/** MSER-5: find truncation that minimizes (sample variance / (n - d)^2). */
export function mser5(series: number[]): number {
  const n = series.length;
  if (n < 20) return 0;
  let bestD = 0;
  let bestVal = Infinity;
  // step by 5 for speed
  for (let d = 0; d < n - 10; d += 5) {
    const tail = series.slice(d);
    const m = tail.reduce((a, b) => a + b, 0) / tail.length;
    const v = tail.reduce((a, b) => a + (b - m) ** 2, 0) / tail.length;
    const score = v / ((n - d) * (n - d));
    if (score < bestVal) {
      bestVal = score;
      bestD = d;
    }
  }
  return bestD;
}

export function detectWarmup(series: number[]): number {
  if (series.length < 30) return 0;
  return mser5(series);
}
