/**
 * Assistant message content cards (ChatPart kinds from useProjectChat).
 *
 * Every card is a left-accented sharp-cornered panel so a long reply reads as
 * a stack of typed blocks rather than a wall: neutral #b8b8b8 for data
 * (table/kpi/bullets), firm #e0930b for plans, brand red for mode refusals,
 * product purple for memory. Tables use TH_MESSAGE/TD_MESSAGE — the demo's
 * light #fafafa header with grey mono labels and mono cells, which is the
 * in-reply table, not the page ledger (piUi explains the split). Above md
 * both restore the ledger literal, so desktop is unchanged.
 */
import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ChatPart, ChatToolCall } from "@/hooks/useProjectChat";
import { LAYER, MonoChip, StatusDot, TD_MESSAGE, TH_MESSAGE, tint } from "./piUi";
import { cn } from "@/lib/utils";
import { PlanCard, type PlanPartData } from "@/components/chat/PlanCard";
import { FROZEN_CELL, FROZEN_CELL_ON_TINT } from '@/components/shared';

// The demo's card hairline is #ebebeb — lighter than the --hair-border token,
// which reads too heavy at three cards stacked in a reply. md: restores it.
const CARD = "mt-2 rounded-sm border border-[#ebebeb] md:border-[--hair-border]";
const accent = (hex: string) => ({ borderLeft: "2px solid " + hex });

/* ── evidence (H1 §22.2) ─────────────────────────────────────────────── */

