/**
 * ProposalCardView — PRESENTATIONAL proposal card for an AI-drafted artifact
 * (ai-agents.md §4.5/§4.6).
 *
 * This does NOT replace src/components/chat/ProposalCard.tsx. That component's
 * contract is `{ proposalId, onSuggestUtterance }` — it resolves the proposal
 * itself and MessageBubble renders it by id. Keep that container and have it
 * render THIS view with the resolved data, so existing call sites keep working
 * and only the visuals change.
 *
 * Provenance is never implied: the chip says "AI-drafted — verify" or
 * "computed from your data", the value table always shows [low, high], method
 * and source, and apply failures surface the server's reason with Retry
 * rather than a silent revert. Rejected cards stay in the thread at reduced
 * opacity — the audit trail is the point.
 */
import React from "react";
import { AGENT_COLOR, AGENT_MONO, LAYER, TD, TH, tint } from "../intelligence/piUi";
import { cn } from "@/lib/utils";
import { FROZEN_CELL, FROZEN_CELL_ON_TINT } from '@/components/shared';

export interface ProposalRow {
  table?: string;
  entity: string;
  field: string;
  value: string;
  low?: string;
  high?: string;
  method?: string;
  source?: string;
}

export interface Proposal {
  id: string;
  title: string;
  agent: string;
  agentId?: string;
  artifactType: "parameter_estimate" | "item_master_diff" | string;
  provenance: string;
  status: "proposed" | "approved" | "applied" | "rejected";
  applyError?: string | null;
  appliedAt?: string | null;
  expiresLabel?: string;
  rows: ProposalRow[];
  citations?: string[];
}

const STATUS_COLOR = (p: Proposal) => {
  if (p.status === "applied") return LAYER.process;
  if (p.status === "rejected") return "#9a9a9a";
  if (p.status === "approved" && p.applyError) return LAYER.brand;
  return LAYER.firm;
};

export function ProposalCardView({
  proposal,
  onApprove,
  onReject,
  onRetry,
}: {
  proposal: Proposal;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const color = AGENT_COLOR[proposal.agentId ?? ""] ?? LAYER.firm;
  const mono = AGENT_MONO[proposal.agentId ?? ""] ?? proposal.agent.slice(0, 2).toUpperCase();
  const isParam = proposal.artifactType === "parameter_estimate";
  const applying = proposal.status === "approved" && !proposal.applyError;
  const failed = proposal.status === "approved" && Boolean(proposal.applyError);

  return (
    <div
      className="mt-2 rounded-sm border border-[--hair-border] px-3 py-2.5"
      style={{ borderLeft: "2px solid " + color, opacity: proposal.status === "rejected" ? 0.55 : 1 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="flex h-[22px] w-[22px] items-center justify-center rounded-sm font-mono text-[9px] font-semibold"
          style={{ background: tint(color, 0.12), color }}
        >
          {mono}
        </span>
        <span className="text-[13px] font-semibold text-foreground">{proposal.agent}</span>
        <span className="rounded-sm bg-[#f4f4f4] px-[7px] py-px text-[10.5px] font-medium text-muted-foreground">
          {proposal.provenance}
        </span>
        <span
          className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{ color: STATUS_COLOR(proposal) }}
        >
          {proposal.status}
        </span>
      </div>

      <div className="mt-1.5 text-[13.5px] font-medium text-foreground">{proposal.title}</div>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {!isParam && <th className={cn(TH, FROZEN_CELL_ON_TINT)}>Table</th>}
              <th className={cn(TH, isParam && FROZEN_CELL_ON_TINT)}>Entity</th>
              <th className={TH}>Field</th>
              <th className={TH}>Value</th>
              {isParam && <th className={TH}>[low, high]</th>}
              {isParam && <th className={TH}>Method</th>}
              <th className={TH}>Source</th>
            </tr>
          </thead>
          <tbody>
            {proposal.rows.map((r, i) => (
              <tr key={i} className="hover:bg-[#fcfcfc]">
                {!isParam && <td className={cn(TD, "font-mono", FROZEN_CELL)}>{r.table}</td>}
                <td className={cn(TD, "font-mono", isParam && FROZEN_CELL)}>{r.entity}</td>
                <td className={TD}>{r.field}</td>
                <td className={cn(TD, "font-mono")}>{r.value}</td>
                {isParam && (
                  <td className={cn(TD, "font-mono")}>
                    [{r.low}, {r.high}]
                  </td>
                )}
                {isParam && <td className={cn(TD, "font-mono")}>{r.method}</td>}
                <td className={TD}>{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Boolean(proposal.citations?.length) && (
        <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
          {proposal.citations!.map((c) => (
            <span key={c} className="mr-2">
              {c}
            </span>
          ))}
        </div>
      )}

      {proposal.status === "proposed" && proposal.expiresLabel && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">{proposal.expiresLabel}</div>
      )}

      {applying && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[#8a6d1f]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: LAYER.firm }} />
          applying…
        </div>
      )}

      {failed && (
        <div className="mt-2 rounded-sm border border-[#f0c7cb] bg-[#fdf2f3] px-2.5 py-1.5 text-[12px] text-[#8a2a30]">
          {proposal.applyError}
        </div>
      )}

      {proposal.status === "applied" && (
        <div
          className="mt-2 rounded-sm px-2.5 py-1.5 text-[12px] text-[#0f6b60]"
          style={{ background: tint(LAYER.process, 0.12) }}
        >
          Applied · {proposal.appliedAt}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-2">
        {proposal.status === "proposed" && (
          <>
            <button
              type="button"
              onClick={() => onApprove(proposal.id)}
              className="rounded-sm bg-foreground px-3 py-1.5 text-[12.5px] text-background"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onReject(proposal.id)}
              className="rounded-sm border border-[--hair-border] bg-background px-3 py-1.5 text-[12.5px] text-foreground"
            >
              Reject
            </button>
          </>
        )}
        {failed && (
          <>
            <button
              type="button"
              onClick={() => onRetry(proposal.id)}
              className="rounded-sm bg-foreground px-3 py-1.5 text-[12.5px] text-background"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => onReject(proposal.id)}
              className="rounded-sm border border-[--hair-border] bg-background px-3 py-1.5 text-[12.5px] text-foreground"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
