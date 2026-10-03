// Compare — §9.3 comparison semantics, one baseline against many scenarios.
//
// Two runs are comparable iff they are CRN-paired (same seed spec) and their
// RunKeys differ in EXACTLY ONE component: policies, world, or disruptions
// (the rule lives in lib/sim/comparability.ts — §4 D221). This panel enforces
// that before it shows a single number — a paired experiment, never a chart of
// two arbitrary runs.
//
// It used to hold ONE pair (an A picker and a B picker), so comparing five
// stress scenarios against the baseline was five round trips through two
// selects. It now holds a BASELINE and every other scenario at once: each one
// is tested against the baseline on its own (§9.3 is a pairwise rule, and that
// does not change — nothing is compared challenger-to-challenger), the
// comparable ones become columns of one matrix of paired deltas, and the rest
// are listed with the reason instead of a column. Clicking a column opens the
// full paired table for that pair, which is the old panel's table unchanged.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { compareRows } from "@/lib/sim/pairedCompare";
import { comparabilityFailures } from "@/lib/sim/comparability";
import { isValidationBaseline } from "@/lib/sim/validationBaseline";
import { compareScope, type CompareCandidate } from "@/lib/sim/labModel";
import { kpiDisplay } from "@/lib/sim/kpiDisplay";
import { bestPerKpi, matrixKpis, rankChallengers, tally, tallyLine, type Tally } from "@/lib/sim/multiCompare";
import { CompareTable, type CompareRow } from "./resultTables";
import { TableBlock } from "@/components/shared";
import { M, MobileNote, MobilePanel, MobileRow } from "@/components/mobile";
import { cn } from "@/lib/utils";
import type { Scenario } from "@/hooks/useScenarios";
import type { SimulationRun } from "@/hooks/useSimulationRun";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type PairRep = { rep_index: number; status: string; kpis: Record<string, number | null> };

interface Props {
  scenarios: Scenario[];
  /** scenario_id → newest completed run (useScenarioRuns). */
  runsByScenario: Record<string, SimulationRun>;
  /**
   * Wear the mobile skin (v2 §4C). The panel is mounted by both platforms, so
   * the skin arrives as a prop: false everywhere desktop renders. What changes
   * is the chrome — the matrix becomes a list of scenarios with their tallies,
   * and the reasons a scenario is not comparable become the skin's caveat. The
   * comparison itself, and every number in it, is the same.
   */
  skin?: boolean;
  /**
   * WP 10.5 — the Validated Model the comparison defaults to: only scenarios
   * whose newest completed run followed it are offered, until "include other
   * models" is ticked, and then every other run is LABELLED. Null = no model
   * chosen (an exploratory session): every run is offered.
   */
  modelId?: string | null;
  /** run id → the model whose EVIDENCE it is (`model_validations.evidence_run_id`).
   *  An evidence run is dispatched before its model exists, so its own row names
   *  no model; it belongs to the model it validated. */
  evidenceModelOf?: Record<string, string>;
}

// §2.4: with no comparable scenarios a select has no options and collapses to
// its 38px chrome — under the touch floor on the one state where the user most
// needs to reach it. `min-w-11` floors the width below `md`; `md:` hands back
// the intrinsic width the desktop panel has always had.
const SELECT =
  "h-7 min-h-11 min-w-11 max-w-full rounded-sm border border-[#d4d4d8] bg-white px-2 text-[12.5px] text-[#18181b] focus:border-foreground focus:outline-none md:min-h-0 md:min-w-0";
const MOBILE_SELECT = cn(
  "h-11 min-w-0 max-w-[52vw] shrink rounded-[6px] border border-[#d4d4d4] bg-white",
  "px-2 text-[length:var(--fs-row)] text-[#171717] focus:border-[#18181b] focus:outline-none",
);
const TH =
  "bg-[--brand-ink] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white border-r border-r-[rgba(255,255,255,0.22)] last:border-r-0";
const TD = "px-3 py-1.5 border-b border-[--sim-divider]";
const BETTER = "#14b8c4";
const WORSE = "#BF2330";
const FOCUSED = "#f4f4f5";

const nameOf = (s: Scenario) => s.name || "Untitled scenario";
const deltaColor = (r: CompareRow) =>
  r.better === null ? "var(--zinc-quiet)" : r.better ? BETTER : WORSE;

interface Challenger {
  id: string;
  scenario: Scenario;
  run: SimulationRun;
  failures: string[];
  rows: CompareRow[];
  tally: Tally;
}

