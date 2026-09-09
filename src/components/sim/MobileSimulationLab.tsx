/**
 * Simulation Lab — the phone tree (PAGES.md 14 · 15, mobile-ui-spec §2.6 / §4.4).
 *
 * WHY A SEPARATE TREE, not `md:` classes on SimulationLab. Below 768px this is a
 * different composition, not a reflow of the desktop one. The demo does not
 * reflow the Lab, it replaces it: the lettered stage rail, the 256px scenario
 * aside, the stress-test drawer and the per-pane card stacks all fold into a
 * header (title · scenario · project), a five-chip pane strip, one pane at a
 * time, and a sticky gate footer whose Run button is always on screen.
 * `use-is-mobile.ts` reserves the hook for exactly this case (a different
 * component tree); the desktop tree is untouched and renders what it rendered
 * before. This is the case §5 established for GettingStarted and G9 for
 * Project Intelligence.
 *
 * WHAT IT DOES NOT OWN. Every value here arrives as a prop from the page, which
 * already computed it. This adds no query, no RPC and no state shape — the only
 * state it owns is which sheet is open, which is purely visual.
 *
 * MATCHING THE DEMO MUST NOT DELETE PRODUCT CAPABILITY (spec §6: the product
 * shows a control, disables it, and explains why — it never hides one). The
 * demo is a prototype with a READ-ONLY Setup pane and no playbook picker, no
 * strategy toggles, no seed explorer and no inline supplier fix. So the demo's
 * chrome, hierarchy, typography and navigation are ported as-is, and every
 * place the demo shows a read-only value row, that row opens a bottom sheet
 * holding the REAL existing editor — `ScenarioSetupForm` sectioned by its new
 * `section` prop, `DisruptionScheduleEditor`, `DisruptionRecoveryPane`'s own
 * playbook card, `PreRunValidationPanel`, `MappingWarningsCard`,
 * `ScenarioList` and `StressTestDrawer`. One editor, two chromes: a control
 * cannot drift between platforms because there is only one of it.
 *
 * Sheet catalogue (all through the one MobileSheet shell, which stops above the
 * tab bar per G6): projects · scenarios · scenario · run window · precision ·
 * objective · disruption schedule · recovery playbook · findings · mapping
 * report.
 */
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Truck, TriangleAlert } from "lucide-react";
import { MobileSheet } from "@/components/shared/MobileSheet";
import { cn } from "@/lib/utils";
import { ScenarioSetupForm } from "./ScenarioSetupForm";
import { DisruptionScheduleEditor } from "./DisruptionScheduleEditor";
import { DisruptionRecoveryPane } from "./DisruptionRecoveryPane";
import { PreRunValidationPanel } from "./PreRunValidationPanel";
import { MappingWarningsCard } from "./RunProgressPanel";
import { ResultsDashboard } from "./ResultsDashboard";
import { CompareScenariosPanel } from "./CompareScenariosPanel";
import { ExperimentLibraryBox, ScenarioList } from "./ScenarioRail";
import { StressTestDrawer, type StressTestPreset } from "./StressTestCard";
import { RESPONSE_LABELS, type RecoveryConfig, type RecoveryResponseKey } from "@/lib/sim/recoveryScore";
import { kpiDisplay } from "@/lib/sim/kpiDisplay";
import { useTimeUnit, UNIT_LABEL_PLURAL } from "@/hooks/useTimeUnit";
import type { PaneId } from "./StageRail";
import type { Scenario } from "@/hooks/useScenarios";
import type { Replication, SimulationRun } from "@/hooks/useSimulationRun";
import type { Credibility } from "@/hooks/useModelValidation";
import type { Finding } from "@/lib/policies/validationService";

/* ── the demo's Lab vocabulary, as extracted from the prototype ───────────
 * Every literal below is the demo's own value. Kept together so the five panes
 * cannot drift into five card treatments.
 */
/** Card: white, 1px #d4d4d4, radius 4, clipped. */
const CARD = "min-w-0 shrink-0 overflow-hidden rounded-sm border border-[#d4d4d4] bg-white";
/** Card header: 11px 13px 10px, closed by a 1px #ebebeb rule. */
const CARD_HEAD = "flex items-center gap-2 border-b border-[#ebebeb] px-[13px] pb-[10px] pt-[11px]";
/** Mono kicker: 10.5px, .07em, uppercase, muted. */
const KICKER = "min-w-0 truncate font-mono text-[10.5px] uppercase tracking-[0.07em] text-[#6b6b6b]";
/** Right-aligned scroll affordance / meta. */
const SWIPE = "shrink-0 whitespace-nowrap font-mono text-[11px] text-[#a1a1a1]";
/** Value row: 52px minimum, 9px 13px, divided on #f4f4f4. */
const ROW =
  "flex w-full min-h-[52px] items-center gap-[11px] border-b border-[#f4f4f4] px-[13px] py-[9px] text-left last:border-b-0";
const ROW_LABEL = "text-[14.5px] leading-snug text-[#171717]";
const ROW_HINT = "min-w-0 truncate font-mono text-[11px] leading-snug text-[#8a8a8a]";
const ROW_VALUE = "shrink-0 font-mono text-[14px] tabular-nums text-[#171717]";
/** Table head cell — the demo's, at Ledger tracking (.04em, §4.3). */
const TH =
  "whitespace-nowrap bg-[#fafafa] px-3 py-[9px] text-left font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-[#8a8a8a]";
