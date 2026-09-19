// §6.3 section 5 — the plant stage.

import { PageTitle, Section, P, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { StageColumns, StageSummary } from "@/components/docs/stageRef";
import { getStage } from "@/lib/policies/stages";

export default function PlantStage() {
  const stage = getStage("plant");

  return (
    <>
      <PageTitle lead={stage.role}>Plant stage</PageTitle>

      <Section id="the-grain" title="One row per product">
        <P>
          What the plant can make, what it costs to make it, and — where the product is made to
          stock — how much finished inventory to keep. The rows come from your{" "}
          <DocLink to="products">Products</DocLink> master and the{" "}
          <DocLink to="outbound-logistics">outbound lanes</DocLink> that name a product.
        </P>
        <P>
          A product's <Term>fulfillment_mode</Term> decides how much of this stage applies to it: a
          make-to-order product holds no finished goods, so its inventory columns describe a
          decision the run never has to take.
        </P>
        <StageSummary stage="plant" />
      </Section>

      <Section id="columns" title="Every column">
        <StageColumns
          stage="plant"
          notes={{
            initial_on_hand: (
              <>
                Opening stock of the finished product. The strategic engine builds opening inventory
                from materials only, so there is no finished-goods opening stock for this to feed —
                see <DocLink to="products">Products</DocLink> for the whole story.
              </>
            ),
            reorder_point: (
              <>
                The level at which a replenishment is triggered. Read the note below it before you
                spend time tuning this.
              </>
            ),
          }}
        />
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="how-policies-work">How policies work</DocLink> ·{" "}
          <DocLink to="products">Products</DocLink> ·{" "}
          <DocLink to="materials">Materials</DocLink> ·{" "}
          <DocLink to="policy-types">Policy types</DocLink>
        </P>
        <P>
          Edited at <AppLink to="/policies">/policies</AppLink>, under <Term>{stage.title}</Term>.
        </P>
      </Section>

      <Provenance from="the grid's own column spec, joined to the derived resolution chains" />
    </>
  );
}
