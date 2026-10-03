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

      <Callout tone="note" title="Demand is set here, row by row">
        <p>
          Since demand can be stated per customer and product, this stage carries the row's own
          demand: its mode (forecast or model), distribution, mean, variation and — for a triangular
          row — its bounds, with the uploaded forecast shown beside them. The supplier stage has{" "}
          {supplierCols} columns and the plant stage {plantCols}; this one has {cols.length}.
        </p>
      </Callout>

      <Section id="the-grain" title="One row per customer and product">
        <P>
          What happens at the demand end: which firm serves this customer, what they pay, and what
          the model does with an order it cannot fill. The rows come from your{" "}
          <DocLink to="outbound-logistics">Outbound Logistics</DocLink> upload.
        </P>
        <P>
          A row's demand comes from its own spec when it has one — uploaded on the outbound file
          or as a <DocLink to="demand-forecasts">Demand Forecast</DocLink>, and overridable in the
          cells here — and otherwise from its product's demand, split by volume.{" "}
          <DocLink to="products">Products</DocLink> covers the product-level shape.
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
            row_demand_mode: (
              <>
                Empty follows the data: a row with an uploaded forecast plans on it, any other on
                its mean. <Term>model</Term> sets an uploaded forecast aside.
              </>
            ),
            row_forecast: <>The uploaded series, summarized — buckets, first date, first weekly values. Read-only here.</>,
            row_demand_distribution: (
              <>
                Your override, else the outbound row's distribution, else the product's distribution
                scaled by the row's share. The edit is saved as an override; the upload is never changed.
              </>
            ),
            row_demand_mean: <>Units per week; the mode for a triangular row.</>,
            row_demand_variation: (
              <>
                Read by the distribution: the CV for normal, the ± fraction for triangularAV. The
                cell's note says which, for its row.
              </>
            ),
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
          The parts of a customer that <em>are</em> per row — what they buy, how much and how it
          varies, at what price and lead time — are your{" "}
          <DocLink to="outbound-logistics">Outbound Logistics</DocLink> upload, with the demand
          cells above as overrides on top. And
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
