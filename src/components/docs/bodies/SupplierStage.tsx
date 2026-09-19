// §6.3 section 5 — the supplier stage. Columns from the grid's own spec, chains
// from the contract's derivation. Nothing about a column is typed here.

import { PageTitle, Section, P, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { StageColumns, StageSummary } from "@/components/docs/stageRef";
import { getStage } from "@/lib/policies/stages";

export default function SupplierStage() {
  const stage = getStage("supplier");

  return (
    <>
      <PageTitle lead={stage.role}>Supplier stage</PageTitle>

      <Section id="the-grain" title="One row per supplier and material">
        <P>
          A supplier who delivers three materials has three rows here, and they can carry different
          decisions. That is the point of the grain: the choice to dual-source is usually about a
          material, not about a firm.
        </P>
        <P>
          The rows come from your <DocLink to="inbound-logistics">Inbound Logistics</DocLink>{" "}
          upload. If a supplier-and-material pair is not on this screen, there is no lane for it.
        </P>
        <StageSummary stage="supplier" />
      </Section>

      <Section id="columns" title="Every column">
        <P>
          Each block is headed by the label on the grid, with the stored field name beside it.
          “Where this value travels” opens the full path from the screen to the engine, with a file
          and line for each claim.
        </P>
        <StageColumns
          stage="supplier"
          notes={{
            primary_source: (
              <>
                Which supplier the app treats as the first choice for this material. It steers the
                product, not the simulation — see the note below it.
              </>
            ),
            material_price: (
              <>
                The price shown on this row. Editing it is the clearest example of the problem this
                page exists to name.
              </>
            ),
          }}
        />
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="how-policies-work">How policies work</DocLink> ·{" "}
          <DocLink to="suppliers">Suppliers</DocLink> ·{" "}
          <DocLink to="inbound-logistics">Inbound Logistics</DocLink> ·{" "}
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
