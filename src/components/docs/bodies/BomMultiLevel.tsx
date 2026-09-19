// §6.3 section 3 — BOM, multi level. Generated reference, authored narrative.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { HowItLoads, TypedColumns, FilledColumns, DatabaseRules, TemplateHeaders } from "@/components/docs/tableRef";
import { refTable } from "@/components/docs/tableFacts";

export default function BomMultiLevel() {
  const t = refTable("bom_multi_level");

  return (
    <>
      <PageTitle lead="The deep bill of materials, level by level.">BOM — multi level</PageTitle>

      <Section id="what-it-is" title="What this file is">
        <P>
          The recipe with its structure intact. One row per material per position in the tree: what
          it is, how deep it sits, what it feeds, and how much of it that parent takes.
        </P>
        <P>
          The engine collapses this tree into the same product-to-material rows that{" "}
          <DocLink to="bom-single-level">BOM — single level</DocLink> states directly. What you gain
          by uploading the deep version is that the intermediate stages exist: they can be seen in
          the <DocLink to="process-level-network">Process-Level Network</DocLink>, and a disruption
          can be aimed at one.
        </P>
        <HowItLoads table={t} />
              <DocFigure id="bom-depth" />
      </Section>

      <Section id="columns" title="The columns you type">
        <TypedColumns
          table={t}
          notes={{
            level: (
              <>
                Level 1 sits directly under the finished product. <strong>Level 0 is accepted</strong>{" "}
                and means a root component — both parsers have always admitted it, so a file using 0
                for the top will load rather than fail.
              </>
            ),
            higher_level_component_id: (
              <>
                Leave it empty at the top of the tree. An empty parent is read as <em>the finished
                product itself</em>, which is why it is the one optional column here.
              </>
            ),
            consumption_rate: (
              <>
                Per one unit of the <em>parent</em> named on this row — not per unit of the finished
                product. This is the difference between the two BOM files, and it is the one that
                changes numbers.
              </>
            ),
          }}
        />
      </Section>

      <Callout title="Two ways to write the same tree">
        <p>
          <Term>consumption_rate</Term> here is relative to the parent on the row; in the
          single-level file it is relative to the finished product. Uploading a deep tree with
          product-relative rates gives you a model that consumes far too little, and nothing will
          reject it, because both files are arithmetically valid.
        </p>
      </Callout>

      <Section id="template" title="The template">
        <TemplateHeaders table={t} />
        <P>
          Upload it from <AppLink to="/project-manager">Project Manager</AppLink> under the BOM tab.
        </P>
      </Section>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="bom-single-level">BOM — single level</DocLink> ·{" "}
          <DocLink to="materials">Materials</DocLink> ·{" "}
          <DocLink to="multi-tier-data">Multi-Tier Data</DocLink>
        </P>
        <FilledColumns table={t} />
      </Section>

      <Provenance from="supabase/contract/bom_multi_level.contract.yaml, joined to the schema and the engine registry" />
    </>
  );
}
