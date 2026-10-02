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
import { formatDuration } from "@/lib/sim/planningTime";
import type { RunGateState } from "@/lib/sim/runGate";
import { KPI_OPTIONS } from "./ScenarioSetupForm";

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
  /** settled eyebrow / label colour */
  quiet: "#9a9a9a",
  /** divider between collapsed rows */
  hairFaint: "#f4f4f4",
  zinc: {
    /** --zinc-chip, the open-band fill */
    band: "#f0f0f2",
    /** --zinc-border */
    border: "#e0e0e3",
    /** --zinc-quiet */
    quiet: "#71717a",
    /** --zinc-body */
    body: "#52525b",
    /** --zinc-ink */
    ink: "#18181b",
  },
} as const;

/** Label column. 220px so a collapsed row's value starts on the stage-card edge. */
export const RAIL_LABEL_COL = "w-full min-w-0 md:w-[220px] md:shrink-0";

/** done → behind you · current → exactly one · todo → ahead of you. */
export type RailState = "done" | "current" | "todo";

/** Rail container: white card, 1px #a3a3a3, radius 4, clipped. */
export const RAIL_SHELL = "overflow-hidden rounded-sm border border-[#a3a3a3] bg-white";
/** Eyebrow row: 7px 12px, closed by a 1px #ebebeb rule. */
export const RAIL_EYEBROW_ROW =
  // The kicker and the gate readout measure 160px + 274px against 270px of room
  // at 320px, so below `md` the readout wraps to its own line rather than
  // pushing the row sideways. `md:flex-nowrap` restores the desktop row exactly.
  "flex flex-wrap items-center gap-[9px] border-b border-[#ebebeb] px-3 py-[7px] md:flex-nowrap";
/** Section eyebrow type: mono 10 / 500, uppercase, .16em, muted. */
export const RAIL_EYEBROW = cn(KX_TIGHT, "whitespace-nowrap font-medium");
/** Stage row: the band the cards sit in. */
export const RAIL_STAGE_ROW =
  // Five equal-width cards need 50px of chrome each before any text; at 320px
  // the row has 270px for all five, so `flex-1 basis-0` leaves them negative
  // room and the labels vanish. The sequence is the information, so it scrolls
  // rather than reflowing (§2.7) — the same treatment the admin sub-nav carries.
  // `md:overflow-visible` means the desktop row is untouched.
  "flex items-stretch gap-[10px] overflow-x-auto bg-[#f4f4f4] px-3 py-[10px] " +
  "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:overflow-visible";

/** The open (sunken) band row — zinc ramp, used by the section that's active. */
export const RAIL_STAGE_ROW_OPEN = "flex items-stretch p-3 border-t";
export const RAIL_STAGE_ROW_OPEN_STYLE = {
  background: RAIL.zinc.band,
  borderColor: RAIL.zinc.border,
} as const;

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
export function RailMarker({
  children,
  settled = false,
}: {
  children: React.ReactNode;
  settled?: boolean;
}) {
  return (
    <span
      className="grid h-4 w-4 shrink-0 place-items-center rounded-sm font-mono text-[9px] leading-none text-white"
      style={{ background: settled ? RAIL.muted : RAIL.ink }}
    >
      {children}
    </span>
  );
}

/**
 * One settled section, one line. `summary` is a mono `value · value · value`
 * run — never a sentence — and the `▾` is the system's band-collapse glyph.
 */
