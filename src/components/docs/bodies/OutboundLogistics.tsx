// §6.3 section 3 — Outbound Logistics. Generated reference, authored narrative.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { HowItLoads, TypedColumns, FilledColumns, DatabaseRules, TemplateHeaders } from "@/components/docs/tableRef";
import { refTable } from "@/components/docs/tableFacts";

export default function OutboundLogistics() {
  const t = refTable("outbound_logistics");
  const expected = t.columns.find((c) => c.csvHeader === "expected_lead_time");

  return (
    <>
      <PageTitle lead="Demand arcs: which customer buys which product, at what price and lead time.">
        Outbound Logistics
      </PageTitle>

      <Section id="what-it-is" title="What this file is">
        <P>
          One row per <em>demand arc</em> — a customer who buys a product. It is the mirror of{" "}
          <DocLink to="inbound-logistics">Inbound Logistics</DocLink>: that file is where material
          comes from, this one is where product goes.
        </P>
        <P>
          It is also the file that decides how much demand the simulation sees. If{" "}
          <Term>demand_mean</Term> is blank on a product, the demand for it is the sum of its
          outbound volumes, normalised to weeks. Most projects never fill{" "}
          <Term>demand_mean</Term> in at all and are driven entirely from here.
        </P>
        <HowItLoads table={t} />
      </Section>

      <Section id="columns" title="The columns you type">
        <TypedColumns
          table={t}
          notes={{
            expected_lead_time: (
              <>
                <strong>In weeks</strong>, like the inbound file's <Term>lead_time</Term>, and
                unrelated to <Term>time_unit</Term> on the same row.
              </>
            ),
            time_unit: (
              <>
                This governs <Term>volume</Term> and nothing else on the row.
              </>
            ),
            unit_price: (
              <>
                This is what the customer pays. When a product's <Term>sell_price</Term> is blank,
                the engine uses the demand-weighted mean of these — so the price a product sells at
                can be decided entirely from this file.
              </>
            ),
          }}
        />
      </Section>

      <Callout tone="limit" title="expected_lead_time is stored, validated, and read by nothing">
        <p>
          The contract records no engine field for it{" "}
          {expected && !expected.engineField ? "— the entry is empty, not omitted" : ""}. The column
          is required, it must be a positive number, it is kept on the row and it appears in
          exports. It does not reach the simulation, so changing it changes no result.
        </p>
        <p>
          We are stating that rather than leaving you to infer it from a run that does not move.
          This is §5.3 T3 — a published blind spot — and it is the honest answer until either the
          engine grows a customer-side lead time or the column is retired.
        </p>
      </Callout>

      <Section id="template" title="The template">
        <TemplateHeaders table={t} />
        <P>
          Upload it from <AppLink to="/project-manager">Project Manager</AppLink>. Column order does
          not matter; the parser binds by header name.
        </P>
      </Section>

      <DatabaseRules table={t} />

      <Section id="what-reads-it" title="What reads this file">
        <P>
          Two of the model's most consequential numbers are derived from here when the item master
          leaves them blank: a product's selling price, and the weekly demand for it. Both show up
          in the policy grid marked as derived rather than as something you set —{" "}
          <DocLink to="where-a-number-came-from">Where a number came from</DocLink> explains what
          that marking means and{" "}
          <DocLink to="when-a-value-is-missing">When a value is missing</DocLink> lists every
          substitution of this kind.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="products">Products</DocLink> ·{" "}
          <DocLink to="inbound-logistics">Inbound Logistics</DocLink> ·{" "}
          <DocLink to="units-and-time-periods">Units and time periods</DocLink>
        </P>
        <FilledColumns table={t} />
      </Section>

      <Provenance from="supabase/contract/outbound_logistics.contract.yaml, joined to the schema and the engine registry" />
    </>
  );
}
