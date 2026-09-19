// §6.3 section 5 — the customer stage.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { StageColumns, StageSummary } from "@/components/docs/stageRef";
import { stageColumns } from "@/components/docs/stageFacts";
import { getStage } from "@/lib/policies/stages";

export default function CustomerStage() {
  const stage = getStage("customer");
  // The count is the point of this page, so it is read rather than written.
  const cols = stageColumns("customer");
  const supplierCols = stageColumns("supplier").length;
  const plantCols = stageColumns("plant").length;

  return (
    <>
      <PageTitle lead={stage.role}>Customer stage</PageTitle>

      <Callout tone="limit" title={`This stage has ${cols.length} columns, and that is the finding`}>
        <p>
          The supplier stage has {supplierCols} and the plant stage has {plantCols}. This one has{" "}
          {cols.length}, and <strong>neither reaches the simulation</strong>. It is the smallest
          screen in the policy grid by a long way, and a reader who came here expecting the
          demand-side equivalent of the other two should stop and read the next section instead of
          hunting for controls that are not there.
        </p>
        <p>
          This page is short because the stage is small. It is not an unfinished page, and padding
          it would hide the one thing worth knowing about the screen.
        </p>
      </Callout>

      <Section id="the-grain" title="One row per customer and product">
        <P>
          What happens at the demand end: which firm serves this customer, what they pay, and what
          the model does with an order it cannot fill. The rows come from your{" "}
          <DocLink to="outbound-logistics">Outbound Logistics</DocLink> upload.
        </P>
        <P>
          Demand itself is not set here. It comes from the product master's{" "}
          <Term>demand_mean</Term>, or — far more often — from the outbound volumes.{" "}
          <DocLink to="products">Products</DocLink> covers the shape of it.
        </P>
        <StageSummary stage="customer" />
      </Section>

      <Section id="columns" title="Every column">
        <StageColumns
          stage="customer"
          notes={{
            primary_source: (
              <>
                Which firm serves this customer. An application routing decision — the note below
                says exactly what that means and why it is not a defect.
              </>
            ),
            sourcing_firm: <>The same kind of decision, recorded per row.</>,
          }}
        />
      </Section>

      <Section id="where-the-decisions-are" title="Where the demand-side decisions actually are">
        <Key>
          Almost everything about the demand end is a project-wide decision, not a per-customer one.
        </Key>
        <P>
          How unmet demand is handled — lost, backordered, or split — how orders are allocated when
          there is not enough to go round, and what service level you are aiming at: all of these
          are set <strong>once for the project</strong>, in the fulfilment defaults on{" "}
          <AppLink to="/policies">/policies</AppLink>, and not per customer and product.
        </P>
        <P>
          That is a modelling decision rather than an omission. Allocating between customers is a
          rule the chain applies <em>across</em> customers, so a per-customer version of it would be
          several rules competing to be the rule. The engine reads one.
        </P>
        <P>
          The parts of a customer that <em>are</em> per row — what they buy, how much, at what price
          and lead time — are your{" "}
          <DocLink to="outbound-logistics">Outbound Logistics</DocLink> upload, not a policy. And
          the customer attributes the engine reads on top of that, priority weight and segment, live
          on a table with no upload and no screen at all; <DocLink to="known-limits">Known
          limits</DocLink> records that.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="how-policies-work">How policies work</DocLink> ·{" "}
          <DocLink to="outbound-logistics">Outbound Logistics</DocLink> ·{" "}
          <DocLink to="policy-catalog">The policy catalog</DocLink> ·{" "}
          <DocLink to="supplier-stage">Supplier stage</DocLink> ·{" "}
          <DocLink to="where-a-number-came-from">Where a number came from</DocLink>
        </P>
        <P>
          Edited at <AppLink to="/policies">/policies</AppLink>, under <Term>{stage.title}</Term>.
        </P>
      </Section>

      <Provenance from="the grid's own column spec, joined to the derived resolution chains" />
    </>
  );
}