/** Table body cell. Rows divide on the SIM divider, #ececee — not #f4f4f4. */
const TD = "whitespace-nowrap px-3 py-[9px] font-mono tabular-nums text-[#171717]";
/** Frozen identifying column (§2.7). Mobile-only by construction — this whole
 *  tree is — so it needs no `md:` release. */
const FROZEN_TD = "sticky left-0 z-[1] border-r border-[#ebebeb] bg-white";
const FROZEN_TH = "sticky left-0 z-[1] border-r border-[#ebebeb]";
/** Secondary action button, the demo's 48px. */
const BTN =
  "flex min-h-12 min-w-0 items-center justify-center rounded-sm border border-[#d4d4d4] bg-white px-[14px] text-[15px] font-medium text-[#171717] active:bg-[#f4f4f5]";
/** The mono uppercase micro-button the demo uses for Spec / Cancel / +10 reps. */
const MONO_BTN =
  "-my-1.5 flex min-h-11 shrink-0 items-center gap-[5px] rounded-sm border border-[#e0e0e3] bg-white px-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[#6b6b6b] active:bg-[#f4f4f5]";

/** Every sheet this screen can show. `null` is the pane itself. */
type Sheet =
  | "projects"
  | "scenarios"
  | "scenario"
  | "runWindow"
  | "precision"
  | "objective"
  | "schedule"
  | "playbook"
  | "findings"
  | "mapping"
  | null;

/** The demo's five chips, in the demo's order. `recovery` is the demo's
 *  "Events"; the pane it opens carries the playbook too, so the playbook keeps
 *  its own name on the card inside. */
const PANES: Array<{ id: PaneId; label: string }> = [
  { id: "setup", label: "Setup" },
  { id: "recovery", label: "Events" },
  { id: "run", label: "Run" },
  { id: "results", label: "Results" },
  { id: "compare", label: "Compare" },
];

/** Named only so the playbook row can count the levers it is not showing. */
const STRATEGY_COUNT = 6;

export interface MobileSimulationLabProps {
  /* header */
  projects: Array<{ id: string; name: string }>;
  projectId: string | null;
  onProjectChange: (id: string | null) => void;

  /* scenarios */
  scenarios: Scenario[];
  scenariosLoading: boolean;
  selected: Scenario | null;
  selectedId: string | null;
  credibilityFor: (s: Scenario) => Credibility;
  onSelectScenario: (id: string) => void;
  onCreateScenario: () => void;
  onDuplicateScenario: (s: Scenario) => void;
  onDeleteScenario: (id: string) => void;
  onBrowseLibrary: () => void;
  stressCount: number;
  stressOpen: boolean;
  onToggleStress: () => void;
  onLaunchStress: (preset: StressTestPreset) => void;

  /* panes */
  pane: PaneId;
  onPane: (p: PaneId) => void;

  /* setup + events — the same handlers the desktop panes get */
  onSaveScenario: (patch: Partial<Scenario>) => void;
  projectRecovery: RecoveryConfig | null;
  effectiveRecovery: RecoveryConfig;

  /* run */
  policyVersionLabel: string | null;
  policyDirty: boolean;
  credibility: Credibility;
  runCredibility: Credibility;
  gateFindings: Finding[] | null;
  gateBlocks: number;
  gateWarns: number;
  ackWarnings: boolean;
  onAckWarnings: (v: boolean) => void;
  runBlockedReason: string | null;
  findingsSource: "pre-run check" | "gate rejection";
  supplierIds: string[];
  latestRun: SimulationRun | null;
  reps: Replication[];
  runVersionLabel: string | null;
  onRun: () => void;
  onSaveVersionAndRun: () => void;
  onCancel: () => void;
  onAddReps: (n: number) => void;

  /* compare */
  runsByScenario: Record<string, SimulationRun>;
}

