// The Simulation Lab pane switcher (UI pass) — replaces the shadcn ToggleGroup.
//
// The five panes are an ordered, gated sequence — not free tabs. The band, the
// eyebrow and the live gate readout are what say so. Purely presentational:
// every sub-label is a fact derived from state the page already holds, never a
// hint.
//
// This file also owns the *shared* process-rail rule set — tokens, shell and
// atoms — that both this rail and the Policies "Model setup" rail
// (components/policies/PolicySetupBar.tsx) render from. Neither rail is allowed
// its own typography, radius or state colours: change them here, once.
import React from "react";
import { cn } from "@/lib/utils";
import { KX_TIGHT, LAYER } from "@/components/intelligence/piUi";

/* ── shared rail rule set ────────────────────────────────────────────────
 * Resolved values of the product tokens: --brand-ink, --zinc-quiet,
 * --hair-rule, --surface-sunken, LAYER.firm, LAYER.process. Kept as literals
 * so they can be handed to inline `style` (a CSS var cannot be interpolated
 * into a gradient-free background reliably across both rails).
 */
export const RAIL = {
  /** --brand-ink */
  ink: "#171717",
  /** --zinc-quiet */
  muted: "#6b6b6b",
  /** --hair-rule — card + control borders */
  rule: "#d4d4d4",
  /** hairlines *inside* the rail */
  hair: "#f0f0f0",
  /** page --surface-sunken */
  canvas: "#ebebeb",
  /** LAYER.firm — the current stage */
  amber: LAYER.firm,
  /** LAYER.process — positive */
  teal: LAYER.process,
  /** the stage-row band */
  band: "#f4f4f4",
} as const;

/** done → behind you · current → exactly one · todo → ahead of you. */
export type RailState = "done" | "current" | "todo";

/** Rail container: white card, 1px #a3a3a3, radius 4, clipped. */
export const RAIL_SHELL = "overflow-hidden rounded-sm border border-[#a3a3a3] bg-white";
/** Eyebrow row: 7px 12px, closed by a 1px #ebebeb rule. */
export const RAIL_EYEBROW_ROW = "flex items-center gap-[9px] border-b border-[#ebebeb] px-3 py-[7px]";
/** Section eyebrow type: mono 10 / 500, uppercase, .16em, muted. */
export const RAIL_EYEBROW = cn(KX_TIGHT, "whitespace-nowrap font-medium");
/** Stage row: the band the cards sit in. */
export const RAIL_STAGE_ROW = "flex items-stretch gap-[10px] bg-[#f4f4f4] px-3 py-[10px]";

/** Right-side readout — 5px dot, 11.5px text, muted label + ink value. */
export function RailReadout({
  dot,
  label,
  value,
  tail,
}: {
  dot: string;
  label: string;
  value: string;
  tail?: string;
}) {
  return (
    <span className="flex shrink-0 items-center gap-[7px]">
      <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: dot }} />
      <span className="whitespace-nowrap text-[11.5px]" style={{ color: RAIL.muted }}>
        {label}{" "}
        <span className="font-medium" style={{ color: RAIL.ink }}>
          {value}
        </span>
        {tail ? ` ${tail}` : null}
      </span>
    </span>
  );
}

/** 16px square ink marker — the A / B / C row markers. */
export function RailMarker({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="grid h-4 w-4 shrink-0 place-items-center rounded-sm font-mono text-[9px] leading-none text-white"
      style={{ background: RAIL.ink }}
    >
      {children}
    </span>
  );
}

/** Muted mono 10px chip on #f0f0f0 — counts, Live/Snapshot, LOCKED. */
export function RailChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn("rounded-sm px-[5px] py-px font-mono text-[10px] leading-normal", className)}
      style={{ background: RAIL.hair, color: RAIL.muted }}
    >
      {children}
    </span>
  );
}

/** The separator between two stage cards. Identical in both rails. */
export function RailChevron() {
  return (
    <span
      aria-hidden
      className="flex shrink-0 select-none items-center text-[18px] leading-none"
      style={{ color: RAIL.muted }}
    >
      ›
    </span>
  );
}

/**
 * One stage card. White, 1px #d4d4d4, radius 4, in every state — the state is
 * carried by the badge and by the 3px bottom track, never by inverting the card
 * and never by a second indicator dot.
 */
export function RailStageCard({
  state,
  numeral,
  label,
  sub,
  onSelect,
  title,
  trailing,
}: {
  state: RailState;
  numeral: string;
  label: string;
  sub: string;
  onSelect: () => void;
  title?: string;
  trailing?: React.ReactNode;
}) {
  const done = state === "done";
  const current = state === "current";
  const badge = done
    ? { background: RAIL.ink, color: "#ffffff" }
    : current
      ? { background: RAIL.amber, color: "#ffffff" }
      : { background: RAIL.hair, color: RAIL.muted };
  const track = done ? RAIL.ink : current ? RAIL.amber : RAIL.rule;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={title}
      aria-current={current ? "step" : undefined}
      className="relative flex min-w-0 flex-[1_1_0] items-center gap-[10px] rounded-sm border border-[#d4d4d4] bg-white px-[10px] pb-[10px] pt-2 text-left transition-colors hover:bg-[#fafafa]"
    >
      <span
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[11px] font-medium leading-none"
        style={badge}
      >
        {done ? "✓" : numeral}
      </span>

      <span className="flex min-w-0 flex-col items-start gap-[2px]">
        <span
          className="flex items-center gap-1.5 truncate whitespace-nowrap text-[13px] font-semibold tracking-[-0.011em]"
          style={{ color: state === "todo" ? RAIL.muted : RAIL.ink }}
        >
          {label}
          {trailing}
        </span>
        <span
          className="truncate whitespace-nowrap font-mono text-[10.5px] font-normal tabular-nums"
          style={{ color: current ? RAIL.amber : RAIL.muted }}
        >
          {sub}
        </span>
      </span>

      {/* the state track — every card carries one, full width, 3px */}
      <span
        aria-hidden
        className="absolute rounded-sm"
        style={{ left: 0, right: 0, bottom: 0, height: 3, borderRadius: 4, background: track }}
      />
    </button>
  );
}

