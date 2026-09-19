// §6.3 section 12 — the reproducibility record (A5).
//
// ── THE MOST HONEST PAGE IN THE MANUAL, AND IT HAS TO BE ──────────────────
//
// Two invariants are NOT met here and the page says so in the reader's words:
//
//   input-hash (I5)     every derived row carries the input hash it came from.
//                       The dual-write is shipped and correct; what is missing
//                       is that nobody has run an analysis since, so every
//                       derived row that exists predates provenance (§4 D88).
//   result-binding (I8) every result binds dataset + policy + scenario +
//                       engine version. The record itself is owed by WP 6.3.
//
// So the page cannot describe a working feature, and describing it as though it
// worked would be the exact failure §5.3 T3 exists to prevent — in the manual's
// own page about reproducibility. It describes what is there, what is not, and
// what a reader can do today instead.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, Provenance } from "@/components/docs/prose";
import { refTable, computedColumns } from "@/components/docs/tableFacts";

const CARRIES_PROVENANCE = ["network_nodes", "node_list", "network_summary", "supply_chain_data"];

export default function ReproducibilityRecord() {
  // Which tables carry the provenance columns is read from the contract's
  // `computed_by` declarations, not asserted — a table that gained or lost them
  // changes this page with no edit.
  const withStamp = CARRIES_PROVENANCE.map((name) => {
    const t = refTable(name);
    return { table: name, stamped: computedColumns(t).some((c) => c.name === "computed_from_hash") };
  }).filter((x) => x.stamped);

  return (
    <>
      <PageTitle lead="The stamp that lets someone else rerun exactly what you ran — and what is honestly in place today.">
        Reproducibility record
      </PageTitle>

      <Section id="what-it-would-be" title="What a reproducibility record is">
        <Key>
          Four things, bound to one result: the data it ran on, the decisions it ran under, the
          scenario it ran in, and the version of the engine that ran it.
        </Key>
        <P>
          With all four, a figure can be handed to somebody else and recreated. With any one
          missing, it cannot — a number reproduced against different data is a different number that
          happens to look the same.
        </P>
      </Section>

      <Callout tone="limit" title="This record does not exist yet, and this page will not pretend it does">
        <p>
          The single artifact binding all four is not built. It is the next substantial piece of
          work in this area, and until it lands the honest statement is that{" "}
          <strong>a result is reproducible in pieces rather than as a record</strong>.
        </p>
        <p>
          What you can do today: export all three{" "}
          <DocLink to="verifiable-exports">verifiable workbooks</DocLink> for the same run. Between
          them they carry the dataset fingerprint, the policy fingerprint and the run's own
          metadata, and a reader can confirm the three belong together. That is most of the record,
          assembled by hand, with nothing checking that you assembled it completely.
        </p>
        <p>
          <strong>One conclusion already has all four, and it is the exception worth knowing.</strong>{" "}
          A <DocLink to="model-validation">model-validation card</DocLink> records the dataset, the
          policy set, the scenario and the engine build it was reached under — each by identity and
          by fingerprint — and names the run that was its evidence. So a validated model IS
          reproducible today. What is missing is the same binding on an ordinary figure.
        </p>
      </Callout>

      <Section id="the-stamps-that-do-exist" title="What is in place">
        <P>
          Every computed row is <em>able</em> to say which version of your data it came from. The
          columns exist on {withStamp.length} tables, the analyses that write them fill them in from
          the run rather than from a parameter — so a row cannot name a world its run never saw —
          and a check compares the stored values field by field against the run store.
        </P>
        <ul className="flex flex-wrap gap-1.5">
          {withStamp.map((x) => (
            <li key={x.table}>
              <span className="rounded-sm border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {x.table}
              </span>
            </li>
          ))}
        </ul>
        <P>
          One table deliberately has no such column: the deep-tier edges, because every column of it
          is uploaded. A provenance stamp no writer could fill would be a promise rather than a
          fact.
        </P>
      </Section>

      <Callout tone="limit" title="And every derived row that exists today carries no stamp">
        <p>
          The mechanism is shipped and correct. What has not happened is that anybody has run an
          analysis since it shipped — so the rows sitting in the database were all written before
          provenance existed, and <Term>computed_from_hash</Term> is empty on every one of them.
        </p>
        <p>
          <strong>They cannot be back-filled.</strong> A row written before the anchor existed has
          no hash, and inventing one would be fabricated provenance — worse than an empty column,
          because an empty column is legible as “we do not know” and a made-up hash is not.
        </p>
        <p>
          The practical reading: a computed number in a project that has not been recomputed
          recently is reported as <em>unknown</em> rather than as current or stale, and{" "}
          <DocLink to="data-trust-report">Data Trust Report</DocLink> is where you see that count.
          Running the analysis again is what fills it in.
        </p>
      </Callout>

      <Section id="what-to-do" title="What to do if you need a defensible figure today">
        <P>
          Freeze a <DocLink to="dataset-versions">dataset version</DocLink> and save a{" "}
          <DocLink to="policy-versions-and-presets">policy version</DocLink> before the run, not
          after. Both are fingerprinted at the moment you take them, and a run that names them can
          be pointed at later; a run against unfrozen data cannot, however carefully it was recorded
          elsewhere.
        </P>
        <P>
          Then export the three workbooks for that run and keep them together. It is assembly by
          hand, and it works.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="verifiable-exports">Verifiable exports</DocLink> ·{" "}
          <DocLink to="dataset-versions">Dataset Versions</DocLink> ·{" "}
          <DocLink to="data-trust-report">Data Trust Report</DocLink> ·{" "}
          <DocLink to="known-limits">Known limits</DocLink> ·{" "}
          <DocLink to="model-validation">Model validation</DocLink>
        </P>
      </Section>

      <Provenance from="the provenance columns the contract declares on each derived table, and the analyses that write them" />
    </>
  );
}
