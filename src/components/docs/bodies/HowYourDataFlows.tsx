import { PageTitle, Section, P, Key, Callout, DocLink, Term } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";
import { DataFlow } from "@/components/docs/figures";

export default function HowYourDataFlows() {
  return (
    <>
      <PageTitle lead="One file, followed from your desktop to a stamped result.">
        How your data flows
      </PageTitle>

      <Section id="the-shape" title="The shape of it">
        <P>
          Seven hops. Each one either checks something, adds something, or records something — and
          each lands in one of the six tiers described on{" "}
          <DocLink to="how-suresuite-is-designed">How SuReSuite is designed</DocLink>. Nothing skips
          a hop, and nothing moves backwards.
        </P>
        <DocFigure id="flow" fallback={<DataFlow />} />
      </Section>

      <Section id="upload" title="1. You upload a file">
        <P>
          You pick a dataset — inbound lanes, products, the bill of materials — and give it a CSV.
          The file is kept exactly as you sent it, byte for byte, before anything reads it.
        </P>
        <P>
          That matters more than it sounds. If a later step misreads a column, the question is
          always “what did the file actually say?”, and the only answer that settles it is the file.
          Keeping the original is what makes every later step reviewable rather than a matter of
          trust.
        </P>
      </Section>

      <Section id="check" title="2. We parse and check it">
        <P>
          The file is parsed and the contents are checked against what that dataset is supposed to
          contain: the headers that must be present, the values that must be numbers, the
          identifiers that must point at something that exists.
        </P>
        <P>
          Findings come back in three severities — <Term>block</Term>, <Term>warn</Term> and{" "}
          <Term>info</Term> — and the vocabulary is the same everywhere it appears, because it comes
          from one place in the code rather than being restated per screen.{" "}
          <DocLink to="verify-your-inputs">Verify your inputs</DocLink> covers what each finding
          means and how to clear it.
        </P>
        <Key>Nothing in your project has changed at this point. Findings are about the file.</Key>
      </Section>

      <Section id="promote" title="3. You promote it">
        <P>
          Once the file is acceptable, its contents are promoted into your project. This is the one
          hop where external data crosses into your data, and it is where two things happen exactly
          once:
        </P>
        <P>
          <strong className="text-foreground">Units are normalised.</strong> A lead time given in
          weeks and one given in days become the same kind of number here. Nothing further
          downstream converts anything, which is what stops a value being converted twice — the
          failure that turns a week into a month and looks completely ordinary on screen.
        </P>
        <P>
          <strong className="text-foreground">Rows are matched, not appended.</strong> Each table has
          a natural key: the combination of fields that identifies one real thing. Re-uploading a
          corrected file updates the rows it matches instead of adding a second copy of everything.
        </P>
        <Callout tone="limit" title="Partly true today">
          <p>
            Row matching is not yet in place for the four lane and bill-of-materials tables:
            uploading the same file twice currently adds the rows twice. It is a known defect with a
            fix scheduled, and it is listed on{" "}
            <DocLink to="known-limits">Known limits</DocLink> rather than left for you to discover.
          </p>
        </Callout>
      </Section>

      <Section id="compute" title="4. We compute from it">
        <P>
          With your data in place, the derived layer is built: sourcing shares, effective
          product-to-material rows collapsed out of a deep bill of materials, expanded supply paths,
          network summaries and structural metrics.
        </P>
        <P>
          None of it is editable, and all of it can be thrown away and rebuilt. If a derived figure
          looks wrong, the cause is in your data or in the computation — never in a stale copy, because
          there is no copy to go stale.
        </P>
      </Section>

      <Section id="decide" title="5. You set policies">
        <P>
          Policies are the decisions: how much stock to hold, when to reorder, which supplier backs
          up which, what happens when capacity runs out. They are set once for the project and then
          patched per node where a particular supplier or material needs different treatment.
        </P>
        <P>
          Where a policy needs a number you have not supplied, the software may substitute one — and
          when it does, it says so at the point the value is shown, with a marker telling you where
          the number came from. A substitution that is not declared in the contract cannot exist in
          the code at all.
        </P>
      </Section>

      <Section id="simulate" title="6. You simulate">
        <P>
          A run executes the model many times rather than once, because a single run of a system
          with randomness in it tells you almost nothing. What comes back is a distribution with a
          confidence interval — a range, and how sure the range is.
        </P>
        <P>
          The work happens on a separate worker, not in your browser. You can close the tab; the run
          continues and the result is waiting.
        </P>
      </Section>

      <Section id="stamp" title="7. The result is stamped">
        <P>
          The result records the exact dataset version, the exact policy set, the scenario and the
          engine version it ran against — together, as one stamp. Two results can then be compared
          honestly, because you can see whether they differ because of the change you made or
          because something underneath moved.
        </P>
        <Key>
          A figure that leaves the system carries that stamp with it. A figure that cannot be
          reproduced is treated as a figure that should not be published.
        </Key>
      </Section>
    </>
  );
}