export function MobileSimulationLab(props: MobileSimulationLabProps) {
  const {
    projects,
    projectId,
    onProjectChange,
    scenarios,
    scenariosLoading,
    selected,
    selectedId,
    credibilityFor,
    onSelectScenario,
    onCreateScenario,
    onDuplicateScenario,
    onDeleteScenario,
    onBrowseLibrary,
    stressCount,
    stressOpen,
    onToggleStress,
    onLaunchStress,
    pane,
    onPane,
    onSaveScenario,
    projectRecovery,
    effectiveRecovery,
    policyVersionLabel,
    policyDirty,
    credibility,
    runCredibility,
    gateFindings,
    gateBlocks,
    gateWarns,
    ackWarnings,
    onAckWarnings,
    runBlockedReason,
    findingsSource,
    supplierIds,
    latestRun,
    reps,
    runVersionLabel,
    onRun,
    onSaveVersionAndRun,
    onCancel,
    onAddReps,
    runsByScenario,
  } = props;

  const [sheet, setSheet] = useState<Sheet>(null);
  const close = () => setSheet(null);
  // Read-only here: the planning unit is set by TimeUnitBar inside the
  // Scenario sheet, which is the real control. This only labels the row.
  const { unit } = useTimeUnit(projectId);

  const activeProject = projects.find((p) => p.id === projectId) ?? null;
  const events = selected?.disruption_schedule ?? [];
  const levers = (effectiveRecovery.response ?? []) as RecoveryResponseKey[];
  const findings = gateFindings ?? [];

  /* ── header ───────────────────────────────────────────────────────────── */
  // The demo's 58px top padding is its own phone-frame notch allowance; the
  // product sits under real app chrome and the page gutter already spaces it,
  // so only the demo's 11px is ported.
  const header = (
    <header className="shrink-0 border-b border-[#d4d4d4] bg-[rgba(250,250,250,0.95)] px-[clamp(11px,3.4vw,15px)] py-[11px] backdrop-blur-[8px]">
      <div className="mb-[11px] flex min-h-11 items-center gap-[10px]">
        <button
          type="button"
          onClick={() => setSheet("scenarios")}
          className="flex min-w-0 flex-1 flex-col items-start gap-[2px] text-left"
        >
          <span className="text-[20px] font-semibold tracking-[-0.022em] text-[#171717]">
            Simulation Lab
          </span>
          <span className="flex min-w-0 max-w-full items-center gap-[6px]">
            <span
              className="h-[6px] w-[6px] shrink-0 rounded-full"
              style={{ background: selected ? "#14b8c4" : "#d4d4d4" }}
            />
            <span className="min-w-0 truncate text-[11.5px] text-[#6b6b6b]">
              {selected ? selected.name || "Untitled scenario" : "No scenario yet"}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSheet("projects")}
          title={activeProject?.name ?? "Select project"}
          className="flex h-11 min-w-0 max-w-[42vw] shrink-0 items-center gap-[6px] rounded-sm border border-[#d4d4d4] bg-white px-3 text-[13.5px] font-medium text-[#171717] active:bg-[#f4f4f5]"
        >
          <span className="min-w-0 truncate">{activeProject?.name ?? "Select project"}</span>
          <ChevronDown className="h-[13px] w-[13px] shrink-0 text-[#6b6b6b]" strokeWidth={2} />
        </button>
      </div>
      {/* The demo has NO lettered stage rail on the phone — the five panes are
          chips. `StageRail` is the desktop vocabulary and stays there. */}
      <div className="flex gap-[7px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PANES.map((p) => {
          const on = p.id === pane;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPane(p.id)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "min-h-11 shrink-0 whitespace-nowrap rounded-sm border px-[14px] text-[14px]",
                on
                  ? "border-[#171717] bg-[#171717] font-semibold text-white"
                  : "border-[#e0e0e3] bg-white font-medium text-[#6b6b6b]",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </header>
  );

  /* ── Setup ────────────────────────────────────────────────────────────── */
  // The demo's Setup pane is read-only fact rows. The product's is an editable
  // form, so every row opens the REAL editor in a sheet. Nothing is dropped:
  // Scenario and Primary KPI are product fields the demo has no row for, and
  // they are added as rows of the same kind rather than hidden.
  const inherited = !!selected?.inherited_validation_id;
  const setupRows: Array<{
    label: string;
    hint: string;
    value: string;
    sheet?: Exclude<Sheet, null>;
    pane?: PaneId;
  }> = selected
    ? [
        {
          label: "Scenario",
          hint: selected.description || "no description",
          value: UNIT_LABEL_PLURAL[unit ?? "day"],
          sheet: "scenario",
        },
        { label: "Horizon", hint: "simulated period", value: `${selected.horizon_days} d`, sheet: "runWindow" },
        {
          label: "Replications",
          hint: inherited ? "adopted n* · from model validation" : "not adopted — engine default",
          value: String(selected.replications),
          sheet: "precision",
        },
        {
          label: "Warm-up",
          hint: inherited
            ? `adopted · detection ${selected.warmup_mode}`
            : `not adopted · detection ${selected.warmup_mode}`,
          value: `${selected.warmup_days} d`,
          sheet: "runWindow",
        },
        {
          label: "Random seed",
          hint: selected.crn ? "reproducible stream" : "common random numbers off",
          value: String(selected.seed),
          sheet: "precision",
        },
        {
          label: "Primary KPI",
          hint: `stopping rule ${selected.stopping_rule?.kind ?? "fixed_horizon"}`,
          value: kpiDisplay(selected.primary_kpi).label,
          sheet: "objective",
        },
        {
          label: "Policy version",
          hint: policyDirty ? "unsaved — a run needs a saved version" : "frozen at run time",
          value: policyVersionLabel ?? "—",
        },
        {
          label: "Disruption schedule",
          hint: "edit in Events",
          value: `${events.length} ${events.length === 1 ? "event" : "events"}`,
          pane: "recovery",
        },
      ]
    : [];

  const setupPane = (
    <div className={CARD}>
      <div className={CARD_HEAD}>
        <span className={KICKER}>Experiment design</span>
      </div>
      {setupRows.map((r) => {
        const inner = (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className={ROW_LABEL}>{r.label}</span>
              <span className={ROW_HINT} title={r.hint}>
                {r.hint}
              </span>
            </span>
            <span className={ROW_VALUE}>{r.value}</span>
            {r.sheet || r.pane ? (
              <ChevronRight className="h-[15px] w-[15px] shrink-0 text-[#a1a1a1]" strokeWidth={2} />
            ) : null}
          </>
        );
        return r.sheet || r.pane ? (
          <button
            key={r.label}
            type="button"
            onClick={() => (r.sheet ? setSheet(r.sheet) : onPane(r.pane!))}
            className={cn(ROW, "active:bg-[#fafafa]")}
          >
            {inner}
          </button>
        ) : (
          <div key={r.label} className={ROW}>
            {inner}
          </div>
        );
      })}
      {/* A cross-screen note WITH A ROUTE, not a dead-end warning. */}
      {selected && !inherited ? (
        <Link
          to="/policies"
          className="flex min-h-11 w-full items-center gap-[9px] px-[13px] py-[11px] text-left active:bg-[#fafafa]"
        >
          <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-[#f59e0b]" />
          <span className="min-w-0 flex-1 font-mono text-[11.5px] leading-snug text-[#6b6b6b] [text-wrap:pretty]">
            warm-up &amp; n* not adopted — set them in Policies
          </span>
          <ChevronRight className="h-[15px] w-[15px] shrink-0 text-[#a1a1a1]" strokeWidth={2} />
        </Link>
      ) : null}
    </div>
  );

  /* ── Events ───────────────────────────────────────────────────────────── */
  const eventsPane = (
    <>
      <div className={CARD}>
        <div className={CARD_HEAD}>
          <span className={KICKER}>Disruption schedule</span>
          <span className="flex-1" />
          {events.length > 0 ? <span className={SWIPE}>swipe →</span> : null}
        </div>
        {events.length === 0 ? (
          <div className="min-w-0 px-6 py-9 text-center text-[13.5px] leading-relaxed text-[#6b6b6b] [text-wrap:pretty]">
            No disruption schedule yet — this project has no network to disrupt.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse whitespace-nowrap text-[13.5px]">
              <thead>
                <tr>
                  <th className={cn(TH, FROZEN_TH)}>Event</th>
                  <th className={TH}>Target</th>
                  <th className={TH}>Start</th>
                  <th className={TH}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className="border-t border-[#ececee]">
                    <td className={cn(TD, FROZEN_TD, "font-sans text-[14px] font-medium")}>
                      {e.target_type === "edge" ? "Lane" : "Node"} · {e.magnitude_pct}%
                    </td>
                    <td className={TD} title={e.target}>
                      {e.target || "—"}
                    </td>
                    <td className={TD}>d{e.start_day}</td>
                    <td className={TD}>{e.duration_days} d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex min-w-0 shrink-0 gap-2">
        <button type="button" onClick={() => setSheet("schedule")} className={cn(BTN, "flex-1")}>
          Add disruption
        </button>
        <button type="button" onClick={() => onPane("setup")} className={cn(BTN, "shrink-0")}>
          Setup
        </button>
      </div>

      {/* The demo's Events pane carries no playbook. The product's pane does,
          and §6 forbids hiding a control — so it keeps the demo's card
          vocabulary ("Recovery playbook" is the demo's own string, from its
          Results pane) and its rows open the real editors. */}
      <div className={CARD}>
        <div className={CARD_HEAD}>
          <span className={KICKER}>Recovery playbook</span>
          <span className="flex-1" />
          <span className={SWIPE}>{effectiveRecovery.enabled ? "enabled" : "disabled"}</span>
        </div>
        <button type="button" onClick={() => setSheet("playbook")} className={cn(ROW, "active:bg-[#fafafa]")}>
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className={ROW_LABEL}>Response strategies</span>
            <span className={ROW_HINT} title={levers.map((l) => RESPONSE_LABELS[l]).join(" · ")}>
              {levers.length ? levers.map((l) => RESPONSE_LABELS[l]).join(" · ") : "none active"}
            </span>
          </span>
          <span className={ROW_VALUE}>
            {levers.length} / {STRATEGY_COUNT}
          </span>
          <ChevronRight className="h-[15px] w-[15px] shrink-0 text-[#a1a1a1]" strokeWidth={2} />
        </button>
      </div>
    </>
  );

  /* ── Run ──────────────────────────────────────────────────────────────── */
  const runStatus = latestRun?.status ?? null;
  const done = runStatus === "done";
  const active = runStatus === "running" || runStatus === "queued";
  const bad = runStatus === "failed" || runStatus === "cancelled";
  const repsDone = latestRun?.rep_count_done ?? 0;
  const repsTarget = latestRun?.rep_count_target ?? selected?.replications ?? 0;
  const pct = repsTarget ? Math.min(100, Math.round((repsDone / repsTarget) * 100)) : 0;

  const specCells = selected
    ? [
        { label: "Scenario", value: selected.name || "Untitled scenario" },
        { label: "Policy version", value: runVersionLabel ?? policyVersionLabel ?? "—" },
        { label: "Replications", value: String(repsTarget) },
        { label: "Warm-up", value: `${selected.warmup_days} d` },
        { label: "Seed", value: String(selected.seed) },
        { label: "Events", value: String(events.length) },
      ]
    : [];

  const runPane = (
    <>
      <div className={CARD}>
        <div className={CARD_HEAD}>
          <span
            className="h-[8px] w-[8px] shrink-0 rounded-full"
            style={{
              background: runStatus === "running" ? "#171717" : done ? "#14b8c4" : bad ? "#bf2330" : "#d4d4d4",
            }}
          />
          <span
            className="whitespace-nowrap font-mono text-[11.5px] uppercase tracking-[0.06em]"
            style={{ color: latestRun ? "#171717" : "#8a8a8a" }}
          >
            {runStatus ?? "not started"}
          </span>
          <span className="flex-1" />
          {active ? (
            <button type="button" onClick={onCancel} className={MONO_BTN}>
              Cancel
            </button>
          ) : done ? (
            <button type="button" onClick={() => onAddReps(10)} className={MONO_BTN}>
              +10 reps
            </button>
          ) : (
            <span className={SWIPE}>queue empty</span>
          )}
        </div>
        <div className="flex flex-col gap-3 px-[13px] pb-[13px] pt-3">
          <div className="flex items-start gap-[10px]">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="text-[17px] font-semibold tracking-[-0.018em] text-[#171717] [text-wrap:pretty]">
                {selected?.name || "Untitled scenario"}
              </div>
              {/* Desktop puts credibility on a badge whose only explanation is a
                  hover tooltip — inert on touch. The state is a fact, so it is
                  named in words here rather than left as a colour. */}
              <div className="font-mono text-[11.5px] leading-snug text-[#6b6b6b] [text-wrap:pretty]">
                {[
                  latestRun ? `model ${runCredibility.state}` : null,
                  runVersionLabel ?? policyVersionLabel ?? "no saved version",
                  selected ? `warm-up ${selected.warmup_days} d` : null,
                  selected ? `seed ${selected.seed}` : null,
                  latestRun?.warmup_detected_at != null
                    ? `detected day ${latestRun.warmup_detected_at}`
                    : "warm-up pending",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <button type="button" onClick={() => onPane("setup")} className={MONO_BTN}>
              {latestRun ? "Spec" : "Edit"}
            </button>
          </div>

          {specCells.length > 0 ? (
            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-px overflow-hidden rounded-sm border border-[#ebebeb] bg-[#ebebeb]">
              {specCells.map((c) => (
                <div key={c.label} className="flex min-w-0 flex-col gap-[3px] bg-white px-[11px] py-[9px]">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#8a8a8a]">
                    {c.label}
                  </span>
                  <span
                    className="min-w-0 truncate font-mono text-[13px] tabular-nums text-[#171717]"
                    title={c.value}
                  >
                    {c.value}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-[7px]">
            <div className="flex flex-wrap items-baseline gap-[6px] font-mono text-[12px] text-[#6b6b6b]">
              <b className="text-[19px] font-medium tabular-nums text-[#171717]">{repsDone}</b>
              <span>/ {repsTarget} replications</span>
            </div>
            <div className="h-2 overflow-hidden rounded-sm bg-[#ebebeb]">
              <div className="h-full rounded-sm bg-[#171717]" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* §3.1: an error message is on the never-truncate list. */}
          {latestRun?.error_message ? (
            <p className="text-[12.5px] leading-snug text-[#bf2330] [text-wrap:pretty]">
              {latestRun.error_message}
            </p>
          ) : null}
          {runStatus === "queued" ? (
            <p className="text-[12.5px] leading-snug text-[#6b6b6b]">Queued — waiting for a worker</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setSheet("mapping")}
          className={cn(ROW, "border-t border-[#f4f4f4] active:bg-[#fafafa]")}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className={ROW_LABEL}>Engine mapping report</span>
            <span className={ROW_HINT}>
              {latestRun ? "values the engine derived or defaulted" : "written when a run dispatches"}
            </span>
          </span>
          <span className={ROW_VALUE}>{latestRun?.mapping_warnings?.length ?? 0}</span>
          <ChevronRight className="h-[15px] w-[15px] shrink-0 text-[#a1a1a1]" strokeWidth={2} />
        </button>
      </div>

      <div className={CARD}>
        <div className={CARD_HEAD}>
          <span className={KICKER}>Per replication · {repsTarget}</span>
          <span className="flex-1" />
          {reps.length > 0 ? <span className={SWIPE}>swipe →</span> : null}
        </div>
        {reps.length === 0 ? (
          <div className="px-[13px] py-6 text-[12.5px] leading-relaxed text-[#6b6b6b]">
            Waiting for first replication…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse whitespace-nowrap text-[13.5px]">
              <thead>
                <tr>
                  <th className={cn(TH, FROZEN_TH)}>Rep</th>
                  <th className={TH}>Seed</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((r) => (
                  <tr key={r.id} className="border-t border-[#ececee]">
                    <td className={cn(TD, FROZEN_TD)}>{r.rep_index}</td>
                    <td className={TD}>{r.seed_used}</td>
                    <td className={cn(TD, "font-sans")}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );

  /* ── Results ──────────────────────────────────────────────────────────── */
  // The demo's KPI tiles carry a delta against a baseline this page does not
  // hold, so the tile's third line is the run's own CI half-width — a number
  // the run recorded, not an invented comparison.
  const kpiTiles = useMemo(() => {
    const agg = latestRun?.aggregate_kpis ?? {};
    const ci = latestRun?.ci_half_widths ?? {};
    return Object.keys(agg)
      .filter((k) => typeof agg[k] === "number")
      .slice(0, 4)
      .map((k) => {
        const d = kpiDisplay(k);
        return {
          key: k,
          label: d.label,
          value: d.format(agg[k]),
          ci: typeof ci[k] === "number" ? `± ${d.format(ci[k])} 95% CI` : "no CI recorded",
        };
      });
  }, [latestRun]);

  const credState = runCredibility.state;
  const resultsPane =
    !latestRun || latestRun.status !== "done" ? (
      <div className={cn(CARD, "flex flex-col items-center gap-3 px-6 py-11 text-center")}>
        <Truck className="h-[22px] w-[22px] text-[#a1a1a1]" strokeWidth={2} />
        <span className="max-w-[250px] text-[13.5px] leading-relaxed text-[#6b6b6b] [text-wrap:pretty]">
          {latestRun && (latestRun.status === "running" || latestRun.status === "queued")
            ? "Run in progress — results appear when it finishes."
            : `No completed replications for ${activeProject?.name ?? "this project"} yet.`}
        </span>
        <button type="button" onClick={() => onPane("run")} className={cn(BTN, "min-h-11 px-4 text-[14px]")}>
          Go to Run
        </button>
      </div>
    ) : (
      <>
        <div className="flex min-w-0 shrink-0 items-start gap-[9px] px-[3px] pt-[2px]">
          <span
            className="inline-flex shrink-0 items-center gap-[6px] rounded-sm px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em]"
            style={
              credState === "validated"
                ? { border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.1)", color: "#047857" }
                : credState === "stale"
                  ? { border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.1)", color: "#b45309" }
                  : { border: "1px solid #e0e0e3", background: "#fafafa", color: "#6b6b6b" }
            }
          >
            {credState}
          </span>
          <span className="min-w-0 flex-1 text-right font-mono text-[10.5px] leading-normal text-[#8a8a8a] [overflow-wrap:anywhere]">
            {[
              latestRun.policy_hash ? `policy ${latestRun.policy_hash.slice(0, 6)}` : null,
              latestRun.scenario_hash ? `scenario ${latestRun.scenario_hash.slice(0, 6)}` : null,
              latestRun.code_version,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-hidden px-[3px]">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#6b6b6b]">
            {[
              selected?.name,
              runVersionLabel ?? policyVersionLabel,
              `n = ${repsDone}`,
              selected ? `warm-up ${selected.warmup_days} d` : null,
              selected ? `seed ${selected.seed}` : null,
              `${events.length} events`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <button type="button" onClick={() => onPane("setup")} className={MONO_BTN}>
            Spec
          </button>
        </div>

        {kpiTiles.length > 0 ? (
          <div className="grid shrink-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-[9px]">
            {kpiTiles.map((k) => (
              <div key={k.key} className={cn(CARD, "flex flex-col gap-1.5 px-[13px] py-3")}>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-[#6b6b6b] [text-wrap:pretty]">
                  {k.label}
                </div>
                <div className="text-[25px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[#171717]">
                  {k.value}
                </div>
                <div className="font-mono text-[11.5px] tabular-nums text-[#6b6b6b] [text-wrap:pretty]">{k.ci}</div>
              </div>
            ))}
          </div>
        ) : null}

        {/* The demo's charts and tables are the product's, unchanged: the same
            components desktop mounts, so no number can differ between them.
            `credibility` is omitted because the demo's chip above already IS
            the credibility readout — the dashboard's badge explains itself only
            through a hover tooltip, which is inert on touch, so a second one
            would be decoration. Desktop still passes it. */}
        <ResultsDashboard
          run={latestRun}
          reps={reps}
          primaryKpi={selected?.primary_kpi ?? ""}
          scenario={selected}
        />
      </>
    );

  /* ── footer — the honest gate ─────────────────────────────────────────── */
  const canRun = !runBlockedReason;
  const runLabel = policyDirty
    ? "Save a policy version first"
    : gateBlocks > 0
      ? `Blocked by ${gateBlocks} ${gateBlocks === 1 ? "finding" : "findings"}`
      : gateWarns > 0 && !ackWarnings
        ? "Acknowledge to run"
        : !canRun
          ? "Run unavailable"
          : active
            ? "Running…"
            : done
              ? "Run again"
              : "Run simulation";

  const warnSummary =
    findings
      .filter((f) => f.severity === "warn")
      .map((f) => f.field)
      .filter(Boolean)
      .join(" · ") || "the engine applies its defaults";

  const footer = (
    <div className="flex shrink-0 flex-col gap-[9px] border-t border-[#d4d4d4] bg-[#fafafa] px-[13px] py-[11px]">
      {gateBlocks > 0 ? (
        <button
          type="button"
          onClick={() => setSheet("findings")}
          className="flex min-h-11 items-center gap-[10px] rounded-sm border border-[rgba(191,35,48,0.3)] bg-[rgba(191,35,48,0.06)] px-[11px] py-[9px] text-left active:bg-[rgba(191,35,48,0.1)]"
        >
          <TriangleAlert className="h-4 w-4 shrink-0 text-[#bf2330]" strokeWidth={2} />
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[14px] font-medium leading-snug text-[#bf2330] [text-wrap:pretty]">
              Run rejected — {gateBlocks} blocking {gateBlocks === 1 ? "gap" : "gaps"}
            </span>
            <span className="font-mono text-[11px] leading-snug text-[#6b6b6b] [text-wrap:pretty]">
              {runBlockedReason ?? "see the findings panel"}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-[#bf2330]" strokeWidth={2} />
        </button>
      ) : gateWarns > 0 ? (
        <div className="flex min-h-11 items-center gap-[10px] text-left">
          <button
            type="button"
            onClick={() => onAckWarnings(!ackWarnings)}
            aria-pressed={ackWarnings}
            aria-label={`Acknowledge ${gateWarns} ${gateWarns === 1 ? "warning" : "warnings"}`}
            className="-m-[10px] box-content grid h-6 w-6 shrink-0 place-items-center p-[10px]"
          >
            <span
              className={cn(
                "grid h-6 w-6 place-items-center rounded-sm border text-[13px] leading-none text-white",
                ackWarnings ? "border-[#171717] bg-[#171717]" : "border-[#a1a1a1] bg-white",
              )}
            >
              {ackWarnings ? "✓" : ""}
            </span>
          </button>
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[14px] font-medium leading-snug text-[#171717] [text-wrap:pretty]">
              Acknowledge {gateWarns} {gateWarns === 1 ? "warning" : "warnings"}
            </span>
            <span className="font-mono text-[11px] leading-snug text-[#6b6b6b] [text-wrap:pretty]">
              {warnSummary}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setSheet("findings")}
            className="-mx-[10px] -my-[11px] flex min-h-11 min-w-11 shrink-0 items-center justify-center px-[10px] py-[11px] font-mono text-[10.5px] text-[#6b6b6b] underline underline-offset-2"
          >
            view
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-2 px-px">
        <span
          className="h-[6px] w-[6px] shrink-0 rounded-full"
          style={{
            background: policyDirty ? "#f59e0b" : credibility.state === "validated" ? "#14b8c4" : "#d4d4d4",
          }}
        />
        <span className="min-w-0 flex-1 font-mono text-[11px] leading-snug text-[#6b6b6b] [text-wrap:pretty]">
          {policyDirty
            ? "unsaved policy state — save a version to bind the run"
            : policyVersionLabel
              ? `binds policy version ${policyVersionLabel}`
              : "no saved model version — runs require a saved policy version"}
        </span>
      </div>

      <button
        type="button"
        disabled={!canRun}
        onClick={policyDirty ? onSaveVersionAndRun : onRun}
        className={cn(
          "min-h-[52px] w-full rounded-sm px-3 text-[16px] font-semibold",
          canRun ? "bg-[#171717] text-white" : "cursor-not-allowed bg-[#ebebeb] text-[#8a8a8a]",
        )}
      >
        {runLabel}
      </button>
      {/* §3.1: the reason a control is disabled is never truncated, and never
          hidden behind a title attribute. The blocked-gate button above already
          carries it, so this covers the capability and dirty-policy cases. */}
      {!canRun && runBlockedReason && gateBlocks === 0 ? (
        <span className="text-[12.5px] leading-snug text-[#a1650a] [text-wrap:pretty]">{runBlockedReason}</span>
      ) : null}
    </div>
  );

  /* ── the screen ───────────────────────────────────────────────────────── */
  const body = !projectId ? (
    <div className={cn(CARD, "px-3 py-[10px] text-[12.5px] text-[#6b6b6b]")}>No project selected</div>
  ) : !selected ? (
    <div className={cn(CARD, "flex flex-col items-center gap-3 px-6 py-11 text-center")}>
      <span className="max-w-[250px] text-[13.5px] leading-relaxed text-[#6b6b6b] [text-wrap:pretty]">
        {scenariosLoading ? "Loading scenarios…" : "No scenario selected."}
      </span>
      {!scenariosLoading ? (
        <button type="button" onClick={() => setSheet("scenarios")} className={cn(BTN, "min-h-11 px-4 text-[14px]")}>
          Choose a scenario
        </button>
      ) : null}
    </div>
  ) : pane === "setup" ? (
    setupPane
  ) : pane === "recovery" ? (
    eventsPane
  ) : pane === "run" ? (
    runPane
  ) : pane === "results" ? (
    resultsPane
  ) : (
    <CompareScenariosPanel scenarios={scenarios} runsByScenario={runsByScenario} />
  );

  return (
    // --pi-chrome is published by PageLayout: the measured bottom reservation
    // plus this page's gutter. The fallback only covers the first paint before
    // the credit bar is measured. The column is fixed-height so the gate footer
    // stays on screen — an honest gate you have to scroll to find is not one.
    <div className="flex h-[calc(100svh-var(--pi-chrome,210px))] min-h-[420px] flex-col overflow-hidden rounded-sm border border-[#d4d4d4] bg-[#ebebeb]">
      {header}
      <main className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-auto p-[13px] pb-[22px]">{body}</main>
      {projectId && selected ? footer : null}

      {/* ── sheets — every one holds the REAL editor ─────────────────────── */}
      <MobileSheet open={sheet === "projects"} title="Switch project" onClose={close}>
        <div className="flex flex-col">
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onProjectChange(p.id);
                close();
              }}
              className="flex min-h-11 w-full items-center gap-2.5 border-b border-[#f4f4f4] px-3.5 py-2.5 text-left last:border-b-0 active:bg-[#f4f4f5]"
            >
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#171717]">{p.name}</span>
              {p.id === projectId ? <span className="shrink-0 text-[15px] text-[#171717]">✓</span> : null}
            </button>
          ))}
          {projects.length === 0 ? (
            <p className="px-3.5 py-3 text-[12.5px] text-[#6b6b6b]">No projects available.</p>
          ) : null}
        </div>
      </MobileSheet>

      <MobileSheet
        open={sheet === "scenarios"}
        title="Scenarios"
        sub="Pick the scenario to design and run, or start one from the stress-test library."
        onClose={close}
      >
        <div className="p-3.5">
          <ExperimentLibraryBox count={stressCount} open={stressOpen} onToggle={onToggleStress} />
          {stressOpen ? <StressTestDrawer onLaunch={onLaunchStress} /> : null}
          <ScenarioList
            scenarios={scenarios}
            selectedId={selectedId}
            loading={scenariosLoading}
            credibilityFor={credibilityFor}
            onSelect={(id) => {
              onSelectScenario(id);
              close();
            }}
            onBrowseSaved={() => {
              close();
              onBrowseLibrary();
            }}
            onCreate={onCreateScenario}
            onDuplicate={onDuplicateScenario}
            onDelete={onDeleteScenario}
          />
        </div>
      </MobileSheet>

      {/* Setup's four sheets mount the ONE ScenarioSetupForm, sectioned. The
          name, the planning unit, the eight parameters and the objective are
          the same controls the desktop pane renders, with the same commit
          semantics — not a phone-only copy that can drift. */}
      {selected ? (
        <>
          <MobileSheet open={sheet === "scenario"} title="Scenario" onClose={close}>
            <div className="p-3.5">
              <ScenarioSetupForm
                section="identity"
                scenario={selected}
                projectId={projectId}
                onSave={onSaveScenario}
              />
            </div>
          </MobileSheet>

          <MobileSheet open={sheet === "runWindow"} title="Run window" onClose={close}>
            <div className="p-3.5">
              <ScenarioSetupForm
                section="runWindow"
                scenario={selected}
                projectId={projectId}
                onSave={onSaveScenario}
              />
            </div>
          </MobileSheet>

          <MobileSheet open={sheet === "precision"} title="Precision" onClose={close}>
            <div className="p-3.5">
              <ScenarioSetupForm
                section="precision"
                scenario={selected}
                projectId={projectId}
                onSave={onSaveScenario}
              />
            </div>
          </MobileSheet>

          <MobileSheet open={sheet === "objective"} title="Objective" onClose={close}>
            <div className="p-3.5">
              <ScenarioSetupForm
                section="objective"
                scenario={selected}
                projectId={projectId}
                onSave={onSaveScenario}
              />
            </div>
          </MobileSheet>

          <MobileSheet
            open={sheet === "schedule"}
            title="Disruption schedule"
            sub="Authored in days; the engine advances in weekly ticks."
            onClose={close}
          >
            <div className="p-3.5">
              <DisruptionScheduleEditor
                value={selected.disruption_schedule}
                onChange={(v) => onSaveScenario({ disruption_schedule: v })}
                projectId={projectId}
              />
            </div>
          </MobileSheet>

          <MobileSheet open={sheet === "playbook"} title="Recovery playbook" onClose={close}>
            <div className="p-3.5">
              <DisruptionRecoveryPane
                sections="playbook"
                scenario={selected}
                projectRecovery={projectRecovery}
                onSave={onSaveScenario}
              />
            </div>
          </MobileSheet>
        </>
      ) : null}

      <MobileSheet open={sheet === "findings"} title="Required-data gate" onClose={close}>
        <div className="p-3.5">
          {projectId ? (
            <PreRunValidationPanel
              projectId={projectId}
              findings={gateFindings}
              source={findingsSource}
              acknowledged={ackWarnings}
              onAcknowledgedChange={onAckWarnings}
              supplierIds={supplierIds}
            />
          ) : null}
        </div>
      </MobileSheet>

      <MobileSheet open={sheet === "mapping"} title="Engine mapping report" onClose={close}>
        <div className="p-3.5">
          {/* MappingWarningsCard renders nothing until a run finishes or the
              engine writes a fallback, so the sheet says why rather than
              opening empty. */}
          {latestRun && (latestRun.status === "done" || latestRun.mapping_warnings?.length) ? (
            <MappingWarningsCard warnings={latestRun.mapping_warnings} status={latestRun.status} />
          ) : (
            <p className="text-[12.5px] leading-snug text-[#6b6b6b] [text-wrap:pretty]">
              The mapping report is written by the engine — it lists every value the mapper had to
              derive or default. It exists once a run has finished.
            </p>
          )}
        </div>
      </MobileSheet>
    </div>
  );
}
