// §6.3 section 5 — How planning works (PLAN.md §24, Phase 14). The flow the
// owner decided on 2026-10-02 (ADR 0002): future finished-good demand → planned
// production → material orders → fulfillment, one rule from end to end. Every
// setting it names is a cell documented on its own stage page.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";

export default function HowPlanningWorks() {
  return (
    <>
      <PageTitle lead="From the demand your customers state, to what the plant builds, to what it buys, to who gets served.">
        How planning works
      </PageTitle>

      <Section id="the-flow" title="The flow, end to end">
        <Key>The plan always starts from future finished-good demand — and it never reads demand that has not happened.</Key>
        <P>
          <strong>1 · Demand per customer row.</strong> Each customer × product row states its
          demand: a forecast series (uploaded as a <DocLink to="demand-forecasts">Demand Forecast</DocLink>)
          or a mean, a variation and a distribution. A row that states neither takes its product's
          demand split by volume. The plan uses the forecast or the mean; the run draws actual
          demand around it. See <DocLink to="customer-stage">Customer stage</DocLink>.
        </P>
        <P>
          <strong>2 · Planned production = min(requirement, capacity).</strong> For a make-to-order
          product the requirement is the projected demand plus any backlog; for make-to-stock it is
          what the finished-goods policy asks for — base-stock, min-max or days of cover — plus any
          backlog. The plan looks ahead as far as the longest material lead time planned by MRP.
          See <DocLink to="plant-stage">Plant stage</DocLink> and{" "}
          <DocLink to="products">Products</DocLink>.
        </P>
        <P>
          <strong>3 · Materials.</strong> A material on <Term>MRP</Term> is ordered from the plan:
          the BOM times planned production over its lead time, net of stock and what is on the way,
          rounded up to the MOQ. A material on a reorder-point type is ordered from consumption, as
          before. Both can sit in one project. See <DocLink to="policy-types">Policy types</DocLink>.
        </P>
        <P>
          <strong>4 · Fulfillment per row.</strong> When supply is short, the project's one
          allocation rule splits each product's units across its rows — by priority, fair share,
          price or service target. Each row decides for itself whether what it does not get waits
          (backorder, within its window, at its cost) or is lost.
        </P>
      </Section>

      <Section id="one-rule" title="One rule for the plan and for fulfillment">
        <P>
          When the plan sees a week it cannot build in full, it splits the shortfall with the same
          allocation rule fulfillment uses, and carries forward only the share of rows that allow
          backorder. A lost-sales row's shortfall leaves the plan the week it leaves the order book,
          so the plant never builds — and MRP never buys — for an order a customer has already
          cancelled.
        </P>
      </Section>

      <Callout tone="note" title="What the plan cannot know">
        <p>
          The plan reads the forecast, not the future. A change that is in your forecast is planned
          for before it arrives; a change nobody forecast is met only by what is on hand and your
          safety stock. The validation study measures both, with the same demand and disruption on
          both sides: <Term>docs/research/mrp-vs-reorder-point.md</Term>.
        </p>
      </Callout>

      <Section id="where-to-set-it" title="Where each setting lives">
        <P>
          Demand and fulfillment per row: the Customer stage. The FG policy and opening stock per
          product: the Plant stage. MRP per material: the Supplier stage's policy type. The
          allocation rule and the backorder defaults: the Customer allocation card. All on{" "}
          <AppLink to="/policies">/policies</AppLink>; the uploads are the base each cell overrides.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="how-policies-work">How policies work</DocLink> ·{" "}
          <DocLink to="customer-stage">Customer stage</DocLink> ·{" "}
          <DocLink to="plant-stage">Plant stage</DocLink> ·{" "}
          <DocLink to="policy-types">Policy types</DocLink> ·{" "}
          <DocLink to="demand-forecasts">Demand Forecast</DocLink>
        </P>
      </Section>

      <Provenance from="ADR 0002 and the design doc docs/design/mrp-multi-stage-planning.md" />
    </>
  );
}
