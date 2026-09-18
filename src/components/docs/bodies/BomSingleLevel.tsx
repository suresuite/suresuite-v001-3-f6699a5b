// §6.3 section 3 — BOM, single level. Generated reference, authored narrative.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { HowItLoads, TypedColumns, FilledColumns, DatabaseRules, TemplateHeaders } from "@/components/docs/tableRef";
import { refTable } from "@/components/docs/tableFacts";

export default function BomSingleLevel() {
  const t = refTable("bom_single_level");

  return (
    <>
      <PageTitle lead="How much of each material one unit of a product consumes.">
        BOM — single level
      </PageTitle>

      <Section id="what-it-is" title="What this file is">
        <P>
          The recipe, flattened. One row says: to make one unit of this product you consume this
          much of this material. Nothing between the two — no sub-assemblies, no intermediate
          stages. If your bill of materials has depth you want the model to see, use{" "}
          <DocLink to="bom-multi-level">BOM — multi level</DocLink> instead.
        </P>
        <Key>
          This is the file that connects the two halves of the chain. Without it, materials arrive
          and products ship and nothing in the model links them.
        </Key>
        <HowItLoads table={t} />
      </Section>

      <Section id="columns" title="The columns you type">
        <TypedColumns
          table={t}
          notes={{
            consumption_rate: (
              <>
                Per <em>one unit of the product</em>, not per batch and not per order. Two square
                metres of sheet per chassis is <Term>2</Term>, whatever quantity you buy the sheet
                in.
              </>
            ),
          }}
        />
      </Section>

      <Section id="template" title="The template">
        <TemplateHeaders table={t} />
        <P>
          Upload it from <AppLink to="/project-manager">Project Manager</AppLink> under the BOM tab.
        </P>
      </Section>

      <DatabaseRules table={t} />

      <Section id="single-or-multi" title="Single level or multi level?">
        <P>
          Use single level when every material you buy is consumed directly by a finished product,
          which is most planning models. Use multi level when a material is consumed by something
          that is itself consumed by something — and you want the intermediate stage to exist in the
          model rather than being folded away.
        </P>
        <P>
          They are separate files and separate tables. A project can hold both; the engine collapses
          the multi-level tree into the same arcs the single-level file states directly, so the two
          describe the same thing at different resolutions.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="bom-multi-level">BOM — multi level</DocLink> ·{" "}
          <DocLink to="materials">Materials</DocLink> ·{" "}
          <DocLink to="products">Products</DocLink> ·{" "}
          <DocLink to="process-level-network">Process-Level Network</DocLink>, which is this file
          drawn.
        </P>
        <FilledColumns table={t} />
      </Section>

      <Provenance from="supabase/contract/bom_single_level.contract.yaml, joined to the schema and the engine registry" />
    </>
  );
}
