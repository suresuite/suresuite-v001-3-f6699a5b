// §6.3 section 3 — Products (the item master). Generated reference, authored narrative.
//
// This page is where D21 is most visible and most easily re-committed. Three of
// its columns are called one thing in the file and another in the engine —
// `sell_price`/`unit_price`, `demand_mean`/`demand_mode`,
// `demand_distribution`/the scenario's `demand_model`. The old manual documented
// the engine's names, and a planner holding products.csv could not find one of
// their own headers. Here the file's name is the heading and the engine's name
// is inside "Technical details", which is read from the contract.

import { PageTitle, Section, P, Key, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { HowItLoads, TypedColumns, FilledColumns, DatabaseRules, TemplateHeaders } from "@/components/docs/tableRef";
import { refTable } from "@/components/docs/tableFacts";

export default function Products() {
  const t = refTable("products");

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

      <Section id="fg-policy" title="Finished-goods policy and opening stock (make to stock)">
        <P>
          A make-to-stock product keeps finished goods, and five columns say how much. Each is
          optional; a product that sets none runs exactly as before. All levels are end-of-week
          finished-goods targets, in units.
        </P>
        <P>
          <Term>fg_policy</Term> picks the rule: <Term>base_stock</Term> builds up to{" "}
          <Term>fg_base_stock</Term> (S) every week; <Term>min_max</Term> builds up to S only when
          the stock left after the week's demand falls below <Term>fg_reorder_point</Term> (s), and
          builds nothing otherwise; <Term>days_of_cover</Term> targets{" "}
          <Term>fg_cover_days</Term> (D) days of the projected weekly demand — D/7 × demand — so the
          target rises and falls with the forecast. Empty is base-stock with the derived target: one
          week of forecast, plus the finished-goods safety stock when that is switched on.
        </P>
        <P>
          A level you type <em>is</em> the target: the safety-stock buffer is never added on top of
          it, so nothing is counted twice. Planned production is the policy's requirement, plus any
          backlog, capped at the product's capacity.
        </P>
        <P>
          <Term>fg_initial_on_hand</Term> is the stock the run starts with — empty starts it at the
          policy target. An incomplete policy (min-max
          without both levels, or with s not below S; days of cover without D) runs as base-stock,
          and the run's mapping report says so. A make-to-order product holds no finished goods and
          ignores all five. Each can also be set per product on the{" "}
          <DocLink to="plant-stage">Plant stage</DocLink>, as an override.
        </P>
      </Section>

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
