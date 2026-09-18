// §6.3 section 3 — Materials (the item master). Generated reference, authored narrative.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { HowItLoads, TypedColumns, FilledColumns, DatabaseRules, TemplateHeaders } from "@/components/docs/tableRef";
import { refTable, blankBehaviour } from "@/components/docs/tableFacts";

export default function Materials() {
  const t = refTable("materials");
  const onHand = t.columns.find((c) => c.csvHeader === "initial_on_hand");

  return (
    <>
      <PageTitle lead="The economics the simulation reads for each material.">Materials</PageTitle>

      <Section id="what-it-is" title="What this file is">
        <P>
          One row per material — an <em>item master</em>. It holds what is true of a material
          wherever it comes from: what it costs, what it costs to keep, the smallest order anyone
          will take, and how variable its lead time is.
        </P>
        <Key>
          Every column except the identifier is optional, and every one of them has a documented
          answer for what happens if you leave it out. That is the point of the file: you fill in
          what you know and the model tells you what it assumed for the rest.
        </Key>
        <HowItLoads table={t} />
      </Section>

      <Section id="columns" title="The columns you type">
        <TypedColumns
          table={t}
          notes={{
            cost: (
              <>
                Leaving this blank is <em>not</em> an error and is often the right choice: the
                cheapest inbound arc's price is usually what you meant, and the model marks the cell
                as derived so you can see it happened.
              </>
            ),
            holding_cost_pct: (
              <>
                A fraction, not a percentage. Twenty per cent a year is <Term>0.2</Term>.
              </>
            ),
            moq: (
              <>
                A commercial fact the supplier states. It applies per supplier-and-material link, so
                two suppliers of the same material can carry different minimums only if you say so
                on the arc.
              </>
            ),
            lead_time_cv: (
              <>
                The <em>spread</em> around a lead time whose centre lives on the inbound arc. This
                file says how variable; <DocLink to="inbound-logistics">Inbound Logistics</DocLink>{" "}
                says how long.
              </>
            ),
          }}
        />
      </Section>

      {onHand && blankBehaviour(onHand).source === "engine-default" && (
        <Callout title="initial_on_hand has no substitution, and that is deliberate">
          <p>
            Every other optional column here names a value we put in its place. This one does not:
            the engine applies its own opening-stock rule and the contract does not restate what
            that rule is. So the honest line is the one printed above — the engine decides — rather
            than a number this page would be inventing.
          </p>
          <p>
            Opening stock is the one economic field on this page that is a <em>measurement</em>:
            somebody counted it. Nothing in the product supplies it from observations today.
          </p>
        </Callout>
      )}

      <Section id="template" title="The template">
        <TemplateHeaders table={t} />
        <P>
          Upload it from <AppLink to="/project-manager">Project Manager</AppLink> under the item
          master tab, or edit rows directly in the{" "}
          <AppLink to="/policies">policy grid</AppLink> — both write the same table.
        </P>
      </Section>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="inbound-logistics">Inbound Logistics</DocLink> ·{" "}
          <DocLink to="products">Products</DocLink> ·{" "}
          <DocLink to="suppliers">Suppliers</DocLink> ·{" "}
          <DocLink to="when-a-value-is-missing">When a value is missing</DocLink>
        </P>
        <FilledColumns table={t} />
      </Section>

      <Provenance from="supabase/contract/materials.contract.yaml, joined to the schema and the engine registry" />
    </>
  );
}
