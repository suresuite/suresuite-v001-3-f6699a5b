// §6.3 section 10 — CSV or connector.

import { PageTitle, Section, P, Key, Callout, Defs, DocLink, Provenance } from "@/components/docs/prose";
import { INGEST_DATASETS } from "../../../../supabase/functions/_shared/ingestSpec.generated";

export default function CsvVsConnector() {
  // How many datasets go through the shared landing path is a generated fact:
  // both routes use it, which is the point the page is making.
  const datasets = Object.keys(INGEST_DATASETS).length;

  return (
    <>
      <PageTitle lead="The trade-off, stated plainly — and the part where it does not matter.">
        CSV or connector — which to use
      </PageTitle>

      <Section id="the-part-that-does-not-matter" title="Start with what is the same">
        <Key>
          Both routes land in the same place, are checked by the same rules, are diffed the same
          way, and are approved by the same person.
        </Key>
        <P>
          {datasets} datasets go through one shared path, whether the rows came from a file you
          dragged in or from a system that pushed them. So the choice is not about safety or about
          which one gets checked properly. It is about effort and freshness.
        </P>
      </Section>

      <Section id="the-trade" title="The trade">
        <Defs
          items={[
            {
              term: "A file",
              def: (
                <>
                  You control exactly what goes in, and you can edit it before it does. Good for a
                  first model, for a one-off study, and for any situation where the data needs
                  judgement applied before it is loaded. It goes stale the moment you export it.
                </>
              ),
            },
            {
              term: "A connector",
              def: (
                <>
                  The data comes to you and can be refreshed without anybody exporting anything.
                  Good for a model that is kept current. It carries whatever your system of record
                  carries, including the parts you would have cleaned up by hand.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Callout title="The honest answer for most people is both">
        <p>
          Connect the things that change — volumes, prices, lead times — and upload the things you
          decided — which materials are in scope, how the bill of materials is modelled. A model is
          not a copy of your ERP, and the parts of it that are judgement do not belong in a sync.
        </p>
      </Callout>

      <Callout tone="limit" title="A connector does not make a model current">
        <p>
          Syncing brings rows in. It does not re-run your analyses, and it does not revisit
          decisions you made against the old data — a policy override seeded from data you no longer
          hold survives the sync that replaced it.
        </p>
        <p>
          <DocLink to="data-trust-report">The Data Trust Report</DocLink> is where that shows up,
          and it is the one kind of staleness that changes a run rather than a display.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="connecting-erp">Connecting an ERP / MRP system</DocLink> ·{" "}
          <DocLink to="reviewing-a-sync">Reviewing and applying a sync</DocLink> ·{" "}
          <DocLink to="uploading-data">Uploading data</DocLink>
        </P>
      </Section>

      <Provenance from="the ingestion spec both routes are validated against" />
    </>
  );
}
