import { PageTitle, Section, P, Key, Callout, Defs, DocLink } from "@/components/docs/prose";

export default function KnownLimits() {
  return (
    <>
      <PageTitle lead="What this tool does not model, and what is not yet true of it. Near the front of the manual on purpose.">
        Known limits
      </PageTitle>

      <Section id="why-at-the-front" title="Why this is page seven and not page seventy">
        <P>
          A modelling tool that lists its limitations in an appendix is relying on you not reading
          the appendix. The limits below change how some results should be read, so they belong
          before the results, not after them.
        </P>
        <Key>
          None of this is a reason not to use the tool. It is the information you need in order to
          know which questions it can answer well.
        </Key>
      </Section>

      <Section id="model-limits" title="What the model does not represent">
        <Defs
          items={[
            {
              term: "The chain runs at steady state",
              def: "The simulation settles the chain into a regular rhythm, then disrupts it and measures the recovery. There is no growth trend, no seasonality and no structural change over the horizon. This is the right shape for 'how badly does a shock hurt, and how fast do we recover' and the wrong shape for 'what does the next three years look like'.",
            },
            {
              term: "Prices do not move",
              def: "Unit prices and costs are held at the values you supply for the whole run. There is no price-volatility model, no commodity index and no exchange-rate movement. A scenario in which the disruption's main effect is a price spike is not one this tool can answer today — the quantity effects will be right and the cost effects will be understated.",
            },
            {
              term: "Demand is drawn, not forecast",
              def: "Weekly demand is sampled from the distribution you specify for each product. The model does not learn a pattern from history, and it does not represent correlated demand across products.",
            },
            {
              term: "One plant per project",
              def: "A project models a single plant and the chain around it. Multi-site networks are represented through the supplier and customer structure rather than as several plants running their own production.",
            },
          ]}
        />
      </Section>

      <Section id="data-limits" title="Where the data layer is not yet complete">
        <P>
          These are known defects with fixes scheduled, not design choices. They are here because
          finding out about them from a wrong number is worse than reading about them now.
        </P>

        <Callout tone="limit" title="Re-uploading a file can duplicate rows">
          <p>
            The four lane and bill-of-materials tables — inbound lanes, outbound lanes, and both
            bill-of-materials shapes — have no uniqueness rule beyond an internal row identifier.
            Uploading the same file a second time adds a second copy of every row rather than
            updating the first.
          </p>
          <p>
            <strong className="text-foreground">Until it is fixed:</strong> replace a dataset rather
            than re-uploading on top of it, and treat an unexpected doubling of volumes as this
            defect until you have ruled it out.
          </p>
        </Callout>

        <Callout tone="limit" title="The dataset fingerprint does not cover everything">
          <p>
            Each run records a fingerprint of the data it ran against, so that two results can be
            told apart. That fingerprint currently covers the single-level bill of materials and not
            the multi-level one, nor the deep-tier network tables.
          </p>
          <p>
            <strong className="text-foreground">What this means:</strong> if you edit a multi-level
            bill of materials and rerun, the two runs will carry the same data fingerprint even
            though the data differed. The results are correct; it is the claim that they ran against
            identical inputs that is not.
          </p>
        </Callout>

        <Callout tone="limit" title="The audit trail covers the administrative plane only">
          <p>
            Changes to accounts, roles and organizations are recorded with the actor who made them.
            Movements of data between tiers — a promotion, a recomputation, a policy change — are
            not yet recorded to the same standard.
          </p>
          <p>
            <strong className="text-foreground">What this means:</strong> the record can tell you
            who changed a permission, but not always who promoted a dataset. See{" "}
            <DocLink to="audit-log">Audit log</DocLink>.
          </p>
        </Callout>

        <Callout tone="limit" title="An unlimited supplier capacity displays as zero">
          <p>
            Leaving a supplier's capacity blank means “no limit” to the engine. The policy grid
            renders that blank as <span className="font-mono">0</span>, which reads as “this
            supplier can supply nothing” — the opposite of what it means — and the marker that would
            normally flag a substituted value does not appear for this case.
          </p>
          <p>
            <strong className="text-foreground">Until it is fixed:</strong> a zero capacity in the
            supplier grid means the field is empty, not that capacity is zero. The simulation treats
            it as unlimited, which is the intended behaviour.
          </p>
        </Callout>
      </Section>

      <Section id="documentation-limits" title="Where this manual is not yet complete">
        <P>
          Most of this manual is generated from the same description the software reads, which is
          what makes it trustworthy. The parts that are not yet written are listed in the navigation
          with the work package that will write them, rather than being left out.
        </P>
        <P>
          <DocLink to="data-model">The data model at a glance</DocLink> does the same for the
          schema: every table appears, either with its description or with the package that owes
          one. If you are looking for a page and cannot find it in the navigation, it is not a
          missing page — it is a page that does not exist yet and says so.
        </P>
      </Section>

      <Section id="how-to-use" title="How to use this page">
        <P>
          Before you put a figure in front of someone who will act on it, check whether any limit
          above touches it. The two that most often matter are the steady-state assumption — which
          makes this a tool for shock and recovery rather than for long-range planning — and the
          absence of price movement, which understates the cost side of scenarios whose main effect
          is on price.
        </P>
        <P>
          <DocLink to="what-happens-to-your-data">What happens to your data</DocLink> explains why
          this page exists at all: publishing our own blind spots is the third of five standing
          commitments, not an act of unusual candour.
        </P>
      </Section>
    </>
  );
}
