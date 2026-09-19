// §6.3 section 9 — the AI assistant.

import { PageTitle, Section, P, Key, Callout, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { ReadsFrom } from "@/components/docs/lineage";

export default function AiAssistant() {
  return (
    <>
      <PageTitle lead="What it can see, what it can do, and what it cannot do without you.">
        The AI assistant
      </PageTitle>

      <Section id="what-it-is" title="What it is for">
        <P>
          A conversation about your project, with the project in front of it. You can ask what your
          data says, what a policy would change, or what a result means, without leaving the tool
          and without knowing which screen holds the answer.
        </P>
        <Key>
          It can read and it can propose. It cannot change your project on its own — every change it
          suggests arrives as something you approve or discard.
        </Key>
      </Section>

      <Section id="reads" title="What this screen reads">
        <ReadsFrom page="ProjectIntelligence.tsx" />
      </Section>

      <Callout tone="law" title="Nothing it says is a result">
        <p>
          An answer from the assistant is a reading of your data, not a number with a run behind it.
          It carries no dataset fingerprint, no policy version and no engine version, so it cannot
          be reproduced and it should not be quoted as a finding.
        </p>
        <p>
          When you need a figure that survives being asked about, run the simulation and take it
          from there. <DocLink to="reproducibility-record">Reproducibility record</DocLink> is what
          that difference is called.
        </p>
      </Callout>

      <Section id="conversations" title="Conversations and folders">
        <P>
          Threads are kept, so a line of enquiry can be picked up later, and can be organised into
          folders when there are enough of them to need it. A thread belongs to a project — asking
          the assistant about one project from inside another is not something the tool lets you do
          by accident.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="plans-and-proposals">Plans and proposals</DocLink> ·{" "}
          <DocLink to="project-memory">Project memory</DocLink> ·{" "}
          <DocLink to="models-budgets-limits">Models, budgets and limits</DocLink> ·{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink>
        </P>
        <P>
          Open it at <AppLink to="/project-intelligence">/project-intelligence</AppLink>.
        </P>
      </Section>

      <Provenance from="WP 5.1's confirmed table-grain lineage for this page" />
    </>
  );
}
