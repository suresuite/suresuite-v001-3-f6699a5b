// §6.3 section 3 — Suppliers (the item master). Generated reference, authored narrative.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { HowItLoads, TypedColumns, FilledColumns, DatabaseRules, TemplateHeaders } from "@/components/docs/tableRef";
import { refTable } from "@/components/docs/tableFacts";

export default function Suppliers() {
  const t = refTable("suppliers");
  const capacity = t.columns.find((c) => c.csvHeader === "capacity_per_week");

  return (
    <>
      <PageTitle lead="Capacity and reliability, beyond the arcs that connect a supplier to materials.">
        Suppliers
      </PageTitle>

      <Section id="what-it-is" title="What this file is">
        <P>
          One row per supplier. <DocLink to="inbound-logistics">Inbound Logistics</DocLink> says
          what a supplier can deliver and at what price; this file says what is true of the supplier
          across everything they deliver — how much they can ship in total, and how often they
          deliver as promised.
        </P>
        <HowItLoads table={t} />
      </Section>

      <Section id="columns" title="The columns you type">
        <TypedColumns
          table={t}
          notes={{
            capacity_per_week: (
              <>
                Across <em>everything</em> this supplier supplies, not per material.
              </>
            ),
            reliability_score: (
              <>
                A fraction in (0, 1]. This is the only column in the input tables whose default is
                the database's rather than the engine's — the column is NOT NULL and defaults to
                1.0, so a row that omits it stores a perfect supplier rather than an empty cell.
              </>
            ),
          }}
        />
      </Section>

      {capacity && (
        <Callout tone="limit" title="Blank capacity means unlimited — and the grid shows it as 0">
          <p>
            An empty <Term>capacity_per_week</Term> is a modelling decision, not a missing value: it
            says this supplier can ship as much as you ask for. Writing <Term>0</Term> there says
            the opposite — a supplier who can ship nothing.
          </p>
          <p>
            <strong>The policy grid currently renders the blank one as 0, with no marking.</strong>{" "}
            So an unlimited supplier and a supplier with zero capacity look identical on that
            screen, and only the blank cell in your file tells the two apart. This is a known
            display defect, recorded rather than smoothed over, and it is the reason this warning
            exists on a documentation page instead of only in an issue.
          </p>
        </Callout>
      )}

      <Section id="template" title="The template">
        <TemplateHeaders table={t} />
        <P>
          Upload it from <AppLink to="/project-manager">Project Manager</AppLink> under the item
          master tab.
        </P>
      </Section>

      <DatabaseRules table={t} />

      <Section id="no-master-row" title="A supplier with no row here still works">
        <P>
          If an inbound arc names a supplier this file never mentions, the model does not stop. It
          synthesises a supplier with perfect reliability and no capacity limit, and carries on.
          That is a reasonable default and it is also an invisible one — nothing on screen
          distinguishes a supplier you declared as perfect from one you never declared at all.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="inbound-logistics">Inbound Logistics</DocLink> ·{" "}
          <DocLink to="materials">Materials</DocLink> ·{" "}
          <DocLink to="multi-tier-suppliers">Multi-Tier Suppliers</DocLink> ·{" "}
          <DocLink to="supplier-stage">Supplier stage</DocLink>
        </P>
        <FilledColumns table={t} />
      </Section>

      <Provenance from="supabase/contract/suppliers.contract.yaml, joined to the schema and the engine registry" />
    </>
  );
}
