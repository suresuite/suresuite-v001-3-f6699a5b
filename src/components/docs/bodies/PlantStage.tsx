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
          Each row's <Term>FG inventory</Term> switch — the product's <Term>fulfillment_mode</Term> —
          decides how much of this stage applies to it. A make-to-order product holds no finished
          goods, so its row shows no FG policy at all. For a make-to-stock product the FG inventory
          band reads like the Supplier stage's inventory band: the FG policy is the policy type, and
          one <Term>Replenishment parameters</Term> cell holds only the levels that policy reads —
          S for base-stock, s and S for min-max, D for days of cover — then the opening stock. They
          decide how much to build: planned
          production is the policy's requirement plus any backlog, capped at capacity. How much
          finished stock to keep is said once, on the row: an empty S is one week of the projected
          demand, and a typed S is used as typed. Demand is not set here: it is set per row on the{" "}
          <DocLink to="customer-stage">Customer stage</DocLink>, and a row with no demand of its own
          inherits the product's mean from the item master, then the outbound volume.
        </P>
        <StageSummary stage="plant" />
      </Section>

      <Section id="columns" title="Every column">
        <StageColumns
          stage="plant"
          notes={{
            prod_lead_time_weeks: (
              <>
                How many weeks a product takes to make: what the plant starts in a week is finished
                that many weeks later. Materials are used when production starts, the plan starts
                each batch that many weeks ahead of the demand it serves, and the units in between
                are work in progress (shown in inspection runs, charged no holding cost). Empty is 0
                — finished in the week it starts. Choose a shape beside it to make it vary, exactly
                as on the Supplier stage; a triangular or uniform product plans on the mean of its
                bounds.
              </>
            ),
            fulfillment_mode: (
              <>
                MTS holds finished-goods inventory and shows the FG columns; MTO builds to order and
                shows none. Empty follows the product's own value, then the project's model, then
                MTO — the order the run reads them in.
              </>
            ),
            fg_policy: (
              <>
                Make-to-stock products only. <Term>base_stock</Term> builds up to S each week,{" "}
                <Term>min_max</Term> builds up to S only when the stock left after the week's demand
                is below s, <Term>days_of_cover</Term> targets D days of the projected demand.
                Empty is base-stock with the derived target.
              </>
            ),
            fg_base_stock: (
              <>
                S, in units. A typed S is the target — the finished-goods safety stock is never added
                on top of it.
              </>
            ),
            fg_reorder_point: <>s, in units — read by min-max only, and must be below S.</>,
            fg_cover_days: <>D, in days — read by days of cover only; the target moves with the forecast.</>,
            fg_initial_on_hand: (
              <>
                The finished-goods stock the run starts with; empty starts at the policy target. See{" "}
                <DocLink to="products">Products</DocLink> for the whole policy.
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
