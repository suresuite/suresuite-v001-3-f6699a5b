// §6.3 section 11 — reading your results. Deepened in WP 5.2j.
//
// ── THE PAGE DESCRIBED THREE LAYERS AND NOT THE SCREEN ────────────────────
//
// 375 rendered words for a dashboard that mounts seven panels. None was named,
// so a reader could not tell which panel answered which of the three layers the
// page described, and the two panels with something surprising in them — the
// engine's conversion notes, behind a disclosure triangle, and a heatmap that
// can never render — were invisible in both the product and the manual.
//
// ── AND THE JOIN THAT ONLY A DERIVATION CAN SEE (D113) ────────────────────
//
// `KpiStatTable` maps over `KPI_DISPLAY` and looks each key up on the
// replication rows. `KPI_DISPLAY` is the LEGACY engine's vocabulary; the
// canonical engine emits different names. Two of thirteen display rows can ever
// appear, and the eleven that cannot include Resilience index — the measure on
// the title of the neighbouring page.
//
// Neither file is wrong on its own, which is why nobody saw it: one is a
// plausible list of supply-chain measures and the other a plausible set of
// engine outputs. `deriveRunKpis` computes the join, so this page states a
// number it cannot get wrong and stops stating it the day somebody aligns them.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { engineVersion } from "@/lib/policies/registryAccess";
import {
  REPLICATION_SERIES_FACTS as SERIES,
  RUN_KPIS,
} from "@/components/docs/generated/policy.generated";

