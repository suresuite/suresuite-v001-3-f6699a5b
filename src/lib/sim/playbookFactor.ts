// Helpers for using saved recovery playbooks as DOE factors.

import type { Factor } from "./doe";
import type { RecoveryPlaybook } from "@/hooks/useRecoveryPlaybooks";

export const PLAYBOOK_FACTOR_KEY = "recovery_playbook_id";

export function buildPlaybookFactor(playbooks: RecoveryPlaybook[]): Factor {
  return {
    key: PLAYBOOK_FACTOR_KEY,
    label: "Recovery playbook",
    levels: playbooks.map((p) => p.id),
  };
}

/** Apply a design row to a base scenario, returning a partial scenario patch
 *  (everything but the primary key) suitable for an `insert`. */
export function materializeDesignRow(
  base: Record<string, unknown>,
  row: Record<string, number | string>,
  playbookLookup: Map<string, RecoveryPlaybook>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...base };
  const overrides: Record<string, unknown> = { ...((base.recovery_overrides as object) ?? {}) };

  for (const [k, v] of Object.entries(row)) {
    if (k === PLAYBOOK_FACTOR_KEY) {
      const pb = playbookLookup.get(String(v));
      patch.recovery_playbook_id = pb?.id ?? null;
      if (pb) Object.assign(overrides, pb.config ?? {});
    } else if (k === "horizon_days" || k === "replications" || k === "warmup_days" || k === "seed") {
      patch[k] = typeof v === "number" ? v : Number(v);
    } else {
      // Treat anything else as a recovery override key.
      overrides[k] = v;
    }
  }
  patch.recovery_overrides = overrides;
  return patch;
}

export function scenarioNameForRow(
  baseName: string,
  row: Record<string, number | string>,
  playbookLookup: Map<string, RecoveryPlaybook>,
): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (k === PLAYBOOK_FACTOR_KEY) {
      const pb = playbookLookup.get(String(v));
      parts.push(pb?.name ?? "playbook");
    } else {
      parts.push(`${k}=${v}`);
    }
  }
  return parts.length ? `${baseName} · ${parts.join(" / ")}` : baseName;
}
