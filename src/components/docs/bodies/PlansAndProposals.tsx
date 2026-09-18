// §6.3 section 9 — plans and proposals.

import { PageTitle, Section, P, Key, Callout, Steps, Term, DocLink, Provenance } from "@/components/docs/prose";

export default function PlansAndProposals() {
  return (
    <>
      <PageTitle lead="Review before apply — nothing changes because a model suggested it.">
        Plans and proposals
      </PageTitle>

      <Section id="the-shape" title="The shape of it">
        <Key>
          The assistant proposes; you apply. Those are two separate events, and the second one is
          always yours.
        </Key>
        <P>
          A <em>plan</em> is what the assistant intends to do, written out before it does any of
          it. A <em>proposal</em> is a specific change waiting for your decision. Neither touches
          your project until you say so, and a proposal you never look at simply stays a proposal.
        </P>
      </Section>

      <Section id="how-it-goes" title="How it goes">
        <Steps
          steps={[
            {
              title: "You ask for something",
              body: <>“Set safety stock to four weeks on everything from this supplier.”</>,
            },
            {
              title: "It writes a plan",
              body: (
                <>
                  What it would change, on which rows, and why. You can read the plan and stop
                  there.
                </>
              ),
            },
            {
              title: "It proposes the change",
              body: (
                <>
                  The concrete edit, as values. It is stored as a proposal, against the state of the
                  project it was computed from.
                </>
              ),
            },
            {
              title: "You apply it — or you do not",
              body: (
                <>
                  Applying writes the same overrides you would have typed, through the same path.
                  Nothing downstream can tell the difference, which is deliberate: an applied
                  proposal is your decision, not a third kind of provenance.
                </>
              ),
            },
          ]}
        />
      </Section>

      <Callout tone="law" title="A proposal knows which data it was computed from">
        <p>
          A proposal is grounded on a version of your project. If the data moves underneath it —
          you re-upload, or an analysis recomputes — the proposal is marked as describing a state
          that no longer holds, rather than silently applying to a world it never saw.
        </p>
        <p>
          That is the same anchor <DocLink to="dataset-versions">Dataset Versions</DocLink>{" "}
          describes, used to stop an old suggestion looking current.
        </p>
      </Callout>

      <Callout tone="limit" title="Applying is as reversible as any other edit, and no more">
        <p>
          An applied proposal becomes ordinary policy overrides. You can change them back the way
          you change any override, and there is no single “undo this proposal” that reaches into
          your project and lifts it out. If a proposal is large, saving a{" "}
          <DocLink to="policy-versions-and-presets">policy version</DocLink> first is what gives you
          a point to return to.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="ai-assistant">The AI assistant</DocLink> ·{" "}
          <DocLink to="how-policies-work">How policies work</DocLink> ·{" "}
          <DocLink to="audit-log">Audit log</DocLink> ·{" "}
          <DocLink to="policy-versions-and-presets">Policy versions &amp; presets</DocLink>
        </P>
      </Section>

      <Provenance from="the proposal grounding rule the data contract declares" />
    </>
  );
}
