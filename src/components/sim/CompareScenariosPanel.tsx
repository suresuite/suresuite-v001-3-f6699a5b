// Compare — §9.3 comparison semantics.
//
// Two runs are comparable iff they are CRN-paired (same seed spec) and their
// RunKeys differ in EXACTLY ONE component: different policies on the same
// world, or a different world under the same policies. This panel enforces
// that before it shows a single number — a paired experiment, never a chart of
// two arbitrary runs. Pairs that fail the test get the reason instead of a
// table.
import { useMemo, useState } from "react";
import { CompareTable, type CompareRow } from "./resultTables";
import { TableBlock } from "@/components/shared";
import { M, MobileNote, MobilePanel, MobileRow } from "@/components/mobile";
import { cn } from "@/lib/utils";
import { kpiDisplay, signedDelta } from "@/lib/sim/kpiDisplay";
import type { Scenario } from "@/hooks/useScenarios";
import type { SimulationRun } from "@/hooks/useSimulationRun";

interface Props {
  scenarios: Scenario[];
  /** scenario_id → newest completed run (useScenarioRuns). */
  runsByScenario: Record<string, SimulationRun>;
  /**
   * Wear the mobile skin (v2 §4C). The panel is mounted by both platforms, so
   * the skin arrives as a prop: false everywhere desktop renders, and the
   * `TableBlock` tree below is untouched. What changes is the chrome — the
   * shell becomes the panel, the A/B pickers become rows, and the reasons a
   * pair is not comparable become the skin's caveat rather than a bulleted
   * list. The comparison itself, and every number in it, is the same.
   */
  skin?: boolean;
}

// §2.4: with no comparable scenarios both selects have no options, so they
// collapse to their 38px chrome — under the touch floor on the one state where
// the user most needs to reach them. `min-w-11` floors the width below `md`;
// `md:` hands back the intrinsic width the desktop panel has always had.
const SELECT =
  "h-7 min-h-11 min-w-11 max-w-full rounded-sm border border-[#d4d4d8] bg-white px-2 text-[12.5px] text-[#18181b] focus:border-foreground focus:outline-none md:min-h-0 md:min-w-0";

/** §9.3: CRN pairing plus a single-component RunKey difference. */
function comparabilityFailures(
  a: { scenario: Scenario; run: SimulationRun },
  b: { scenario: Scenario; run: SimulationRun },
): string[] {
  const failures: string[] = [];
  if (!a.scenario.crn || !b.scenario.crn) {
    failures.push("common random numbers are off — the runs are not CRN-paired");
  } else if (a.scenario.seed !== b.scenario.seed) {
    failures.push(
      `seed spec differs (${a.scenario.seed} vs ${b.scenario.seed}) — the runs are not CRN-paired`,
    );
  }

  const policyDiffers = a.run.policy_version_id !== b.run.policy_version_id;
  // scenario_hash is the baseline world fingerprint stamped at dispatch
  const worldDiffers = (a.run.scenario_hash ?? null) !== (b.run.scenario_hash ?? null);
  const differing = [policyDiffers && "policies", worldDiffers && "world"].filter(
    Boolean,
  ) as string[];
  if (differing.length === 0) {
    failures.push("both runs share the same policies and the same world — nothing to compare");
  } else if (differing.length > 1) {
    failures.push(
      "policies AND world both differ — isolate one component to get a valid paired experiment",
    );
  }

  if (a.run.code_version && b.run.code_version && a.run.code_version !== b.run.code_version) {
    failures.push(
      `engine versions differ (${a.run.code_version} vs ${b.run.code_version}) — re-run one side`,
    );
  }
  return failures;
}