/* ── Simulation Lab rail ─────────────────────────────────────────────────── */

export type PaneId = "setup" | "recovery" | "run" | "results" | "compare";

export interface StageDef {
  id: PaneId;
  n: string;
  label: string;
  sub: string;
  /** the stage is behind you */
  done?: boolean;
  /** derived in buildStages; the active pane is promoted to "current" here */
  state: RailState;
}

export interface GateReadout {
  dot: string;
  label: string;
  value: string;
  tail?: string;
}

export interface StageRailProps {
  stages: StageDef[];
  active: PaneId;
  onSelect: (id: PaneId) => void;
  /** gate readout shown on the right of the eyebrow row */
  gate: GateReadout;
}

/** Equal-width cards (flex 1 1 0), 10px gap, a chevron between each pair. */
export function StageRail({ stages, active, onSelect, gate }: StageRailProps) {
  return (
    <section className={RAIL_SHELL}>
      <div className={RAIL_EYEBROW_ROW}>
        <span className={RAIL_EYEBROW}>Scenario run sequence</span>
        <span className="h-px flex-1" style={{ background: RAIL.rule }} />
        <RailReadout dot={gate.dot} label={gate.label} value={gate.value} tail={gate.tail} />
      </div>

      <div className={RAIL_STAGE_ROW}>
        {stages.map((s, i) => (
          <React.Fragment key={s.id}>
            {i > 0 ? <RailChevron /> : null}
            <RailStageCard
              state={s.id === active ? "current" : s.state}
              numeral={s.n}
              label={s.label}
              sub={s.sub}
              title={`${s.label} — ${s.sub}`}
              onSelect={() => onSelect(s.id)}
            />
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

/**
 * Build the stage list from the page's real state. Keep this next to the page so
 * the sub-labels stay honest — every one of them is a fact, never a hint. Copy
 * grammar is `value · value · value`: lowercase, spaced units, never a sentence.
 */
export function buildStages(args: {
  scenario: { horizon_days: number; replications: number; primary_kpi: string };
  eventCount: number;
  leverCount: number;
  recoveryEnabled: boolean;
  gate: { blocks: number; warns: number; reason: string | null };
  run: { status: string; rep_count_done: number; rep_count_target: number; current: boolean } | null;
  scenariosWithResults: number;
}): { stages: StageDef[]; gate: GateReadout } {
  const { scenario, eventCount, leverCount, recoveryEnabled, gate, run, scenariosWithResults } = args;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const blockText = plural(gate.blocks, "blocking finding", "blocking findings");
  const warnText = plural(gate.warns, "warning", "warnings");

  const runSub = run
    ? run.status === "running" || run.status === "queued"
      ? `${run.status} · ${run.rep_count_done}/${run.rep_count_target} reps`
      : `${run.status} · ${plural(run.rep_count_done, "rep", "reps")}`
    : "no run yet";

  const runStageSub = gate.reason
    ? gate.blocks > 0
      ? blockText
      : `${warnText} — ack required`
    : run?.status === "running"
      ? "running"
      : "ready to run";

  const stage = (
    id: PaneId,
    n: string,
    label: string,
    sub: string,
    done: boolean,
  ): StageDef => ({ id, n, label, sub, done, state: done ? "done" : "todo" });

  const stages: StageDef[] = [
    stage(
      "setup",
      "1",
      "Setup",
      `${scenario.horizon_days} d · ${plural(scenario.replications, "rep", "reps")} · ${scenario.primary_kpi}`,
      !!scenario.primary_kpi,
    ),
    stage(
      "recovery",
      "2",
      "Recovery playbook",
      `${plural(eventCount, "event", "events")} · ${plural(leverCount, "lever", "levers")}`,
      // never tick a stage that has nothing scheduled
      eventCount > 0 && recoveryEnabled && leverCount > 0,
    ),
    // a completed run with an open gate is not "done"
    stage("run", "3", "Run", runStageSub, run?.status === "done" && !gate.reason),
    stage("results", "4", "Results", runSub, run?.status === "done" && !!run.current),
    stage(
      "compare",
      "5",
      "Compare",
      plural(scenariosWithResults, "scenario with results", "scenarios with results"),
      scenariosWithResults >= 2,
    ),
  ];

  const gateReadout: GateReadout =
    gate.blocks > 0
      ? { dot: LAYER.brand, label: "gate", value: blockText, tail: "— run gated" }
      : gate.warns > 0 && gate.reason
        ? { dot: RAIL.amber, label: "gate", value: warnText, tail: "— acknowledge to run" }
        : { dot: RAIL.teal, label: "gate", value: "clear", tail: "— run allowed" };

  return { stages, gate: gateReadout };
}
