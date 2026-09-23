/**
 * The browser's MSER-5 is the engine's MSER-5 (audit 2026-09-22 · F-37's class,
 * found here; F-25's residue).
 *
 * The user switched the engine to White's (1997) published statistic in WP 6b:
 * z(d) = Σ(b − b̄)² / (n_b − d)² over the batch means after d. The "mser5" button
 * on /policies → Run & Validate computes a warm-up in the browser from the run's
 * own weekly series, and it still used the retired statistic — the n−1 sample
 * variance over (n_b − d)², i.e. one factor of (n_b − d) too many. So since WP 6b
 * the button and the engine could name different weeks for the same run.
 *
 * `ENGINE_SERIES` / `ENGINE_WEEK` were produced by `scsim.stats.warmup.mser5`
 * itself (engine 0.2.7); the legacy statistic answers 25 on the same series,
 * which is what makes the fixture able to tell the two apart.
 */
import { describe, expect, it } from 'vitest';
import { mser5 } from '../validationStats';

const ENGINE_SERIES = [
  0.615, 0.6644, 0.6478, 0.6821, 0.7417, 0.7565, 0.7397, 0.755, 0.8064, 0.796,
  0.8092, 0.8103, 0.8396, 0.8444, 0.831, 0.8758, 0.8919, 0.8593, 0.8521, 0.873,
  0.8711, 0.8629, 0.8745, 0.9177, 0.8997, 0.8549, 0.9076, 0.9142, 0.8934, 0.8849,
  0.9106, 0.8959, 0.8761, 0.9014, 0.9101, 0.886, 0.8721, 0.9133, 0.9153, 0.8804,
  0.8843, 0.9186, 0.9252, 0.8893, 0.9024, 0.9047, 0.9195, 0.8945, 0.8972, 0.9221,
  0.881, 0.8659, 0.9063, 0.9233, 0.9018, 0.9007, 0.9186, 0.9148, 0.8676, 0.8843,
];
const ENGINE_WEEK = 30;
const LEGACY_WEEK = 25;

/** White (1997), written from the definition — independent of the module. */
function published(xs: number[], batch = 5): number {
  const nb = Math.floor(xs.length / batch);
  if (nb < 4) return 0;
  const b = Array.from({ length: nb }, (_, i) =>
    xs.slice(i * batch, (i + 1) * batch).reduce((a, v) => a + v, 0) / batch);
  let best = 0;
  let bestZ = Infinity;
  for (let d = 0; d <= Math.floor(nb / 2); d++) {
    const t = b.slice(d);
    const m = t.reduce((a, v) => a + v, 0) / t.length;
    const z = t.reduce((a, v) => a + (v - m) ** 2, 0) / t.length ** 2;
    if (z < bestZ) { bestZ = z; best = d; }
  }
  return best * batch;
}

describe('MSER-5 parity — the button and the engine name the same week', () => {
  it('matches the engine on a series where the retired statistic does not', () => {
    expect(mser5([ENGINE_SERIES])).toBe(ENGINE_WEEK);
    expect(ENGINE_WEEK).not.toBe(LEGACY_WEEK);
  });

  it('matches the published definition on 60 deterministic series', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 60; k++) {
      const n = 30 + (k % 5) * 10;
      const amp = 0.05 + 0.3 * rnd();
      const tau = 2 + 10 * rnd();
      const xs = Array.from({ length: n }, (_, t) => 0.9 - amp * Math.exp(-t / tau) + 0.04 * (rnd() - 0.5));
      expect(mser5([xs]), `series ${k}`).toBe(published(xs));
    }
  });
});