export function CompareScenariosPanel({ scenarios, runsByScenario, skin = false }: Props) {
  const withResults = useMemo(
    () => scenarios.filter((s) => runsByScenario[s.id]),
    [scenarios, runsByScenario],
  );
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);

  const a = withResults.find((s) => s.id === aId) ?? withResults[0] ?? null;
  const b =
    withResults.find((s) => s.id === bId) ?? withResults.find((s) => s.id !== a?.id) ?? null;

  const pair = useMemo(
    () =>
      a && b && a.id !== b.id
        ? {
            a: { scenario: a, run: runsByScenario[a.id] },
            b: { scenario: b, run: runsByScenario[b.id] },
          }
        : null,
    [a, b, runsByScenario],
  );

  const failures = useMemo(() => (pair ? comparabilityFailures(pair.a, pair.b) : []), [pair]);

  const rows = useMemo<CompareRow[]>(() => {
    if (!pair || failures.length > 0) return [];
    const kA = pair.a.run.aggregate_kpis ?? {};
    const kB = pair.b.run.aggregate_kpis ?? {};
    const ciA = pair.a.run.ci_half_widths ?? {};
    const ciB = pair.b.run.ci_half_widths ?? {};
    return Object.keys(kA)
      .filter((key) => typeof kA[key] === "number" && typeof kB[key] === "number")
      .map((key) => {
        const d = kpiDisplay(key);
        const delta = kB[key] - kA[key];
        const halfA = ciA[key] ?? 0;
        const halfB = ciB[key] ?? 0;
        return {
          key,
          label: d.label,
          a: d.format(kA[key]),
          aci: `± ${d.format(halfA)}`,
          b: d.format(kB[key]),
          bci: `± ${d.format(halfB)}`,
          delta: signedDelta(delta, d.format),
          better:
            d.higherIsBetter === null || Math.abs(delta) < 1e-9
              ? null
              : d.higherIsBetter
                ? delta > 0
                : delta < 0,
          // intervals that touch cannot separate the two means
          overlap: Math.abs(delta) <= halfA + halfB,
        };
      });
  }, [pair, failures.length]);

  // The body states, shared by both chromes so a message can never differ
  // between platforms.
  const shortfall =
    withResults.length < 2
      ? `${withResults.length} of ${scenarios.length} ${
          scenarios.length === 1 ? "scenario has" : "scenarios have"
        } completed results — a comparison needs two`
      : !pair
        ? "Pick two different scenarios"
        : failures.length === 0 && rows.length === 0
          ? "The two runs share no KPI in their aggregates"
          : null;

  if (skin) {
    const picker = (
      label: string,
      value: string,
      onChange: (id: string) => void,
      disabled: boolean,
    ) => (
      <MobileRow
        chevron={false}
        label={label}
        trailing={
          <select
            className={cn(
              "h-11 min-w-0 max-w-[52vw] shrink rounded-[6px] border border-[#d4d4d4] bg-white",
              "px-2 text-[length:var(--fs-row)] text-[#171717] focus:border-[#18181b] focus:outline-none",
            )}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            aria-label={`Scenario ${label}`}
          >
            {withResults.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name || "Untitled scenario"}
              </option>
            ))}
          </select>
        }
      />
    );

    return (
      <>
        <MobilePanel label="Paired comparison" counter={`${withResults.length} with results`}>
          {picker("A", a?.id ?? "", setAId, withResults.length === 0)}
          {picker("B", b?.id ?? "", setBId, withResults.length < 2)}
          {shortfall ? (
            <MobileRow chevron={false} label={shortfall} />
          ) : failures.length > 0 ? (
            <MobileRow
              chevron={false}
              dot={M.firm}
              label="Not a paired experiment"
              sub="§9.3 requires CRN pairing and exactly one differing RunKey component"
            />
          ) : (
            // A comparison IS a table, and §9.5 allows one to scroll inside
            // its own container. Every column the desktop table has is here.
            <div className="m-cq overflow-x-auto">
              <CompareTable rows={rows} />
            </div>
          )}
        </MobilePanel>

        {/* One caveat per screen (§13.6). The reasons are the caveat, and they
            are a consequence of the pick rather than something blocking. */}
        {failures.length > 0 ? (
          <MobileNote tone="caveat">{failures.join(" · ")}</MobileNote>
        ) : null}
      </>
    );
  }

  return (
    // L1: the name and the A/B pickers move onto the canvas above the shell.
    <TableBlock
      name="Paired comparison"
      actions={
        <span className="flex flex-wrap items-center gap-[7px]">
          <span className="text-[11.5px] text-[#52525b]">A</span>
          <select
            className={SELECT}
            value={a?.id ?? ""}
            onChange={(e) => setAId(e.target.value)}
            disabled={withResults.length === 0}
          >
            {withResults.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || "Untitled scenario"}
              </option>
            ))}
          </select>
          <span className="text-[11.5px] text-[#52525b]">B</span>
          <select
            className={SELECT}
            value={b?.id ?? ""}
            onChange={(e) => setBId(e.target.value)}
            disabled={withResults.length < 2}
          >
            {withResults.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || "Untitled scenario"}
              </option>
            ))}
          </select>
        </span>
      }
    >
      {withResults.length < 2 ? (
        <div className="px-3 py-[10px] text-[12.5px] text-[--zinc-quiet]">
          {withResults.length} of {scenarios.length}{" "}
          {scenarios.length === 1 ? "scenario has" : "scenarios have"} completed results — a
          comparison needs two
        </div>
      ) : !pair ? (
        <div className="px-3 py-[10px] text-[12.5px] text-[--zinc-quiet]">
          Pick two different scenarios
        </div>
      ) : failures.length > 0 ? (
        <div className="flex flex-col gap-[5px] px-3 py-[10px]">
          <span className="text-[12.5px] text-[#18181b]">
            Not a paired experiment — §9.3 requires CRN pairing and exactly one differing RunKey
            component
          </span>
          {failures.map((f) => (
            <span key={f} className="flex items-start gap-[7px] text-[12px] text-[#52525b]">
              <span className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full bg-[#e0930b]" />
              {f}
            </span>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-3 py-[10px] text-[12.5px] text-[--zinc-quiet]">
          The two runs share no KPI in their aggregates
        </div>
      ) : (
        <CompareTable rows={rows} />
      )}
    </TableBlock>
  );
}
