// Seed helpers for replication control.
export function randomSeed(): number {
  // 53-bit safe integer
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

/** Deterministic per-replication seeds derived from master (mulberry32). */
export function repSeeds(master: number, n: number): number[] {
  let state = master >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out.push(((t ^ (t >>> 14)) >>> 0));
  }
  return out;
}
