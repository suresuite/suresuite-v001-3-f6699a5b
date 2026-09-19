// §6.3 section 4 — Dataset Versions. The trust anchor.
//
// The hash columns' meanings are read from the contract, which matters here more
// than anywhere: `hash_network`'s description was three tables out of date when
// this page was written, because WP 5.3's migration folded the deep-tier
// topology in and the sidecar was not updated with it. Rendering the sidecar is
// what made that visible.

import { PageTitle, Section, P, Key, Callout, Prose, Term, DocLink, Provenance } from "@/components/docs/prose";
import { refTable } from "@/components/docs/tableFacts";
import { SuppliedAndComputed, DatabaseRules, HowItLoads } from "@/components/docs/tableRef";

export default function DatasetVersions() {
  const t = refTable("dataset_versions");
  const hashes = t.columns.filter((c) => c.name.startsWith("hash_") || c.name === "graph_hash");

  return (
    <>
      <PageTitle lead="A frozen copy of your data, and the fingerprint that identifies it.">
        Dataset Versions
      </PageTitle>

      <Section id="why" title="Why a version exists at all">
        <Key>
          A result is only meaningful with the data that produced it. A run that names a dataset
          version can be reproduced; one that does not, cannot.
        </Key>
        <P>
          So freezing a version does two things. It keeps the actual rows — not a pointer to rows
          that may since have changed, the rows themselves — and it computes a fingerprint over
          them. Two runs with the same fingerprint saw the same world.
        </P>
        <HowItLoads
          table={t}
          instead={
            <p>
              Written when a version is frozen, from the tier-2 tables as they stand at that moment.
              Nothing uploads it and nothing edits it afterwards — that is the point of it.
            </p>
          }
        />
      </Section>

      <Section id="the-hashes" title="The fingerprints, and why there are three">
        <P>
          One hash would answer “did anything change”. Three answer “did anything that matters to
          <em> this</em> question change”, which is a more useful thing to know when you are trying
          to work out whether a stored result is still good.
        </P>
        <div className="divide-y divide-border rounded-sm border border-border bg-card shadow-xs">
          {hashes.map((c) => (
            <div key={c.name} id={c.name} className="scroll-mt-20 p-4">
              <span className="font-mono text-[13px] font-semibold text-foreground">{c.name}</span>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                <Prose text={c.meaning} />
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Callout tone="law" title="A hash moving is not a problem. A hash not moving is.">
        <p>
          When you change your data the fingerprint changes, which is how anything computed from the
          old data can be marked as describing something else. The failure mode is the reverse: a
          change the fingerprint does not see, so a stored result looks current when it is not.
        </p>
        <p>
          That happened once and it is the reason the deep-tier topology is inside the network
          fingerprint now: a re-uploaded network left the anchor unmoved, and centralities computed
          against the previous graph were served back as though they were current.
        </p>
      </Callout>

      <Section id="columns" title="Every column">
        <SuppliedAndComputed table={t} />
      </Section>

      <DatabaseRules table={t} />

      <Section id="related" title="Related">
        <P>
          <DocLink to="reproducibility-record">Reproducibility record</DocLink> ·{" "}
          <DocLink to="data-trust-report">Data Trust Report</DocLink> ·{" "}
          <DocLink to="verifiable-exports">Verifiable exports</DocLink> ·{" "}
          <DocLink to="network-science-metrics">Network science metrics</DocLink>
        </P>
      </Section>

      <Provenance from="supabase/contract/dataset_versions.contract.yaml, joined to the schema" />
    </>
  );
}
