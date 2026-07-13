import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  CircleDashed,
  Database,
  ExternalLink,
  FlaskConical,
  Lightbulb,
  Loader2,
  MessageSquareQuote,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FIELD_LABELS } from "@/lib/policies/schemas";
import { errorRemedy, PART_TREATMENTS, typedErrorCode } from "@/lib/chat/partStyles";
import { APPLY_RETRY_CAP, useProposal, type Proposal } from "@/hooks/useProposals";

/**
 * Proposal card (ai-agents.md §4.6) — the reviewable unit of Layer B output,
 * anchored in-thread at the message that produced it. Card states map 1:1 to
 * proposals.status + apply bookkeeping; the card never renders numbers that
 * are not in payload/applied_result (no client-side recomputation).
 *
 * §17.2 (v1.2 Phase 2): the card sits in the readability grammar — amber left
 * rail (the proposal content class, never the agent) + agent chip + status
 * pill; apply errors render in the errors-and-refusals treatment with the
 * typed code and its one-line remedy. All treatments from partStyles.ts.
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
        <div className={cn("mt-1.5 rounded px-2 py-1 text-[12px]", PART_TREATMENTS.proposal.chip)}>
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
        <div className={cn("rounded px-2 py-1 text-[12px]", PART_TREATMENTS.proposal.chip)}>
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
          <div className={cn("mb-0.5 text-[11px] font-medium uppercase tracking-wide", PART_TREATMENTS.proposal.accent)}>
            Narrative — AI-drafted, verify
          </div>
          <div className="whitespace-pre-wrap text-[13px]">{payload.narrative_md}</div>
        </div>
      )}
    </div>
  );
}

interface ExperimentSpecPayload {
  scenario_id?: string;
  scenario_name?: string;
  new_scenario?: {
    name?: string;
    horizon_days?: number;
    disruption_schedule?: Array<Record<string, unknown>>;
  };
  policy_version_id?: string;
  policy_version_label?: string | null;
  newer_version_exists?: boolean;
  replications?: number;
  question?: string;
  gate_status?: string;
  findings_preview?: Array<{ severity: string; field: string; message: string }>;
}

/** §4.6 experiment view: spec summary + the read-only gate pre-check result
 * (findings_preview) the acknowledgment checkbox is informed by (§5.4). */
