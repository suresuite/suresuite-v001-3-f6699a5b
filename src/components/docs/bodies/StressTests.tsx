// §6.3 section 7 — the stress-test battery.
//
// The seven tests are READ FROM THE ENGINE (scsim/scsim/stress/battery.py's
// ST_DEFINITIONS), not mined from the archived manual. §6.6 lists them as
// mineable narrative; the archived copy already carried statuses the engine
// does not, which is D22's shape before anybody read it. Whether a test RUNS is
// derived from a call site rather than from a docstring.
//
// It is still a text scan over a Python literal — §4 D90's weakest door — and
// the footer says so rather than presenting it as contract-generated.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { Badge } from "@/components/ui/badge";
import { STRESS_TESTS } from "@/components/docs/generated/policy.generated";

export default function StressTests() {
  const runnable = STRESS_TESTS.filter((t) => t.runnable);
  const declared = STRESS_TESTS.filter((t) => !t.runnable);

  return (
    <>
      <PageTitle lead="The standing battery: what each test sweeps, and which ones you can run today.">
        Stress tests
      </PageTitle>

      <Section id="what-a-battery-is" title="What a battery is for">
        <Key>
          One disruption tells you what happens to this chain if that fails. A battery tells you
          which failure matters most.
        </Key>
        <P>
          Each test sweeps one dimension — every supplier, every severity, every duration — and
          ranks the results. You do not have to guess which node to attack; the sweep attacks all of
          them and reports the order.
        </P>
        <P>
          All cells share one clean reference run and one warm state per seed, so a cell's result is
          paired against the baseline rather than against its own separate world.{" "}
          <DocLink to="seeds-replications-confidence">Seeds, replications &amp;
          confidence</DocLink> is why that matters.
        </P>
      </Section>

      <Section id="the-battery" title="The seven tests">
        <P>
          {runnable.length} of {STRESS_TESTS.length} run today; the rest are declared in the engine
          and not yet implemented. Listed rather than hidden, so “does this tool do X” is a fact you
          can read.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {STRESS_TESTS.map((t) => (
            <div key={t.id} id={t.id} className="scroll-mt-20 p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[13px] font-semibold text-foreground">{t.id}</span>
                <Badge variant={t.runnable ? "secondary" : "outline"} className="text-[10px]">
                  {t.runnable ? "runs today" : "declared, not implemented"}
                </Badge>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{t.description}</p>
            </div>
          ))}
        </div>
      </Section>

      <Callout tone="limit" title="A supplier's rank is a rank under one kind of failure">
        <p>
          <Term>{runnable[0]?.id ?? "The outage sweep"}</Term> ranks suppliers by what a delay does.{" "}
          <Term>{runnable[1]?.id ?? "The capacity sweep"}</Term> ranks them by what losing volume
          does. <strong>The same supplier can come out differently.</strong>
        </p>
        <p>
          So “our most critical supplier” is not a property of the chain — it is a property of the
          question. Run both before you act on either, and expect the two lists to disagree.
        </p>
      </Callout>

      {declared.length > 0 && (
        <Callout tone="limit" title={`${declared.length} of the seven cannot be run`}>
          <p>
            They are part of the engine's declared battery and their implementations are not there.
            A sweep you cannot run is not a sweep you should plan around, and listing them is not a
            commitment to a date.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="disruptions">Disruptions</DocLink> ·{" "}
          <DocLink to="experiments-and-comparison">Experiments &amp; comparison</DocLink> ·{" "}
          <DocLink to="kpis-and-resilience-index">KPIs &amp; the Resilience Index</DocLink> ·{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink>
        </P>
      </Section>

      <Provenance from="scsim/scsim/stress/battery.py's ST_DEFINITIONS, read from the engine source — the weakest of the three declaration routes, because the battery is not in the registry export" />
    </>
  );
}
