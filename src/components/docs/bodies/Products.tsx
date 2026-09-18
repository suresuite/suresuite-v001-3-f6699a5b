// §6.3 section 3 — Products (the item master). Generated reference, authored narrative.
//
// This page is where D21 is most visible and most easily re-committed. Three of
// its columns are called one thing in the file and another in the engine —
// `sell_price`/`unit_price`, `demand_mean`/`demand_mode`,
// `demand_distribution`/the scenario's `demand_model`. The old manual documented
// the engine's names, and a planner holding products.csv could not find one of
// their own headers. Here the file's name is the heading and the engine's name
// is inside "Technical details", which is read from the contract.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { HowItLoads, TypedColumns, FilledColumns, DatabaseRules, TemplateHeaders } from "@/components/docs/tableRef";
import { refTable } from "@/components/docs/tableFacts";

export default function Products() {
  const t = refTable("products");
  const hasOnHand = t.columns.some((c) => c.name === "initial_on_hand");

  return (
    <>
      <PageTitle lead="Price, capacity, fulfilment mode and the shape of demand.">Products</PageTitle>

      <Section id="what-it-is" title="What this file is">
        <P>
          One row per finished product — the demand-side item master. It answers four questions:
          what does it sell for, how many can we make, do we make it to order or to stock, and what
          does demand for it look like.
        </P>
        <Key>
          Every column except the identifier is optional. Leave the demand columns out entirely and
          demand is taken from <DocLink to="outbound-logistics">Outbound Logistics</DocLink>
          instead, which is how most projects run.
        </Key>
        <HowItLoads table={t} />
      </Section>

      <Section id="columns" title="The columns you type">
        <TypedColumns
          table={t}
          notes={{
            sell_price: (
              <>
                The engine calls this <Term>unit_price</Term>. Same number, different vocabulary —
                and the reason this manual leads with the header you type.
              </>
            ),
            demand_mean: (
              <>
                The engine calls this <Term>demand_mode</Term>: it is the <em>peak</em> of the
                distribution rather than its arithmetic average, which matters as soon as the
                distribution is skewed.
              </>
            ),
            demand_distribution: (
              <>
                The shape. Leave it blank and the scenario's own <Term>demand_model</Term> decides
                for every product at once — which is usually what you want while you are still
                comparing scenarios.
              </>
            ),
            demand_min: (
              <>
                Bounds the distribution below. A value <em>above</em> the mode is pulled back to the
                mode and you are told, rather than being silently accepted into an impossible shape.
              </>
            ),
            demand_max: <>Bounds it above, with the mirror-image correction.</>,
            production_capacity: (
              <>
                Per week, for this product. Blank is not unlimited here — the engine substitutes a
                capacity derived from demand, and says so on the run's mapping report.
              </>
            ),
            fulfillment_mode: (
              <>
                <Term>mto</Term> (make to order) or <Term>mts</Term> (make to stock). Only mts holds
                finished goods, so this column decides whether a product has an inventory policy at
                all.
              </>
            ),
          }}
        />
      </Section>

      <Callout tone="limit" title="There is no opening stock for finished goods">
        <p>
          <DocLink to="materials">Materials</DocLink> has an <Term>initial_on_hand</Term> column and
          this file {hasOnHand ? "has one too" : "does not"}. That is not an oversight in the
          template: the strategic engine builds opening inventory from materials only, so there is
          no finished-goods opening stock for the column to feed.
        </p>
        <p>
          The policy grid used to attribute a plant-stage <Term>initial_on_hand</Term> cell to this
          file's item master. It pointed at a column that has never existed, so the cell fell
          through to the policy bundle while the header said it came from your data. The attribution
          has been removed. Adding the column for real is a schema change <em>and</em> an engine
          capability, and it has not been made.
        </p>
      </Callout>

      <Section id="template" title="The template">
        <TemplateHeaders table={t} />
        <P>
          Upload it from <AppLink to="/project-manager">Project Manager</AppLink>, or edit rows in
          the <AppLink to="/policies">policy grid</AppLink>.
        </P>
      </Section>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="outbound-logistics">Outbound Logistics</DocLink> ·{" "}
          <DocLink to="bom-single-level">BOM — single level</DocLink> ·{" "}
          <DocLink to="materials">Materials</DocLink> ·{" "}
          <DocLink to="when-a-value-is-missing">When a value is missing</DocLink>
        </P>
        <FilledColumns table={t} />
      </Section>

      <Provenance from="supabase/contract/products.contract.yaml, joined to the schema and the engine registry" />
    </>
  );
}