export default function ReadingYourResults() {
  const shown = RUN_KPIS.display.filter((d) => d.emitted);
  const absent = RUN_KPIS.display.filter((d) => !d.emitted);
  const always = RUN_KPIS.emitted.filter((e) => e.always);
  const onDisruption = RUN_KPIS.emitted.filter((e) => !e.always);

  return (
    <>
      <PageTitle lead="What a run produces, which panel says it, and the order to look at them in.">
        Reading your results
      </PageTitle>

      <Section id="the-order" title="The order that saves time">
        <Key>
          Read the spread before the mean, and read what the model assumed before either.
        </Key>
        <P>
          A mean with a wide interval around it is a weaker claim than a slightly worse mean with a
          narrow one. And both are claims about a model that may have filled in half your
          economics — <DocLink to="data-trust-report">the Data Trust Report</DocLink> is how much.
        </P>
        <P>
          In practice that is four questions, in this order. <strong>Did the engine change my
          model?</strong> (the conversion notes) <strong>Has it settled?</strong> (the convergence
          plot) <strong>What is the answer and how sure is it?</strong> (the KPI table){" "}
          <strong>What shape was it?</strong> (the weekly series). Every panel below answers exactly
          one of those.
        </P>
      </Section>

      <Section id="the-panels" title="The panels, in the order they appear">
        <div className="space-y-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-sm font-semibold text-foreground">
              The badges — “Monte Carlo · N replications”
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              N is how many replications <em>finished</em>, not how many you asked for, so a run
              whose worker died partway reports what it has. A yellow “Preliminary estimate” badge
              means the engine has not finished and the numbers under it will move. Beside it, the
              credibility badge says whether this run was made under a validated warm-up and
              replication count — see <DocLink to="model-validation">Model validation</DocLink>.
            </p>
          </div>

          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-sm font-semibold text-foreground">
              Engine conversion notes — <strong>open this one</strong>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              A collapsed triangle with a count beside it, and it is the most consequential thing on
              the screen. These are the things the engine <em>had to change</em> about your model to
              run it: a policy it could not apply, a unit it substituted, a disruption target it
              could not find. A run with notes is a run about a slightly different chain than the
              one you described, and the notes are the only place that is said.
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              It is collapsed by default on a wide screen and open on a phone. Treat the phone
              behaviour as the correct one.
            </p>
          </div>

          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-sm font-semibold text-foreground">Convergence plot</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              The running mean of your primary measure with its 95% interval, as replications
              complete. A line still moving at the right-hand edge means you stopped too early; a
              flat line inside a narrowing band means the answer has settled and more replications
              will only tighten it.
            </p>
          </div>

          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-sm font-semibold text-foreground">
              Replication &amp; seed explorer — {SERIES.offered.length} weekly series
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              The default is the mean across replications with a confidence band; pick a seed and
              that replication is drawn against it. This is where you find out whether a bad week is
              your chain or that seed.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SERIES.offered.map((s) => (
                <span
                  key={s.key}
                  className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {s.label} <span className="font-mono text-[10px]">{s.unit}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-sm font-semibold text-foreground">KPI summary across replications</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Mean, ± interval, standard deviation, minimum, maximum and the count of replications
              behind each. Your scenario's objective is banded so it does not get lost among the
              others. A measure with nothing behind it is omitted rather than shown as zero — which
              is right, and is also why this table is shorter than you expect. The next section is
              why.
            </p>
          </div>

          {SERIES.heatmapRemoved ? (
            <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
              <div className="text-sm font-semibold text-foreground">
                Utilization heatmap — removed
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                If you remember a node × time heatmap here, it is gone. It read a per-node{" "}
                <Term>{SERIES.heatmapWants}</Term> series that <strong>no engine writes</strong> —
                the four series a replication carries are listed above — so it was empty on every
                run, forever, under a caption that read as something a different run could fix. A
                panel that can only ever be empty is a placeholder, not a state. The measure itself
                is not lost: <Term>capacity_utilization</Term> is a run-level KPI and appears in the
                summary table above, which the same defect had been hiding.
              </p>
            </div>
          ) : !SERIES.heatmapEverRenders && (
            <div className="rounded-sm border border-destructive/40 bg-card p-4 shadow-xs">
              <div className="text-sm font-semibold text-foreground">
                Utilization heatmap — permanently empty
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                It reads a per-node <Term>{SERIES.heatmapWants}</Term> series from each replication,
                and <strong>no engine writes one</strong>. The four series a replication does carry
                are listed above. So this panel shows “No utilization series yet. Run a simulation
                that emits per-node utilization to see it here” on every run — which reads as
                something you could fix by running differently, and there is no run that produces
                it. Ignore the panel; it is a placeholder, not a state.
              </p>
            </div>
          )}

          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="text-sm font-semibold text-foreground">Per-item weekly series</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Present only on an inspection run, and absent entirely otherwise — not empty, absent.{" "}
              <DocLink to="per-item-time-series">Per-item time series</DocLink> is how to get one.
            </p>
          </div>
        </div>
      </Section>

      <Callout tone="limit" title={`The KPI table can show ${shown.length} of its ${RUN_KPIS.display.length} rows, and the missing ones are not small`}>
        <p>
          The results screen looks for {RUN_KPIS.display.length} named measures on each replication.
          The engine writes {always.length} measures per replication
          {onDisruption.length > 0 && <> plus {onDisruption.length} more on a run that had a
          disruption</>}, and only <strong>{shown.map((d) => d.label).join(" and ")}</strong> are
          named the same in both. Everything else in that list —{" "}
          {absent.map((d) => d.label).join(", ")} — <strong>cannot appear</strong>, whatever you
          run.
        </p>
        <p>
          Nothing wrong is displayed: a row with no data is dropped rather than shown as zero. What
          you lose is the measures themselves. The engine computes cost of resilience, lost sales
          value, peak backlog, a ten-way cost breakdown and, on a disrupted run, time-to-recover and
          time-to-survive — and none of them has a row on that table.
        </p>
        <p>
          <strong>Resilience index is the sharpest case and it is worse than a naming mismatch.</strong>{" "}
          No run computes it at all: the only code that does sits in the engine's stress-test
          library, which nothing in this product calls (see{" "}
          <DocLink to="stress-tests">Stress tests</DocLink>). So the measure named in the title of{" "}
          <DocLink to="kpis-and-resilience-index">the neighbouring page</DocLink> is a measure you
          cannot obtain from a run today. That page documents the engine's definition, which is
          real; this one tells you the run does not produce it.
        </p>
        <p>
          <strong>Where to get the measures that are missing:</strong> the per-replication rows
          carry every engine measure under the engine's own names, and{" "}
          <DocLink to="verifiable-exports">the verifiable exports</DocLink> ship those rows. The
          data is there; it is the table that is looking for the wrong names.
        </p>
      </Callout>

      <Section id="what-comes-back" title="The three layers underneath">
        <DocFigure id="kpi-vocabulary-gap" />
        <P>Each answers a different question, and each is what the one above it was computed from.</P>
        <div className="space-y-3">
          {[
            {
              t: "Aggregate measures",
              d: "One value per measure across all replications, with its confidence interval. This is the headline and it is the layer most likely to be quoted out of context.",
            },
            {
              t: "Per-replication rows",
              d: "The same measures, one row per seed, under the engine's own names. This is what the interval was computed from, and it is what lets somebody else check it rather than trust it.",
            },
            {
              t: "Weekly series",
              d: "What happened week by week — four measures for every run, and eight per item on an inspection run. Where a mean says the fill rate was 94%, this says whether it was 94% every week or 100% for forty weeks and 40% for ten.",
            },
          ].map((x) => (
            <div key={x.t} className="rounded-sm border border-border bg-card p-4 shadow-xs">
              <div className="text-sm font-semibold text-foreground">{x.t}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{x.d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Callout tone="law" title="The mean hides the shape, and the shape is usually the finding">
        <p>
          Two chains with the same average service level can be completely different businesses: one
          consistently adequate, one excellent until a shortage and then catastrophic. The aggregate
          cannot tell them apart and{" "}
          <DocLink to="per-item-time-series">the weekly series</DocLink> can.
        </p>
      </Callout>

      <Section id="what-a-result-carries" title="What a result carries with it">
        <P>
          Each run records what it ran on: the data, the decisions, the scenario, the seeds and the
          engine version — <Term>{engineVersion()}</Term> today. That is what makes a figure
          defensible six months later rather than merely recorded.
        </P>
        <P>
          It is also not yet one artifact.{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink> says exactly what is
          in place and what is not, including the part that is honestly missing.
        </P>
        <P>
          The dashboard itself lives under a run in{" "}
          <AppLink to="/simulation-lab">Simulation Lab</AppLink> and under the queue on{" "}
          <AppLink to="/policies">Policies</AppLink> → Run &amp; validate. It is the same component
          in both places, so nothing differs between them but what is around it.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="kpis-and-resilience-index">KPIs &amp; the Resilience Index</DocLink> defines
          the measures · <DocLink to="per-item-time-series">Per-item time series</DocLink> is the
          layer below ·{" "}
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp; confidence</DocLink>{" "}
          is why the interval is the number to read ·{" "}
          <DocLink to="verifiable-exports">Verifiable exports</DocLink> is how the rows leave ·{" "}
          <DocLink to="model-validation">Model validation</DocLink> is where the credibility badge
          comes from.
        </P>
      </Section>

      <Provenance from="scsim/scsim/kpi/compute.py's replication row joined to src/lib/sim/kpiDisplay.ts's KPI_DISPLAY, and the engine's extra_series joined to the two panels that read it — the panel inventory is ResultsDashboard's own mount order" />
    </>
  );
}
