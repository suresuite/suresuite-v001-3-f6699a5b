// §6.3 section 3 — Node List. Generated reference, authored narrative.
//
// This table is BOTH an input and an output (§4 D56) and the page says so. The
// split between the two halves is read from the contract's `computed_by`, never
// listed here.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { HowItLoads, SuppliedAndComputed, DatabaseRules, TemplateHeaders } from "@/components/docs/tableRef";
import { refTable, computedColumns } from "@/components/docs/tableFacts";

export default function NodeList() {
  const t = refTable("node_list");
  const written = computedColumns(t);
  const geocoded = written.filter((c) => (c.computedBy ?? "").includes("geocode"));

  return (
    <>
      <PageTitle lead="Named locations and their coordinates.">Node List</PageTitle>

      <Section id="what-it-is" title="What this file is">
        <P>
          One row per node in your chain — a supplier, a plant, a customer, a material — with what
          it is called, where it is, and whether an analysis has flagged it as critical. It is what
          the map draws from.
        </P>
        <P>
          Most of its rows are not typed by hand. They are refreshed from the chain you have already
          uploaded, so a node appears here because an arc somewhere named it. You then add the parts
          only you know: a description and a location.
        </P>
        <HowItLoads
          table={t}
          instead={
            <p>
              There <em>is</em> an upload tab for it, and it does not go through the contract's
              landing path: the rows are written straight into the table by a bulk call. So no file
              is kept, no staged copy is diffed against what you already had, and there is no
              review step to approve before it lands. This is a known gap, named rather than
              papered over, and it is what the deep-tier files do too.
            </p>
          }
        />
      </Section>

      <Section id="columns" title="Every column, and who wrote it">
        <P>
          This table has no CSV header mapping, so each column's stored name is the name you see —
          in the grid, in an export, and here.
        </P>
        <SuppliedAndComputed table={t} />
      </Section>

      {geocoded.length > 0 && (
        <Callout tone="limit" title="Coordinates are written with no run behind them">
          <p>
            {geocoded.length === 1 ? "One column" : `${geocoded.length} columns`} on this table{" "}
            {geocoded.length === 1 ? "is" : "are"} filled in by geocoding — a lookup that turns the
            location text into a point on the map. Unlike the other computed columns here, it does
            not record a run, so there is nothing that says which version of your data it was
            computed from.
          </p>
          <p>
            In practice that means a coordinate can outlive the address it came from without
            anything noticing. If a location looks wrong on the map, re-check the text it was
            derived from rather than the point.
          </p>
        </Callout>
      )}

      <Section id="template" title="The file you upload">
        <TemplateHeaders table={t} />
        <P>
          Export the node list you already have from{" "}
          <AppLink to="/project-manager">Project Manager</AppLink>, fill in the description and
          location columns, and upload the same file back under the Node List tab. The{" "}
          <Term>node_id</Term> values are how a row finds the node it belongs to, so leave them
          exactly as they came out.
        </P>
      </Section>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="deep-tier-nodes">Deep-Tier Nodes</DocLink> ·{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink> ·{" "}
          <DocLink to="product-level-network">Product-Level Network</DocLink>
        </P>
        <P>
          Uploaded and reviewed from <AppLink to="/project-manager">Project Manager</AppLink>.
        </P>
      </Section>

      <Provenance from="supabase/contract/node_list.contract.yaml, joined to the schema and the engine registry" />
    </>
  );
}
