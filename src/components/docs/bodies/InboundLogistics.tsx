// §6.3 section 3 — Inbound Logistics. Generated reference, authored narrative.
//
// Every column, unit, constraint, substitution and engine field below comes
// from `supabase/contract/inbound_logistics.contract.yaml` through
// `generated/reference.generated.ts`. The page supplies the story and the
// warnings a column's `meaning` cannot carry; it types no data fact.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { HowItLoads, TypedColumns, FilledColumns, DatabaseRules, TemplateHeaders } from "@/components/docs/tableRef";
import { refTable } from "@/components/docs/tableFacts";

export default function InboundLogistics() {
  const t = refTable("inbound_logistics");

  return (
    <>
      <PageTitle lead="Supply lanes: which supplier delivers which material, at what price and lead time.">
        Inbound Logistics
      </PageTitle>

      <Section id="what-it-is" title="What this file is">
        <P>
          One row per <em>supply lane</em> — a supplier who can deliver a material. It is the file
          that tells the model where a material can come from, so a material with no inbound row is
          a material nothing can supply, and the simulation will say so.
        </P>
        <P>
          Lanes are not the same thing as suppliers. This file says <em>this supplier can deliver
          this material, at this price, in this time</em>; the{" "}
          <DocLink to="suppliers">Suppliers</DocLink> file says what is true of the supplier
          regardless of what they are delivering. Upload both.
        </P>
        <HowItLoads table={t} />
              <DocFigure id="chain-shape" />
      </Section>

      <Section id="columns" title="The columns you type">
        <P>
          The heading of each block below is the header as it appears in your file. Where the
          database or the engine calls it something else, that is in “Technical details”.
        </P>
        <TypedColumns
          table={t}
          notes={{
            lead_time: (
              <>
                <strong>This is in weeks.</strong> The neighbouring <Term>time_unit</Term> column
                does <em>not</em> apply to it — see the warning below, which is the single most
                common misreading of this file.
              </>
            ),
            time_unit: (
              <>
                This governs <Term>volume</Term> and nothing else on the row.
              </>
            ),
            lead_time_unit: (
              <>
                The way to quote a lead time in days. Leave it out and the number is read as weeks;
                put <Term>day</Term> in it and a 14 becomes two weeks rather than fourteen.
              </>
            ),
            volume: (
              <>
                A rate, not a stock count. Two rows are comparable only once both have been
                converted to the same period — which is what <Term>time_unit</Term> is for.
              </>
            ),
          }}
        />
      </Section>

      <Callout tone="limit" title="lead_time is weeks. time_unit is about volume.">
        <p>
          Two columns on this row carry a period and they are unrelated.{" "}
          <Term>time_unit</Term> says what period <Term>volume</Term> is quoted over — 500 a month.{" "}
          <Term>lead_time</Term> is fixed at weeks by the contract and has its own optional
          override, <Term>lead_time_unit</Term>.
        </p>
        <p>
          So a row reading <Term>time_unit=month</Term> and <Term>lead_time=2</Term> means <em>500
          units a month, delivered in two weeks</em> — not two months. If you meant days, say so in{" "}
          <Term>lead_time_unit</Term>. <DocLink to="units-and-time-periods">Units and time
          periods</DocLink> is the page that settles this once.
        </p>
      </Callout>

      <Section id="template" title="The template">
        <TemplateHeaders table={t} />
        <P>
          Column order does not matter — the parser reads your header row and binds by name. A
          column we do not recognise is kept in the record of the file and mapped to nothing, and
          you are told which. A column the server supplies is different: a file carrying{" "}
          <Term>project_id</Term> or <Term>plant_name</Term> is <em>refused</em>, because its author
          expected those values to be used and they will not be.
        </P>
        <P>
          Upload it from <AppLink to="/project-manager">Project Manager</AppLink>.{" "}
          <DocLink to="uploading-data">Uploading data</DocLink> describes what the wizard checks
          before anything lands.
        </P>
      </Section>

      <DatabaseRules table={t} />

      <Section id="what-reads-it" title="What reads this file">
        <Key>
          Almost every economic default in the model traces back to this file.
        </Key>
        <P>
          When <Term>cost</Term> is blank on a material, the engine uses the cheapest inbound{" "}
          <Term>unit_price</Term> for it. When a supplier's share of a material has to be worked
          out, it comes from the <Term>volume</Term> columns here. So an inbound file with
          placeholder prices does not produce a model with placeholder prices in one place — it
          produces one with placeholder economics throughout, and the{" "}
          <DocLink to="where-a-number-came-from">provenance dots</DocLink> in the policy grid are
          how you see which numbers those are.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="suppliers">Suppliers</DocLink> ·{" "}
          <DocLink to="materials">Materials</DocLink> ·{" "}
          <DocLink to="outbound-logistics">Outbound Logistics</DocLink> ·{" "}
          <DocLink to="units-and-time-periods">Units and time periods</DocLink> ·{" "}
          <DocLink to="supply-chain-data">Supply Chain Data</DocLink>, which is what we derive from
          this file.
        </P>
        <FilledColumns table={t} />
      </Section>

      <Provenance from="supabase/contract/inbound_logistics.contract.yaml, joined to the schema and the engine registry" />
    </>
  );
}
