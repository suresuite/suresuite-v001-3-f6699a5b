import type { PolicyBundle, PolicyFamily } from "./schemas";

/** Shallow merge — sufficient for our flat policy shapes, except `ratios` map. */
export function mergePatch<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  if (!patch || typeof patch !== "object") return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === "ratios" && v && typeof v === "object") {
      out[k] = { ...(base as Record<string, unknown>)[k] as object, ...(v as object) };
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export interface OverrideRow {
  scope: "node" | "edge";
  target_key: string;
  family: PolicyFamily;
  patch: Record<string, unknown>;
}

/**
 * Return the effective policy for a given node or edge by merging the project
 * default with all overrides that target it.
 */
export function effectivePolicy(
  defaults: PolicyBundle,
  overrides: OverrideRow[],
  scope: "node" | "edge",
  targetKey: string,
): PolicyBundle {
  const out: PolicyBundle = { ...defaults };
  for (const o of overrides) {
    if (o.scope !== scope || o.target_key !== targetKey) continue;
    (out as unknown as Record<string, unknown>)[o.family] = mergePatch(
      (defaults as unknown as Record<string, unknown>)[o.family] as Record<string, unknown>,
      o.patch as Record<string, unknown>,
    );
  }
  return out;
}

/** Field-level diff for the "deviates from default" badge. */
export function diffFields(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): string[] {
  if (!patch || typeof patch !== "object") return [];
  const changed: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (JSON.stringify(base?.[k]) !== JSON.stringify(v)) changed.push(k);
  }
  return changed;
}
