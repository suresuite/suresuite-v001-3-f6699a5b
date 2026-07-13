import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  CircleDashed,
  Database,
  ExternalLink,
  FlaskConical,
  Loader2,
  MessageSquareQuote,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FIELD_LABELS } from "@/lib/policies/schemas";
import { APPLY_RETRY_CAP, useProposal, type Proposal } from "@/hooks/useProposals";

/**
 * Proposal card (ai-agents.md §4.6) — the reviewable unit of Layer B output,
 * anchored in-thread at the message that produced it. Card states map 1:1 to
 * proposals.status + apply bookkeeping; the card never renders numbers that
 * are not in payload/applied_result (no client-side recomputation).
 */

const AGENT_META: Record<string, { name: string; Icon: typeof Database }> = {
  "data-steward": { name: "Data Steward", Icon: Database },
  "policy-configurator": { name: "Policy Configurator", Icon: SlidersHorizontal },
  "vv-analyst": { name: "V&V Analyst", Icon: BadgeCheck },
  "experiment-designer": { name: "Experiment Designer", Icon: FlaskConical },
  explainer: { name: "Explainer", Icon: MessageSquareQuote },
};

const PROVENANCE_CHIP: Record<Proposal["provenance"], { label: string; className: string }> = {
  deterministic: { label: "computed from your data", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  llm_drafted: { label: "AI-drafted — verify", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  user_supplied: { label: "as you specified", className: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
};

// artifact type → room deep link + apply-gate name (§4.4 / §4.6)
const ARTIFACT_META: Record<string, { room: string | null; roomLabel: string; gate: string }> = {
  item_master_diff: { room: "/project-manager", roomLabel: "Project Manager", gate: "the item-master write RPCs" },
  policy_bundle_diff: { room: "/policies", roomLabel: "Policies", gate: "save_policy_defaults + snapshot_policy" },
  model_card_draft: { room: "/policies", roomLabel: "Run & Validate", gate: "record_model_validation" },
  experiment_spec: { room: "/simulation-lab", roomLabel: "Simulation Lab", gate: "the experiment dispatch gate" },
  trace_explanation: { room: null, roomLabel: "", gate: "" },
};

const DIFF_COLLAPSE_LIMIT = 20;

function expiresIn(expiresAt: string): string {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `expires in ${days}d`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `expires in ${hours}h`;
}

function ItemMasterDiff({ rows }: { rows: Array<Record<string, unknown>> }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, DIFF_COLLAPSE_LIMIT);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Table</th>
            <th className="py-1 pr-3 font-medium">Entity</th>
            <th className="py-1 pr-3 font-medium">Field</th>
            <th className="py-1 pr-3 font-medium">New value</th>
            <th className="py-1 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr key={i} className="border-b border-border/50">
              <td className="py-1 pr-3">{String(r.table ?? "")}</td>
              <td className="py-1 pr-3 font-mono">{String(r.entity_id ?? "")}</td>
              <td className="py-1 pr-3">{String(r.field ?? "")}</td>
              <td className="py-1 pr-3 font-mono">{r.value == null ? "—" : String(r.value)}</td>
              <td className="py-1">{String(r.source ?? "")}{r.reducer ? ` (${String(r.reducer)})` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > DIFF_COLLAPSE_LIMIT && !showAll && (
        <button type="button" className="mt-1 text-[12px] text-primary underline" onClick={() => setShowAll(true)}>
          show all {rows.length}
        </button>
      )}
    </div>
  );
}

const fieldLabel = (f: string) => FIELD_LABELS[f] ?? f;

const fmtValue = (v: unknown): string => {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

interface PolicyDiffPayload {
  diff?: {
    defaults?: Record<string, Record<string, unknown>>;
    overrides?: Array<{ scope: string; target_key: string; family: string; patch: Record<string, unknown> }>;
  };
  rationale?: string;
  newly_required?: string[];
  findings_preview?: Array<{ severity: string; field: string; message: string }>;
}

/** §4.6 policy diff view: per-field family/override rows with the registry
 * labels the /policies grid uses — the reviewer reads the storage vocabulary. */
function PolicyBundleDiff({ payload }: { payload: PolicyDiffPayload }) {
  const [showAll, setShowAll] = useState(false);
  const rows: Array<{ target: string; family: string; field: string; value: unknown }> = [];
  for (const [family, patch] of Object.entries(payload.diff?.defaults ?? {})) {
    for (const [field, value] of Object.entries(patch ?? {})) {
      rows.push({ target: "project default", family, field, value });
    }
  }
  for (const o of payload.diff?.overrides ?? []) {
    for (const [field, value] of Object.entries(o.patch ?? {})) {
      rows.push({ target: o.target_key, family: o.family, field, value });
    }
  }
  const visible = showAll ? rows : rows.slice(0, DIFF_COLLAPSE_LIMIT);
  const newlyRequired = payload.newly_required ?? [];
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Target</th>
              <th className="py-1 pr-3 font-medium">Family</th>
              <th className="py-1 pr-3 font-medium">Parameter</th>
              <th className="py-1 font-medium">New value</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-1 pr-3 font-mono">{r.target}</td>
                <td className="py-1 pr-3">{r.family}</td>
                <td className="py-1 pr-3">{fieldLabel(r.field)}</td>
                <td className="py-1 font-mono">{fmtValue(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > DIFF_COLLAPSE_LIMIT && !showAll && (
          <button type="button" className="mt-1 text-[12px] text-primary underline" onClick={() => setShowAll(true)}>
            show all {rows.length}
          </button>
        )}
      </div>
      {payload.rationale && (
        <div className="mt-1.5 text-[12px] text-muted-foreground">{payload.rationale}</div>
      )}
      {newlyRequired.length > 0 && (
        <div className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-[12px] text-amber-700 dark:text-amber-400">
          Newly required data (from the recompiled manifest): {newlyRequired.join(", ")} — the Data
          Steward can fill these.
        </div>
      )}
      <div className="mt-1 text-[11.5px] text-muted-foreground">
        Outcomes are not predicted — verify with a simulation run (unvalidated configuration).
      </div>
    </div>
  );
}

interface ModelCardPayload {
  verdict?: string;
  basis?: string;
  downgrade_note?: string | null;
  narrative_md?: string;
  computed?: {
    adopted_warmup_days?: number;
    warmup_method?: string;
    recommended_replications?: number;
    replication_basis?: { confidence?: number; target_precision?: number; per_kpi?: Record<string, { mean: number; half: number; n: number; n_star: number }> };
    validation_tests?: Array<{ kpi: string; pass: boolean }>;
  };
}

/** §4.6 model-card view: the machine-computed adopted numbers printed next to
 * the AI-drafted narrative, so prose can never contradict silently (§5.3). */
function ModelCardDraft({ payload }: { payload: ModelCardPayload }) {
  const c = payload.computed ?? {};
  const perKpi = c.replication_basis?.per_kpi ?? {};
  return (
    <div className="space-y-1.5 text-[12.5px]">
      <div className="flex flex-wrap gap-2">
        <span className="rounded bg-muted px-1.5 py-px font-mono">
          verdict: {payload.verdict ?? "—"} ({payload.basis ?? "—"})
        </span>
        <span className="rounded bg-muted px-1.5 py-px font-mono">
          warm-up: {c.adopted_warmup_days ?? "—"}d ({c.warmup_method ?? "—"})
        </span>
        <span className="rounded bg-muted px-1.5 py-px font-mono">
          recommended replications: {c.recommended_replications ?? "—"}
        </span>
      </div>
      {payload.downgrade_note && (
        <div className="rounded bg-amber-500/10 px-2 py-1 text-[12px] text-amber-700 dark:text-amber-400">
          Downgraded by the platform: {payload.downgrade_note}
        </div>
      )}
      {Object.keys(perKpi).length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-0.5 pr-3 font-medium">KPI</th>
                <th className="py-0.5 pr-3 font-medium">Mean</th>
                <th className="py-0.5 pr-3 font-medium">± CI</th>
                <th className="py-0.5 pr-3 font-medium">n</th>
                <th className="py-0.5 font-medium">n*</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(perKpi).map(([kpi, s]) => (
                <tr key={kpi} className="border-b border-border/50">
                  <td className="py-0.5 pr-3 font-mono">{kpi}</td>
                  <td className="py-0.5 pr-3 font-mono">{Number(s.mean).toFixed(4)}</td>
                  <td className="py-0.5 pr-3 font-mono">{Number(s.half).toFixed(4)}</td>
                  <td className="py-0.5 pr-3 font-mono">{s.n}</td>
                  <td className="py-0.5 font-mono">{s.n_star}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {payload.narrative_md && (
        <div>
          <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Narrative — AI-drafted, verify
          </div>
          <div className="whitespace-pre-wrap text-[13px]">{payload.narrative_md}</div>
        </div>
      )}
    </div>
  );
}

function ProposalBody({ proposal }: { proposal: Proposal }) {
  const payload = proposal.payload ?? {};
  const rows = (payload as { rows?: Array<Record<string, unknown>> }).rows;
  if (proposal.artifact_type === "item_master_diff" && Array.isArray(rows)) {
    return <ItemMasterDiff rows={rows} />;
  }
  if (proposal.artifact_type === "policy_bundle_diff" && (payload as PolicyDiffPayload).diff) {
    return <PolicyBundleDiff payload={payload as PolicyDiffPayload} />;
  }
  if (proposal.artifact_type === "model_card_draft" && (payload as ModelCardPayload).computed) {
    return <ModelCardDraft payload={payload as ModelCardPayload} />;
  }
  const narrative = (payload as { narrative_md?: string; explanation_md?: string });
  const text = narrative.explanation_md ?? narrative.narrative_md;
  if (typeof text === "string" && text.length > 0) {
    return <div className="whitespace-pre-wrap text-[13px]">{text}</div>;
  }
  return (
    <pre className="max-h-64 overflow-auto rounded bg-muted px-2 py-1.5 text-[12px]">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

function Citations({ citations }: { citations: Proposal["citations"] }) {
  if (!Array.isArray(citations) || citations.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-[11.5px] text-muted-foreground">
      {citations.map((c, i) => (
        <li key={i} className="truncate">
          <span className="rounded bg-muted px-1 py-px font-mono">{String(c.kind ?? "ref")}</span>{" "}
          {String(c.ref ?? "")}
        </li>
      ))}
    </ul>
  );
}

export function ProposalCard({ proposalId }: { proposalId: string | null | undefined }) {
  const { proposal, loading, applying, approve, reject, retryApply, recordViewed } = useProposal(proposalId ?? null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (proposal?.id) recordViewed(proposal.id);
  }, [proposal?.id, recordViewed]);

  if (!proposalId) return null;
  if (loading) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading proposal…
      </div>
    );
  }
  if (!proposal) {
    return (
      <div className="my-2 rounded-lg border border-border px-3 py-2 text-[13px] text-muted-foreground">
        This proposal is no longer available.
      </div>
    );
  }

  const agent = AGENT_META[proposal.agent_id] ?? { name: proposal.agent_id, Icon: CircleDashed };
  const provenance = PROVENANCE_CHIP[proposal.provenance];
  const artifact = ARTIFACT_META[proposal.artifact_type] ?? { room: null, roomLabel: "", gate: "" };
  const dimmed = proposal.status === "rejected" || proposal.status === "expired";
  const isApplying = proposal.status === "approved" && !proposal.apply_error;
  const retryDisabled = proposal.apply_attempts >= APPLY_RETRY_CAP;

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setActionError(null);
    const err = await fn();
    if (err) setActionError(err);
    setBusy(false);
  };

  return (
    <div
      role="region"
      aria-label={`Proposal: ${proposal.title}`}
      className={cn(
        "my-2 rounded-lg border border-border bg-surface-elevated/50 px-3 py-2.5",
        dimmed && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <agent.Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-[13px] font-semibold">{agent.name}</span>
        <span className={cn("rounded-full px-2 py-px text-[11px] font-medium", provenance.className)}>
          {provenance.label}
        </span>
        <span aria-live="polite" className="ml-auto text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
          {proposal.status}
        </span>
      </div>

      <div className="mt-1 text-[13.5px] font-medium">{proposal.title}</div>

      {proposal.status === "draft" && (
        <div className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-[12.5px] text-amber-700 dark:text-amber-400">
          Needs input — answer the agent's question in the chat to continue.
        </div>
      )}

      {(proposal.status === "proposed" || proposal.status === "draft") && (
        <>
          <div className="mt-2">
            <ProposalBody proposal={proposal} />
          </div>
          <Citations citations={proposal.citations} />
          <div className="mt-1 text-[11.5px] text-muted-foreground">{expiresIn(proposal.expires_at)}</div>
        </>
      )}

      {isApplying && proposal.status === "approved" && (
        <div className="mt-2 flex items-center gap-2 text-[12.5px] text-muted-foreground" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          applying through {artifact.gate || "the platform gates"}
        </div>
      )}

      {proposal.status === "approved" && proposal.apply_error && (
        <div className="mt-2 rounded bg-destructive/10 px-2 py-1.5 text-[12.5px] text-destructive">
          {proposal.apply_error}
        </div>
      )}

      {proposal.status === "applied" && (
        <div className="mt-2 rounded bg-emerald-500/10 px-2 py-1.5 text-[12.5px] text-emerald-700 dark:text-emerald-400">
          Applied{proposal.applied_at ? ` · ${new Date(proposal.applied_at).toLocaleString()}` : ""}
          {proposal.applied_result && (
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/60 px-2 py-1 text-[11.5px] text-foreground">
              {JSON.stringify(proposal.applied_result, null, 2)}
            </pre>
          )}
        </div>
      )}

      {dimmed && proposal.status_reason && (
        <div className="mt-1.5 text-[12px] text-muted-foreground">{proposal.status_reason}</div>
      )}

      {actionError && (
        <div className="mt-2 rounded bg-destructive/10 px-2 py-1.5 text-[12.5px] text-destructive">{actionError}</div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {proposal.status === "proposed" && (
          <>
            <Button size="sm" className="h-7 px-3 text-[12.5px]" disabled={busy}
              onClick={() => run(() => approve(proposal.id))}>
              Approve
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-3 text-[12.5px]" disabled={busy}
              onClick={() => run(() => reject(proposal.id))}>
              Reject
            </Button>
          </>
        )}
        {proposal.status === "approved" && proposal.apply_error && (
          <>
            <Button size="sm" className="h-7 px-3 text-[12.5px]" disabled={busy || applying || retryDisabled}
              title={retryDisabled ? `Retry limit reached (${APPLY_RETRY_CAP})` : undefined}
              onClick={() => run(() => retryApply(proposal.id))}>
              Retry
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-3 text-[12.5px]" disabled={busy}
              onClick={() => run(() => reject(proposal.id))}>
              Reject
            </Button>
          </>
        )}
        {proposal.status === "applied" && (
          <Button size="sm" variant="outline" className="h-7 px-3 text-[12.5px]" disabled
            title="Revert drafting ships with the owning agent">
            Draft revert
          </Button>
        )}
        {artifact.room && (
          <Link
            to={artifact.room}
            className="ml-auto inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
          >
            Open in {artifact.roomLabel} <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}