export function CompareScenariosPanel({
  scenarios,
  runsByScenario,
  skin = false,
  modelId = null,
  evidenceModelOf = {},
}: Props) {
  const [includeOthers, setIncludeOthers] = useState(false);
  const scope = useMemo(() => {
    const cands: CompareCandidate[] = scenarios
      .filter((s) => runsByScenario[s.id])
      .map((s) => {
        const run = runsByScenario[s.id];
        const evidenceOf = evidenceModelOf[run.id] ?? null;
        return {
          scenarioId: s.id,
          modelId: run.model_validation_id ?? evidenceOf,
          exploratory: evidenceOf ? false : run.exploratory ?? !run.model_validation_id,
        };
      });
    return compareScope(cands, modelId, includeOthers);
  }, [scenarios, runsByScenario, evidenceModelOf, modelId, includeOthers]);
  const withResults = useMemo(
    () => scenarios.filter((s) => scope.offered.some((c) => c.scenarioId === s.id)),
    [scenarios, scope],
  );
  // An exploratory run is never the baseline side (WP 10.5).
  const aOptions = useMemo(
    () => withResults.filter((s) => scope.baselineEligible.some((c) => c.scenarioId === s.id)),
    [withResults, scope],
  );
  const tagOf = (id: string): string | null => {
    const c = scope.offered.find((x) => x.scenarioId === id);
    return c ? scope.labelOf(c) : null;
  };
  const withTag = (s: Scenario) => {
    const t = tagOf(s.id);
    return t ? `${nameOf(s)} — ${t}` : nameOf(s);
  };

  const [aId, setAId] = useState<string | null>(null);
  /** Comparable scenarios the user took OUT of the matrix. Kept as exclusions so
   *  a scenario that gains results joins the comparison without a click. */
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  /** undefined = not chosen: rank by the baseline's objective KPI. */
  const [rankChoice, setRankChoice] = useState<string | null | undefined>(undefined);

  // The validated baseline is the natural A: every experiment is a change to it.
  const a =
    aOptions.find((s) => s.id === aId) ??
    aOptions.find((s) => isValidationBaseline(s)) ??
    aOptions[0] ??
    null;
  const runA = a ? runsByScenario[a.id] : null;

  // Every other scenario, tested against the baseline ON ITS OWN (§9.3).
  const evaluated = useMemo(() => {
    if (!a || !runA) return [];
    return withResults
      .filter((s) => s.id !== a.id)
      .map((s) => {
        const run = runsByScenario[s.id];
        return {
          id: s.id,
          scenario: s,
          run,
          failures: comparabilityFailures({ scenario: a, run: runA }, { scenario: s, run }),
        };
      });
  }, [a, runA, withResults, runsByScenario]);
  const comparable = evaluated.filter((c) => c.failures.length === 0);
  const notComparable = evaluated.filter((c) => c.failures.length > 0);
  const included = comparable.filter((c) => !excluded.has(c.id));

  // Replication rows, so every delta is the CRN-PAIRED difference (audit F-14).
  // One request per run — a single `.in()` over many runs would meet PostgREST's
  // row cap long before any one run does — and cached by run id, so toggling a
  // scenario in and out does not refetch anything.
  const [repsByRun, setRepsByRun] = useState<Record<string, PairRep[]>>({});
  const wanted = useMemo(
    () => (runA && included.length ? [runA.id, ...included.map((c) => c.run.id)] : []),
    [runA, included],
  );
  const missing = wanted.filter((id) => !(id in repsByRun));
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    let live = true;
    void Promise.all(
      missingKey.split(",").map(async (id) => {
        const { data } = await sb.from("run_replications").select("rep_index,status,kpis").eq("run_id", id);
        return [id, (data ?? []) as PairRep[]] as const;
      }),
    ).then((loaded) => {
      if (live) setRepsByRun((prev) => ({ ...prev, ...Object.fromEntries(loaded) }));
    });
    return () => {
      live = false;
    };
  }, [missingKey]);
  const loading = missing.length > 0;

  const challengers = useMemo<Challenger[]>(() => {
    if (!runA || loading) return [];
    return included.map((c) => {
      const rows = compareRows(
        runA.aggregate_kpis ?? {}, c.run.aggregate_kpis ?? {},
        runA.ci_half_widths ?? {}, c.run.ci_half_widths ?? {},
        repsByRun[runA.id] ?? [], repsByRun[c.run.id] ?? [],
      );
      return { ...c, rows, tally: tally(rows) };
    });
  }, [runA, included, repsByRun, loading]);

  const kpis = useMemo(() => matrixKpis(challengers), [challengers]);
  const rankKpi =
    rankChoice !== undefined
      ? rankChoice
      : a && kpis.some((k) => k.key === a.primary_kpi)
        ? a.primary_kpi
        : null;
  const ranked = useMemo(() => rankChallengers(challengers, rankKpi), [challengers, rankKpi]);
  const best = useMemo(() => bestPerKpi(challengers), [challengers]);

  const focus =
    ranked.find((c) => c.id === focusId) ??
    notComparable.find((c) => c.id === focusId) ??
    ranked[0] ??
    null;
  const focusRows = ranked.find((c) => c.id === focus?.id)?.rows ?? null;

  // The body states, shared by both chromes so a message can never differ
  // between platforms.
  const shortfall =
    withResults.length < 2
      ? `Needs 2 scenarios with results (${withResults.length} of ${scenarios.length})`
      : !a
        ? "No baseline: every scenario with results ran exploratory, and an exploratory run is never a comparison baseline. Run a Validated Model (Policies › Run & Validate) to compare against."
        : comparable.length === 0
          ? `None of the other ${evaluated.length} scenarios is comparable with this baseline`
          : included.length === 0
            ? "Pick at least one scenario to compare"
            : loading
              ? "Loading replications…"
              : kpis.length === 0
                ? "No shared KPIs"
                : null;
  const cells = ranked.length * kpis.length;
  const multiple =
    ranked.length > 1
      ? `Each scenario × KPI is its own 95% paired test — across ${cells} tests (${ranked.length} scenarios × ${kpis.length} KPIs) about 1 in 20 differences inside the noise will still read separated by chance, so confirm a winner with more replications before acting on it.`
      : null;

  const rankOptions = (
    <>
      <option value="">Scenario order</option>
      {kpis.map((k) => (
        <option key={k.key} value={k.key}>
          {k.label}
        </option>
      ))}
    </>
  );
  const onRank = (v: string) => setRankChoice(v === "" ? null : v);

  if (skin) {
    return (
      <>
        <MobilePanel
          label="Scenario comparison"
          counter={a ? `${comparable.length} of ${evaluated.length} comparable` : `${withResults.length} with results`}
        >
          <MobileRow
            chevron={false}
            label="Baseline"
            trailing={
              <select
                className={MOBILE_SELECT}
                value={a?.id ?? ""}
                onChange={(e) => setAId(e.target.value)}
                disabled={aOptions.length === 0}
                aria-label="Baseline scenario"
              >
                {aOptions.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {withTag(sc)}
                  </option>
                ))}
              </select>
            }
          />
          {kpis.length > 0 ? (
            <MobileRow
              chevron={false}
              label="Rank by"
              trailing={
                <select
                  className={MOBILE_SELECT}
                  value={rankKpi ?? ""}
                  onChange={(e) => onRank(e.target.value)}
                  aria-label="Rank scenarios by"
                >
                  {rankOptions}
                </select>
              }
            />
          ) : null}
          {modelId ? (
            <MobileRow
              chevron={false}
              label="Include other models"
              sub="runs of another model, or of none, are labelled"
              trailing={
                <input
                  type="checkbox"
                  aria-label="Include other models"
                  checked={includeOthers}
                  onChange={(e) => setIncludeOthers(e.target.checked)}
                  className="h-5 w-5 accent-foreground"
                />
              }
            />
          ) : null}
          {shortfall ? <MobileRow chevron={false} label={shortfall} /> : null}
          {ranked.map((c, i) => {
            const r = rankKpi ? c.rows.find((x) => x.key === rankKpi) : null;
            return (
              <MobileRow
                key={c.id}
                dot={focus?.id === c.id ? M.ink : undefined}
                label={`${rankKpi ? `${i + 1}. ` : ""}${withTag(c.scenario)}`}
                sub={tallyLine(c.tally)}
                value={r ? <span style={{ color: deltaColor(r) }}>{r.delta}</span> : undefined}
                onClick={() => setFocusId(c.id)}
              />
            );
          })}
          {notComparable.map((c) => (
            <MobileRow
              key={c.id}
              dot={M.firm}
              label={withTag(c.scenario)}
              sub="not comparable with the baseline"
              onClick={() => setFocusId(c.id)}
            />
          ))}
        </MobilePanel>

        {focus && focusRows && !shortfall ? (
          // A comparison IS a table, and §9.5 allows one to scroll inside its
          // own container. Every column the desktop table has is here.
          <MobilePanel label={`Baseline vs ${nameOf(focus.scenario)}`} bare>
            <div className="m-cq overflow-x-auto">
              <CompareTable rows={focusRows} />
            </div>
          </MobilePanel>
        ) : null}

        {/* One caveat per screen (§13.6): the reasons for the scenario in hand
            when it is not comparable, otherwise what many tests at once mean. */}
        {focus && focus.failures.length > 0 ? (
          <MobileNote tone="caveat">
            {nameOf(focus.scenario)}: {focus.failures.join(" · ")}
          </MobileNote>
        ) : multiple && !shortfall ? (
          <MobileNote tone="caveat">{multiple}</MobileNote>
        ) : null}
      </>
    );
  }

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chip =
    "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-sm border px-2 py-[3px] text-[11.5px] md:min-h-0";
  const linkBtn =
    "min-h-11 px-1 text-[11.5px] text-[#52525b] underline-offset-2 hover:underline disabled:opacity-40 md:min-h-0";

  return (
    <div className="flex flex-col gap-4">
      <TableBlock
        name="Scenario comparison"
        count={a ? `${included.length} of ${evaluated.length}` : undefined}
        actions={
          <span className="flex flex-wrap items-center justify-end gap-[7px]">
            <span className="text-[11.5px] text-[#52525b]">Baseline</span>
            <select
              className={SELECT}
              value={a?.id ?? ""}
              onChange={(e) => setAId(e.target.value)}
              disabled={aOptions.length === 0}
              aria-label="Baseline scenario"
            >
              {aOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {withTag(s)}
                </option>
              ))}
            </select>
            <span className="text-[11.5px] text-[#52525b]">Rank by</span>
            <select
              className={SELECT}
              value={rankKpi ?? ""}
              onChange={(e) => onRank(e.target.value)}
              disabled={kpis.length === 0}
              aria-label="Rank scenarios by"
            >
              {rankOptions}
            </select>
            {modelId ? (
              <label className="flex items-center gap-1.5 text-[11.5px] text-[#52525b]">
                <input
                  type="checkbox"
                  checked={includeOthers}
                  onChange={(e) => setIncludeOthers(e.target.checked)}
                  className="h-[13px] w-[13px] accent-foreground"
                />
                include other models (labelled)
              </label>
            ) : null}
          </span>
        }
      >
        {comparable.length > 0 ? (
          <div className="flex flex-wrap items-center gap-[6px] border-b border-[--sim-divider] px-3 py-2">
            <span className="mr-1 text-[11.5px] text-[#52525b]">Compare against the baseline</span>
            {comparable.map((c) => {
              const on = !excluded.has(c.id);
              const tag = tagOf(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(c.id)}
                  title={withTag(c.scenario)}
                  className={cn(
                    chip,
                    on
                      ? "border-[#18181b] bg-white text-[#18181b]"
                      : "border-[#d4d4d8] bg-[#fafafa] text-[--zinc-quiet]",
                  )}
                >
                  <span
                    aria-hidden
                    className="h-[8px] w-[8px] flex-none rounded-[2px] border border-[#18181b]"
                    style={{ background: on ? "#18181b" : "transparent" }}
                  />
                  <span className="min-w-0 max-w-[200px] truncate">{nameOf(c.scenario)}</span>
                  {tag ? <span className="text-[10.5px] text-[--zinc-quiet]">{tag}</span> : null}
                </button>
              );
            })}
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className={linkBtn}
                disabled={excluded.size === 0}
                onClick={() => setExcluded(new Set())}
              >
                all
              </button>
              <button
                type="button"
                className={linkBtn}
                disabled={included.length === 0}
                onClick={() => setExcluded(new Set(comparable.map((c) => c.id)))}
              >
                none
              </button>
            </span>
          </div>
        ) : null}

        {shortfall ? (
          <div className="px-3 py-[10px] text-[12.5px] text-[--zinc-quiet]">{shortfall}</div>
        ) : (
          <>
            {/* The matrix: one column per scenario, so it scrolls sideways at
                any width once there are many, with the KPI column frozen. */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={cn(TH, "sticky left-0 z-[2] text-left align-bottom")}>KPI</th>
                    <th className={cn(TH, "text-right align-bottom")}>
                      <span className="block normal-case tracking-normal">Baseline</span>
                      <span
                        className="block max-w-[160px] truncate text-[10px] font-normal normal-case tracking-normal text-white/75"
                        title={a ? withTag(a) : undefined}
                      >
                        {a ? nameOf(a) : ""}
                      </span>
                    </th>
                    {ranked.map((c, i) => {
                      const tag = tagOf(c.id);
                      const on = focus?.id === c.id;
                      return (
                        <th key={c.id} className={cn(TH, "p-0 text-right align-bottom")}>
                          <button
                            type="button"
                            onClick={() => setFocusId(c.id)}
                            aria-pressed={on}
                            title={`${withTag(c.scenario)} — open the full paired table`}
                            className="flex min-h-11 w-full flex-col items-end gap-0.5 px-3 py-1.5 text-right normal-case tracking-normal md:min-h-0"
                            style={on ? { boxShadow: "inset 0 -3px 0 #ffffff" } : undefined}
                          >
                            <span className="max-w-[170px] truncate text-[11.5px]">
                              {rankKpi ? `${i + 1}. ` : ""}
                              {nameOf(c.scenario)}
                            </span>
                            {tag ? <span className="text-[10px] font-normal text-white/75">{tag}</span> : null}
                            <span className="whitespace-nowrap text-[10px] font-normal text-white/75">
                              {tallyLine(c.tally)}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {kpis.map((k) => {
                    const d = kpiDisplay(k.key);
                    const va = runA?.aggregate_kpis?.[k.key];
                    const ranking = k.key === rankKpi;
                    return (
                      <tr key={k.key}>
                        <td className={cn(TD, "sticky left-0 z-[1] bg-white")}>
                          <span
                            className="inline-block whitespace-nowrap border-l-2 pl-2 text-[12.5px] text-[#18181b]"
                            style={{ borderLeftColor: ranking ? "#18181b" : "transparent" }}
                          >
                            {k.label}
                          </span>
                        </td>
                        <td className={cn(TD, "text-right tabular-nums")}>
                          <span className="block whitespace-nowrap text-[12.5px] text-[#18181b]">
                            {typeof va === "number" ? d.format(va) : "not measured"}
                          </span>
                          <span className="block whitespace-nowrap text-[11px] text-[--zinc-quiet]">
                            ± {d.format(runA?.ci_half_widths?.[k.key] ?? 0)}
                          </span>
                        </td>
                        {ranked.map((c) => {
                          const r = c.rows.find((x) => x.key === k.key);
                          const isBest = best.get(k.key) === c.id && ranked.length > 1;
                          return (
                            <td
                              key={c.id}
                              className={cn(TD, "text-right tabular-nums")}
                              style={focus?.id === c.id ? { background: FOCUSED } : undefined}
                            >
                              {r ? (
                                <>
                                  <span
                                    className={cn(
                                      "block whitespace-nowrap text-[12.5px]",
                                      isBest ? "font-semibold" : "font-medium",
                                    )}
                                    style={{ color: deltaColor(r) }}
                                    title={
                                      r.basis === "unpaired"
                                        ? "unpaired — no replication rows"
                                        : r.overlap
                                          ? "not separated: the paired interval contains 0"
                                          : "separated: the paired interval excludes 0"
                                    }
                                  >
                                    {isBest ? (
                                      <span className="mr-1.5 rounded-sm border border-current px-1 text-[9.5px] font-semibold uppercase tracking-[0.06em]">
                                        best
                                      </span>
                                    ) : null}
                                    {r.delta}
                                  </span>
                                  <span className="block whitespace-nowrap text-[11px] text-[--zinc-quiet]">
                                    {r.b}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[11.5px] text-[--zinc-quiet]">not measured</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-0.5 px-3 py-2 text-[11px] leading-snug text-[--zinc-quiet]">
              <span>
                Each cell is scenario − baseline: the CRN-paired difference over replications ± its
                95% interval, with the scenario's own mean beneath. Coloured only when the interval
                excludes 0. Click a scenario for its full paired table.
              </span>
              {multiple ? <span>{multiple}</span> : null}
            </div>
          </>
        )}
      </TableBlock>

      {notComparable.length > 0 ? (
        <TableBlock name="Not comparable with the baseline" count={notComparable.length}>
          <div className="flex flex-col divide-y divide-[--sim-divider]">
            {notComparable.map((c) => (
              <div key={c.id} className="flex flex-col gap-[3px] px-3 py-2">
                <span className="text-[12.5px] text-[#18181b]">{withTag(c.scenario)}</span>
                {c.failures.map((f) => (
                  <span key={f} className="flex items-start gap-[7px] text-[12px] text-[#52525b]">
                    <span className="mt-[6px] h-[7px] w-[7px] flex-none rounded-full bg-[#e0930b]" />
                    {f}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </TableBlock>
      ) : null}

      {focus && focusRows && !shortfall && a ? (
        <TableBlock
          name={`${nameOf(a)} vs ${nameOf(focus.scenario)}`}
          meta="the full paired comparison for one scenario"
        >
          <CompareTable rows={focusRows} />
        </TableBlock>
      ) : null}
    </div>
  );
}
