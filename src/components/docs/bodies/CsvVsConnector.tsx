// §6.3 section 10 — CSV or connector. Rewritten in WP 5.2j.
//
// ── THE PAGE OPENED WITH A REASSURANCE THAT IS NOT TRUE ───────────────────
//
// "Both routes land in the same place, are checked by the same rules, are
// diffed the same way, and are approved by the same person. N datasets go
// through one shared path, whether the rows came from a file you dragged in or
// from a system that pushed them."
//
// Three of those four are wrong, and the count is the wrong count:
//
//   · the connector covers PRODUCTS ONLY — one table, not the nine the CSV
//     path covers, so N is the CSV route's number rendered as if it were both;
//   · it stages into `ingest_staged_products` and promotes through
//     `mrp_apply_staged_products`, not `ingest_land_file` / `ingest_apply_run`,
//     so it does not get the tier-0 file record or the contract-generated
//     parser;
//   · and a link with an auto-apply threshold applies WITHOUT a person, when
//     the change is small enough — which is the direct opposite of "approved by
//     the same person", on the page whose job is the comparison.
//
// The auto-apply is deliberate, attributed and documented in its own source. It
// is the manual that was describing something else.

import { PageTitle, Section, P, Key, Callout, Defs, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { INGEST_DATASETS } from "../../../../supabase/functions/_shared/ingestSpec.generated";

export default function CsvVsConnector() {
  // The CSV route's own number, named as that rather than as "both routes".
  const datasets = Object.keys(INGEST_DATASETS).length;

  return (
    <>
      <PageTitle lead="The trade-off, stated plainly — including the three things that are not the same.">
        CSV or connector — which to use
      </PageTitle>

      <Callout tone="limit" title="They are not two doors into one room">
        <p>
          It is tempting to read a connector as “the same upload, automated”. It is not, and the
          differences all point the same way: the file route is the one with the full set of
          guarantees behind it.
        </p>
      </Callout>

      <Section id="what-each-covers" title="What each one can actually load">
        <Key>
          The file route loads {datasets} datasets. The connector loads one.
        </Key>
        <P>
          Uploading covers your whole chain — arcs, bills of materials, item masters, the deep-tier
          network. The ERP connector brings across <strong>products</strong>, and nothing else. Every
          other table is a file, whether or not you have a connector configured.
        </P>
        <P>
          So this is not really a choice between two ways of loading your data. It is a choice about
          one table, made against a background where everything else arrives as a file.
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
                  The product data comes to you and can be refreshed without anybody exporting
                  anything. Good for a model that is kept current. It carries whatever your system
                  of record carries, including the parts you would have cleaned up by hand.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Section id="what-is-the-same" title="What is genuinely the same">
        <P>
          Both routes stage before they change anything, both produce a run you can look at with a
          count of new, changed and unchanged rows, and both record what was substituted on the way
          in as mapping warnings. Neither writes over your tier-2 data without a staged copy
          existing first.
        </P>
        <P>
          Both also name the person who applied the change, and the tier-2 write records them. For
          a sync that applied itself, that person is <strong>whoever created the link and set the
          threshold</strong> — attribution to who authorised the automation, not to somebody present
          at the time. The run records which of the two it was.
        </P>
      </Section>

      <Section id="what-is-not" title="What is not">
        <div className="space-y-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              A sync can apply itself, and an upload cannot
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              A link with an auto-apply threshold applies its own run when the change is small
              relative to the live table and nothing failed to map. That is the setting doing what
              it says — but it means <strong>a connector can change your data with nobody looking
              at the diff</strong>, and an upload never can. Set the threshold to zero if you want
              every sync reviewed.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              No file is kept for a sync
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              An upload keeps the bytes you uploaded, so “what exactly did we load in March” is
              answerable from the file itself. A sync has no file — what it fetched is reconstructed
              from the staged rows, and only for as long as they are kept.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              The two paths are different code
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              An upload is parsed and validated from the data contract itself, so a column rule
              changes in one place and both the uploader and the documentation follow. The sync maps
              its own fields. They agree today; nothing makes them agree tomorrow.
            </p>
          </div>
        </div>
      </Section>

      <Callout title="The honest answer for most people is both">
        <p>
          Connect products if your item master genuinely moves and you have the connector. Upload
          the rest, and upload the things you decided — which materials are in scope, how the bill
          of materials is modelled. A model is not a copy of your ERP, and the parts of it that are
          judgement do not belong in a sync.
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
          <DocLink to="connecting-erp">Connecting an ERP / MRP system</DocLink> is how a link is
          made · <DocLink to="reviewing-a-sync">Reviewing and applying a sync</DocLink> is the
          review a threshold can skip ·{" "}
          <DocLink to="uploading-data">Uploading data</DocLink> is the other route ·{" "}
          <DocLink to="products">Products</DocLink> is the one table both can write.
        </P>
        <P>
          Both live on <AppLink to="/project-manager">Project Manager</AppLink>.
        </P>
      </Section>

      <Provenance from="the ingestion spec for the file route's dataset count, and the ERP sync function itself for what it stages, what it promotes and when it applies without a person — the two are different code paths and the page says which fact came from which" />
    </>
  );
}
