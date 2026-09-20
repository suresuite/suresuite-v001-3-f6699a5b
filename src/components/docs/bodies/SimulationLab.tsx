// §6.3 section 7 — running an experiment. Rewritten in WP 5.2j.
//
// ── THE PAGE DOCUMENTED TWO MODES THE SCREEN DOES NOT HAVE ────────────────
//
// It opened "Preview and experiment modes, and what each one produces", and
// there is no preview mode: the only occurrence of the word in the whole of
// `src/pages/SimulationLab.tsx` and `src/components/sim/` is a comment about a
// recovery calculation. What the screen actually has is a FIVE-STAGE GATED
// RAIL — Setup, Recovery playbook, Run, Results, Compare — and a run gate that
// refuses to dispatch until its findings are cleared or acknowledged. None of
// that was on the page, and a reader arriving blocked by the gate had nothing
// to read.
//
// Same class as §4 D111: a page describing a plausible feature rather than the
// one on screen. E3 is the check that catches it.
//
// The objective list is DERIVED, because four of its five choices name a
// measure the engine does not emit (§4 D113) and that is not a fact a page
// should be trusted to keep up to date by hand.

import { PageTitle, Section, P, Key, Callout, Steps, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { ReadsFrom } from "@/components/docs/lineage";
import { RUN_KPIS } from "@/components/docs/generated/policy.generated";
import { DocFigure } from "@/components/docs/DocFigure";

export default function SimulationLab() {
  const usable = RUN_KPIS.objectives.filter((o) => o.emitted);
  const unusable = RUN_KPIS.objectives.filter((o) => !o.emitted);

  return (
    <>
      <PageTitle lead="The five stages a scenario goes through, the gate between stage 2 and stage 3, and the one setting that decides whether you get a chart.">
        Simulation Lab — running an experiment
      </PageTitle>

      <Section id="the-rail" title="The rail across the top is the whole screen">
        <Key>
          Five stages, in order, and the one you are on is the only pane you see.
        </Key>
        <P>
          Simulation Lab is not a dashboard with tabs. It is a sequence, and the rail shows where
          you are in it, what each stage currently holds, and whether the run is allowed. Every
          sub-label under a stage name is a live fact about <em>your</em> scenario — not a hint, not
          a description — so the rail alone tells you what is set and what is missing.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {[
            {
              n: "1",
              t: "Setup",
              sub: "horizon · replications · objective",
              d: "The run window and what you are measuring. Its sub-label reads back the three numbers, so a scenario set to one replication is visible before you run it rather than after.",
            },
            {
              n: "2",
              t: "Recovery playbook",
              sub: "events · levers",
              d: "The disruption schedule and the responses to it. It only ticks as done when there is at least one event AND recovery is enabled AND at least one lever is set — a half-configured playbook is never shown as finished.",
            },
            {
              n: "3",
              t: "Run",
              sub: "the gate, then the queue",
              d: "The model version you are running, the gate's findings, and the progress of a live run. This is where a run is dispatched and where it is refused.",
            },
            {
              n: "4",
              t: "Results",
              sub: "status · replications done",
              d: "The dashboard. It ticks as done only when the latest run is both finished and current — a result computed against data you have since changed does not count as done.",
            },
            {
              n: "5",
              t: "Compare",
              sub: "scenarios with results",
              d: "Two or more finished scenarios side by side. It ticks at two, because one scenario is not a comparison.",
            },
          ].map((s) => (
            <div key={s.n} className="flex gap-3 p-4">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                {s.n}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-foreground">{s.t}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{s.sub}</span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
        <P>
          You can click any stage at any time — the sequence is the recommended order, not a lock.
          What <em>is</em> locked is dispatching a run, and that is the gate.
        </P>
      </Section>

      <Section id="the-gate" title="The gate, and why a run is refused">
        <DocFigure id="run-sequence" />
        <P>
          To the right of the rail's heading is a single readout: a coloured dot, the word{" "}
          <Term>gate</Term>, and a count. It is the most useful thing on the screen and it has
          exactly three states.
        </P>
        <div className="space-y-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">clear — run allowed</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Nothing found that would make the run meaningless. It does not mean your model is
              right; it means nothing is obviously missing.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              N warnings — acknowledge to run
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              The run will produce numbers and something about the model is worth knowing first. You
              tick an acknowledgement and the run proceeds. <strong>Read the findings before you
              tick.</strong> This is the product asking whether you meant it, and the tick is
              recorded against your run.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">N blocking findings — run gated</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              There is no acknowledgement for these. Something the run requires is absent, and the
              reason is printed as text beside the button rather than hidden in a tooltip. Fix the
              finding and the dot clears on its own.
            </p>
          </div>
        </div>
        <P>
          The findings themselves are a table under the gate, each naming the field or policy it is
          about. <DocLink to="verify-your-inputs">Verify your inputs</DocLink> is the same grading
          applied before you get here — a model verified there rarely arrives blocked.
        </P>
      </Section>

      <Callout tone="limit" title="A run needs a SAVED policy version, and the button tells you which situation you are in">
        <p>
          A run is bound to a snapshot of your policies, not to the policies as they are at this
          instant. So there are three cases, and the run control changes to match: it runs, it
          offers <strong>Save version and run</strong> because you have edits since the last
          snapshot, or it tells you there is no saved version at all.
        </p>
        <p>
          That binding is what makes a result reproducible — the run records the version it used,
          and a result you look at in six months names a policy set you can still read.{" "}
          <DocLink to="policy-versions-and-presets">Policy versions &amp; presets</DocLink> is how
          those snapshots work.
        </p>
      </Callout>

      <Section id="objective" title="The objective you pick in Setup decides whether you get a chart">
        <Key>
          {usable.length} of the {RUN_KPIS.objectives.length} objectives produce a convergence plot.
          The rest leave it empty, permanently.
        </Key>
        <P>
          Setup's objective drop-down offers {RUN_KPIS.objectives.map((o) => o.label).join(", ")}.
          The convergence plot on Results reads that measure off each replication — and the engine
          only writes{" "}
          <strong>{usable.map((o) => o.label).join(" and ")}</strong>
          {usable.length === 1 ? " under that name" : " under those names"}.
        </P>
        <P>
          Choose {unusable.map((o) => o.label).join(", ")} and the plot says “Need at least 2
          completed replications to plot convergence” on a run with a hundred. Nothing is wrong with
          the run; the chart is looking for a measure that is not on the row.{" "}
          <DocLink to="reading-your-results">Reading your results</DocLink> has the full shape of
          this, and it affects the KPI table too.
        </P>
        <P>
          The default is <Term>fill_rate</Term>, which works. If you have not deliberately changed
          it, you are fine.
        </P>
      </Section>

      <Section id="how-a-run-goes" title="How a run goes">
        <Steps
          steps={[
            {
              title: "The model is assembled",
              body: (
                <>
                  Your tier-2 data plus the policy snapshot, mapped into the engine's own entities.
                  Anything missing is substituted here, and the mapping report says what was — it
                  comes back as the <strong>engine conversion notes</strong> on the results panel.
                </>
              ),
            },
            {
              title: "It is handed to the engine",
              where: "worker",
              body: (
                <>
                  The simulation runs outside the browser. Closing the tab does not stop it, and it
                  does not need your machine to be fast. The progress panel updates as replications
                  land, so a long run is watchable rather than opaque.
                </>
              ),
            },
            {
              title: "Replications run",
              body: (
                <>
                  The same world, different random draws. You can <strong>cancel</strong> an
                  in-flight run, or <strong>add replications</strong> to one that has finished
                  without starting over — the added ones extend the same run rather than making a
                  second.{" "}
                  <DocLink to="seeds-replications-confidence">Seeds, replications &amp;
                  confidence</DocLink> is why one run is not an answer.
                </>
              ),
            },
            {
              title: "Results come back stamped",
              body: (
                <>
                  Aggregate measures with their spread, per-replication detail underneath, and a
                  credibility badge saying whether the warm-up and replication count behind them
                  were validated.{" "}
                  <DocLink to="reading-your-results">Reading your results</DocLink> covers what to
                  look at first.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section id="the-aside" title="The scenario list, and the two libraries above it">
        <P>
          The left column holds your scenarios, and above them two ways of not starting from blank.
        </P>
        <P>
          <strong>The stress-test drawer</strong> creates a scenario with a disruption already
          written into it. Read <DocLink to="stress-tests">Stress tests</DocLink> before you rely on
          one: most of the presets name a target the engine cannot resolve as shipped.
        </P>
        <P>
          <strong>The saved-scenario library</strong> clones a scenario somebody saved as a
          template, and drops you on stage 2 to edit its disruption. Beside each scenario in your
          own list, a credibility badge says whether it is still aligned with the policy version and
          validation it was set up under — so a scenario that has drifted is visible in the list
          rather than at the moment you read its result.
        </P>
        <P>
          Duplicating a scenario copies its settings and not its runs, which is the right way to
          test one change: duplicate, change the one thing, run both, compare.
        </P>
      </Section>

      <Callout tone="limit" title="Arriving from the network map is not the same as arriving here">
        <p>
          A scenario created from a network screen carries a “from network map” marker and opens on
          stage 2 with its disruption already set. The rest of the sequence is unchanged and the
          gate still applies — but the objective and the run window are whatever the defaults are,
          because that path never asked you.
        </p>
        <p>Check stage 1 before you run one of those.</p>
      </Callout>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="SimulationLab.tsx" />
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="scenarios">Scenarios</DocLink> is stage 1 in full ·{" "}
          <DocLink to="disruptions">Disruptions</DocLink> and{" "}
          <DocLink to="recovery-playbooks">Recovery playbooks</DocLink> are stage 2 ·{" "}
          <DocLink to="reading-your-results">Reading your results</DocLink> is stage 4 ·{" "}
          <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink> is stage 5
          · <DocLink to="performance-and-caching">Performance &amp; caching</DocLink> is why a
          second identical run is instant.
        </P>
        <P>
          Open it at <AppLink to="/simulation-lab">/simulation-lab</AppLink>.
        </P>
      </Section>

      <Provenance from="src/components/sim/StageRail.tsx's buildStages for the five stages and the gate readout, ScenarioSetupForm's own objective list joined to the engine's emitted keys, and WP 5.1's confirmed table-grain lineage for the reads block" />
    </>
  );
}
