// policy_bundle_diff apply mapping — Stage 2 (ai-agents.md §4.4 row 2, §9.3).
//
// The exact §4.4 sequence, every step an interface that already exists:
//   (1) grounding check: current_policy_hash(project) equals
//       grounding.policy_hash (else `stale_values`) — re-checked
//       TRANSACTIONALLY inside apply_policy_bundle as well, so an out-of-band
//       edit between approve and apply fails cleanly under concurrency;
//   (2)+(3) save_policy_defaults-semantics family merges +
//       bulk_upsert_policy_overrides-semantics override merges + snapshot_policy
//       with label `agent: <title>` and parent lineage — one transaction via
//       the wrapping RPC apply_policy_bundle (20260716000001); any failure
//       rolls back all three;
//   (4) gradeManifest against the new snapshot defaults: the authoritative
//       grade runs BEFORE the RPC on the MERGED defaults (grading is a pure
//       function of dataset + defaults, so pre-merge grade ≡ post-snapshot
//       grade for the same dataset) — a `block` finding means the RPC is
//       never called and the apply fails `gate_blocked` with nothing mutated;
//       the post-apply re-grade is recorded on applied_result and, should a
//       concurrent dataset change surface a new block, the parent version is
//       restored (restore_policy_version — the §4.4 revert path) and the
//       apply fails `gate_blocked`.
//
// Pure orchestration over an injected supabase-like client: no Deno.env, no
// module-level clients — the deterministic eval tier drives it with a
// stateful stub, and index.ts drives it with the service role.

import { loadGateDataset } from "../_shared/validationGate.ts";
import { flattenFindings } from "../_shared/grading.ts";
import { gradeDataset, loadPolicyDefaults } from "../_shared/itemMasterCandidates.ts";
import {
  mergeDefaults,
  validatePolicyDiff,
  type PolicyDiff,
} from "../_shared/policyFields.ts";
import { ApplyFailure, type GateFindingLite } from "./itemMasterApply.ts";

/** §4.4 `applied_result` shape for policy_bundle_diff. */
export interface PolicyBundleApplyResult {
  policy_version_id: string;
  policy_hash: string;
  findings: GateFindingLite[];
}

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

function lite(findings: ReturnType<typeof flattenFindings>): GateFindingLite[] {
  return findings.map(({ severity, field, policy, rows, message }) => ({
    severity,
    field,
    policy,
    rows,
    message,
  }));
}

function blockSummary(findings: GateFindingLite[]): string {
  const blocks = findings.filter((f) => f.severity === "block");
  return blocks.slice(0, 3).map((f) => `${f.field}: ${f.message}`).join(" | ") +
    (blocks.length > 3 ? ` (+${blocks.length - 3} more)` : "");
}

/**
 * Apply one approved policy_bundle_diff proposal. Throws ApplyFailure with a
 * §4.4 code; on success the new snapshot is visible in /policies version
 * history with the `agent:` label and its parent lineage (pc-09).
 */
export async function applyPolicyBundle(
  db: Db,
  args: {
    projectId: string;
    title: string;
    payload: Record<string, unknown>;
    grounding: Record<string, unknown>;
    userId?: string | null;
    userEmail?: string | null;
  },
): Promise<PolicyBundleApplyResult> {
  // Stored payloads were validated at draft time; re-validate so a manually
  // forged row can never reach the write RPCs (same posture as item-master).
  const validation = validatePolicyDiff(args.payload?.diff);
  if (!validation.ok) {
    throw new ApplyFailure("rpc_error", `stored payload failed validation: ${validation.reason}`);
  }
  const diff = args.payload.diff as PolicyDiff;
  const baseVersionId = typeof args.payload.base_policy_version_id === "string"
    ? args.payload.base_policy_version_id
    : null;

  // (1) grounding freshness (§4.2 approved→applied precondition, §8 T8).
  const groundedPolicyHash = typeof args.grounding?.policy_hash === "string"
    ? String(args.grounding.policy_hash)
    : null;
  if (groundedPolicyHash) {
    const { data: currentHash, error } = await db.rpc("current_policy_hash", {
      p_project_id: args.projectId,
    });
    if (!error && typeof currentHash === "string" && currentHash !== groundedPolicyHash) {
      throw new ApplyFailure(
        "stale_values",
        "the policy configuration changed since this proposal was drafted (policy hash drift) — ask for a fresh draft",
      );
    }
  }

  // (4, authoritative half) grade the MERGED defaults with the ONE grader.
  const [dataset, defaults] = await Promise.all([
    loadGateDataset(db, args.projectId),
    loadPolicyDefaults(db, args.projectId),
  ]);
  const merged = mergeDefaults(defaults, diff.defaults);
  const preFindings = lite(flattenFindings(gradeDataset(dataset, merged)));
  if (preFindings.some((f) => f.severity === "block")) {
    throw new ApplyFailure(
      "gate_blocked",
      `the recompiled required-data manifest blocks this configuration: ${blockSummary(preFindings)}`,
    );
  }

  // (2)+(3) the transactional wrapper (single transaction; §4.4).
  const { data: applied, error: applyErr } = await db.rpc("apply_policy_bundle", {
    p_project_id: args.projectId,
    p_defaults: diff.defaults ?? {},
    p_overrides: diff.overrides ?? [],
    p_label: `agent: ${args.title}`.slice(0, 140),
    p_parent_version_id: baseVersionId,
    p_expected_policy_hash: groundedPolicyHash,
    p_user_id: args.userId ?? null,
    p_user_email: args.userEmail ?? null,
    p_user_name: null,
  });
  if (applyErr) {
    const msg = String(applyErr.message ?? "apply_policy_bundle failed");
    const code = msg.includes("stale_values") ? "stale_values" : "rpc_error";
    throw new ApplyFailure(code, msg);
  }
  const result = (applied ?? {}) as Record<string, unknown>;
  const versionId = String(result.policy_version_id ?? "");
  const policyHash = String(result.policy_hash ?? "");
  if (!versionId) {
    throw new ApplyFailure("rpc_error", "apply_policy_bundle returned no policy_version_id");
  }

  // (4, recorded half) post-snapshot grade against the LIVE defaults.
  const [datasetAfter, defaultsAfter] = await Promise.all([
    loadGateDataset(db, args.projectId),
    loadPolicyDefaults(db, args.projectId),
  ]);
  const findings = lite(flattenFindings(gradeDataset(datasetAfter, defaultsAfter)));
  if (findings.some((f) => f.severity === "block")) {
    // Only reachable via a concurrent dataset change (the pre-grade passed on
    // the same merged defaults): compensate by restoring the parent version —
    // the §4.4 revert path; the agent snapshot stays in history (A5).
    if (baseVersionId) {
      const { error: restoreErr } = await db.rpc("restore_policy_version", {
        p_version_id: baseVersionId,
        _actor_user_id: args.userId ?? null,   // D71
      });
      if (restoreErr) console.error("restore_policy_version failed:", restoreErr.message);
    }
    throw new ApplyFailure(
      "gate_blocked",
      `the post-snapshot grade found blockers: ${blockSummary(findings)}` +
        (baseVersionId ? " — the parent policy version was restored" : ""),
    );
  }

  return { policy_version_id: versionId, policy_hash: policyHash, findings };
}