export function EvidencePart({ data }: { data: any }) {
  const [open, setOpen] = useState(false);
  const citations: any[] = data?.citations ?? [];
  const fallback = Boolean(data?.fallback ?? data?.not_grounded);
  const label = fallback
    ? "not_grounded — fallback reply"
    : "grounded — " + citations.length + (citations.length === 1 ? " source" : " sources");

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="min-h-11 rounded-sm px-3 text-[11.5px] md:min-h-0 md:px-2.5 md:py-1 md:text-[11px]"
        style={{
          background: tint(fallback ? LAYER.brand : "#6b6b6b", 0.1),
          color: fallback ? LAYER.brand : "#5a5a5a",
        }}
      >
        {label} {open ? "︿" : "﹀"}
      </button>
      {open && (
        <div className={cn(CARD, "mt-1.5")} style={accent("#9a9a9a")}>
          {fallback && (
            <div className="border-b border-b-[#e8e8ea] px-2.5 py-2 text-[11.5px] text-muted-foreground md:border-b-[--hair-border]">
              The drafted reply couldn't be traced to project data, so a grounded fallback shipped instead.
            </div>
          )}
          {citations.map((c, i) => (
            <div key={i} className="flex gap-2 border-b border-b-[#e8e8ea] px-[11px] py-2 text-[12px] last:border-b-0 md:border-b-[--hair-divider] md:px-2.5 md:py-1.5">
              <span className="font-mono text-muted-foreground">[{i + 1}]</span>
              <span className="text-muted-foreground">{c.label ?? c.kind}</span>
              <span className="font-mono text-foreground">{c.ref ?? c.reference ?? ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── table / kpi / bullets ───────────────────────────────────────────── */

export function TablePart({ data }: { data: any }) {
  const columns: string[] = data?.columns ?? [];
  const rows: any[][] = data?.rows ?? [];
  return (
    <div className={cn(CARD, "overflow-hidden")} style={accent("#b8b8b8")}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {columns.map((c, i) => (
                // FROZEN_CELL_ON_TINT, not FROZEN_CELL (§2.7): TH_MESSAGE
                // already paints its own opaque header fill, and FROZEN_CELL's
                // bg-background would repaint it — which is what turned the
                // first column header into white-on-white on a phone.
                //
                // md:bg-transparent is kept deliberately. FROZEN_CELL carried
                // it, so above md this cell has always rendered transparent
                // while its neighbours render on ink. That is a desktop defect,
                // but fixing it is a desktop change and this work is mobile-only
                // — so the desktop rendering is preserved exactly and the defect
                // is reported rather than folded in here.
                <th key={c} className={cn(TH_MESSAGE, i === 0 && FROZEN_CELL_ON_TINT, i === 0 && "md:bg-transparent")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-[#fcfcfc]">
                {r.map((cell, j) => (
                  <td key={j} className={cn(TD_MESSAGE, j === 0 && FROZEN_CELL)}>
                    {String(cell ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.sourceTool && (
        <div className="border-t border-t-[#e8e8ea] px-2.5 py-1.5 text-[length:var(--fs-micro)] text-[#525252] md:border-t-[--hair-divider] md:py-1 md:text-muted-foreground">
          Source: <span className="font-mono">{data.sourceTool}</span>
        </div>
      )}
    </div>
  );
}

export function KpiPart({ data }: { data: any }) {
  const cards: any[] = data?.cards ?? [];
  return (
    // Three narrow columns do not fit a 320px phone. Below md the strip is the
    // §2.3 auto-fit 2-up that collapses to 1-up under 360; at md the desktop
    // count (up to 3) is restored from --kpi-cols.
    <div
      className={cn(
        CARD,
        "grid grid-cols-[repeat(auto-fit,minmax(min(140px,100%),1fr))] gap-px bg-[#e8e8ea] md:bg-[--hair-divider]",
        "md:[grid-template-columns:repeat(var(--kpi-cols),minmax(0,1fr))]",
      )}
      style={{ ...accent("#b8b8b8"), "--kpi-cols": Math.min(cards.length || 1, 3) } as React.CSSProperties}
    >
      {cards.map((c, i) => (
        <div key={i} className="bg-background px-[11px] py-2.5 md:p-2.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#525252] md:text-[10px] md:text-muted-foreground">
            {c.label}
          </div>
          <div className="mt-[3px] text-[16px] font-semibold tabular-nums text-foreground md:mt-0.5">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

export function BulletsPart({ data }: { data: any }) {
  const items: string[] = data?.items ?? [];
  return (
    <div className={cn(CARD, "py-2.5 pl-[26px] pr-2.5")} style={accent("#b8b8b8")}>
      <ul className="m-0 list-disc p-0 text-[13px] leading-[1.7] text-foreground">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

/* ── plan checklist (H3 §21.2) ───────────────────────────────────────── */

/**
 * Plans are SERVER state (§21.2): the {kind:"plan"} part carries a render
 * snapshot, and the live checklist comes from subscribing to the chat_plans
 * row. This surface used to draw the snapshot directly, so a plan advancing in
 * the background stayed frozen here while the same plan animated correctly in
 * the floating chat bubble, which renders the real PlanCard. Delegate to it —
 * one plan renderer, live on every surface.
 */
export function PlanPart({ data }: { data: unknown }) {
  return <PlanCard data={data as PlanPartData} />;
}

/* ── mode notice (§15) ───────────────────────────────────────────────── */

export function ModeNoticePart({ data, onSwitchToReview }: { data: any; onSwitchToReview?: () => void }) {
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-[#f0c7cb] bg-[#fdf2f3] px-3 py-2"
      style={accent(LAYER.brand)}
    >
      {data?.blocked_intent && (
        <MonoChip color={LAYER.brand}>{data.blocked_intent}</MonoChip>
      )}
      <span className="text-[12.5px] text-[#8a2a30]">
        {data?.message ?? "Decision Support mode — nothing was changed."}
      </span>
      {onSwitchToReview && (
        <button
          type="button"
          onClick={onSwitchToReview}
          className="rounded-sm bg-foreground px-2.5 py-1 text-[12px] text-background"
        >
          Switch to Review
        </button>
      )}
    </div>
  );
}

/* ── memory consent chips (M2 §14.4) ─────────────────────────────────── */

export function MemoryPart({
  data,
  saved,
  onSave,
  onDismiss,
}: {
  data: any;
  saved: boolean;
  onSave?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-[#e4d9fb] bg-[#faf8ff] px-3 py-2"
      style={accent(LAYER.product)}
    >
      {saved ? (
        <span className="text-[12.5px] text-[#5b21b6]">Saved to project memory.</span>
      ) : (
        <>
          <span className="flex-1 text-[12.5px] text-foreground">
            Save this for the project? <span className="text-muted-foreground">“{data?.content}”</span>
          </span>
          <button
            type="button"
            onClick={onSave}
            className="rounded-sm bg-foreground px-2.5 py-1 text-[12px] text-background"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-sm border border-[#e4d9fb] bg-background px-2.5 py-1 text-[12px] text-muted-foreground"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}

/* ── activity group (§17.2) ──────────────────────────────────────────── */

export function ActivityGroup({ toolCalls }: { toolCalls: ChatToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (!toolCalls?.length) return null;
  const allOk = toolCalls.every((c) => c.ok);
  const totalMs = toolCalls.reduce((a, c) => a + (c.duration_ms ?? 0), 0);
  const summary =
    "Analyzed project data · " +
    toolCalls.length +
    (toolCalls.length === 1 ? " step" : " steps") +
    (totalMs ? " · " + (totalMs / 1000).toFixed(1) + "s" : "");

  return (
    <div className="mt-2.5 overflow-hidden rounded-sm border border-[#ebebeb] md:border-[--hair-border]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-[7px] bg-[#fcfcfc] p-2.5 text-left text-[12px] text-muted-foreground md:min-h-0 md:px-2.5 md:py-1.5"
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: allOk ? LAYER.process : LAYER.brand }}
        />
        <span className="flex-1">{summary}</span>
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="border-t border-t-[#ebebeb] px-2.5 py-2 font-mono text-[11px] md:border-t-[--hair-border] md:py-1.5">
          {toolCalls.map((c, i) => (
            <div key={i} className="flex items-center gap-[7px] py-0.5">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: c.ok ? LAYER.process : LAYER.brand }}
              />
              <span className="text-foreground">{c.name}</span>
              <span className="text-muted-foreground">
                · {c.row_count} {c.row_count === 1 ? "row" : "rows"}
                {c.duration_ms ? " · " + (c.duration_ms / 1000).toFixed(1) + "s" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── merged meta row (v1b space pass) ────────────────────────────────── */

/**
 * The reply's evidence, as ONE row.
 *
 * It used to be two stacked blocks under every grounded answer: the grounding
 * chip (EvidencePart) and the activity accordion (ActivityGroup), each with
 * its own border, its own fill and its own disclosure. Two bordered bands
 * under a three-line answer cost more vertical space than the answer, and
 * they say one thing between them — where this came from.
 *
 * Both affordances are kept, not traded: the steps and the citations both
 * still expand, from a single chevron, and either half renders alone when
 * only one is present. The stream composes this in place of the two blocks
 * (desktop only — the phone tree still stacks them, see MessageStream).
 */
export function MetaRow({
  toolCalls = [],
  evidence,
}: {
  toolCalls?: ChatToolCall[];
  // useProjectChat's part payloads are untyped JSON by design.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evidence?: any;
}) {
  const [open, setOpen] = useState(false);
  const hasSteps = toolCalls.length > 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const citations: any[] = evidence?.citations ?? [];
  const hasEvidence = Boolean(evidence);
  if (!hasSteps && !hasEvidence) return null;

  const allOk = toolCalls.every((c) => c.ok);
  const totalMs = toolCalls.reduce((a, c) => a + (c.duration_ms ?? 0), 0);
  const steps =
    "Analyzed project data · " +
    toolCalls.length +
    (toolCalls.length === 1 ? " step" : " steps") +
    (totalMs ? " · " + (totalMs / 1000).toFixed(1) + "s" : "");

  const fallback = Boolean(evidence?.fallback ?? evidence?.not_grounded);
  const grounding = fallback
    ? "not_grounded — fallback reply"
    : "grounded — " + citations.length + (citations.length === 1 ? " source" : " sources");

  return (
    <div className="mt-1.5 overflow-hidden rounded-sm border border-[--hair-border] bg-[#fcfcfc]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-1.5 px-2 py-1 text-left"
      >
        {hasSteps && (
          <>
            <StatusDot ok={allOk} />
            <span className="text-[11.5px] text-muted-foreground">{steps}</span>
          </>
        )}
        {hasSteps && hasEvidence && <span className="h-2.5 w-px shrink-0 bg-[#e0e0e0]" />}
        {hasEvidence && (
          <span className="text-[11.5px]" style={{ color: fallback ? LAYER.brand : "#5a5a5a" }}>
            {grounding}
          </span>
        )}
        <ChevronRight
          className={cn("ml-auto h-3 w-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
      </button>

      {open && (hasSteps || fallback || citations.length > 0) && (
        <div className="border-t border-[--hair-border] bg-background px-2.5 py-1.5">
          {toolCalls.map((c, i) => (
            <div key={"s" + i} className="flex items-center gap-[7px] py-0.5 font-mono text-[11px]">
              <StatusDot ok={c.ok} />
              <span className="text-foreground">{c.name}</span>
              <span className="text-muted-foreground">
                · {c.row_count} {c.row_count === 1 ? "row" : "rows"}
                {c.duration_ms ? " · " + (c.duration_ms / 1000).toFixed(1) + "s" : ""}
              </span>
            </div>
          ))}
          {fallback && (
            <p className="m-0 py-0.5 text-[11.5px] leading-[1.5] text-muted-foreground">
              The drafted reply couldn't be traced to project data, so a grounded fallback shipped instead.
            </p>
          )}
          {citations.map((c, i) => (
            <div key={"c" + i} className="flex gap-2 py-0.5 text-[11.5px]">
              <span className="font-mono text-muted-foreground">[{i + 1}]</span>
              <span className="text-muted-foreground">{c.label ?? c.kind}</span>
              <span className="font-mono text-foreground">{c.ref ?? c.reference ?? ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Agent hand-off divider ("<Agent> drafted a proposal"). */
export function AgentDivider({ agentName }: { agentName: string }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="h-px flex-1 bg-[--hair-border]" />
      <span className="text-[11px] text-muted-foreground">
        <strong className="text-foreground">{agentName}</strong> drafted a proposal
      </span>
      <span className="h-px flex-1 bg-[--hair-border]" />
    </div>
  );
}

/** Dispatch a ChatPart to its card. `proposal` is handled by the caller
 * (it needs the proposals hook), so it falls through to null here. */
export function MessagePart({
  part,
  onSwitchToReview,
  onSaveMemory,
  onDismissMemory,
}: {
  part: ChatPart;
  onSwitchToReview?: () => void;
  onSaveMemory?: () => void;
  onDismissMemory?: () => void;
}) {
  const data = part.data as any;
  switch (part.kind) {
    case "evidence":
      return <EvidencePart data={data} />;
    case "table":
      return <TablePart data={data} />;
    case "kpi":
      return <KpiPart data={data} />;
    case "bullets":
      return <BulletsPart data={data} />;
    case "plan":
      return <PlanPart data={data} />;
    case "mode_notice":
      return <ModeNoticePart data={data} onSwitchToReview={onSwitchToReview} />;
    case "memory_offer":
      return <MemoryPart data={data} saved={false} onSave={onSaveMemory} onDismiss={onDismissMemory} />;
    case "memory_saved":
      return <MemoryPart data={data} saved />;
    case "text":
      return <div className="mt-2 whitespace-pre-wrap text-[14px] leading-[1.65] text-foreground">{data?.text}</div>;
    default:
      return null;
  }
}