export function RailCollapsedRow({
  letter,
  label,
  summary,
  onExpand,
  last = false,
}: {
  letter: string;
  label: string;
  summary: React.ReactNode;
  onExpand: () => void;
  /** last collapsed row before the open band — divides on the full hairline */
  last?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-start gap-1.5 px-3 py-1.5 border-b md:flex-row md:items-center md:gap-0"
      style={{ borderColor: last ? RAIL.rule : RAIL.hairFaint }}
    >
      <span className={cn(RAIL_LABEL_COL, "flex items-center gap-[7px]")}>
        <RailMarker settled>{letter}</RailMarker>
        <span className={RAIL_EYEBROW} style={{ color: RAIL.quiet }}>
          {label}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">{summary}</span>
      <button
        type="button"
        onClick={onExpand}
        aria-label={`Expand ${label}`}
        title="Expand"
        className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-sm border bg-white text-[11px] leading-none transition-colors hover:bg-[#fafafa]"
        style={{ borderColor: "#e4e4e4", color: RAIL.muted }}
      >
        ▾
      </button>
    </div>
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
export function RailChevron({ palette = "grey" }: { palette?: "grey" | "zinc" }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 select-none items-center text-[18px] leading-none"
      style={{ color: palette === "zinc" ? RAIL.zinc.quiet : RAIL.muted }}
    >
      ›
    </span>
  );
}

export type Palette = "grey" | "zinc";

const CARD = {
  grey: { border: "#d4d4d4", bg: "#ffffff", body: "#525252", quiet: "#6b6b6b", chip: "#f0f0f0", done: RAIL.ink },
  zinc: { border: RAIL.zinc.border, bg: "#ffffff", body: RAIL.zinc.body, quiet: RAIL.zinc.quiet, chip: RAIL.zinc.band, done: RAIL.zinc.body },
} satisfies Record<Palette, Record<string, string>>;

/**
 * Badge fill for a stage numeral. Exported so a second rendering of the same
 * step sequence (the Policies mobile step list) carries the identical state
 * vocabulary instead of a copy that can drift out of step with this one.
 */
export function railBadgeStyle(
  state: RailState,
  needsSetup = false,
  palette: Palette = "grey",
): React.CSSProperties {
  const c = CARD[palette];
  if (state === "current") return { background: RAIL.amber, color: "#ffffff" };
  if (needsSetup)
    return {
      background: "rgba(191,35,48,0.08)",
      color: "#bf2330",
      boxShadow: "inset 0 0 0 1px rgba(191,35,48,0.4)",
    };
  if (state === "done") return { background: c.done, color: "#ffffff" };
  return { background: c.chip, color: c.quiet };
}

/**
 * One stage card. White, 1px border, radius 4, in every state — the state is
 * carried by the badge and by the 3px bottom track, never by inverting the card
 * and never by a second indicator dot. `needsSetup` marks a required setting
 * as missing — the only state that carries red, as a signal (ringed numeral +
 * meta text), never a card fill.
 */
export function RailStageCard({
  state,
  numeral,
  label,
  sub,
  onSelect,
  title,
  trailing,
  palette = "grey",
  needsSetup = false,
}: {
  state: RailState;
  numeral: string;
  label: string;
  sub: string;
  onSelect: () => void;
  title?: string;
  trailing?: React.ReactNode;
  palette?: Palette;
  needsSetup?: boolean;
}) {
  const done = state === "done";
  const current = state === "current";
  const c = CARD[palette];
  const badge = railBadgeStyle(state, needsSetup, palette);
  const track = current ? RAIL.amber : done ? c.done : RAIL.rule;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={title}
      aria-current={current ? "step" : undefined}
      className="relative flex w-[180px] shrink-0 min-w-0 items-center gap-[10px] rounded-sm border bg-white px-[10px] pb-[10px] pt-2 text-left md:w-auto md:flex-1 md:shrink md:basis-0 transition-colors hover:bg-[#fafafa]"
      style={{ borderColor: c.border, background: c.bg }}
    >
      <span
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[11px] font-medium leading-none"
        style={badge}
      >
        {numeral}
      </span>

      {/* The text column takes the card's remaining width and both lines WRAP
          inside it. They used to `truncate` from an `items-start` column, which
          sized each line to its own content, so nothing clipped and a long label
          or sub-label ran out of the card into its neighbour as the window
          narrowed. Wrapping keeps every fact readable at any width; the cards in
          a row stay equal height because the row is `items-stretch`. */}
      <span className="flex min-w-0 flex-1 flex-col items-start gap-[2px]">
        <span
          className="flex min-w-0 max-w-full items-center gap-1.5 text-[13px] font-semibold leading-tight tracking-[-0.011em]"
          style={{ color: state === "todo" ? c.quiet : palette === "zinc" ? RAIL.zinc.ink : RAIL.ink }}
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
          {trailing}
        </span>
        <span
          className="max-w-full font-mono text-[10.5px] font-normal leading-snug tabular-nums [overflow-wrap:anywhere]"
          style={{ color: current ? "#a1650a" : needsSetup ? "#bf2330" : c.quiet }}
        >
          {/* bind each `·` to the value before it and a number to its unit, so a
              wrapped line never opens on a separator or splits "10 reps" */}
          {sub.replace(/ · /g, " · ").replace(/(\d) (?=\S)/g, "$1 ")}
        </span>
      </span>

      {/* the state track — every card carries one, full width, 3px — deliberately NOT red on needsSetup */}
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
  // With the row scrolling below `md`, the current stage can sit off-screen.
  // Centre it, the way the admin sub-nav centres its active tab.
  const rowRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const strip = rowRef.current;
    const el = strip?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!strip || !el) return;
    const offset =
      el.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    strip.scrollLeft = Math.max(0, offset - (strip.clientWidth - el.clientWidth) / 2);
  }, [active]);

  return (
    <section className={RAIL_SHELL}>
      <div className={RAIL_EYEBROW_ROW}>
        <span className={RAIL_EYEBROW}>Run sequence</span>
        <span className="h-px flex-1" style={{ background: RAIL.rule }} />
        <RailReadout dot={gate.dot} label={gate.label} value={gate.value} tail={gate.tail} />
      </div>

      <div ref={rowRef} className={RAIL_STAGE_ROW}>
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
 * grammar is `value · value`: lowercase, terse, never a sentence (WP 9.4 slice 2).
 *
 * The gate arrives as ONE `RunGateState` (runGate.ts): stage 3's sub-label and
 * the readout are fields of it, never re-derived here from the counts — the
 * re-derivation is what read "clear" beside a disabled button (§4 D147).
 */
export function buildStages(args: {
  scenario: { horizon_days: number; replications: number; primary_kpi: string };
  eventCount: number;
  leverCount: number;
  recoveryEnabled: boolean;
  gate: RunGateState;
  run: { status: string; rep_count_done: number; rep_count_target: number; current: boolean } | null;
  scenariosWithResults: number;
}): { stages: StageDef[]; gate: GateReadout } {
  const { scenario, eventCount, leverCount, recoveryEnabled, gate, run, scenariosWithResults } = args;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const runSub = !run
    ? "no run"
    : run.status === "running" || run.status === "queued"
      ? `${run.status} ${run.rep_count_done}/${run.rep_count_target}`
      : run.status === "done"
        ? run.current
          ? "done"
          : "older version"
        : run.status;

  const kpi = KPI_OPTIONS.find((k) => k.value === scenario.primary_kpi)?.label ?? scenario.primary_kpi;

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
      `${formatDuration(scenario.horizon_days)} · ${plural(scenario.replications, "rep", "reps")} · ${kpi}`,
      !!scenario.primary_kpi,
    ),
    stage(
      "recovery",
      "2",
      "Recovery playbook",
      eventCount === 0
        ? "no events"
        : leverCount > 0 && recoveryEnabled
          ? `${plural(eventCount, "event", "events")} · ${plural(leverCount, "lever", "levers")}`
          : plural(eventCount, "event", "events"),
      // never tick a stage that has nothing scheduled
      eventCount > 0 && recoveryEnabled && leverCount > 0,
    ),
    // a completed run with a closed gate is not "done"
    stage("run", "3", "Run", gate.stageSub, run?.status === "done" && gate.canRun),
    stage("results", "4", "Results", runSub, run?.status === "done" && !!run.current),
    stage(
      "compare",
      "5",
      "Compare",
      plural(scenariosWithResults, "scenario", "scenarios"),
      scenariosWithResults >= 2,
    ),
  ];

  const dot =
    gate.readout.tone === "block"
      ? LAYER.brand
      : gate.readout.tone === "warn"
        ? RAIL.amber
        : gate.readout.tone === "clear"
          ? RAIL.teal
          : RAIL.quiet;

  return { stages, gate: { dot, label: "gate", value: gate.readout.value } };
}