function ExperimentSpec({ payload, grounding }: { payload: ExperimentSpecPayload; grounding: Record<string, unknown> }) {
  const ns = payload.new_scenario;
  const events = ns?.disruption_schedule ?? [];
  const findings = payload.findings_preview ?? [];
  const policyHash = typeof grounding?.policy_hash === "string" ? String(grounding.policy_hash) : null;
  return (
    <div className="space-y-1.5 text-[12.5px]">
      <div className="flex flex-wrap gap-2">
        <span className="rounded bg-muted px-1.5 py-px font-mono">
          scenario: {ns ? `${ns.name ?? "—"} (new, ${ns.horizon_days ?? "—"}d, ${events.length} events)` : payload.scenario_name ?? payload.scenario_id ?? "—"}
        </span>
        <span className="rounded bg-muted px-1.5 py-px font-mono">
          policy version: {payload.policy_version_label ?? payload.policy_version_id?.slice(0, 8) ?? "—"}
          {policyHash ? ` (${policyHash.slice(0, 12)})` : ""}
        </span>
        <span className="rounded bg-muted px-1.5 py-px font-mono">replications: {payload.replications ?? "—"}</span>
      </div>
      {payload.question && <div className="text-[12px] text-muted-foreground">Question: {payload.question}</div>}
      {payload.newer_version_exists && (
        <div className={cn("rounded px-2 py-1 text-[12px]", PART_TREATMENTS.proposal.chip)}>
          A newer saved policy version exists — this spec binds an older one (versions are immutable, so the run stays reproducible).
        </div>
      )}
      <div className="text-[12px]">
        Gate pre-check: <span className="font-mono">{payload.gate_status ?? "—"}</span>
        {findings.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {findings.slice(0, 8).map((f, i) => (
              <li key={i} className={f.severity === "block" ? PART_TREATMENTS.error.accent : f.severity === "warn" ? PART_TREATMENTS.proposal.accent : "text-muted-foreground"}>
                [{f.severity}] {f.field}: {f.message}
              </li>
            ))}
            {findings.length > 8 && <li className="text-muted-foreground">(+{findings.length - 8} more)</li>}
          </ul>
        )}
      </div>
      <div className="text-[11.5px] text-muted-foreground">
        Approving dispatches this run through the standard gate — the engine computes the results; nothing here predicts them.
      </div>
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
  if (proposal.artifact_type === "experiment_spec" && (payload as ExperimentSpecPayload).policy_version_id) {
    return <ExperimentSpec payload={payload as ExperimentSpecPayload} grounding={proposal.grounding ?? {}} />;
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

interface ProposalCardProps {
  proposalId: string | null | undefined;
  /** §17.4: offer a follow-up utterance (prefilled into the composer) — used
   * for the post-apply "save this decision to project memory" suggestion. */
  onSuggestUtterance?: (utterance: string) => void;
}

export function ProposalCard({ proposalId, onSuggestUtterance }: ProposalCardProps) {
  const { proposal, loading, applying, approve, reject, retryApply, recordViewed } = useProposal(proposalId ?? null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // §5.4: only the approving human can acknowledge warn findings — this
  // checkbox is that act. It renders only when the card DISPLAYS warn (and
  // no block) findings from the stored findings_preview; the server honors
  // it only under the same condition.
  const [ackWarnings, setAckWarnings] = useState(false);
  // §17.4: the save-the-rationale suggestion appears only when THIS session
  // watched the card transition to applied — the moment memory is most
  // valuable — never retroactively on old applied cards in history.
  const [justApplied, setJustApplied] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  useEffect(() => {
    if (proposal?.id) recordViewed(proposal.id);
  }, [proposal?.id, recordViewed]);

  useEffect(() => {
    if (!proposal) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = proposal.status;
    if (prev && prev !== "applied" && proposal.status === "applied") setJustApplied(true);
  }, [proposal, proposal?.status]);

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
  const findingsPreview = Array.isArray((proposal.payload as { findings_preview?: unknown })?.findings_preview)
    ? ((proposal.payload as { findings_preview: Array<{ severity: string }> }).findings_preview)
    : [];
  const ackAvailable = proposal.artifact_type === "experiment_spec" &&
    findingsPreview.some((f) => f.severity === "warn") &&
    !findingsPreview.some((f) => f.severity === "block");
  const applyOpts = ackAvailable ? { acknowledgeWarnings: ackWarnings } : undefined;

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
        "my-2 px-3 py-2.5",
        PART_TREATMENTS.proposal.card,
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
        <div className={cn("mt-2 rounded px-2 py-1.5 text-[12.5px]", PART_TREATMENTS.proposal.chip)}>
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
        <div className={cn("mt-2 px-2 py-1.5 text-[12.5px]", PART_TREATMENTS.error.card)}>
          {typedErrorCode(proposal.apply_error) && (
            <span className={cn("mr-1.5 rounded px-1 py-px font-mono text-[11px]", PART_TREATMENTS.error.chip)}>
              {typedErrorCode(proposal.apply_error)}
            </span>
          )}
          <span className={PART_TREATMENTS.error.accent}>{proposal.apply_error}</span>
          {errorRemedy(typedErrorCode(proposal.apply_error)) && (
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">
              {errorRemedy(typedErrorCode(proposal.apply_error))}
            </div>
          )}
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

      {/* §17.4: post-apply guidance — offer to save the decision rationale at
          the moment it's most valuable. The chip only PREFILLS the composer
          with a "Remember that …" sentence; the save itself rides the §14.4
          consent path (a) when the user sends it — no new write path. */}
      {justApplied && proposal.status === "applied" && onSuggestUtterance && (
        <button
          type="button"
          onClick={() =>
            onSuggestUtterance(`Remember that we applied "${proposal.title}" because `)
          }
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-2.5 py-1 text-[12px] text-muted-foreground transition hover:text-foreground"
          title="Prefills a 'Remember that…' message — you add the rationale and send"
        >
          <Lightbulb className="h-3 w-3 shrink-0" />
          Save this decision to project memory
        </button>
      )}

      {dimmed && proposal.status_reason && (
        <div className="mt-1.5 text-[12px] text-muted-foreground">{proposal.status_reason}</div>
      )}

      {actionError && (
        <div className={cn("mt-2 px-2 py-1.5 text-[12.5px]", PART_TREATMENTS.error.card, PART_TREATMENTS.error.accent)}>{actionError}</div>
      )}

      {ackAvailable && (proposal.status === "proposed" || (proposal.status === "approved" && proposal.apply_error)) && (
        <label className={cn("mt-2 flex items-start gap-2 text-[12px]", PART_TREATMENTS.proposal.accent)}>
          <input
            type="checkbox"
            checked={ackWarnings}
            onChange={(e) => setAckWarnings(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-amber-600"
          />
          <span>
            I've read the warn findings above and want the run dispatched anyway
            (the same "Run anyway" acknowledgment the Lab asks for).
          </span>
        </label>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {proposal.status === "proposed" && (
          <>
            <Button size="sm" className="h-7 px-3 text-[12.5px]" disabled={busy}
              onClick={() => run(() => approve(proposal.id, applyOpts))}>
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
              onClick={() => run(() => retryApply(proposal.id, applyOpts))}>
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
