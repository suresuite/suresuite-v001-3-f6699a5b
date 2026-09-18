// §6.3 section 5 — the customer stage.

import { PageTitle, Section, P, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { StageColumns, StageSummary } from "@/components/docs/stageRef";
import { getStage } from "@/lib/policies/stages";

export default function CustomerStage() {
  const stage = getStage("customer");

  return (
    <>
      <PageTitle lead={stage.role}>Customer stage</PageTitle>

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

      <Section id="related" title="Related">
        <P>
          <DocLink to="how-policies-work">How policies work</DocLink> ·{" "}
          <DocLink to="outbound-logistics">Outbound Logistics</DocLink> ·{" "}
          <DocLink to="policy-catalog">The policy catalog</DocLink>
        </P>
        <P>
          Edited at <AppLink to="/policies">/policies</AppLink>, under <Term>{stage.title}</Term>.
        </P>
      </Section>

      <Provenance from="the grid's own column spec, joined to the derived resolution chains" />
    </>
  );
}
