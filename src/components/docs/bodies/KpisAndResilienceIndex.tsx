// §6.3 section 11 — KPIs. Marked G*: every definition, symbol and unit is read
// from the engine registry export. §6.6 forbids mining KPI definitions from the
// archive for exactly the reason this page exists.

import { PageTitle, Section, P, Key, Callout, Prose, Term, DocLink, Provenance } from "@/components/docs/prose";
import { engineVersion } from "@/lib/policies/registryAccess";
import registry from "@/lib/policies/registry.generated.json";
import { DocFigure } from "@/components/docs/DocFigure";

type Kpi = { name: string; symbol: string; unit: string; definition: string };

/** What each measure is FOR, in a planner's terms. The registry has the maths. */
const WHY: Record<string, string> = {
  fill_rate: "The headline service measure. Weighted by value, so missing an expensive product hurts more than missing a cheap one.",
  lost_sales_value: "What the unserved demand was worth. The number a commercial reader will ask for first.",
  cost_of_resilience: "Everything you spent to be resilient — extra stock, backup suppliers, expediting, overtime — in one figure, so protection can be compared against what it costs.",
  delta_cost: "How much a strategy changed the cost of resilience, against the baseline.",
  delta_revenue: "How much it changed revenue, against the baseline. Read with delta_cost, never alone.",
  ttr_weeks: "Time to recover: how long until the chain is working normally again after a shock.",
  tts_weeks: "Time to survive: how long the chain can absorb the shock before service degrades. If it exceeds the disruption, nothing is felt outside.",
  service_loss_area: "Not just how deep the service dip went, but how long it lasted — depth times duration, which is what a customer experiences.",
  max_backlog: "The worst point of the queue. A capacity question as much as a service one.",
  lost_inbound_units: "Supply that never arrived, in units.",
  "synergy_R / synergy_C": "Whether combining two strategies did more than the two apart, on revenue and on cost.",
  resilience_index: "A single 0–100 score rolling the rest together, for ranking. Useful for a shortlist and misleading as an answer.",
};

export default function KpisAndResilienceIndex() {
  const kpis = (registry as { kpis: Kpi[] }).kpis;

  return (
    <>
      <PageTitle lead="Every measure the engine reports, what it is for, and its unit.">
        KPIs &amp; the Resilience Index
      </PageTitle>

      <Section id="how-to-read" title="How to read this page">
        <Key>
          {kpis.length} measures, from engine <Term>{engineVersion()}</Term>. The definition under
          each one is the engine's own, read from its export rather than restated.
        </Key>
        <P>
          The archived manual carried hand-copied KPI definitions and they drifted. This page cannot
          — a measure added, renamed or redefined in the engine changes here with nobody editing it.
        </P>
      </Section>

      <Section id="three-as-regions" title="Three of them are shapes, not numbers">
        <P>
          <Term>ttr_weeks</Term>, <Term>tts_weeks</Term> and <Term>service_loss_area</Term> are
          defined on the fill-rate trace itself. Reading their definitions as sentences is
          possible; seeing them is faster, and the three-week rule in particular does not read as
          load-bearing until you watch it disqualify a week.
        </P>
        <DocFigure id="resilience-curve" />
      </Section>

      <Section id="the-measures" title="The measures">
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {kpis.map((k) => (
            <div key={k.name} id={k.name} className="scroll-mt-20 p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[13px] font-semibold text-foreground">{k.name}</span>
                {k.symbol && k.symbol !== "—" && (
                  <span className="text-[12px] text-muted-foreground">{k.symbol}</span>
                )}
                <span className="text-[11px] text-muted-foreground">in {k.unit}</span>
              </div>
              {WHY[k.name] && (
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{WHY[k.name]}</p>
              )}
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[12px] text-muted-foreground">
                  The engine's definition
                </summary>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  <Prose text={k.definition} />
                </p>
              </details>
            </div>
          ))}
        </div>
      </Section>

      <Callout tone="limit" title="The Resilience Index is a ranking device, not a verdict">
        <p>
          One number rolling several together is useful for sorting a list and dangerous as an
          answer, because two chains can reach the same score in incompatible ways — one cheap and
          fragile, one expensive and steady.
        </p>
        <p>
          Use it to decide what to look at. Decide with the measures underneath it, which is why
          they are all on this page rather than behind it.
        </p>
      </Callout>

      <Callout title="Cost and revenue deltas belong together">
        <p>
          A strategy that improves revenue tells you nothing on its own — it may have cost more than
          it returned. The two deltas are reported as a pair and should be read as one, which is
          also what the synergy figures are decomposing.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="reading-your-results">Reading your results</DocLink> ·{" "}
          <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink> ·{" "}
          <DocLink to="stress-tests">Stress tests</DocLink> ·{" "}
          <DocLink to="per-item-time-series">Per-item time series</DocLink>
        </P>
      </Section>

      <Provenance from="the engine registry export's KPI block" />
    </>
  );
}
