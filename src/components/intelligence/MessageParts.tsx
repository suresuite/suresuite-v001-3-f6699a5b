/**
 * Assistant message content cards (ChatPart kinds from useProjectChat).
 *
 * Every card is a left-accented sharp-cornered panel so a long reply reads as
 * a stack of typed blocks rather than a wall: neutral #b8b8b8 for data
 * (table/kpi/bullets), firm #e0930b for plans, brand red for mode refusals,
 * product purple for memory. Tables use the mono UPPERCASE header on ink
 * with ~30px rows, matching adminUi's TH/TD.
 */
import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ChatPart, ChatToolCall } from "@/hooks/useProjectChat";
import { LAYER, MonoChip, TD, TH, tint } from "./piUi";
import { cn } from "@/lib/utils";

const CARD = "mt-2 rounded-sm border border-[--hair-border]";
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
        className="rounded-sm px-2.5 py-1 text-[11px]"
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
            <div className="border-b border-[--hair-border] px-2.5 py-2 text-[11.5px] text-muted-foreground">
              The drafted reply couldn't be traced to project data, so a grounded fallback shipped instead.
            </div>
          )}
          {citations.map((c, i) => (
            <div key={i} className="flex gap-2 border-b border-[--hair-divider] px-2.5 py-1.5 text-[12px] last:border-b-0">
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
              {columns.map((c) => (
                <th key={c} className={TH}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-[#fcfcfc]">
                {r.map((cell, j) => (
                  <td key={j} className={TD}>
                    {String(cell ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.sourceTool && (
        <div className="border-t border-[--hair-divider] px-2.5 py-1 text-[10.5px] text-muted-foreground">
          Source: <span className="font-mono">{data.sourceTool}</span>
        </div>
      )}
    </div>
  );
}

export function KpiPart({ data }: { data: any }) {
  const cards: any[] = data?.cards ?? [];
  return (
    <div
      className={cn(CARD, "grid gap-px bg-[--hair-divider]")}
      style={{ ...accent("#b8b8b8"), gridTemplateColumns: "repeat(" + Math.min(cards.length || 1, 3) + ",1fr)" }}
    >
      {cards.map((c, i) => (
        <div key={i} className="bg-background p-2.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{c.label}</div>
          <div className="mt-0.5 text-[16px] font-semibold text-foreground">{c.value}</div>
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

const STEP_DOT: Record<string, string> = {
  pending: "#d9d9d9",
  active: LAYER.firm,
  done: LAYER.process,
  failed: LAYER.brand,
  refused: "#d9d9d9",
  awaiting_approval: LAYER.accent,
  awaiting_run: LAYER.firm,
};

export function PlanPart({ data }: { data: any }) {
  const steps: any[] = data?.steps ?? [];
  return (
    <div className={cn(CARD, "px-3 py-2.5")} style={accent(LAYER.firm)}>
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-semibold text-foreground">{data?.title ?? "Task plan"}</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {data?.status}
        </span>
      </div>
      {steps.map((s, i) => (
        <div key={s.id ?? i} className="mt-[7px] flex items-center gap-[7px] text-[12.5px]">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: STEP_DOT[s.status] ?? "#d9d9d9" }}
          />
          <span className="text-foreground">{s.label}</span>
          <span className="text-[11px] text-muted-foreground">{String(s.status ?? "").replace(/_/g, " ")}</span>
          {s.note && <span className="text-[11px] text-muted-foreground">— {s.note}</span>}
        </div>
      ))}
    </div>
  );
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
    <div className="mt-2.5 overflow-hidden rounded-sm border border-[--hair-border]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-[7px] bg-[#fcfcfc] px-2.5 py-1.5 text-left text-[12px] text-muted-foreground"
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: allOk ? LAYER.process : LAYER.brand }}
        />
        <span className="flex-1">{summary}</span>
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="border-t border-[--hair-border] px-2.5 py-1.5 font-mono text-[11px]">
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
