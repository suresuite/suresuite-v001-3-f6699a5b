// §6.3 section 12 — the three workbooks (A4).

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";

const WORKBOOKS = [
  {
    name: "Policy snapshot",
    what: "The saved policy version: every family, every override, every cell.",
    stamp: "the policy fingerprint",
    checkable:
      "Under every value row sits a provenance row grading the cell — set (differs from the schema default), equal to the schema default, override, or inherited. So a reader can tell a decision you made from a default you never touched.",
    honest:
      "Storage cannot distinguish “never touched” from “deliberately set to the default value”, and the export says so rather than picking one.",
  },
  {
    name: "Dataset",
    what: "The exact canonical rows the dataset fingerprint was computed over, one sheet per table the engine reads.",
    stamp: "the dataset fingerprint",
    checkable:
      "Not “the rows as they are now” — the rows as they were when the version was frozen, taken from the snapshot itself. Someone can recompute the fingerprint from the sheets and get the same value.",
    honest:
      "A sheet the fingerprint does not cover would be a sheet a reader would wrongly believe was verified, so the workbook carries the snapshot and not a fresh query.",
  },
  {
    name: "Run results",
    what: "Per-run metadata, aggregate KPIs with confidence intervals, one row per seed, and a weeks-by-seeds sheet per stored series.",
    stamp: "the run's own provenance",
    checkable:
      "The per-seed sheet is what makes the confidence interval checkable: a reader can recompute the spread rather than taking the summary on trust.",
    honest:
      "A single aggregate number with no seeds behind it is not a result anyone can argue with, which is why the seeds ship.",
  },
];

export default function VerifiableExports() {
  return (
    <>
      <PageTitle lead="Three workbooks that let someone check your model without access to this software.">
        Verifiable exports
      </PageTitle>

      <Section id="the-idea" title="What makes an export verifiable">
        <Key>
          It carries what it was computed from, not only what was computed.
        </Key>
        <P>
          A spreadsheet of results is a claim. A spreadsheet of results, plus the exact inputs, plus
          the fingerprint tying the two together, is something a reviewer can check — by recomputing
          the fingerprint, by reading the inputs, or by rerunning the model elsewhere.
        </P>
        <P>
          That is the whole difference, and it is why there are three files rather than one: they
          answer <em>what did you decide</em>, <em>what did you decide it on</em>, and{" "}
          <em>what came out</em>.
        </P>
      </Section>

      <Section id="the-three" title="The three workbooks">
        <div className="space-y-3">
          {WORKBOOKS.map((w) => (
            <div key={w.name} id={w.name.toLowerCase().replace(/\s+/g, "-")} className="scroll-mt-20 rounded-sm border border-border bg-card p-4 shadow-xs">
              <div className="text-sm font-semibold text-foreground">{w.name}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{w.what}</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                <span className="text-foreground">Stamped with:</span> {w.stamp}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                <span className="text-foreground">What makes it checkable:</span> {w.checkable}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                <span className="text-foreground">And what it admits:</span> {w.honest}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Callout tone="limit" title="Three files, not yet one record">
        <p>
          Each workbook carries its own stamp. What does not exist yet is the single record that
          binds all four things together — dataset, policy set, scenario and engine version — as one
          artifact you can hand over.{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink> is that page, and it
          says plainly that the record is owed rather than shipped.
        </p>
        <p>
          In the meantime, exporting all three of these for the same run is the closest thing, and
          the fingerprints are what let a reader confirm they belong together.
        </p>
      </Callout>

      <Section id="where" title="Where to get them">
        <P>
          From the policy screen at <AppLink to="/policies">/policies</AppLink>, against a saved{" "}
          <DocLink to="policy-versions-and-presets">policy version</DocLink>. A version is required
          rather than optional: an export of unsaved decisions would carry a fingerprint over
          something nobody could return to.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="dataset-versions">Dataset Versions</DocLink> ·{" "}
          <DocLink to="reproducibility-record">Reproducibility record</DocLink> ·{" "}
          <DocLink to="reading-your-results">Reading your results</DocLink> ·{" "}
          <DocLink to="exporting-and-deleting">Exporting and deleting your data</DocLink>
        </P>
      </Section>

      <Provenance from="the three workbook builders and the stamps each one writes" />
    </>
  );
}
